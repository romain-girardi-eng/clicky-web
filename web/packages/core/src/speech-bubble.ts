/**
 * SpeechBubbleOverlay renders a comic-style speech bubble near the
 * animated cursor. It's the primary visual interface for Clicky replies
 * when the chat drawer is closed: the LLM stream is mirrored into a
 * bubble via a typewriter effect, and auto-dismissed when the TTS stops.
 *
 * Positioning:
 *   - follows the cursor each frame via a rAF loop (unless pinned)
 *   - picks a side (top-left / top-right / bottom-left / bottom-right)
 *     based on viewport space so it never clips
 *   - a small triangular tail points towards the cursor
 *
 * Animation:
 *   - mount: scale 0.8 -> 1.0, fade in, 200ms ease-out
 *   - unmount: fade + scale 0.95, 200ms ease-in
 *   - typewriter at ~40 chars/sec (or controlled from outside)
 *   - prefers-reduced-motion: no typewriter, no scale
 */

const CONTAINER_ID = 'clicky-speech-bubble-root'
const MAX_WIDTH = 320
const CURSOR_OFFSET = 22
const DEFAULT_TYPE_CPS = 40

export interface SpeechBubbleCursorLike {
  getPosition(): { x: number; y: number }
}

export interface SpeechBubbleOptions {
  duration?: number
  typewriter?: boolean
  onDismiss?: () => void
}

export class SpeechBubbleOverlay {
  private host: HTMLDivElement | null = null
  private bubble: HTMLDivElement | null = null
  private textEl: HTMLDivElement | null = null
  private tailEl: HTMLDivElement | null = null
  private rafHandle: number | null = null
  private hideTimer: ReturnType<typeof setTimeout> | null = null
  private typewriterTimer: ReturnType<typeof setInterval> | null = null
  private mounted = false
  private prefersReducedMotion = false
  private currentFullText = ''
  private currentRenderedLength = 0
  private onDismiss: (() => void) | null = null
  private visible = false

  constructor(private readonly cursor: SpeechBubbleCursorLike) {}

  mount(): void {
    if (this.mounted || typeof document === 'undefined') return
    this.prefersReducedMotion =
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

    injectStylesOnce()

    const host = document.createElement('div')
    host.id = CONTAINER_ID
    host.setAttribute('aria-hidden', 'false')
    host.setAttribute('role', 'status')
    host.style.cssText = [
      'position:fixed',
      'left:0',
      'top:0',
      'pointer-events:none',
      'z-index:2147483646',
      'opacity:0',
      'transform:translate(-50%,-100%) scale(0.8)',
      'transform-origin:bottom center',
      'transition:opacity 200ms ease-out, transform 200ms ease-out',
      'will-change:transform,left,top,opacity',
    ].join(';')

    const bubble = document.createElement('div')
    bubble.className = 'clicky-speech-bubble'
    bubble.style.cssText = [
      'position:relative',
      `max-width:${MAX_WIDTH}px`,
      'min-width:60px',
      'padding:12px 16px',
      'background:#ffffff',
      'color:#141a1f',
      'border-radius:18px',
      'font:500 14px/1.45 -apple-system,BlinkMacSystemFont,system-ui,sans-serif',
      'box-shadow:0 14px 40px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.08)',
      'border:1px solid rgba(0,0,0,0.06)',
      'white-space:pre-wrap',
      'word-wrap:break-word',
    ].join(';')

    const textEl = document.createElement('div')
    textEl.className = 'clicky-speech-bubble-text'
    bubble.appendChild(textEl)

    const tail = document.createElement('div')
    tail.className = 'clicky-speech-bubble-tail'
    tail.style.cssText = [
      'position:absolute',
      'width:14px',
      'height:14px',
      'background:#ffffff',
      'transform:rotate(45deg)',
      'border-right:1px solid rgba(0,0,0,0.06)',
      'border-bottom:1px solid rgba(0,0,0,0.06)',
      'left:18px',
      'bottom:-7px',
    ].join(';')
    bubble.appendChild(tail)

    host.appendChild(bubble)
    document.body.appendChild(host)

    this.host = host
    this.bubble = bubble
    this.textEl = textEl
    this.tailEl = tail
    this.mounted = true

    this.startFollow()
  }

