/**
 * HotkeyManager registers global keyboard shortcuts. It supports standard
 * combos ("ctrl+alt+k", "meta+shift+space") and a hold-to-talk mode where
 * the handler is notified on both keydown and keyup so the caller can
 * implement push-to-talk semantics.
 *
 * The parser recognises the modifiers `ctrl`, `alt`, `shift`, and `meta`
 * (aliases: `cmd`, `control`, `option`, `opt`). Non-modifier keys are
 * matched against event.key (case-insensitive). A combo composed only of
 * modifiers ("ctrl+alt") fires when every listed modifier is held and no
 * other key is pressed.
 *
 * Focus-aware: if the active element is an input/textarea/contenteditable,
 * hotkeys that include a printable key are ignored to avoid stealing typing.
 * Pure-modifier hotkeys still fire.
 */

export interface HotkeyHandlerEvent {
  pressed: boolean
  original: KeyboardEvent
}

export interface HotkeyRegisterOptions {
  holdToTalk?: boolean
}

interface ParsedCombo {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  key: string | null
}

interface Registration {
  combo: ParsedCombo
  handler: (event: HotkeyHandlerEvent) => void
  options: HotkeyRegisterOptions
  holding: boolean
}

export class HotkeyManager {
  private registrations: Registration[] = []
  private keydownListener: ((event: KeyboardEvent) => void) | null = null
  private keyupListener: ((event: KeyboardEvent) => void) | null = null

  register(
    combo: string,
    handler: (event: HotkeyHandlerEvent) => void,
    options: HotkeyRegisterOptions = {},
  ): () => void {
    const parsed = parseCombo(combo)
    const registration: Registration = { combo: parsed, handler, options, holding: false }
    this.registrations.push(registration)
    this.attach()
    return () => this.unregister(registration)
  }

  unregisterAll(): void {
    this.registrations = []
    this.detach()
  }

  private unregister(registration: Registration): void {
    this.registrations = this.registrations.filter((r) => r !== registration)
    if (this.registrations.length === 0) this.detach()
  }

  private attach(): void {
    if (this.keydownListener || typeof window === 'undefined') return
    this.keydownListener = (event: KeyboardEvent) => this.handleKeydown(event)
    this.keyupListener = (event: KeyboardEvent) => this.handleKeyup(event)
    window.addEventListener('keydown', this.keydownListener, true)
    window.addEventListener('keyup', this.keyupListener, true)
  }

  private detach(): void {
    if (typeof window === 'undefined') return
    if (this.keydownListener) window.removeEventListener('keydown', this.keydownListener, true)
    if (this.keyupListener) window.removeEventListener('keyup', this.keyupListener, true)
    this.keydownListener = null
    this.keyupListener = null
  }

  private handleKeydown(event: KeyboardEvent): void {
    for (const registration of this.registrations) {
      if (!matches(registration.combo, event)) continue
      if (isInputFocused() && registration.combo.key) continue
      if (registration.options.holdToTalk) {
        if (registration.holding) return
        registration.holding = true
        registration.handler({ pressed: true, original: event })
        event.preventDefault()
      } else {
        registration.handler({ pressed: true, original: event })
        event.preventDefault()
      }
    }
  }

  private handleKeyup(event: KeyboardEvent): void {
    for (const registration of this.registrations) {
      if (!registration.options.holdToTalk || !registration.holding) continue
      if (!stillActive(registration.combo, event)) {
        registration.holding = false
        registration.handler({ pressed: false, original: event })
      }
    }
  }
}

export const parseCombo = (combo: string): ParsedCombo => {
  const tokens = combo.toLowerCase().split('+').map((t) => t.trim()).filter(Boolean)
  const result: ParsedCombo = { ctrl: false, alt: false, shift: false, meta: false, key: null }
  for (const token of tokens) {
    if (token === 'ctrl' || token === 'control') result.ctrl = true
    else if (token === 'alt' || token === 'opt' || token === 'option') result.alt = true
    else if (token === 'shift') result.shift = true
    else if (token === 'meta' || token === 'cmd' || token === 'command') result.meta = true
    else result.key = token
  }
  return result
}

const matches = (combo: ParsedCombo, event: KeyboardEvent): boolean => {
  if (combo.ctrl !== event.ctrlKey) return false
  if (combo.alt !== event.altKey) return false
  if (combo.shift !== event.shiftKey) return false
  if (combo.meta !== event.metaKey) return false
  if (combo.key === null) {
    // Pure modifier combo. Fire on the keydown of the LAST modifier pressed
    // — i.e. the event key must itself be a modifier name.
    const modifierNames = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'])
    return modifierNames.has(event.key)
  }
  return event.key.toLowerCase() === combo.key.toLowerCase()
}

const stillActive = (combo: ParsedCombo, event: KeyboardEvent): boolean => {
  if (combo.ctrl && !event.ctrlKey) return false
  if (combo.alt && !event.altKey) return false
  if (combo.shift && !event.shiftKey) return false
  if (combo.meta && !event.metaKey) return false
  return true
}

const isInputFocused = (): boolean => {
  if (typeof document === 'undefined') return false
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if ((el as HTMLElement).isContentEditable) return true
  return false
}
