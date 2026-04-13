/**
 * AnimatedCursor injects an SVG cursor that flies to a target element along
 * a quadratic bezier arc. This is the visual signature of Clicky macOS — the
 * blue cursor that "points" at things the LLM mentions in its response.
 *
 * The cursor is rendered in a fixed-position, pointer-events:none container
 * so it never intercepts interactions. It is intentionally standalone and
 * independent of HighlightOverlay so the two can animate in parallel.
 */

const CURSOR_CONTAINER_ID = 'clicky-animated-cursor-root'
const DEFAULT_DURATION_MS = 1200
const DEFAULT_COLOR = '#3b82f6'

export interface FlyToOptions {
  label?: string
  duration?: number
  color?: string
  onArrived?: () => void
}

interface Point {
  x: number
  y: number
}

export class AnimatedCursor {
  private container: HTMLDivElement | null = null
  private cursorEl: HTMLDivElement | null = null
  private labelEl: HTMLDivElement | null = null
  private rafHandle: number | null = null
  private currentPosition: Point = { x: 0, y: 0 }
  private prefersReducedMotion = false
  private mounted = false

  mount(): void {
    if (this.mounted || typeof document === 'undefined') return
    this.prefersReducedMotion =
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

    const container = document.createElement('div')
    container.id = CURSOR_CONTAINER_ID
    container.setAttribute('aria-hidden', 'true')
    container.style.cssText = [
      'position:fixed',
      'inset:0',
      'pointer-events:none',
      'z-index:2147483647',
      'overflow:visible',
    ].join(';')

    const cursorEl = document.createElement('div')
    cursorEl.style.cssText = [
      'position:absolute',
      'left:0',
      'top:0',
      'width:28px',
      'height:28px',
      'transform:translate(-50%,-50%) scale(0)',
      'transition:transform 220ms ease',
      'will-change:transform,left,top',
    ].join(';')
    cursorEl.innerHTML = cursorSvg(DEFAULT_COLOR)

    const labelEl = document.createElement('div')
    labelEl.style.cssText = [
      'position:absolute',
      'left:0',
      'top:0',
      'transform:translate(18px,-6px)',
      'padding:6px 10px',
      'background:rgba(20,20,22,0.88)',
      'backdrop-filter:blur(6px)',
      '-webkit-backdrop-filter:blur(6px)',
      'color:#ffffff',
      'font:500 12px/1.2 system-ui,-apple-system,sans-serif',
      'border-radius:8px',
      'opacity:0',
      'transition:opacity 180ms ease',
      'white-space:nowrap',
      'box-shadow:0 6px 20px rgba(0,0,0,0.25)',
    ].join(';')

    container.appendChild(cursorEl)
    container.appendChild(labelEl)
    document.body.appendChild(container)

    this.container = container
    this.cursorEl = cursorEl
    this.labelEl = labelEl
    this.mounted = true
    const initialX = typeof window !== 'undefined' ? window.innerWidth - 60 : 0
    const initialY = typeof window !== 'undefined' ? window.innerHeight - 60 : 0
    this.currentPosition = { x: initialX, y: initialY }
    this.applyPosition(initialX, initialY)
  }

  unmount(): void {
    if (this.rafHandle !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafHandle)
    }
    this.rafHandle = null
    this.container?.remove()
    this.container = null
    this.cursorEl = null
    this.labelEl = null
    this.mounted = false
  }

  show(): void {
    if (!this.cursorEl) return
    this.cursorEl.style.transform = 'translate(-50%,-50%) scale(1)'
  }

  hide(): void {
    if (!this.cursorEl) return
    this.cursorEl.style.transform = 'translate(-50%,-50%) scale(0)'
    if (this.labelEl) this.labelEl.style.opacity = '0'
  }

  async flyTo(target: HTMLElement | string, options: FlyToOptions = {}): Promise<void> {
    if (!this.mounted) this.mount()
    if (!this.cursorEl || !this.labelEl) return

    const element = typeof target === 'string' ? this.resolveSelector(target) : target
    if (!element) return

    const color = options.color ?? DEFAULT_COLOR
    this.cursorEl.innerHTML = cursorSvg(color)

    if (typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({
        behavior: this.prefersReducedMotion ? 'auto' : 'smooth',
        block: 'center',
      })
    }

    if (options.label) {
      this.labelEl.textContent = options.label
      this.labelEl.style.opacity = '1'
    } else {
      this.labelEl.style.opacity = '0'
    }

    this.show()

    const destination = (): Point => {
      const rect = element.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    }

    if (this.prefersReducedMotion) {
      const end = destination()
      this.currentPosition = end
      this.applyPosition(end.x, end.y)
      options.onArrived?.()
      return
    }

    const start: Point = { ...this.currentPosition }
    const duration = options.duration ?? DEFAULT_DURATION_MS

    // Bezier control point: midpoint pushed upward to create an arc.
    const midBase: Point = { x: (start.x + destination().x) / 2, y: (start.y + destination().y) / 2 }
    const distance = Math.hypot(destination().x - start.x, destination().y - start.y)
    const arcHeight = Math.min(160, Math.max(60, distance * 0.25))
    const control: Point = { x: midBase.x, y: midBase.y - arcHeight }

    return new Promise<void>((resolve) => {
      const startTime = performance.now()
      const step = (): void => {
        if (!this.cursorEl) {
          resolve()
          return
        }
        const now = performance.now()
        const raw = Math.min(1, (now - startTime) / duration)
        const eased = easeInOutCubic(raw)

        // Recompute destination each frame so user scrolling is tracked.
        const end = destination()
        const p = quadBezier(start, control, end, eased)
        this.currentPosition = p
        this.applyPosition(p.x, p.y)

        if (raw >= 1) {
          this.rafHandle = null
          this.pulseOnArrival()
          options.onArrived?.()
          resolve()
          return
        }
        this.rafHandle = requestAnimationFrame(step)
      }
      this.rafHandle = requestAnimationFrame(step)
    })
  }

  private pulseOnArrival(): void {
    if (!this.cursorEl) return
    const el = this.cursorEl
    el.style.transition = 'transform 280ms cubic-bezier(.2,1.4,.4,1)'
    el.style.transform = 'translate(-50%,-50%) scale(1.35)'
    setTimeout(() => {
      if (!this.cursorEl) return
      this.cursorEl.style.transform = 'translate(-50%,-50%) scale(1)'
      this.cursorEl.style.transition = 'transform 220ms ease'
    }, 240)
  }

  private applyPosition(x: number, y: number): void {
    if (!this.cursorEl || !this.labelEl) return
    this.cursorEl.style.left = `${x}px`
    this.cursorEl.style.top = `${y}px`
    this.labelEl.style.left = `${x}px`
    this.labelEl.style.top = `${y}px`
  }

  private resolveSelector(selector: string): HTMLElement | null {
    if (typeof document === 'undefined') return null
    try {
      return document.querySelector(selector) as HTMLElement | null
    } catch {
      return null
    }
  }
}

const cursorSvg = (color: string): string =>
  `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg" style="display:block;filter:drop-shadow(0 4px 10px rgba(0,0,0,0.25))">
    <path d="M4 3 L22 13 L14 15 L11 24 Z" fill="${color}" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`

const quadBezier = (p0: Point, p1: Point, p2: Point, t: number): Point => {
  const oneMinusT = 1 - t
  const x = oneMinusT * oneMinusT * p0.x + 2 * oneMinusT * t * p1.x + t * t * p2.x
  const y = oneMinusT * oneMinusT * p0.y + 2 * oneMinusT * t * p1.y + t * t * p2.y
  return { x, y }
}

const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
