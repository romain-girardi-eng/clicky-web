/**
 * HighlightOverlay injects an SVG layer on top of the page and exposes
 * primitives for spotlight, arrow, and pulse pointing. Coordinates are
 * derived from real DOM elements via getBoundingClientRect, so the
 * overlay tracks any element regardless of viewport state.
 */

const OVERLAY_ID = 'clicky-overlay-root'

export interface SpotlightOptions {
  message?: string
  padding?: number
  scrollIntoView?: boolean
}

export class HighlightOverlay {
  private root: HTMLDivElement | null = null
  private svg: SVGSVGElement | null = null
  private message: HTMLDivElement | null = null
  private trackedElement: Element | null = null
  private rafHandle: number | null = null
  private prefersReducedMotion = false

  mount(): void {
    if (this.root || typeof document === 'undefined') return
    this.prefersReducedMotion =
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

    const root = document.createElement('div')
    root.id = OVERLAY_ID
    root.setAttribute('aria-hidden', 'true')
    root.style.cssText = [
      'position:fixed',
      'inset:0',
      'pointer-events:none',
      'z-index:2147483646',
    ].join(';')

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('width', '100%')
    svg.setAttribute('height', '100%')
    svg.style.cssText = 'position:absolute;inset:0;overflow:visible'

    const message = document.createElement('div')
    message.className = 'clicky-overlay-message'
    message.style.cssText = [
      'position:absolute',
      'max-width:280px',
      'padding:10px 14px',
      'background:rgba(20,20,22,0.92)',
      'color:#f5f5f5',
      'font:14px/1.4 system-ui,-apple-system,sans-serif',
      'border-radius:10px',
      'box-shadow:0 12px 32px rgba(0,0,0,0.35)',
      'pointer-events:none',
      'opacity:0',
      'transform:translateY(4px)',
      'transition:opacity 180ms ease,transform 180ms ease',
    ].join(';')

    root.appendChild(svg)
    root.appendChild(message)
    document.body.appendChild(root)

    this.root = root
    this.svg = svg
    this.message = message
  }

  unmount(): void {
    this.stopTracking()
    this.root?.remove()
    this.root = null
    this.svg = null
    this.message = null
  }

  clear(): void {
    this.stopTracking()
    if (!this.svg) return
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild)
    if (this.message) {
      this.message.style.opacity = '0'
      this.message.textContent = ''
    }
  }

  spotlight(target: Element, options: SpotlightOptions = {}): void {
    if (!this.svg || !this.root) this.mount()
    if (!this.svg) return
    this.clear()
    if (options.scrollIntoView !== false && typeof (target as HTMLElement).scrollIntoView === 'function') {
      (target as HTMLElement).scrollIntoView({
        behavior: this.prefersReducedMotion ? 'auto' : 'smooth',
        block: 'center',
      })
    }

    const rect = target.getBoundingClientRect()
    const padding = options.padding ?? 8
    const x = rect.left - padding
    const y = rect.top - padding
    const width = rect.width + padding * 2
    const height = rect.height + padding * 2

    const ns = 'http://www.w3.org/2000/svg'
    const defs = document.createElementNS(ns, 'defs')
    const mask = document.createElementNS(ns, 'mask')
    mask.setAttribute('id', 'clicky-spotlight-mask')
    const maskBg = document.createElementNS(ns, 'rect')
    maskBg.setAttribute('width', '100%')
    maskBg.setAttribute('height', '100%')
    maskBg.setAttribute('fill', 'white')
    const maskHole = document.createElementNS(ns, 'rect')
    maskHole.setAttribute('x', String(x))
    maskHole.setAttribute('y', String(y))
    maskHole.setAttribute('width', String(width))
    maskHole.setAttribute('height', String(height))
    maskHole.setAttribute('rx', '8')
    maskHole.setAttribute('fill', 'black')
    mask.appendChild(maskBg)
    mask.appendChild(maskHole)
    defs.appendChild(mask)

    const dim = document.createElementNS(ns, 'rect')
    dim.setAttribute('width', '100%')
    dim.setAttribute('height', '100%')
    dim.setAttribute('fill', 'rgba(0,0,0,0.55)')
    dim.setAttribute('mask', 'url(#clicky-spotlight-mask)')

    const ring = document.createElementNS(ns, 'rect')
    ring.setAttribute('x', String(x))
    ring.setAttribute('y', String(y))
    ring.setAttribute('width', String(width))
    ring.setAttribute('height', String(height))
    ring.setAttribute('rx', '8')
    ring.setAttribute('fill', 'none')
    ring.setAttribute('stroke', '#5f7b6e')
    ring.setAttribute('stroke-width', '2')
    if (!this.prefersReducedMotion) {
      ring.setAttribute('style', 'animation:clicky-pulse 1.6s ease-in-out infinite')
    }

    this.svg.appendChild(defs)
    this.svg.appendChild(dim)
    this.svg.appendChild(ring)

    if (options.message && this.message) {
      this.message.textContent = options.message
      this.message.style.left = `${Math.max(12, rect.left)}px`
      this.message.style.top = `${rect.bottom + 12}px`
      requestAnimationFrame(() => {
        if (this.message) {
          this.message.style.opacity = '1'
          this.message.style.transform = 'translateY(0)'
        }
      })
    }

    this.injectKeyframes()
    this.trackElement(target)
  }

  arrow(target: Element, message?: string): void {
    this.spotlight(target, { message, padding: 12 })
  }

  pulse(target: Element): void {
    this.spotlight(target, { padding: 6 })
  }

  private trackElement(element: Element): void {
    this.trackedElement = element
    const tick = (): void => {
      if (!this.trackedElement || !this.svg) return
      const rect = this.trackedElement.getBoundingClientRect()
      const ring = this.svg.querySelector('rect[stroke="#5f7b6e"]')
      const hole = this.svg.querySelector('mask rect[fill="black"]')
      const padding = 8
      if (ring) {
        ring.setAttribute('x', String(rect.left - padding))
        ring.setAttribute('y', String(rect.top - padding))
        ring.setAttribute('width', String(rect.width + padding * 2))
        ring.setAttribute('height', String(rect.height + padding * 2))
      }
      if (hole) {
        hole.setAttribute('x', String(rect.left - padding))
        hole.setAttribute('y', String(rect.top - padding))
        hole.setAttribute('width', String(rect.width + padding * 2))
        hole.setAttribute('height', String(rect.height + padding * 2))
      }
      this.rafHandle = requestAnimationFrame(tick)
    }
    this.rafHandle = requestAnimationFrame(tick)
  }

  private stopTracking(): void {
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle)
    this.rafHandle = null
    this.trackedElement = null
  }

  private injectKeyframes(): void {
    if (typeof document === 'undefined') return
    if (document.getElementById('clicky-overlay-keyframes')) return
    const style = document.createElement('style')
    style.id = 'clicky-overlay-keyframes'
    style.textContent = `@keyframes clicky-pulse{0%,100%{opacity:1}50%{opacity:0.5}}`
    document.head.appendChild(style)
  }
}
