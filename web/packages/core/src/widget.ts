/**
 * Widget renders the floating button + chat drawer in vanilla DOM,
 * isolated in a Shadow Root so the host page CSS cannot leak in. The
 * widget subscribes to the agent and re-renders the message list and
 * status indicator on every state change.
 *
 * V2 features:
 *   - Markdown rendering (internal tiny renderer, HTML-escaped).
 *   - Draggable floating button with snap-to-corner + localStorage persist.
 *   - Optional voice input (push-to-talk via hotkey + click-to-record).
 *   - Voice output (speak response toggle) persisted in localStorage.
 *   - Dark mode, themed CSS variables, reduced-motion aware.
 *   - Typing indicator animation while the agent is thinking.
 */

import type { ClickyAgent } from './agent'
import type { ClickyTheme } from './types'
import { renderMarkdown } from './markdown'
import { VoiceInput } from './voice-input'
import { HotkeyManager } from './hotkey'

export interface WidgetOptions {
  theme?: ClickyTheme
  locale?: 'en' | 'fr'
  voice?: {
    input?: boolean
    output?: boolean
    lang?: string
  }
  hotkey?: {
    activate?: string
  }
}

type Locale = 'en' | 'fr'

const COPY: Record<Locale, {
  open: string
  close: string
  placeholder: string
  send: string
  thinking: string
  acting: string
  listening: string
  speaking: string
  mic: string
  muteOn: string
  muteOff: string
  holdToTalk: string
}> = {
  en: {
    open: 'Open Clicky',
    close: 'Close',
    placeholder: 'Ask anything about this page',
    send: 'Send',
    thinking: 'Thinking',
    acting: 'Working',
    listening: 'Listening',
    speaking: 'Speaking',
    mic: 'Tap to speak',
    muteOn: 'Mute voice',
    muteOff: 'Unmute voice',
    holdToTalk: 'Hold ⌃⌥ to talk',
  },
  fr: {
    open: 'Ouvrir Clicky',
    close: 'Fermer',
    placeholder: 'Pose une question sur la page',
    send: 'Envoyer',
    thinking: 'Réflexion',
    acting: 'Action',
    listening: 'Écoute',
    speaking: 'Parle',
    mic: 'Appuyez pour parler',
    muteOn: 'Couper la voix',
    muteOff: 'Activer la voix',
    holdToTalk: 'Maintenez ⌃⌥ pour parler',
  },
}

const STORAGE_POS_KEY = 'clicky.launcher.position'
const STORAGE_MUTE_KEY = 'clicky.voice.muted'

type Corner = 'br' | 'bl' | 'tr' | 'tl'

export class Widget {
  private host: HTMLDivElement | null = null
  private shadow: ShadowRoot | null = null
  private listEl: HTMLDivElement | null = null
  private statusEl: HTMLDivElement | null = null
  private inputEl: HTMLTextAreaElement | null = null
  private drawerEl: HTMLDivElement | null = null
  private buttonEl: HTMLButtonElement | null = null
  private micEl: HTMLButtonElement | null = null
  private speakerEl: HTMLButtonElement | null = null
  private unsubscribe: (() => void) | null = null
  private isOpen = false
  private voiceInput: VoiceInput | null = null
  private hotkeyManager: HotkeyManager | null = null
  private hotkeyUnregister: (() => void) | null = null
  private muted = false
  private corner: Corner = 'br'
  private draggingOffset: { x: number; y: number } | null = null
  private dragged = false

  constructor(private readonly agent: ClickyAgent, private readonly options: WidgetOptions = {}) {}

  mount(parent: Element = document.body): void {
    if (this.host) return
    const host = document.createElement('div')
    host.className = 'clicky-widget-host'
    host.style.all = 'initial'
    parent.appendChild(host)
    const shadow = host.attachShadow({ mode: 'open' })

    const style = document.createElement('style')
    style.textContent = this.css()
    shadow.appendChild(style)

    const root = document.createElement('div')
    root.className = 'clicky-root'
    shadow.appendChild(root)

    const button = this.buildLauncher()
    root.appendChild(button)

    const drawer = this.buildDrawer()
    root.appendChild(drawer)

    this.host = host
    this.shadow = shadow
    void this.shadow
    this.buttonEl = button
    this.drawerEl = drawer

    this.restoreCorner()
    this.restoreMute()
    this.wireVoice()
    this.wireHotkey()

    this.unsubscribe = this.agent.subscribe(({ state, messages }) => {
      this.renderMessages(messages)
      this.renderStatus(state)
    })
  }

