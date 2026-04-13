import { describe, it, expect, vi, afterEach } from 'vitest'
import { HotkeyManager, parseCombo } from '../src/hotkey'

describe('parseCombo', () => {
  it('parses ctrl+alt as pure modifier combo', () => {
    const combo = parseCombo('ctrl+alt')
    expect(combo).toEqual({ ctrl: true, alt: true, shift: false, meta: false, key: null })
  })
  it('parses meta+shift+k with a key', () => {
    const combo = parseCombo('meta+shift+k')
    expect(combo).toEqual({ ctrl: false, alt: false, shift: true, meta: true, key: 'k' })
  })
  it('accepts option/opt/cmd aliases', () => {
    expect(parseCombo('cmd+opt+space')).toEqual({ ctrl: false, alt: true, shift: false, meta: true, key: 'space' })
  })
})

describe('HotkeyManager', () => {
  const manager = new HotkeyManager()
  afterEach(() => manager.unregisterAll())

  it('fires a pure-modifier combo in hold-to-talk mode with pressed/released transitions', () => {
    const handler = vi.fn()
    manager.register('ctrl+alt', handler, { holdToTalk: true })

    // Keydown of the Alt modifier (Ctrl already held) — should fire pressed:true.
    const down = new KeyboardEvent('keydown', {
      key: 'Alt',
      ctrlKey: true,
      altKey: true,
    })
    window.dispatchEvent(down)

    // Keyup with altKey false — should fire pressed:false.
    const up = new KeyboardEvent('keyup', {
      key: 'Alt',
      ctrlKey: true,
      altKey: false,
    })
    window.dispatchEvent(up)

    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler.mock.calls[0]?.[0]?.pressed).toBe(true)
    expect(handler.mock.calls[1]?.[0]?.pressed).toBe(false)
  })

  it('ignores key-based hotkey when typing in a textarea', () => {
    const handler = vi.fn()
    manager.register('ctrl+k', handler)
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    textarea.focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    expect(handler).not.toHaveBeenCalled()
    textarea.remove()
  })

  it('unregister stops firing', () => {
    const handler = vi.fn()
    const off = manager.register('ctrl+j', handler)
    off()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true }))
    expect(handler).not.toHaveBeenCalled()
  })
})
