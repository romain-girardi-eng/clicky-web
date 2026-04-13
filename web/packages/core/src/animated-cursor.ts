/**
 * AnimatedCursor is the visual signature of Clicky — a small living
 * companion that shares the user's screen. It's always visible, follows
 * the mouse with spring physics, trails a soft glow, and reacts to the
 * agent state machine with recognisable body language.
 *
 * V3 — expressive blob: two eyes that blink and track, an animated mouth
 * that syncs with TTS and mood, sparkles on success, and emotional mood
 * states (happy, thinking, excited, confused, pointing, celebrating,
 * speaking). Spring physics and flyTo flight paths are preserved from V2.
 */

import type { AgentState } from './types'

const CURSOR_CONTAINER_ID = 'clicky-animated-cursor-root'
const DEFAULT_DURATION_MS = 1100
const DEFAULT_COLOR = '#3b82f6'
const FOLLOW_OFFSET = { x: 18, y: 18 }
const TRAIL_LENGTH = 10
const SPRING_STIFFNESS = 170
const SPRING_DAMPING = 18
const SPRING_MASS = 1
const BODY_SIZE = 36

export type CursorMood =
  | 'neutral'
  | 'happy'
  | 'thinking'
  | 'excited'
  | 'confused'
  | 'pointing'
  | 'celebrating'
  | 'speaking'

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
  private bodyEl: HTMLDivElement | null = null
  private ringEl: HTMLDivElement | null = null
  private labelEl: HTMLDivElement | null = null
  private trailPath: SVGPathElement | null = null
  private eyeLeftPupil: SVGCircleElement | null = null
  private eyeRightPupil: SVGCircleElement | null = null
  private eyeLeftLid: SVGRectElement | null = null
  private eyeRightLid: SVGRectElement | null = null
  private mouthPath: SVGPathElement | null = null
  private rafHandle: number | null = null
  private followRaf: number | null = null
  private lastFrame = 0
  private currentPosition: Point = { x: 0, y: 0 }
  private targetPosition: Point = { x: 0, y: 0 }
  private previousPosition: Point = { x: 0, y: 0 }
  private springX: SpringValue = new SpringValue(0)
  private springY: SpringValue = new SpringValue(0)
  private trail: Point[] = []
  private prefersReducedMotion = false
  private mounted = false
  private flying = false
  private flyReturnTimer: ReturnType<typeof setTimeout> | null = null
  private currentRotation = 0
  private mood: CursorMood = 'neutral'
  private gazeTarget: Point | null = null
  private speakingTimer: ReturnType<typeof setInterval> | null = null
  private blinkTimer: ReturnType<typeof setTimeout> | null = null

  private readonly persistent: boolean
  private readonly color: string

  private mouseListener: ((e: MouseEvent) => void) | null = null

  constructor(options: AnimatedCursorOptions = {}) {
    this.persistent = options.persistent ?? true
    this.color = options.color ?? DEFAULT_COLOR
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

    // Trail SVG
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
      `width:${BODY_SIZE}px`,
      `height:${BODY_SIZE}px`,
      'transform:translate(-50%,-50%)',
      'will-change:transform,left,top',
      `--clicky-cursor-color:${this.color}`,
    ].join(';')

    // Inner body: the blob with face
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
      'width:60px',
      'height:60px',
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

    // Wire up refs into the SVG face elements
    this.eyeLeftPupil = bodyEl.querySelector('[data-clicky-eye="left-pupil"]')
    this.eyeRightPupil = bodyEl.querySelector('[data-clicky-eye="right-pupil"]')
    this.eyeLeftLid = bodyEl.querySelector('[data-clicky-eye="left-lid"]')
    this.eyeRightLid = bodyEl.querySelector('[data-clicky-eye="right-lid"]')
    this.mouthPath = bodyEl.querySelector('[data-clicky-mouth]')
    this.setMouth('neutral')

    const initialX = typeof window !== 'undefined' ? window.innerWidth - 80 : 0
    const initialY = typeof window !== 'undefined' ? window.innerHeight - 80 : 0
    this.currentPosition = { x: initialX, y: initialY }
    this.previousPosition = { x: initialX, y: initialY }
    this.targetPosition = { x: initialX, y: initialY }
    this.springX.set(initialX)
    this.springY.set(initialY)
    this.applyPosition(initialX, initialY)

    if (this.persistent && !this.prefersReducedMotion) {
      this.startFollow()
      this.startBlinkLoop()
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
    if (this.blinkTimer) {
      clearTimeout(this.blinkTimer)
      this.blinkTimer = null
    }
    if (this.speakingTimer) {
      clearInterval(this.speakingTimer)
      this.speakingTimer = null
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
    this.eyeLeftPupil = null
    this.eyeRightPupil = null
    this.eyeLeftLid = null
    this.eyeRightLid = null
    this.mouthPath = null
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

  /** Get current cursor screen position (used by speech bubble overlay). */
  getPosition(): Point {
    return { ...this.currentPosition }
  }

  /**
   * Sync the cursor's visual mood with the agent state machine.
   */
  setState(state: AgentState): void {
    if (!this.cursorEl || !this.ringEl) return

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

    // Map agent state to cursor mood / face.
    switch (state) {
      case 'thinking':
        this.setMood('thinking')
        break
      case 'speaking':
        this.setMood('speaking')
        break
      case 'listening':
        this.setMood('excited')
        break
      case 'acting':
        this.setMood('pointing')
        break
      default:
        this.setMood('neutral')
    }

    if (state === 'idle') {
      this.ringEl.style.opacity = '0'
      return
    }
    if (this.prefersReducedMotion) return
    this.ringEl.style.opacity = '1'
    this.ringEl.classList.add(`clicky-ring-${state}`)
  }

  /**
   * Set the cursor's emotional mood. Changes eyes + mouth shape. Called by
   * the agent on state transitions, and directly on happy events (click
   * success, celebration).
   */
  setMood(mood: CursorMood): void {
    this.mood = mood
    if (!this.bodyEl) return
    this.bodyEl.classList.remove(
      'clicky-mood-neutral',
      'clicky-mood-happy',
      'clicky-mood-thinking',
      'clicky-mood-excited',
      'clicky-mood-confused',
      'clicky-mood-pointing',
      'clicky-mood-celebrating',
      'clicky-mood-speaking',
    )
    this.bodyEl.classList.add(`clicky-mood-${mood}`)
    this.setMouth(mood)

    if (mood === 'speaking') {
      this.startSpeakingMouth()
    } else {
      this.stopSpeakingMouth()
    }
  }

  /**
   * Set a specific point the eyes should look at (in screen coordinates).
   * Passing null lets the eyes follow movement direction again.
   */
  lookAt(point: Point | null): void {
    this.gazeTarget = point
    this.updateGaze()
  }

  /**
   * Spawn small sparkle particles around the cursor. Great for click
   * success / celebrating moments.
   */
  sparkle(): void {
    if (!this.container || this.prefersReducedMotion) return
    const { x, y } = this.currentPosition
    const count = 6
    for (let i = 0; i < count; i += 1) {
      const s = document.createElement('div')
      s.className = 'clicky-sparkle'
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6
      const dist = 22 + Math.random() * 18
      const dx = Math.cos(angle) * dist
      const dy = Math.sin(angle) * dist
      s.style.cssText = [
        'position:absolute',
        `left:${x}px`,
        `top:${y}px`,
        'width:6px',
        'height:6px',
        'border-radius:50%',
        `background:${this.color}`,
        `box-shadow:0 0 8px ${hexToRgba(this.color, 0.85)}`,
        'transform:translate(-50%,-50%) scale(0.2)',
        'opacity:1',
        'pointer-events:none',
        `--clicky-sparkle-dx:${dx}px`,
        `--clicky-sparkle-dy:${dy}px`,
      ].join(';')
      this.container.appendChild(s)
      requestAnimationFrame(() => {
        s.style.transition = 'transform 620ms cubic-bezier(.2,.8,.2,1), opacity 620ms ease-out'
        s.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1)`
        s.style.opacity = '0'
      })
      setTimeout(() => s.remove(), 700)
    }
  }

  async flyTo(target: HTMLElement | string, options: FlyToOptions = {}): Promise<void> {
    if (!this.mounted) this.mount()
    if (!this.cursorEl || !this.labelEl || !this.bodyEl) return

    const element = typeof target === 'string' ? this.resolveSelector(target) : target
    if (!element) return

    this.flying = true
    if (this.flyReturnTimer) {
      clearTimeout(this.flyReturnTimer)
      this.flyReturnTimer = null
    }
    this.setMood('pointing')

    if (typeof element.scrollIntoView === 'function') {
      try {
        element.scrollIntoView({
          behavior: this.prefersReducedMotion ? 'auto' : 'smooth',
          block: 'center',
          inline: 'nearest',
        })
      } catch {
        // jsdom
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
      this.lookAt(end)
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
        this.springX.set(p.x)
        this.springY.set(p.y)
        this.currentPosition = p
        this.targetPosition = p
        const dx = p.x - previous.x
        const dy = p.y - previous.y
        if (Math.abs(dx) + Math.abs(dy) > 0.4) {
          const angle = Math.atan2(dy, dx) * (180 / Math.PI)
          this.currentRotation = angle
        }
        previous = p
        this.pushTrail(p)
        this.applyPosition(p.x, p.y)
        this.lookAt(end)

        if (raw >= 1) {
          this.rafHandle = null
          this.currentRotation = 0
          if (this.bodyEl) this.bodyEl.style.transform = 'scale(1)'
          this.pulseOnArrival()
          if (options.click) {
            this.playClick(element as HTMLElement)
            this.setMood('celebrating')
            this.sparkle()
            setTimeout(() => this.setMood('happy'), 600)
          }
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
        this.previousPosition = this.currentPosition
        this.currentPosition = { x, y }
        this.pushTrail({ x, y })
        this.applyPosition(x, y)
        this.updateGaze()
      }
      this.followRaf = requestAnimationFrame(tick)
    }
    this.followRaf = requestAnimationFrame(tick)
  }

  private updateGaze(): void {
    if (!this.eyeLeftPupil || !this.eyeRightPupil) return
    let dx = 0
    let dy = 0
    if (this.gazeTarget) {
      dx = this.gazeTarget.x - this.currentPosition.x
      dy = this.gazeTarget.y - this.currentPosition.y
    } else {
      // Follow movement direction
      dx = this.currentPosition.x - this.previousPosition.x
      dy = this.currentPosition.y - this.previousPosition.y
    }
    const dist = Math.hypot(dx, dy)
    if (dist < 0.01) return
    const maxOffset = 1.6
    const ox = (dx / dist) * Math.min(maxOffset, dist * 0.1)
    const oy = (dy / dist) * Math.min(maxOffset, dist * 0.1)
    this.eyeLeftPupil.setAttribute('cx', String(13 + ox))
    this.eyeLeftPupil.setAttribute('cy', String(15 + oy))
    this.eyeRightPupil.setAttribute('cx', String(23 + ox))
    this.eyeRightPupil.setAttribute('cy', String(15 + oy))
  }

  private startBlinkLoop(): void {
    if (this.prefersReducedMotion) return
    const schedule = (): void => {
      const delay = 2800 + Math.random() * 3400
      this.blinkTimer = setTimeout(() => {
        this.blink()
        schedule()
      }, delay)
    }
    schedule()
  }

  private blink(): void {
    if (!this.eyeLeftLid || !this.eyeRightLid) return
    const lids = [this.eyeLeftLid, this.eyeRightLid]
    lids.forEach((lid) => {
      lid.setAttribute('height', '4')
    })
    setTimeout(() => {
      lids.forEach((lid) => lid.setAttribute('height', '0'))
    }, 110)
  }

  private setMouth(mood: CursorMood): void {
    if (!this.mouthPath) return
    // Mouth coordinates centered around (18, 22) inside 36x36 viewbox.
    const paths: Record<CursorMood, string> = {
      neutral: 'M14 22 Q18 23 22 22',
      happy: 'M13 21 Q18 26 23 21',
      speaking: 'M15 22 Q18 24.5 21 22 Q18 24.5 15 22',
      thinking: 'M15 23 Q18 22 21 23',
      excited: 'M13 22 Q18 27 23 22',
      confused: 'M14 23 Q16 21 18 23 Q20 25 22 23',
      pointing: 'M14 22 L22 22',
      celebrating: 'M13 21 Q18 28 23 21',
    }
    this.mouthPath.setAttribute('d', paths[mood] ?? paths.neutral)
  }

  private startSpeakingMouth(): void {
    if (this.prefersReducedMotion || this.speakingTimer || !this.mouthPath) return
    const open = 'M15 21.5 Q18 26 21 21.5 Q18 26 15 21.5'
    const mid = 'M15 22 Q18 24.5 21 22 Q18 24.5 15 22'
    const closed = 'M15 22.5 Q18 23 21 22.5'
    let i = 0
    const frames = [closed, mid, open, mid]
    this.speakingTimer = setInterval(() => {
      if (!this.mouthPath) return
      this.mouthPath.setAttribute('d', frames[i % frames.length]!)
      i += 1
    }, 110)
  }

  private stopSpeakingMouth(): void {
    if (this.speakingTimer) {
      clearInterval(this.speakingTimer)
      this.speakingTimer = null
    }
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
      this.lookAt(null)
      if (this.labelEl) this.labelEl.style.opacity = '0'
    }, 900)
  }

  private pulseOnArrival(): void {
    if (!this.bodyEl || !this.ringEl) return
    const body = this.bodyEl
    body.style.transition = 'transform 240ms cubic-bezier(.2,1.6,.4,1)'
    body.style.transform = 'scale(1.35)'
    const ring = this.ringEl
    const prevTransition = ring.style.transition
    ring.style.transition = 'transform 480ms cubic-bezier(.2,.8,.2,1), opacity 480ms ease-out'
    ring.style.transform = 'translate(-50%,-50%) scale(1.6)'
    ring.style.opacity = '0'
    setTimeout(() => {
      if (!this.bodyEl) return
      this.bodyEl.style.transform = 'scale(1)'
      this.bodyEl.style.transition = 'transform 220ms ease'
      if (this.ringEl) {
        this.ringEl.style.transition = prevTransition
        this.ringEl.style.transform = 'translate(-50%,-50%) scale(1)'
      }
    }, 220)
    if (this.cursorEl) {
      this.cursorEl.classList.add('clicky-wobble')
      setTimeout(() => this.cursorEl?.classList.remove('clicky-wobble'), 420)
    }
  }

  private playClick(target: HTMLElement): void {
    if (!this.bodyEl || !this.cursorEl) return
    this.bodyEl.style.transition = 'transform 90ms ease-out'
    this.bodyEl.style.transform = 'scale(0.72)'
    setTimeout(() => {
      if (!this.bodyEl) return
      this.bodyEl.style.transition = 'transform 220ms cubic-bezier(.2,1.6,.4,1)'
      this.bodyEl.style.transform = 'scale(1)'
    }, 100)
    this.spawnRipple()
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
      'width:24px',
      'height:24px',
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
    if (this.flying) {
      const tilt = this.mood === 'confused' ? 15 : 0
      this.bodyEl.style.transform = `scale(1) rotate(${tilt}deg)`
      void this.currentRotation // retained for compat
    }
  }

  private resolveSelector(selector: string): HTMLElement | null {
    if (typeof document === 'undefined') return null
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

const cursorSvg = (color: string): string => {
  const id = color.replace('#', '')
  return `<svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg" style="display:block;filter:drop-shadow(0 0 16px ${hexToRgba(color, 0.55)}) drop-shadow(0 4px 10px rgba(0,0,0,0.25))">
    <defs>
      <radialGradient id="clicky-core-${id}" cx="38%" cy="32%" r="72%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.98"/>
        <stop offset="55%" stop-color="${color}" stop-opacity="1"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0.82"/>
      </radialGradient>
    </defs>
    <!-- body blob -->
    <circle cx="18" cy="18" r="15" fill="url(#clicky-core-${id})" stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round"/>
    <!-- highlight -->
    <ellipse cx="12" cy="11" rx="3.6" ry="2.2" fill="#ffffff" opacity="0.55"/>
    <!-- eyes whites -->
    <circle cx="13" cy="15" r="3.1" fill="#ffffff"/>
    <circle cx="23" cy="15" r="3.1" fill="#ffffff"/>
    <!-- pupils -->
    <circle data-clicky-eye="left-pupil" cx="13" cy="15" r="1.6" fill="#141a1f"/>
    <circle data-clicky-eye="right-pupil" cx="23" cy="15" r="1.6" fill="#141a1f"/>
    <!-- blinking lids (rectangles collapsed; height animated on blink) -->
    <rect data-clicky-eye="left-lid" x="9.9" y="12" width="6.2" height="0" fill="${color}"/>
    <rect data-clicky-eye="right-lid" x="19.9" y="12" width="6.2" height="0" fill="${color}"/>
    <!-- mouth -->
    <path data-clicky-mouth d="M14 22 Q18 23 22 22" stroke="#141a1f" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`
}

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
@keyframes clicky-bounce-soft {
  0%, 100% { transform: scale(1) translateY(0); }
  50%      { transform: scale(1.05) translateY(-2px); }
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
@keyframes clicky-celebrating-spin {
  0% { transform: scale(1) rotate(0deg); }
  50% { transform: scale(1.15) rotate(180deg); }
  100% { transform: scale(1) rotate(360deg); }
}
.clicky-cursor.clicky-state-idle .clicky-cursor-body {
  animation: clicky-breathe 3.2s ease-in-out infinite;
}
.clicky-cursor-body.clicky-mood-happy {
  animation: clicky-bounce-soft 1.4s ease-in-out infinite;
}
.clicky-cursor-body.clicky-mood-celebrating {
  animation: clicky-celebrating-spin 900ms cubic-bezier(.2,.8,.2,1);
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
  .clicky-trail, .clicky-sparkle { display: none !important; }
}
`
  document.head.appendChild(style)
}
