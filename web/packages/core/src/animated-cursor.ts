/**
 * AnimatedCursor is the visual signature of Clicky — a small living
 * companion that shares the user's screen. It's always visible, follows
 * the mouse with spring physics, trails a soft glow, and reacts to the
 * agent state machine with recognisable body language.
 *
 * Visual states:
 *   idle      — breathing scale, slow drift
 *   thinking  — dashed ring spinning around the cursor
 *   listening — red pulse ring
 *   speaking  — 3-bar equaliser pulse
 *   acting    — quick blink
 *
 * Motion states:
 *   follow    — spring to user mouse position
 *   flying    — cubic bezier flight to a specific element, rotates to
 *               face its velocity vector, wobbles on arrival, ripples
 *   clicking  — scale-down press + expanding ripple
 */

import type { AgentState } from './types'

const CURSOR_CONTAINER_ID = 'clicky-animated-cursor-root'
const DEFAULT_DURATION_MS = 1100
const DEFAULT_COLOR = '#3b82f6'
const FOLLOW_OFFSET = { x: 18, y: 18 } // sit just below-right of the mouse
const TRAIL_LENGTH = 10
const SPRING_STIFFNESS = 170
const SPRING_DAMPING = 18
const SPRING_MASS = 1

export interface AnimatedCursorOptions {
  persistent?: boolean
  color?: string
  /** @deprecated lerp has been replaced by spring physics. Kept for API compat. */
  lerpFactor?: number
  idleAnimation?: boolean
}

export interface FlyToOptions {
  label?: string
  duration?: number
  color?: string
  onArrived?: () => void
  click?: boolean
}

interface Point {
  x: number
  y: number
}

class SpringValue {
  private velocity = 0
  constructor(private value: number) {}
  get(): number {
    return this.value
  }
  set(value: number): void {
    this.value = value
    this.velocity = 0
  }
  update(dt: number, target: number): number {
    const spring = -SPRING_STIFFNESS * (this.value - target)
    const damper = -SPRING_DAMPING * this.velocity
    const acceleration = (spring + damper) / SPRING_MASS
    this.velocity += acceleration * dt
    this.value += this.velocity * dt
    return this.value
  }
}

export class AnimatedCursor {
  private container: HTMLDivElement | null = null
  private cursorEl: HTMLDivElement | null = null
  private bodyEl: HTMLDivElement | null = null // inner rotatable/scalable shell
  private ringEl: HTMLDivElement | null = null
  private labelEl: HTMLDivElement | null = null
  private trailPath: SVGPathElement | null = null
  private rafHandle: number | null = null
  private followRaf: number | null = null
  private lastFrame = 0
  private currentPosition: Point = { x: 0, y: 0 }
  private targetPosition: Point = { x: 0, y: 0 }
  private springX: SpringValue = new SpringValue(0)
  private springY: SpringValue = new SpringValue(0)
  private trail: Point[] = []
  private prefersReducedMotion = false
  private mounted = false
  private flying = false
  private flyReturnTimer: ReturnType<typeof setTimeout> | null = null
  private currentRotation = 0

  private readonly persistent: boolean
  private readonly color: string

  private mouseListener: ((e: MouseEvent) => void) | null = null

