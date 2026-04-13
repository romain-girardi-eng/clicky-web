import { describe, it, expect, beforeEach } from 'vitest'
import { HighlightOverlay } from '../src/highlight-overlay'

describe('HighlightOverlay', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="target">Hi</button>'
  })

  it('mounts and unmounts a root element', () => {
    const overlay = new HighlightOverlay()
    overlay.mount()
    expect(document.getElementById('clicky-overlay-root')).toBeTruthy()
    overlay.unmount()
    expect(document.getElementById('clicky-overlay-root')).toBeNull()
  })

  it('renders an svg ring around the target on spotlight', () => {
    const overlay = new HighlightOverlay()
    overlay.mount()
    const target = document.getElementById('target')!
    overlay.spotlight(target, { message: 'click here' })
    const root = document.getElementById('clicky-overlay-root')!
    expect(root.querySelector('svg')).toBeTruthy()
    expect(root.querySelector('rect[stroke="#5f7b6e"]')).toBeTruthy()
    overlay.unmount()
  })

  it('clears overlays', () => {
    const overlay = new HighlightOverlay()
    overlay.mount()
    overlay.spotlight(document.getElementById('target')!)
    overlay.clear()
    const root = document.getElementById('clicky-overlay-root')!
    expect(root.querySelector('rect[stroke="#5f7b6e"]')).toBeNull()
    overlay.unmount()
  })
})
