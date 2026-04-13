/**
 * AnimatedCursor injects an SVG cursor that lives on the page next to the
 * user's mouse cursor. This is the visual signature of Clicky macOS — a small
 * blue companion that:
 *
 *   - is always visible (persistent: true, default)
 *   - lazily follows the mouse with a lerp so it feels alive
 *   - reacts to the agent's state (idle, listening, thinking, speaking, acting)
 *   - flies to a specific element on demand via flyTo() when the LLM points
 *
 * It's rendered in a fixed-position, pointer-events:none container so it
 * never intercepts user interactions.
 */

import type { AgentState } from './types'

const CURSOR_CONTAINER_ID = 'clicky-animated-cursor-root'
const DEFAULT_DURATION_MS = 1200
const DEFAULT_COLOR = '#3b82f6'
const DEFAULT_LERP = 0.15
const FOLLOW_OFFSET = { x: 18, y: 18 } // sit just below-right of the mouse

export interface AnimatedCursorOptions {
  persistent?: boolean
  color?: string
  lerpFactor?: number
  idleAnimation?: boolean
}

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
  private ringEl: HTMLDivElement | null = null
  private labelEl: HTMLDivElement | null = null
  private rafHandle: number | null = null
  private followRaf: number | null = null
  private currentPosition: Point = { x: 0, y: 0 }
  private targetPosition: Point = { x: 0, y: 0 }
  private prefersReducedMotion = false
  private mounted = false
  private flying = false
  private flyReturnTimer: ReturnType<typeof setTimeout> | null = null

  private readonly persistent: boolean
  private readonly color: string
  private readonly lerpFactor: number

  private mouseListener: ((e: MouseEvent) => void) | null = null

  constructor(options: AnimatedCursorOptions = {}) {
    this.persistent = options.persistent ?? true
    this.color = options.color ?? DEFAULT_COLOR
    this.lerpFactor = options.lerpFactor ?? DEFAULT_LERP
    // idleAnimation reserved for future opt-out — currently controlled via CSS
    void options.idleAnimation
  }

  mount(): void {
    if (this.mounted || typeof document === 'undefined') return
    this.prefersReducedMotion =
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

    injectStylesOnce()

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
    cursorEl.className = 'clicky-cursor'
    cursorEl.style.cssText = [
      'position:absolute',
      'left:0',
      'top:0',
      'width:24px',
      'height:24px',
      'transform:translate(-50%,-50%) scale(0)',
      'transition:transform 320ms cubic-bezier(.2,1.4,.4,1)',
      'will-change:transform,left,top',
      `--clicky-cursor-color:${this.color}`,
    ].join(';')
    cursorEl.innerHTML = cursorSvg(this.color)

    const ringEl = document.createElement('div')
    ringEl.className = 'clicky-cursor-ring'
    ringEl.style.cssText = [
      'position:absolute',
      'left:0',
      'top:0',
      'width:44px',
      'height:44px',
      'transform:translate(-50%,-50%)',
      'border-radius:50%',
      'pointer-events:none',
      'opacity:0',
      `border:2px solid ${this.color}`,
      'box-sizing:border-box',
      'transition:opacity 240ms ease',
    ].join(';')

    const labelEl = document.createElement('div')
    labelEl.className = 'clicky-cursor-label'
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

    container.appendChild(ringEl)
    container.appendChild(cursorEl)
    container.appendChild(labelEl)
    document.body.appendChild(container)

    this.container = container
    this.cursorEl = cursorEl
    this.ringEl = ringEl
    this.labelEl = labelEl
    this.mounted = true

    // Initial position: bottom-right corner if no mouse known yet.
    const initialX = typeof window !== 'undefined' ? window.innerWidth - 80 : 0
    const initialY = typeof window !== 'undefined' ? window.innerHeight - 80 : 0
    this.currentPosition = { x: initialX, y: initialY }
    this.targetPosition = { x: initialX, y: initialY }
    this.applyPosition(initialX, initialY)

    if (this.persistent && !this.prefersReducedMotion) {
      this.startFollow()
      // Entrance animation after a tick so the scale(0) is committed.
      requestAnimationFrame(() => this.show())
    } else if (this.persistent) {
      // Reduced motion: just snap visible at corner with no follow.
      this.show()
    }
  }

  unmount(): void {
    if (this.rafHandle !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafHandle)
    }
    if (this.followRaf !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.followRaf)
    }
    if (this.flyReturnTimer) {
      clearTimeout(this.flyReturnTimer)
      this.flyReturnTimer = null
    }
    if (this.mouseListener && typeof window !== 'undefined') {
      window.removeEventListener('mousemove', this.mouseListener)
    }
    this.mouseListener = null
    this.rafHandle = null
    this.followRaf = null
    this.container?.remove()
    this.container = null
    this.cursorEl = null
    this.ringEl = null
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
    if (this.ringEl) this.ringEl.style.opacity = '0'
  }

  /**
   * Sync the cursor's visual mood with the agent state machine. Called by
   * ClickyAgent.setState() so the companion is always in sync.
   */
  setState(state: AgentState): void {
    if (!this.cursorEl || !this.ringEl) return
    if (this.prefersReducedMotion) return

    // Reset base classes.
    this.cursorEl.classList.remove('clicky-state-idle', 'clicky-state-thinking', 'clicky-state-listening', 'clicky-state-speaking', 'clicky-state-acting')
    this.ringEl.classList.remove('clicky-ring-thinking', 'clicky-ring-listening', 'clicky-ring-speaking', 'clicky-ring-acting')

    this.cursorEl.classList.add(`clicky-state-${state}`)

    if (state === 'idle') {
      this.ringEl.style.opacity = '0'
      return
    }
    this.ringEl.style.opacity = '1'
    this.ringEl.classList.add(`clicky-ring-${state}`)
  }

  async flyTo(target: HTMLElement | string, options: FlyToOptions = {}): Promise<void> {
    if (!this.mounted) this.mount()
    if (!this.cursorEl || !this.labelEl) return

    const element = typeof target === 'string' ? this.resolveSelector(target) : target
    if (!element) return

    const color = options.color ?? this.color
    this.cursorEl.innerHTML = cursorSvg(color)
    this.flying = true
    if (this.flyReturnTimer) {
      clearTimeout(this.flyReturnTimer)
      this.flyReturnTimer = null
    }

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
      this.targetPosition = end
      this.applyPosition(end.x, end.y)
      options.onArrived?.()
      this.scheduleFlyReturn()
      return
    }

    const start: Point = { ...this.currentPosition }
    const duration = options.duration ?? DEFAULT_DURATION_MS

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

        const end = destination()
        const p = quadBezier(start, control, end, eased)
        this.currentPosition = p
        this.targetPosition = p
        this.applyPosition(p.x, p.y)

        if (raw >= 1) {
          this.rafHandle = null
          this.pulseOnArrival()
          options.onArrived?.()
          this.scheduleFlyReturn()
          resolve()
          return
        }
        this.rafHandle = requestAnimationFrame(step)
      }
      this.rafHandle = requestAnimationFrame(step)
    })
  }

  /* ----- internals ----- */

  private startFollow(): void {
    if (typeof window === 'undefined') return

    this.mouseListener = (e: MouseEvent): void => {
      // Sit slightly below-right so the cursor doesn't cover the user's mouse.
      this.targetPosition = { x: e.clientX + FOLLOW_OFFSET.x, y: e.clientY + FOLLOW_OFFSET.y }
    }
    window.addEventListener('mousemove', this.mouseListener, { passive: true })

    const tick = (): void => {
      if (!this.mounted || !this.cursorEl) return
      // While flying, the flight RAF owns position — don't fight it.
      if (!this.flying) {
        const dx = this.targetPosition.x - this.currentPosition.x
        const dy = this.targetPosition.y - this.currentPosition.y
        if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
          this.currentPosition = {
            x: this.currentPosition.x + dx * this.lerpFactor,
            y: this.currentPosition.y + dy * this.lerpFactor,
          }
          this.applyPosition(this.currentPosition.x, this.currentPosition.y)
        }
      }
      this.followRaf = requestAnimationFrame(tick)
    }
    this.followRaf = requestAnimationFrame(tick)
  }

  private scheduleFlyReturn(): void {
    // After holding on the target for a bit, reset to follow mode so the
    // companion catches back up to the user's mouse.
    if (!this.persistent) return
    this.flyReturnTimer = setTimeout(() => {
      this.flying = false
      if (this.labelEl) this.labelEl.style.opacity = '0'
    }, 800)
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
    if (!this.cursorEl || !this.labelEl || !this.ringEl) return
    this.cursorEl.style.left = `${x}px`
    this.cursorEl.style.top = `${y}px`
    this.ringEl.style.left = `${x}px`
    this.ringEl.style.top = `${y}px`
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
  `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="display:block;filter:drop-shadow(0 4px 12px ${hexToRgba(color, 0.45)})">
    <path d="M4 3 L20 12 L13 14 L10 22 Z" fill="${color}" stroke="white" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`

const quadBezier = (p0: Point, p1: Point, p2: Point, t: number): Point => {
  const oneMinusT = 1 - t
  const x = oneMinusT * oneMinusT * p0.x + 2 * oneMinusT * t * p1.x + t * t * p2.x
  const y = oneMinusT * oneMinusT * p0.y + 2 * oneMinusT * t * p1.y + t * t * p2.y
  return { x, y }
}

const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

const hexToRgba = (hex: string, alpha: number): string => {
  const m = hex.replace('#', '')
  if (m.length !== 6) return `rgba(59,130,246,${alpha})`
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

let stylesInjected = false
const injectStylesOnce = (): void => {
  if (stylesInjected || typeof document === 'undefined') return
  stylesInjected = true
  const style = document.createElement('style')
  style.setAttribute('data-clicky-cursor', '')
  style.textContent = `
@keyframes clicky-idle-pulse {
  0%, 100% { transform: translate(-50%,-50%) scale(1); }
  50%      { transform: translate(-50%,-50%) scale(1.06); }
}
@keyframes clicky-ring-thinking-spin {
  to { transform: translate(-50%,-50%) rotate(360deg); }
}
@keyframes clicky-ring-pulse {
  0%, 100% { transform: translate(-50%,-50%) scale(1); opacity: 0.65; }
  50%      { transform: translate(-50%,-50%) scale(1.25); opacity: 0.15; }
}
@keyframes clicky-ring-listening {
  0%, 100% { transform: translate(-50%,-50%) scale(1); opacity: 0.8; }
  50%      { transform: translate(-50%,-50%) scale(1.18); opacity: 0.35; }
}
@keyframes clicky-acting-blink {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.45; }
}
.clicky-cursor.clicky-state-idle {
  animation: clicky-idle-pulse 2.6s ease-in-out infinite;
}
.clicky-cursor.clicky-state-acting {
  animation: clicky-acting-blink 0.45s ease-in-out infinite;
}
.clicky-cursor-ring.clicky-ring-thinking {
  border-style: dashed;
  animation: clicky-ring-thinking-spin 1.4s linear infinite;
}
.clicky-cursor-ring.clicky-ring-speaking {
  animation: clicky-ring-pulse 1.1s ease-in-out infinite;
}
.clicky-cursor-ring.clicky-ring-listening {
  animation: clicky-ring-listening 1.3s ease-in-out infinite;
}
.clicky-cursor-ring.clicky-ring-acting {
  animation: clicky-ring-pulse 0.7s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .clicky-cursor, .clicky-cursor-ring { animation: none !important; }
}
`
  document.head.appendChild(style)
}