  unmount(): void {
    if (this.rafHandle !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafHandle)
    }
    this.rafHandle = null
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
    if (this.typewriterTimer) {
      clearInterval(this.typewriterTimer)
      this.typewriterTimer = null
    }
    this.host?.remove()
    this.host = null
    this.bubble = null
    this.textEl = null
    this.tailEl = null
    this.mounted = false
    this.visible = false
  }

  isVisible(): boolean {
    return this.visible
  }

  show(text: string, options: SpeechBubbleOptions = {}): void {
    if (!this.mounted) this.mount()
    if (!this.host || !this.textEl) return
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
    if (this.typewriterTimer) {
      clearInterval(this.typewriterTimer)
      this.typewriterTimer = null
    }

    this.onDismiss = options.onDismiss ?? null
    this.currentFullText = text
    const useTypewriter = options.typewriter !== false && !this.prefersReducedMotion

    if (useTypewriter) {
      this.currentRenderedLength = 0
      this.textEl.innerHTML = ''
      this.runTypewriter()
    } else {
      this.currentRenderedLength = text.length
      this.textEl.innerHTML = renderInlineMd(text)
    }

    this.visible = true
    this.host.style.opacity = '1'
    this.host.style.transform = this.prefersReducedMotion
      ? 'translate(-50%,-100%) scale(1)'
      : 'translate(-50%,-100%) scale(1)'

    const duration = options.duration ?? text.length * 60 + 1500
    this.hideTimer = setTimeout(() => this.hide(), duration)

    this.updatePosition()
  }

  /**
   * Append text to the currently displayed bubble (for streaming). The
   * typewriter picks up the new content seamlessly.
   */
  update(newText: string): void {
    if (!this.mounted || !this.textEl) return
    if (!this.visible) {
      this.show(newText)
      return
    }
    this.currentFullText = newText
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
    }
    if (this.prefersReducedMotion) {
      this.textEl.innerHTML = renderInlineMd(newText)
      this.currentRenderedLength = newText.length
    } else if (!this.typewriterTimer) {
      this.runTypewriter()
    }
    // Re-arm auto-dismiss based on latest length
    this.hideTimer = setTimeout(() => this.hide(), newText.length * 60 + 1500)
  }

  hide(): void {
    if (!this.host) return
    this.visible = false
    this.host.style.opacity = '0'
    this.host.style.transform = 'translate(-50%,-100%) scale(0.95)'
    if (this.typewriterTimer) {
      clearInterval(this.typewriterTimer)
      this.typewriterTimer = null
    }
    const cb = this.onDismiss
    this.onDismiss = null
    if (cb) {
      setTimeout(cb, 210)
    }
  }

  clear(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
    if (this.typewriterTimer) {
      clearInterval(this.typewriterTimer)
      this.typewriterTimer = null
    }
    this.currentFullText = ''
    this.currentRenderedLength = 0
    if (this.textEl) this.textEl.innerHTML = ''
    this.hide()
  }

  /* ----- internals ----- */

  private runTypewriter(): void {
    if (!this.textEl) return
    const interval = Math.max(10, Math.floor(1000 / DEFAULT_TYPE_CPS))
    this.typewriterTimer = setInterval(() => {
      if (!this.textEl) return
      if (this.currentRenderedLength >= this.currentFullText.length) {
        if (this.typewriterTimer) {
          clearInterval(this.typewriterTimer)
          this.typewriterTimer = null
        }
        return
      }
      this.currentRenderedLength += 1
      const shown = this.currentFullText.slice(0, this.currentRenderedLength)
      this.textEl.innerHTML = renderInlineMd(shown)
      this.updatePosition()
    }, interval)
  }

  private startFollow(): void {
    if (typeof window === 'undefined') return
    const tick = (): void => {
      if (!this.mounted) return
      if (this.visible) this.updatePosition()
      this.rafHandle = requestAnimationFrame(tick)
    }
    this.rafHandle = requestAnimationFrame(tick)
  }

  private updatePosition(): void {
    if (!this.host || !this.bubble || !this.tailEl) return
    const pos = this.cursor.getPosition()
    const rect = this.bubble.getBoundingClientRect()
    const bubbleW = rect.width || MAX_WIDTH
    const bubbleH = rect.height || 50
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024
    const vh = typeof window !== 'undefined' ? window.innerHeight : 768

    // Decide placement: prefer above-right, fall back to other quadrants.
    const spaceAbove = pos.y
    const spaceBelow = vh - pos.y
    const placeAbove = spaceAbove > bubbleH + CURSOR_OFFSET + 20 || spaceAbove > spaceBelow
    const spaceRight = vw - pos.x
    const placeRight = spaceRight > bubbleW / 2 + 30

    let hostX = pos.x
    let hostY = pos.y - CURSOR_OFFSET
    // Keep the center horizontally anchored but clamp so bubble stays on-screen.
    const halfW = bubbleW / 2
    const minX = halfW + 12
    const maxX = vw - halfW - 12
    hostX = Math.min(Math.max(hostX, minX), maxX)

    if (placeAbove) {
      hostY = pos.y - CURSOR_OFFSET
      this.host.style.transformOrigin = 'bottom center'
    } else {
      hostY = pos.y + CURSOR_OFFSET + bubbleH
      this.host.style.transformOrigin = 'top center'
    }
    void placeRight

    this.host.style.left = `${hostX}px`
    this.host.style.top = `${hostY}px`

    // Position tail to point at cursor
    const tailOffsetFromLeft = Math.max(
      12,
      Math.min(bubbleW - 26, pos.x - (hostX - halfW) - 7),
    )
    this.tailEl.style.left = `${tailOffsetFromLeft}px`
    if (placeAbove) {
      this.tailEl.style.bottom = '-7px'
      this.tailEl.style.top = 'auto'
      this.tailEl.style.borderRight = '1px solid rgba(0,0,0,0.06)'
      this.tailEl.style.borderBottom = '1px solid rgba(0,0,0,0.06)'
      this.tailEl.style.borderLeft = 'none'
      this.tailEl.style.borderTop = 'none'
    } else {
      this.tailEl.style.top = '-7px'
      this.tailEl.style.bottom = 'auto'
      this.tailEl.style.borderLeft = '1px solid rgba(0,0,0,0.06)'
      this.tailEl.style.borderTop = '1px solid rgba(0,0,0,0.06)'
      this.tailEl.style.borderRight = 'none'
      this.tailEl.style.borderBottom = 'none'
    }
  }
}

/**
 * Very small inline markdown renderer: escapes HTML then replaces
 *   **bold**, *italic*, `code`. No block elements (lists, headings,
 *   code fences) — bubbles are single-idea, single-line-ish.
 */
const renderInlineMd = (text: string): string => {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped
    .replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.07);padding:1px 5px;border-radius:4px;font:12px ui-monospace,Menlo,Consolas,monospace">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
}

let stylesInjected = false
const injectStylesOnce = (): void => {
  if (stylesInjected || typeof document === 'undefined') return
  stylesInjected = true
  const style = document.createElement('style')
  style.setAttribute('data-clicky-speech-bubble', '')
  style.textContent = `
@media (prefers-color-scheme: dark) {
  .clicky-speech-bubble { background:#1a1f24 !important; color:#f5f5f7 !important; border-color:rgba(255,255,255,0.08) !important; }
  .clicky-speech-bubble-tail { background:#1a1f24 !important; }
}
@media (prefers-reduced-motion: reduce) {
  #${CONTAINER_ID} { transition: opacity 120ms linear !important; transform: translate(-50%,-100%) scale(1) !important; }
}
`
  document.head.appendChild(style)
}