  unmount(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.hotkeyUnregister?.()
    this.hotkeyUnregister = null
    this.hotkeyManager?.unregisterAll()
    this.hotkeyManager = null
    this.voiceInput?.stop()
    this.voiceInput = null
    this.host?.remove()
    this.host = null
    this.shadow = null
  }

  toggle(): void {
    this.isOpen = !this.isOpen
    if (this.drawerEl) this.drawerEl.classList.toggle('open', this.isOpen)
    if (this.buttonEl) this.buttonEl.classList.toggle('open', this.isOpen)
    if (this.isOpen) requestAnimationFrame(() => this.inputEl?.focus())
  }

  /* ----- builders ----- */

  private buildLauncher(): HTMLButtonElement {
    const button = document.createElement('button')
    button.className = 'clicky-launcher'
    button.type = 'button'
    button.setAttribute('aria-label', this.copy().open)
    button.innerHTML =
      '<span class="clicky-launcher-dot" aria-hidden="true"></span>' +
      '<span class="clicky-launcher-text">Clicky</span>'
    button.addEventListener('click', (event) => {
      if (this.dragged) {
        event.preventDefault()
        this.dragged = false
        return
      }
      this.toggle()
    })
    button.addEventListener('pointerdown', (event) => this.beginDrag(event))
    return button
  }

