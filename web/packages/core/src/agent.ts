/**
 * ClickyAgent is the central state machine. It owns:
 *   - the message history exchanged with the LLM
 *   - the readables registry (snapshots of host-app state)
 *   - the action registry (tools the LLM can call)
 *   - the DOM reader and highlight overlay
 *
 * Per turn it:
 *   1) snapshots context (DOM + readables)
 *   2) streams a response from the LLM
 *   3) accumulates text and tool calls
 *   4) executes tool calls and feeds the results back as a new turn
 *   5) loops until the LLM stops asking for tools
 */

import { ActionRegistry } from './action-registry'
import { DomReader } from './dom-reader'
import { HighlightOverlay } from './highlight-overlay'
import { AnthropicProvider, MockProvider } from './llm-client'
import { createBuiltInActions } from './built-in-actions'
import { VoiceIO } from './voice-io'
import type {
  ActionDefinition,
  AgentMessage,
  AgentState,
  ChatMessage,
  ChatProvider,
  ClickyConfig,
  ReadableGetter,
  StreamEvent,
} from './types'

const DEFAULT_MODEL = 'claude-sonnet-4-5'
const DEFAULT_SYSTEM = `You are Clicky, an embedded assistant inside a web application.
You can see a compact summary of the page the user is currently on (provided as JSON in the user message) and you have tools to highlight, click, fill, navigate, read, and finish.
When the user asks "where do I do X", do not just answer in text — call the highlight tool with a target description so the user actually sees it on screen.
Keep responses short, concrete, and grounded in what is actually visible.
Always finish with the "done" tool when the user request is satisfied.`

type AgentListener = (state: { state: AgentState; messages: AgentMessage[] }) => void

interface InternalReadable {
  label: string
  get: ReadableGetter
}

export class ClickyAgent {
  readonly dom: DomReader
  readonly overlay: HighlightOverlay
  readonly actions: ActionRegistry
  readonly voice: VoiceIO

  private readonly provider: ChatProvider
  private readonly readables = new Map<string, InternalReadable>()
  private readonly listeners = new Set<AgentListener>()
  private messages: AgentMessage[] = []
  private historyForLLM: ChatMessage[] = []
  private currentState: AgentState = 'idle'
  private abortController: AbortController | null = null

  constructor(private readonly config: ClickyConfig) {
    this.dom = new DomReader()
    this.overlay = new HighlightOverlay()
    this.actions = new ActionRegistry()
    this.voice = new VoiceIO(config.locale === 'fr' ? 'fr-FR' : 'en-US')
    this.provider = config.provider ?? new AnthropicProvider(config.apiUrl)
    this.registerBuiltInActions()
  }

  static withMockProvider(config: Omit<ClickyConfig, 'apiUrl'>): ClickyAgent {
    return new ClickyAgent({ ...config, apiUrl: 'mock://', provider: new MockProvider() })
  }

  /* ----- public api ----- */

  mount(target: Element = document.body): void {
    this.dom.start()
    this.overlay.mount()
    void target
  }

  unmount(): void {
    this.abortController?.abort()
    this.dom.stop()
    this.overlay.unmount()
  }

  readable(label: string, getter: ReadableGetter): () => void {
    this.readables.set(label, { label, get: getter })
    return () => this.readables.delete(label)
  }

  action(definition: ActionDefinition): () => void {
    this.actions.register(definition)
    return () => this.actions.unregister(definition.name)
  }

  subscribe(listener: AgentListener): () => void {
    this.listeners.add(listener)
    listener({ state: this.currentState, messages: this.messages.slice() })
    return () => this.listeners.delete(listener)
  }

  getState(): AgentState {
    return this.currentState
  }

  getMessages(): AgentMessage[] {
    return this.messages.slice()
  }

  abort(): void {
    this.abortController?.abort()
    this.setState('idle')
  }

  async ask(text: string): Promise<void> {
    if (!text.trim()) return
    this.appendMessage({ id: makeId(), role: 'user', text, createdAt: Date.now() })
    this.historyForLLM.push({
      role: 'user',
      content: [{ type: 'text', text: this.composeUserMessage(text) }],
    })
    await this.runLoop()
  }

  /* ----- internals ----- */

