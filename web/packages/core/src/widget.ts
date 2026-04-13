/**
 * Widget renders the floating button + chat drawer in vanilla DOM,
 * isolated in a Shadow Root so the host page CSS cannot leak in. The
 * widget subscribes to the agent and re-renders the message list and
 * status indicator on every state change.
 */

import type { ClickyAgent } from './agent'
import type { ClickyTheme } from './types'

export interface WidgetOptions {
  theme?: ClickyTheme
  locale?: 'en' | 'fr'
}

const COPY: Record<'en' | 'fr', { open: string; close: string; placeholder: string; send: string; thinking: string; speak: string }> = {
  en: {
    open: 'Open Clicky',
    close: 'Close',
    placeholder: 'Ask anything about this page',
    send: 'Send',
    thinking: 'Thinking',
    speak: 'Speak',
  },
  fr: {
    open: 'Ouvrir Clicky',
    close: 'Fermer',
    placeholder: 'Pose une question sur la page',
    send: 'Envoyer',
    thinking: 'Reflexion',
    speak: 'Parler',
  },
}

export class Widget {
  private host: HTMLDivElement | null = null
  private shadow: ShadowRoot | null = null
  private listEl: HTMLDivElement | null = null
  private statusEl: HTMLDivElement | null = null
  private inputEl: HTMLTextAreaElement | null = null
  private drawerEl: HTMLDivElement | null = null
  private buttonEl: HTMLButtonElement | null = null
  private unsubscribe: (() => void) | null = null
  private isOpen = false

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

    const button = document.createElement('button')
    button.className = 'clicky-launcher'
    button.type = 'button'
    button.setAttribute('aria-label', this.copy().open)
    button.innerHTML = `<span class="clicky-launcher-dot"></span><span class="clicky-launcher-text">Clicky</span>`
    button.addEventListener('click', () => this.toggle())
    root.appendChild(button)

    const drawer = document.createElement('div')
    drawer.className = 'clicky-drawer'
    drawer.setAttribute('role', 'dialog')
    drawer.setAttribute('aria-label', 'Clicky')

    const header = document.createElement('div')
    header.className = 'clicky-header'
    header.innerHTML = `<span>Clicky</span>`
    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'clicky-close'
    closeBtn.textContent = this.copy().close
    closeBtn.addEventListener('click', () => this.toggle())
    header.appendChild(closeBtn)
    drawer.appendChild(header)

    const list = document.createElement('div')
    list.className = 'clicky-messages'
    list.setAttribute('aria-live', 'polite')
    drawer.appendChild(list)

    const status = document.createElement('div')
    status.className = 'clicky-status'
    drawer.appendChild(status)