  private buildDrawer(): HTMLDivElement {
    const drawer = document.createElement('div')
    drawer.className = 'clicky-drawer'
    drawer.setAttribute('role', 'dialog')
    drawer.setAttribute('aria-label', 'Clicky')
    drawer.setAttribute('aria-modal', 'false')

    const header = document.createElement('div')
    header.className = 'clicky-header'
    const title = document.createElement('span')
    title.className = 'clicky-title'
    title.textContent = 'Clicky'
    header.appendChild(title)

    const headerActions = document.createElement('div')
    headerActions.className = 'clicky-header-actions'

    if (this.options.voice?.output) {
      const speaker = document.createElement('button')
      speaker.type = 'button'
      speaker.className = 'clicky-icon-btn'
      speaker.setAttribute('aria-label', this.copy().muteOn)
      speaker.innerHTML = speakerIcon(false)
      speaker.addEventListener('click', () => this.toggleMute())
      headerActions.appendChild(speaker)
      this.speakerEl = speaker
    }

    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'clicky-close'
    closeBtn.textContent = this.copy().close
    closeBtn.setAttribute('aria-label', this.copy().close)
    closeBtn.addEventListener('click', () => this.toggle())
    headerActions.appendChild(closeBtn)
    header.appendChild(headerActions)
    drawer.appendChild(header)

    const list = document.createElement('div')
    list.className = 'clicky-messages'
    list.setAttribute('aria-live', 'polite')
    drawer.appendChild(list)
    this.listEl = list

    const status = document.createElement('div')
    status.className = 'clicky-status'
    drawer.appendChild(status)
    this.statusEl = status

    const form = document.createElement('form')
    form.className = 'clicky-form'
    const input = document.createElement('textarea')
    input.placeholder = this.copy().placeholder
    input.rows = 2
    input.className = 'clicky-input'
    input.setAttribute('aria-label', this.copy().placeholder)
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        form.requestSubmit()
      }
    })
    form.appendChild(input)
    this.inputEl = input

    if (this.options.voice?.input) {
      const mic = document.createElement('button')
      mic.type = 'button'
      mic.className = 'clicky-icon-btn clicky-mic'
      mic.setAttribute('aria-label', this.copy().mic)
      mic.innerHTML = micIcon()
      mic.addEventListener('click', () => this.toggleVoiceRecording())
      form.appendChild(mic)
      this.micEl = mic
    }

    const submit = document.createElement('button')
    submit.type = 'submit'
    submit.className = 'clicky-send'
    submit.textContent = this.copy().send
    form.appendChild(submit)

    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const text = input.value.trim()
      if (!text) return
      input.value = ''
      void this.agent.ask(text)
    })
    drawer.appendChild(form)

    if (this.options.voice?.input && this.options.hotkey?.activate) {
      const hint = document.createElement('div')
      hint.className = 'clicky-hint'
      hint.textContent = this.copy().holdToTalk
      drawer.appendChild(hint)
    }

    return drawer
  }

  /* ----- voice ----- */

  private wireVoice(): void {
    if (!this.options.voice?.input) return
    if (!VoiceInput.isSupported()) return
    this.voiceInput = new VoiceInput()
  }

  private wireHotkey(): void {
    if (!this.options.voice?.input) return
    const combo = this.options.hotkey?.activate
    if (!combo) return
    this.hotkeyManager = new HotkeyManager()
    this.hotkeyUnregister = this.hotkeyManager.register(
      combo,
      ({ pressed }) => {
        if (!this.voiceInput) return
        if (pressed) {
          if (!this.isOpen) this.toggle()
          this.startVoiceRecording()
        } else {
          this.stopVoiceRecording(true)
        }
      },
      { holdToTalk: true },
    )
  }

  private toggleVoiceRecording(): void {
    if (!this.voiceInput) return
    if (this.voiceInput.isActive()) this.stopVoiceRecording(true)
    else this.startVoiceRecording()
  }

  private startVoiceRecording(): void {
    if (!this.voiceInput || !this.inputEl) return
    // Barge-in: stop any current TTS so the user can speak.
    this.agent.voiceOutput.stop()
    this.micEl?.classList.add('recording')
    const lang = this.options.voice?.lang ?? (this.options.locale === 'fr' ? 'fr-FR' : 'en-US')
    this.voiceInput.start({
      lang,
      onResult: (text, isFinal) => {
        if (!this.inputEl) return
        this.inputEl.value = text
        if (isFinal) {
          this.stopVoiceRecording(false)
          const value = this.inputEl.value.trim()
          if (value) {
            this.inputEl.value = ''
            void this.agent.ask(value)
          }
        }
      },
      onError: () => this.stopVoiceRecording(false),
      onEnd: () => this.micEl?.classList.remove('recording'),
    })
  }

  private stopVoiceRecording(submit: boolean): void {
    this.voiceInput?.stop()
    this.micEl?.classList.remove('recording')
    if (submit && this.inputEl) {
      const value = this.inputEl.value.trim()
      if (value) {
        this.inputEl.value = ''
        void this.agent.ask(value)
      }
    }
  }

  /* ----- mute ----- */

  private toggleMute(): void {
    this.muted = !this.muted
    this.persistMute()
    this.syncSpeakerButton()
    if (this.muted) this.agent.voiceOutput.stop()
  }

  private syncSpeakerButton(): void {
    if (!this.speakerEl) return
    this.speakerEl.innerHTML = speakerIcon(this.muted)
    this.speakerEl.setAttribute('aria-label', this.muted ? this.copy().muteOff : this.copy().muteOn)
  }

  private persistMute(): void {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_MUTE_KEY, this.muted ? '1' : '0')
    } catch {
      // ignore
    }
  }

  private restoreMute(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        this.muted = localStorage.getItem(STORAGE_MUTE_KEY) === '1'
      }
    } catch {
      // ignore
    }
    this.syncSpeakerButton()
  }

  /* ----- draggable launcher ----- */

  private beginDrag(event: PointerEvent): void {
    if (!this.buttonEl) return
    const rect = this.buttonEl.getBoundingClientRect()
    this.draggingOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    this.dragged = false
    this.buttonEl.setPointerCapture(event.pointerId)

    const move = (moveEvent: PointerEvent): void => {
      if (!this.draggingOffset || !this.buttonEl) return
      const dx = moveEvent.clientX - (rect.left + this.draggingOffset.x)
      const dy = moveEvent.clientY - (rect.top + this.draggingOffset.y)
      if (Math.abs(dx) + Math.abs(dy) > 4) this.dragged = true
      this.buttonEl.style.left = `${moveEvent.clientX - this.draggingOffset.x}px`
      this.buttonEl.style.top = `${moveEvent.clientY - this.draggingOffset.y}px`
      this.buttonEl.style.right = 'auto'
      this.buttonEl.style.bottom = 'auto'
    }
    const up = (upEvent: PointerEvent): void => {
      if (!this.buttonEl) return
      this.buttonEl.removeEventListener('pointermove', move)
      this.buttonEl.removeEventListener('pointerup', up)
      this.buttonEl.removeEventListener('pointercancel', up)
      this.draggingOffset = null
      if (this.dragged) this.snapToCorner(upEvent.clientX, upEvent.clientY)
    }
    this.buttonEl.addEventListener('pointermove', move)
    this.buttonEl.addEventListener('pointerup', up)
    this.buttonEl.addEventListener('pointercancel', up)
  }

  private snapToCorner(x: number, y: number): void {
    if (typeof window === 'undefined' || !this.buttonEl) return
    const w = window.innerWidth
    const h = window.innerHeight
    const isLeft = x < w / 2
    const isTop = y < h / 2
    const corner: Corner = isTop ? (isLeft ? 'tl' : 'tr') : isLeft ? 'bl' : 'br'
    this.corner = corner
    this.applyCorner()
    this.persistCorner()
  }

  private applyCorner(): void {
    if (!this.buttonEl || !this.drawerEl) return
    const b = this.buttonEl
    const d = this.drawerEl
    b.style.left = 'auto'
    b.style.top = 'auto'
    b.style.right = 'auto'
    b.style.bottom = 'auto'
    d.style.left = 'auto'
    d.style.top = 'auto'
    d.style.right = 'auto'
    d.style.bottom = 'auto'
    switch (this.corner) {
      case 'tl':
        b.style.left = '20px'
        b.style.top = '20px'
        d.style.left = '20px'
        d.style.top = '80px'
        break
      case 'tr':
        b.style.right = '20px'
        b.style.top = '20px'
        d.style.right = '20px'
        d.style.top = '80px'
        break
      case 'bl':
        b.style.left = '20px'
        b.style.bottom = '20px'
        d.style.left = '20px'
        d.style.bottom = '80px'
        break
      case 'br':
      default:
        b.style.right = '20px'
        b.style.bottom = '20px'
        d.style.right = '20px'
        d.style.bottom = '80px'
        break
    }
  }

  private persistCorner(): void {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_POS_KEY, this.corner)
    } catch {
      // ignore
    }
  }

  private restoreCorner(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_POS_KEY)
        if (raw === 'tl' || raw === 'tr' || raw === 'bl' || raw === 'br') this.corner = raw
      }
    } catch {
      // ignore
    }
    this.applyCorner()
  }

  /* ----- rendering ----- */

  private renderMessages(messages: ReadonlyArray<{ role: string; text: string; id: string }>): void {
    if (!this.listEl) return
    this.listEl.innerHTML = ''
    for (const message of messages) {
      const bubble = document.createElement('div')
      bubble.className = `clicky-message clicky-${message.role}`
      if (message.role === 'assistant') {
        bubble.innerHTML = renderMarkdown(message.text)
      } else {
        bubble.textContent = message.text
      }
      this.listEl.appendChild(bubble)
    }
    this.listEl.scrollTop = this.listEl.scrollHeight
  }

  private renderStatus(state: string): void {
    if (!this.statusEl) return
    if (state === 'idle') {
      this.statusEl.textContent = ''
      this.statusEl.classList.remove('active')
      this.statusEl.classList.remove('thinking')
      return
    }
    const labels: Record<string, string> = {
      thinking: this.copy().thinking,
      acting: this.copy().acting,
      listening: this.copy().listening,
      speaking: this.copy().speaking,
    }
    this.statusEl.innerHTML = state === 'thinking'
      ? `<span class="clicky-typing"><i></i><i></i><i></i></span> ${labels[state] ?? state}`
      : `${labels[state] ?? state}...`
    this.statusEl.classList.add('active')
    this.statusEl.classList.toggle('thinking', state === 'thinking')
  }

  private copy(): typeof COPY['en'] {
    return COPY[(this.options.locale ?? 'en') as Locale]
  }

  private css(): string {
    const theme = this.options.theme ?? {}
    const primary = theme.primary ?? '#5f7b6e'
    const background = theme.background ?? '#ffffff'
    const foreground = theme.foreground ?? '#1a1a1a'
    const radius = theme.radius ?? '14px'
    return `
      :host, .clicky-root {
        --clicky-primary: ${primary};
        --clicky-bg: ${background};
        --clicky-fg: ${foreground};
        --clicky-radius: ${radius};
        --clicky-shadow: 0 28px 60px rgba(0,0,0,0.22);
        --clicky-muted: rgba(0,0,0,0.55);
        --clicky-border: rgba(0,0,0,0.08);
        --clicky-surface: rgba(0,0,0,0.05);
        font-family: system-ui, -apple-system, sans-serif;
      }
      @media (prefers-color-scheme: dark) {
        :host, .clicky-root {
          --clicky-bg: #121214;
          --clicky-fg: #f5f5f7;
          --clicky-muted: rgba(255,255,255,0.6);
          --clicky-border: rgba(255,255,255,0.1);
          --clicky-surface: rgba(255,255,255,0.06);
          --clicky-shadow: 0 28px 60px rgba(0,0,0,0.5);
        }
      }
      .clicky-root { color: var(--clicky-fg); }
      .clicky-launcher {
        position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
        display: flex; align-items: center; gap: 8px;
        padding: 12px 18px; border: none; border-radius: 999px;
        background: var(--clicky-primary); color: white; font-size: 14px; font-weight: 600;
        cursor: pointer; box-shadow: 0 14px 28px rgba(0,0,0,0.18);
        transition: transform 160ms ease, box-shadow 160ms ease;
        touch-action: none; user-select: none;
      }
      .clicky-launcher:hover { transform: translateY(-1px); box-shadow: 0 18px 34px rgba(0,0,0,0.24); }
      .clicky-launcher:focus-visible { outline: 2px solid var(--clicky-primary); outline-offset: 3px; }
      .clicky-launcher.open { display: none; }
      .clicky-launcher-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: rgba(255,255,255,0.9); animation: clicky-blink 2s infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        .clicky-launcher-dot { animation: none; }
      }
      @keyframes clicky-blink { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }
      .clicky-drawer {
        position: fixed; right: 20px; bottom: 80px; z-index: 2147483647;
        width: min(380px, calc(100vw - 40px));
        max-height: min(560px, calc(100vh - 120px));
        display: none; flex-direction: column;
        background: var(--clicky-bg); color: var(--clicky-fg);
        border-radius: var(--clicky-radius);
        box-shadow: var(--clicky-shadow);
        border: 1px solid var(--clicky-border);
        overflow: hidden;
        animation: clicky-slide-in 220ms cubic-bezier(.2,.9,.3,1);
      }
      @media (prefers-reduced-motion: reduce) {
        .clicky-drawer { animation: none; }
      }
      @keyframes clicky-slide-in {
        from { opacity: 0; transform: translateY(8px) scale(0.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .clicky-drawer.open { display: flex; }
      .clicky-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 16px; font-weight: 600; font-size: 14px;
        border-bottom: 1px solid var(--clicky-border);
      }
      .clicky-header-actions { display: flex; align-items: center; gap: 6px; }
      .clicky-icon-btn {
        width: 32px; height: 32px; border-radius: 8px;
        background: transparent; border: 1px solid var(--clicky-border);
        color: var(--clicky-fg); cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center;
      }
      .clicky-icon-btn:hover { background: var(--clicky-surface); }
      .clicky-close {
        background: transparent; border: 1px solid var(--clicky-border);
        color: var(--clicky-fg); border-radius: 8px; padding: 4px 10px;
        cursor: pointer; font-size: 12px;
      }
      .clicky-messages {
        flex: 1; overflow-y: auto; padding: 14px 16px;
        display: flex; flex-direction: column; gap: 10px;
      }
      .clicky-message {
        padding: 10px 12px; border-radius: 12px; max-width: 86%;
        font-size: 14px; line-height: 1.45;
        animation: clicky-fade-in 180ms ease;
      }
      @media (prefers-reduced-motion: reduce) {
        .clicky-message { animation: none; }
      }
      @keyframes clicky-fade-in {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .clicky-user {
        align-self: flex-end; background: var(--clicky-primary); color: white;
        border-bottom-right-radius: 4px; white-space: pre-wrap;
      }
      .clicky-assistant {
        align-self: flex-start; background: var(--clicky-surface);
        border-bottom-left-radius: 4px;
      }
      .clicky-assistant p { margin: 0 0 6px; }
      .clicky-assistant p:last-child { margin-bottom: 0; }
      .clicky-assistant ul, .clicky-assistant ol { margin: 6px 0; padding-left: 18px; }
      .clicky-assistant code {
        background: rgba(0,0,0,0.08); padding: 1px 5px; border-radius: 4px;
        font: 12px ui-monospace, Menlo, Consolas, monospace;
      }
      @media (prefers-color-scheme: dark) {
        .clicky-assistant code { background: rgba(255,255,255,0.1); }
      }
      .clicky-assistant pre {
        background: rgba(0,0,0,0.08); padding: 10px 12px; border-radius: 8px;
        overflow-x: auto; margin: 6px 0;
      }
      @media (prefers-color-scheme: dark) {
        .clicky-assistant pre { background: rgba(255,255,255,0.08); }
      }
      .clicky-assistant pre code {
        background: transparent; padding: 0;
        font: 12px ui-monospace, Menlo, Consolas, monospace;
      }
      .clicky-assistant a { color: var(--clicky-primary); }
      .clicky-status {
        padding: 0 16px 6px; font-size: 12px; color: var(--clicky-muted);
        min-height: 16px;
      }
      .clicky-status.active::before {
        content: ''; display: inline-block; width: 6px; height: 6px;
        border-radius: 50%; background: var(--clicky-primary); margin-right: 6px;
        animation: clicky-blink 1.4s infinite;
      }
      .clicky-status.thinking::before { display: none; }
      .clicky-typing { display: inline-flex; gap: 3px; vertical-align: middle; }
      .clicky-typing i {
        width: 5px; height: 5px; border-radius: 50%;
        background: var(--clicky-primary);
        animation: clicky-bounce 1.2s infinite ease-in-out;
      }
      .clicky-typing i:nth-child(2) { animation-delay: 0.15s; }
      .clicky-typing i:nth-child(3) { animation-delay: 0.3s; }
      @keyframes clicky-bounce {
        0%,80%,100% { transform: translateY(0); opacity: 0.5; }
        40% { transform: translateY(-4px); opacity: 1; }
      }
      @media (prefers-reduced-motion: reduce) {
        .clicky-typing i { animation: none; opacity: 1; }
      }
      .clicky-form {
        display: flex; gap: 8px; padding: 12px 16px 10px;
        border-top: 1px solid var(--clicky-border);
        align-items: stretch;
      }
      .clicky-input {
        flex: 1; resize: none; padding: 10px 12px; border-radius: 10px;
        border: 1px solid var(--clicky-border); font: inherit; font-size: 14px;
        background: var(--clicky-bg); color: var(--clicky-fg);
        outline: none; min-height: 44px;
      }
      .clicky-input:focus { border-color: var(--clicky-primary); }
      .clicky-mic {
        width: 44px; min-height: 44px; align-self: stretch;
      }
      .clicky-mic.recording {
        background: var(--clicky-primary); color: white;
        border-color: var(--clicky-primary);
        animation: clicky-pulse-bg 1.2s infinite;
      }
      @keyframes clicky-pulse-bg {
        0%,100% { box-shadow: 0 0 0 0 rgba(95,123,110,0.4); }
        50% { box-shadow: 0 0 0 6px rgba(95,123,110,0); }
      }
      @media (prefers-reduced-motion: reduce) {
        .clicky-mic.recording { animation: none; }
      }
      .clicky-send {
        background: var(--clicky-primary); color: white; border: none;
        border-radius: 10px; padding: 0 16px; font-weight: 600; cursor: pointer;
        min-height: 44px;
      }
      .clicky-hint {
        padding: 0 16px 10px; font-size: 11px; color: var(--clicky-muted);
        text-align: center;
      }
      @media (max-width: 520px) {
        .clicky-drawer {
          right: 10px !important; left: 10px !important;
          bottom: 10px !important; top: auto !important;
          width: auto; max-height: 80vh;
          padding-bottom: env(safe-area-inset-bottom);
        }
        .clicky-launcher { padding: 10px 14px; font-size: 13px; }
      }
    `
  }
}

const speakerIcon = (muted: boolean): string => {
  if (muted) {
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>'
  }
  return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>'
}

const micIcon = (): string =>
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>'