  private composeUserMessage(text: string): string {
    const snapshot = this.dom.snapshot()
    const readableValues: Record<string, unknown> = {}
    for (const readable of this.readables.values()) {
      try {
        readableValues[readable.label] = readable.get()
      } catch {
        readableValues[readable.label] = null
      }
    }
    const context = {
      page: snapshot,
      app: readableValues,
    }
    return `<user_request>${text}</user_request>\n<page_context>${JSON.stringify(context).slice(0, 12000)}</page_context>`
  }

  private async runLoop(): Promise<void> {
    const maxTurns = 5
    for (let turn = 0; turn < maxTurns; turn += 1) {
      this.setState('thinking')
      this.abortController = new AbortController()
      const events = this.provider.streamChat(
        {
          model: this.config.model ?? DEFAULT_MODEL,
          system: this.config.systemPrompt ?? DEFAULT_SYSTEM,
          messages: this.historyForLLM,
          tools: this.actions.toToolDefinitions(),
          maxTokens: this.config.maxTokens ?? 1024,
        },
        this.abortController.signal,
      )

      const { text, toolCalls } = await this.consumeStream(events)

      if (text.trim()) {
        const message: AgentMessage = { id: makeId(), role: 'assistant', text, createdAt: Date.now() }
        this.appendMessage(message)
        this.historyForLLM.push({
          role: 'assistant',
          content: [{ type: 'text', text }],
        })
        if (this.config.voice?.output) this.voice.speak(text)
      }

      if (toolCalls.length === 0) {
        this.setState('idle')
        return
      }

      this.setState('acting')
      const toolResults = await this.executeTools(toolCalls)
      this.historyForLLM.push({
        role: 'assistant',
        content: toolCalls.map((call) => ({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: call.input,
        })),
      })
      this.historyForLLM.push({
        role: 'user',
        content: toolResults.map((result) => ({
          type: 'tool_result',
          tool_use_id: result.id,
          content: JSON.stringify(result.content).slice(0, 800),
          is_error: result.isError,
        })),
      })
    }
    this.setState('idle')
  }

  private async consumeStream(events: AsyncIterable<StreamEvent>): Promise<{
    text: string
    toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>
  }> {
    let text = ''
    const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown>; raw: string }> = []
    let active: { id: string; name: string; raw: string } | null = null
    for await (const event of events) {
      if (event.type === 'text_delta' && event.text) {
        text += event.text
      } else if (event.type === 'tool_use_start' && event.toolUseId && event.toolName) {
        active = { id: event.toolUseId, name: event.toolName, raw: '' }
      } else if (event.type === 'tool_use_input_delta' && active && event.inputJsonDelta) {
        active.raw += event.inputJsonDelta
      } else if (event.type === 'tool_use_end' && active) {
        let parsed: Record<string, unknown> = {}
        try {
          parsed = active.raw ? (JSON.parse(active.raw) as Record<string, unknown>) : {}
        } catch {
          parsed = {}
        }
        toolCalls.push({ id: active.id, name: active.name, input: parsed, raw: active.raw })
        active = null
      } else if (event.type === 'error') {
        text += `\n[error: ${event.error}]`
      }
    }
    return { text, toolCalls: toolCalls.map(({ id, name, input }) => ({ id, name, input })) }
  }

  private async executeTools(
    calls: Array<{ id: string; name: string; input: Record<string, unknown> }>,
  ): Promise<Array<{ id: string; content: unknown; isError: boolean }>> {
    const results: Array<{ id: string; content: unknown; isError: boolean }> = []
    for (const call of calls) {
      const outcome = await this.actions.invoke(call.name, call.input)
      if (outcome.ok) results.push({ id: call.id, content: outcome.result, isError: false })
      else results.push({ id: call.id, content: { error: outcome.error }, isError: true })
    }
    return results
  }

  private registerBuiltInActions(): void {
    const builtIns = createBuiltInActions({
      dom: this.dom,
      overlay: this.overlay,
      config: this.config,
      onAssistantText: () => undefined,
    })
    for (const action of builtIns) this.actions.register(action)
  }

  private appendMessage(message: AgentMessage): void {
    this.messages = [...this.messages, message]
    this.notify()
  }

  private setState(state: AgentState): void {
    this.currentState = state
    this.notify()
  }

  private notify(): void {
    const snapshot = { state: this.currentState, messages: this.messages.slice() }
    for (const listener of this.listeners) listener(snapshot)
  }
}

const makeId = (): string => Math.random().toString(36).slice(2, 10)
