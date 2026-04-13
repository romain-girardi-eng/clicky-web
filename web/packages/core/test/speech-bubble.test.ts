import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SpeechBubbleOverlay } from '../src/speech-bubble'

const makeCursor = (x = 200, y = 200) => ({
  getPosition: () => ({ x, y }),
})

describe('SpeechBubbleOverlay', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    ;(window as unknown as { matchMedia: (q: string) => { matches: boolean } }).matchMedia = () => ({ matches: false })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('mount creates a fixed overlay attached to body', () => {
    const bubble = new SpeechBubbleOverlay(makeCursor())
    bubble.mount()
    const root = document.getElementById('clicky-speech-bubble-root')
    expect(root).toBeTruthy()
    bubble.unmount()
    expect(document.getElementById('clicky-speech-bubble-root')).toBeNull()
  })

  it('show sets the text and hide dismisses it', () => {
    const bubble = new SpeechBubbleOverlay(makeCursor())
    bubble.mount()
    bubble.show('Bonjour', { typewriter: false })
    const textEl = document.querySelector('.clicky-speech-bubble-text') as HTMLElement
    expect(textEl.textContent).toBe('Bonjour')
    expect(bubble.isVisible()).toBe(true)
    bubble.hide()
    expect(bubble.isVisible()).toBe(false)
    bubble.unmount()
  })

  it('typewriter renders characters over time', () => {
    const bubble = new SpeechBubbleOverlay(makeCursor())
    bubble.mount()
    bubble.show('Hello world', { typewriter: true })
    const textEl = document.querySelector('.clicky-speech-bubble-text') as HTMLElement
    expect(textEl.textContent?.length ?? 0).toBeLessThan('Hello world'.length)
    vi.advanceTimersByTime(2000)
    expect(textEl.textContent).toBe('Hello world')
    bubble.unmount()
  })
})