    const form = document.createElement('form')
    form.className = 'clicky-form'
    const input = document.createElement('textarea')
    input.placeholder = this.copy().placeholder
    input.rows = 2
    input.className = 'clicky-input'
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        form.requestSubmit()
      }
    })
    form.appendChild(input)

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
    root.appendChild(drawer)

    this.host = host
    this.shadow = shadow
    void this.shadow
    this.listEl = list
    this.statusEl = status
    this.inputEl = input
    this.drawerEl = drawer
    this.buttonEl = button

    this.unsubscribe = this.agent.subscribe(({ state, messages }) => {
      this.renderMessages(messages)
      this.renderStatus(state)
    })
  }

  unmount(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
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

  private renderMessages(messages: ReadonlyArray<{ role: string; text: string; id: string }>): void {
    if (!this.listEl) return
    this.listEl.innerHTML = ''
    for (const message of messages) {
      const bubble = document.createElement('div')
      bubble.className = `clicky-message clicky-${message.role}`
      bubble.textContent = message.text
      this.listEl.appendChild(bubble)
    }
    this.listEl.scrollTop = this.listEl.scrollHeight
  }

  private renderStatus(state: string): void {
    if (!this.statusEl) return
    if (state === 'idle') {
      this.statusEl.textContent = ''
      this.statusEl.classList.remove('active')
      return
    }
    const labels: Record<string, string> = {
      thinking: this.copy().thinking,
      acting: 'Working',
      listening: 'Listening',
      speaking: 'Speaking',
    }
    this.statusEl.textContent = `${labels[state] ?? state}...`
    this.statusEl.classList.add('active')
  }

  private copy(): typeof COPY['en'] {
    return COPY[this.options.locale ?? 'en']
  }

  private css(): string {
    const theme = this.options.theme ?? {}
    const primary = theme.primary ?? '#5f7b6e'
    const background = theme.background ?? '#ffffff'
    const foreground = theme.foreground ?? '#1a1a1a'
    const radius = theme.radius ?? '14px'
    return `
      :host, .clicky-root { font-family: system-ui, -apple-system, sans-serif; }
      .clicky-root { color: ${foreground}; }
      .clicky-launcher {
        position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
        display: flex; align-items: center; gap: 8px;
        padding: 12px 18px; border: none; border-radius: 999px;
        background: ${primary}; color: white; font-size: 14px; font-weight: 600;
        cursor: pointer; box-shadow: 0 14px 28px rgba(0,0,0,0.18);
        transition: transform 160ms ease;
      }
      .clicky-launcher:hover { transform: translateY(-1px); }
      .clicky-launcher.open { display: none; }
      .clicky-launcher-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: rgba(255,255,255,0.9); animation: clicky-blink 2s infinite;
      }
      @keyframes clicky-blink { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }
      .clicky-drawer {
        position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
        width: min(380px, calc(100vw - 40px));
        max-height: min(560px, calc(100vh - 40px));
        display: none; flex-direction: column;
        background: ${background}; color: ${foreground};
        border-radius: ${radius};
        box-shadow: 0 28px 60px rgba(0,0,0,0.22);
        border: 1px solid rgba(0,0,0,0.06);
        overflow: hidden;
      }
      .clicky-drawer.open { display: flex; }
      .clicky-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 16px; font-weight: 600; font-size: 14px;
        border-bottom: 1px solid rgba(0,0,0,0.06);
      }
      .clicky-close {
        background: transparent; border: 1px solid rgba(0,0,0,0.1);
        border-radius: 8px; padding: 4px 10px; cursor: pointer; font-size: 12px;
      }
      .clicky-messages {
        flex: 1; overflow-y: auto; padding: 14px 16px;
        display: flex; flex-direction: column; gap: 10px;
      }
      .clicky-message {
        padding: 10px 12px; border-radius: 12px; max-width: 86%;
        font-size: 14px; line-height: 1.4; white-space: pre-wrap;
      }
      .clicky-user {
        align-self: flex-end; background: ${primary}; color: white;
        border-bottom-right-radius: 4px;
      }
      .clicky-assistant {
        align-self: flex-start; background: rgba(0,0,0,0.05);
        border-bottom-left-radius: 4px;
      }
      .clicky-status {
        padding: 0 16px 6px; font-size: 12px; color: rgba(0,0,0,0.55);
        min-height: 16px;
      }
      .clicky-status.active::before {
        content: ''; display: inline-block; width: 6px; height: 6px;
        border-radius: 50%; background: ${primary}; margin-right: 6px;
        animation: clicky-blink 1.4s infinite;
      }
      .clicky-form {
        display: flex; gap: 8px; padding: 12px 16px 16px;
        border-top: 1px solid rgba(0,0,0,0.06);
      }
      .clicky-input {
        flex: 1; resize: none; padding: 10px 12px; border-radius: 10px;
        border: 1px solid rgba(0,0,0,0.12); font: inherit; font-size: 14px;
        background: white; color: ${foreground};
        outline: none;
      }
      .clicky-input:focus { border-color: ${primary}; }
      .clicky-send {
        background: ${primary}; color: white; border: none;
        border-radius: 10px; padding: 0 16px; font-weight: 600; cursor: pointer;
      }
      @media (max-width: 520px) {
        .clicky-drawer { right: 10px; left: 10px; bottom: 10px; width: auto; max-height: 80vh; }
      }
    `
  }
}