  constructor(options: AnimatedCursorOptions = {}) {
    this.persistent = options.persistent ?? true
    this.color = options.color ?? DEFAULT_COLOR
    // idleAnimation / lerpFactor reserved for compat
    void options.idleAnimation
    void options.lerpFactor
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

    // Trail SVG (behind everything else)
    const trail = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    trail.setAttribute('class', 'clicky-trail')
    trail.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible'
    const trailDefs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
    const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient')
    grad.setAttribute('id', 'clicky-trail-grad')
    grad.setAttribute('gradientUnits', 'userSpaceOnUse')
    const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop')
    stop1.setAttribute('offset', '0%')
    stop1.setAttribute('stop-color', this.color)
    stop1.setAttribute('stop-opacity', '0')
    const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop')
    stop2.setAttribute('offset', '100%')
    stop2.setAttribute('stop-color', this.color)
    stop2.setAttribute('stop-opacity', '0.8')
    grad.appendChild(stop1)
    grad.appendChild(stop2)
    trailDefs.appendChild(grad)
    trail.appendChild(trailDefs)
    const trailPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    trailPath.setAttribute('fill', 'none')
    trailPath.setAttribute('stroke', 'url(#clicky-trail-grad)')
    trailPath.setAttribute('stroke-width', '3')
    trailPath.setAttribute('stroke-linecap', 'round')
    trailPath.setAttribute('stroke-linejoin', 'round')
    trail.appendChild(trailPath)

    const cursorEl = document.createElement('div')
    cursorEl.className = 'clicky-cursor'
    cursorEl.style.cssText = [
      'position:absolute',
      'left:0',
      'top:0',
      'width:28px',
      'height:28px',
      'transform:translate(-50%,-50%)',
      'will-change:transform,left,top',
      `--clicky-cursor-color:${this.color}`,
    ].join(';')

    // Inner body that rotates/scales (outer handles position so wobble
    // and press animations can compose cleanly with rotation).
    const bodyEl = document.createElement('div')
    bodyEl.className = 'clicky-cursor-body'
    bodyEl.style.cssText = [
      'width:100%',
      'height:100%',
      'transform:scale(0)',
      'transform-origin:center',
      'transition:transform 360ms cubic-bezier(.2,1.4,.4,1)',
    ].join(';')
    bodyEl.innerHTML = cursorSvg(this.color)
    cursorEl.appendChild(bodyEl)

    const ringEl = document.createElement('div')
    ringEl.className = 'clicky-cursor-ring'
    ringEl.style.cssText = [
      'position:absolute',
      'left:0',
      'top:0',
      'width:52px',
      'height:52px',
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
      'transform:translate(22px,-14px)',
      'padding:6px 10px',
      'background:rgba(18,20,22,0.92)',
      'backdrop-filter:blur(8px)',
      '-webkit-backdrop-filter:blur(8px)',
      'color:#ffffff',
      'font:500 12px/1.2 -apple-system,BlinkMacSystemFont,system-ui,sans-serif',
      'border-radius:10px',
      'opacity:0',
      'transition:opacity 180ms ease, transform 260ms cubic-bezier(.2,1.4,.4,1)',
      'white-space:nowrap',
      'box-shadow:0 6px 24px rgba(0,0,0,0.28)',
      `border:1px solid ${hexToRgba(this.color, 0.3)}`,
    ].join(';')

    container.appendChild(trail)
    container.appendChild(ringEl)
    container.appendChild(cursorEl)
    container.appendChild(labelEl)
    document.body.appendChild(container)

    this.container = container
    this.cursorEl = cursorEl
    this.bodyEl = bodyEl
    this.ringEl = ringEl
    this.labelEl = labelEl
    this.trailPath = trailPath
    this.mounted = true

    // Initial position: bottom-right corner if no mouse known yet.
    const initialX = typeof window !== 'undefined' ? window.innerWidth - 80 : 0
    const initialY = typeof window !== 'undefined' ? window.innerHeight - 80 : 0
    this.currentPosition = { x: initialX, y: initialY }
    this.targetPosition = { x: initialX, y: initialY }
    this.springX.set(initialX)
    this.springY.set(initialY)
    this.applyPosition(initialX, initialY)

    if (this.persistent && !this.prefersReducedMotion) {
      this.startFollow()
      // Entrance pop after a tick.
      requestAnimationFrame(() => this.show())
    } else if (this.persistent) {
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
    this.bodyEl = null
    this.ringEl = null
    this.labelEl = null
    this.trailPath = null
    this.trail = []
    this.mounted = false
  }

  show(): void {
    if (!this.bodyEl) return
    this.bodyEl.style.transform = 'scale(1)'
  }

  hide(): void {
    if (!this.bodyEl) return
    this.bodyEl.style.transform = 'scale(0)'
    if (this.labelEl) this.labelEl.style.opacity = '0'
    if (this.ringEl) this.ringEl.style.opacity = '0'
  }

  /**
   * Sync the cursor's visual mood with the agent state machine.
   */
  setState(state: AgentState): void {
    if (!this.cursorEl || !this.ringEl) return
    if (this.prefersReducedMotion) return

    this.cursorEl.classList.remove(
      'clicky-state-idle',
      'clicky-state-thinking',
      'clicky-state-listening',
      'clicky-state-speaking',
      'clicky-state-acting',
    )
    this.ringEl.classList.remove(
      'clicky-ring-thinking',
      'clicky-ring-listening',
      'clicky-ring-speaking',
      'clicky-ring-acting',
    )
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
    if (!this.cursorEl || !this.labelEl || !this.bodyEl) return

    const element = typeof target === 'string' ? this.resolveSelector(target) : target
    if (!element) return

    const color = options.color ?? this.color
    this.bodyEl.innerHTML = cursorSvg(color)
    this.flying = true
    if (this.flyReturnTimer) {
      clearTimeout(this.flyReturnTimer)
      this.flyReturnTimer = null
    }

    if (typeof element.scrollIntoView === 'function') {
      try {
        element.scrollIntoView({
          behavior: this.prefersReducedMotion ? 'auto' : 'smooth',
          block: 'center',
          inline: 'nearest',
        })
      } catch {
        // jsdom can throw on unsupported options
      }
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
      this.springX.set(end.x)
      this.springY.set(end.y)
      this.applyPosition(end.x, end.y)
      options.onArrived?.()
      if (options.click) this.playClick(element as HTMLElement)
      this.scheduleFlyReturn()
      return
    }

    const start: Point = { ...this.currentPosition }
    const duration = options.duration ?? DEFAULT_DURATION_MS

    const midBase: Point = { x: (start.x + destination().x) / 2, y: (start.y + destination().y) / 2 }
    const distance = Math.hypot(destination().x - start.x, destination().y - start.y)
    const arcHeight = Math.min(180, Math.max(60, distance * 0.28))
    const control: Point = { x: midBase.x, y: midBase.y - arcHeight }

    return new Promise<void>((resolve) => {
      const startTime = performance.now()
      let previous: Point = { ...start }
      const step = (): void => {
        if (!this.cursorEl) {
          resolve()
          return
        }
        const now = performance.now()
        const raw = Math.min(1, (now - startTime) / duration)
        const eased = easeOutExpo(raw)

        const end = destination()
        const p = quadBezier(start, control, end, eased)
        // Update springs so they land where the flight lands — avoids a
        // visual snap when follow mode takes over again.
        this.springX.set(p.x)
        this.springY.set(p.y)
        this.currentPosition = p
        this.targetPosition = p
        // Rotation follows velocity direction so the cursor "looks where
        // it's going".
        const dx = p.x - previous.x
        const dy = p.y - previous.y
        if (Math.abs(dx) + Math.abs(dy) > 0.4) {
          const angle = Math.atan2(dy, dx) * (180 / Math.PI)
          // The arrow SVG points up-right at 0deg, compensate.
          this.currentRotation = angle + 45
        }
        previous = p
        this.pushTrail(p)
        this.applyPosition(p.x, p.y)

        if (raw >= 1) {
          this.rafHandle = null
          this.currentRotation = 0
          if (this.bodyEl) this.bodyEl.style.transform = 'scale(1) rotate(0deg)'
          this.pulseOnArrival()
          if (options.click) this.playClick(element as HTMLElement)
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

  /**
   * Play a press+ripple animation at the cursor's current location and
   * dispatch a click on the element after a short delay. Used when the
   * agent actually wants to execute a click.
   */
  async clickElement(element: HTMLElement, label?: string): Promise<void> {
    await this.flyTo(element, { label, click: true })
  }

  /* ----- internals ----- */

  private startFollow(): void {
    if (typeof window === 'undefined') return

    this.mouseListener = (e: MouseEvent): void => {
      this.targetPosition = { x: e.clientX + FOLLOW_OFFSET.x, y: e.clientY + FOLLOW_OFFSET.y }
    }
    window.addEventListener('mousemove', this.mouseListener, { passive: true })

    this.lastFrame = performance.now()
    const tick = (): void => {
      if (!this.mounted || !this.cursorEl) return
      const now = performance.now()
      const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrame) / 1000))
      this.lastFrame = now

      if (!this.flying) {
        const x = this.springX.update(dt, this.targetPosition.x)
        const y = this.springY.update(dt, this.targetPosition.y)
        this.currentPosition = { x, y }
        this.pushTrail({ x, y })
        this.applyPosition(x, y)
      }
      this.followRaf = requestAnimationFrame(tick)
    }
    this.followRaf = requestAnimationFrame(tick)
  }

  private pushTrail(p: Point): void {
    if (!this.trailPath) return
    this.trail.push(p)
    if (this.trail.length > TRAIL_LENGTH) this.trail.shift()
    if (this.trail.length < 2) {
      this.trailPath.setAttribute('d', '')
      return
    }
    const first = this.trail[0]!
    let d = `M ${first.x} ${first.y}`
    for (let i = 1; i < this.trail.length; i++) {
      const point = this.trail[i]!
      d += ` L ${point.x} ${point.y}`
    }
    this.trailPath.setAttribute('d', d)
  }

  private scheduleFlyReturn(): void {
    if (!this.persistent) return
    this.flyReturnTimer = setTimeout(() => {
      this.flying = false
      this.lastFrame = performance.now()
      if (this.labelEl) this.labelEl.style.opacity = '0'
    }, 900)
  }

  private pulseOnArrival(): void {
    if (!this.bodyEl || !this.ringEl) return
    const body = this.bodyEl
    body.style.transition = 'transform 240ms cubic-bezier(.2,1.6,.4,1)'
    body.style.transform = 'scale(1.45) rotate(0deg)'
    // Ring pulse: expand + fade
    const ring = this.ringEl
    const prevTransition = ring.style.transition
    ring.style.transition = 'transform 480ms cubic-bezier(.2,.8,.2,1), opacity 480ms ease-out'
    ring.style.transform = 'translate(-50%,-50%) scale(1.6)'
    ring.style.opacity = '0'
    setTimeout(() => {
      if (!this.bodyEl) return
      this.bodyEl.style.transform = 'scale(1) rotate(0deg)'
      this.bodyEl.style.transition = 'transform 220ms ease'
      if (this.ringEl) {
        this.ringEl.style.transition = prevTransition
        this.ringEl.style.transform = 'translate(-50%,-50%) scale(1)'
      }
    }, 220)
    // Tiny wobble
    if (this.cursorEl) {
      this.cursorEl.classList.add('clicky-wobble')
      setTimeout(() => this.cursorEl?.classList.remove('clicky-wobble'), 420)
    }
  }

  private playClick(target: HTMLElement): void {
    if (!this.bodyEl || !this.cursorEl) return
    // Press down
    this.bodyEl.style.transition = 'transform 90ms ease-out'
    this.bodyEl.style.transform = 'scale(0.72)'
    setTimeout(() => {
      if (!this.bodyEl) return
      this.bodyEl.style.transition = 'transform 220ms cubic-bezier(.2,1.6,.4,1)'
      this.bodyEl.style.transform = 'scale(1)'
    }, 100)
    // Ripple
    this.spawnRipple()
    // Actual click, slightly delayed so the user sees it happen
    setTimeout(() => {
      try {
        target.click()
      } catch {
        // ignore
      }
    }, 140)
  }

  private spawnRipple(): void {
    if (!this.container) return
    const ripple = document.createElement('div')
    ripple.className = 'clicky-ripple'
    ripple.style.cssText = [
      'position:absolute',
      `left:${this.currentPosition.x}px`,
      `top:${this.currentPosition.y}px`,
      'width:20px',
      'height:20px',
      'border-radius:50%',
      `background:radial-gradient(circle, ${hexToRgba(this.color, 0.5)} 0%, ${hexToRgba(this.color, 0)} 70%)`,
      `border:2px solid ${hexToRgba(this.color, 0.8)}`,
      'transform:translate(-50%,-50%) scale(0.3)',
      'opacity:1',
      'pointer-events:none',
    ].join(';')
    this.container.appendChild(ripple)
    requestAnimationFrame(() => {
      ripple.style.transition = 'transform 520ms cubic-bezier(.2,.8,.2,1), opacity 520ms ease-out'
      ripple.style.transform = 'translate(-50%,-50%) scale(3.2)'
      ripple.style.opacity = '0'
    })
    setTimeout(() => ripple.remove(), 600)
  }

  private applyPosition(x: number, y: number): void {
    if (!this.cursorEl || !this.labelEl || !this.ringEl || !this.bodyEl) return
    this.cursorEl.style.left = `${x}px`
    this.cursorEl.style.top = `${y}px`
    this.ringEl.style.left = `${x}px`
    this.ringEl.style.top = `${y}px`
    this.labelEl.style.left = `${x}px`
    this.labelEl.style.top = `${y}px`
    // Apply rotation/scale to inner body so wobble animations compose.
    if (this.flying) {
      this.bodyEl.style.transform = `scale(1) rotate(${this.currentRotation}deg)`
    }
  }

  private resolveSelector(selector: string): HTMLElement | null {
    if (typeof document === 'undefined') return null
    // Honour our injected stable IDs first.
    const clickyMatch = selector.match(/^#?(c-\d+)$/)
    if (clickyMatch) {
      return document.querySelector(`[data-clicky-id="${clickyMatch[1]}"]`) as HTMLElement | null
    }
    try {
      return document.querySelector(selector) as HTMLElement | null
    } catch {
      return null
    }
  }
}

const cursorSvg = (color: string): string =>
  `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="display:block;filter:drop-shadow(0 0 14px ${hexToRgba(color, 0.55)}) drop-shadow(0 4px 10px rgba(0,0,0,0.25))">
    <defs>
      <radialGradient id="clicky-core-${color.replace('#', '')}" cx="40%" cy="35%" r="65%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
        <stop offset="45%" stop-color="${color}" stop-opacity="1"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0.85"/>
      </radialGradient>
    </defs>
    <path d="M6 4 L26 15 L17 17.2 L13.5 27 Z" fill="url(#clicky-core-${color.replace('#', '')})" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="11" cy="9" r="1.4" fill="#ffffff" opacity="0.9"/>
  </svg>`

const quadBezier = (p0: Point, p1: Point, p2: Point, t: number): Point => {
  const oneMinusT = 1 - t
  const x = oneMinusT * oneMinusT * p0.x + 2 * oneMinusT * t * p1.x + t * t * p2.x
  const y = oneMinusT * oneMinusT * p0.y + 2 * oneMinusT * t * p1.y + t * t * p2.y
  return { x, y }
}

const easeOutExpo = (t: number): number => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t))

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
@keyframes clicky-breathe {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.06); }
}
@keyframes clicky-idle-drift {
  0%, 100% { transform: rotate(-3deg); }
  50%      { transform: rotate(3deg); }
}
@keyframes clicky-wobble {
  0%   { transform: translate(-50%,-50%) translateX(0); }
  20%  { transform: translate(-50%,-50%) translateX(3px) translateY(-2px); }
  40%  { transform: translate(-50%,-50%) translateX(-3px) translateY(1px); }
  60%  { transform: translate(-50%,-50%) translateX(2px) translateY(-1px); }
  80%  { transform: translate(-50%,-50%) translateX(-1px); }
  100% { transform: translate(-50%,-50%) translateX(0); }
}
@keyframes clicky-ring-thinking-spin {
  to { transform: translate(-50%,-50%) rotate(360deg); }
}
@keyframes clicky-ring-pulse {
  0%, 100% { transform: translate(-50%,-50%) scale(1); opacity: 0.7; }
  50%      { transform: translate(-50%,-50%) scale(1.28); opacity: 0.18; }
}
@keyframes clicky-ring-listening {
  0%, 100% { transform: translate(-50%,-50%) scale(1); opacity: 0.85; }
  50%      { transform: translate(-50%,-50%) scale(1.22); opacity: 0.35; }
}
@keyframes clicky-acting-blink {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.55; }
}
.clicky-cursor.clicky-state-idle .clicky-cursor-body {
  animation: clicky-breathe 3.2s ease-in-out infinite;
}
.clicky-cursor.clicky-state-acting .clicky-cursor-body {
  animation: clicky-acting-blink 0.42s ease-in-out infinite;
}
.clicky-cursor.clicky-wobble {
  animation: clicky-wobble 420ms ease-in-out;
}
.clicky-cursor-ring.clicky-ring-thinking {
  border-style: dashed;
  animation: clicky-ring-thinking-spin 1.4s linear infinite;
}
.clicky-cursor-ring.clicky-ring-speaking {
  animation: clicky-ring-pulse 1.1s ease-in-out infinite;
  border-color: #22c55e;
}
.clicky-cursor-ring.clicky-ring-listening {
  animation: clicky-ring-listening 1.2s ease-in-out infinite;
  border-color: #ef4444;
}
.clicky-cursor-ring.clicky-ring-acting {
  animation: clicky-ring-pulse 0.6s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .clicky-cursor, .clicky-cursor-ring, .clicky-cursor-body { animation: none !important; }
  .clicky-trail { display: none !important; }
}
`
  document.head.appendChild(style)
}
