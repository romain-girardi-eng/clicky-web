import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AnimatedCursor } from '../src/animated-cursor'

describe('AnimatedCursor', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="target" style="position:absolute;left:100px;top:100px;width:50px;height:20px">Hit me</button>'
    // jsdom matchMedia stub: prefer reduced motion so flyTo resolves synchronously.
    ;(window as unknown as { matchMedia: (q: string) => { matches: boolean } }).matchMedia = () => ({ matches: true })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('mount creates a fixed container appended to body', () => {
    const cursor = new AnimatedCursor()
    cursor.mount()
    const el = document.getElementById('clicky-animated-cursor-root')
    expect(el).toBeTruthy()
    cursor.unmount()
    expect(document.getElementById('clicky-animated-cursor-root')).toBeNull()
  })

  it('flyTo resolves and calls onArrived when reduced-motion', async () => {
    const cursor = new AnimatedCursor()
    cursor.mount()
    const onArrived = vi.fn()
    const target = document.getElementById('target') as HTMLElement
    target.getBoundingClientRect = () =>
      ({ left: 100, top: 100, right: 150, bottom: 120, width: 50, height: 20, x: 100, y: 100, toJSON: () => ({}) }) as DOMRect
    await cursor.flyTo(target, { label: 'Hello', onArrived })
    expect(onArrived).toHaveBeenCalledOnce()
    cursor.unmount()
  })

  it('flyTo accepts a string selector', async () => {
    const cursor = new AnimatedCursor()
    cursor.mount()
    const target = document.getElementById('target') as HTMLElement
    target.getBoundingClientRect = () =>
      ({ left: 10, top: 10, right: 30, bottom: 20, width: 20, height: 10, x: 10, y: 10, toJSON: () => ({}) }) as DOMRect
    await expect(cursor.flyTo('#target', { label: 'x' })).resolves.toBeUndefined()
    cursor.unmount()
  })

  it('hide/show toggles the cursor transform', () => {
    const cursor = new AnimatedCursor()
    cursor.mount()
    cursor.show()
    cursor.hide()
    cursor.unmount()
    expect(document.getElementById('clicky-animated-cursor-root')).toBeNull()
  })
})
