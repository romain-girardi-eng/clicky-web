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
import { OpenAIProvider } from './openai-client'
import { createBuiltInActions } from './built-in-actions'
import { VoiceIO } from './voice-io'
import { AnimatedCursor } from './animated-cursor'
import { InlinePointParser, type PointTag } from './inline-point-parser'
import { VoiceOutput, SentenceBuffer } from './voice-output'
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
const DEFAULT_SYSTEM = `You are Clicky, a living companion embedded inside a web application. You are NOT a chatbot — you ACT.

Each user message is accompanied by a snapshot of the current page. Every interactive element is listed with a stable id in the form [c-N]. To point at, click or fill an element, always reference it by #c-N. Never invent selectors.

RULES
- Prefer doing over explaining. If the user asks "how do I X", navigate, point, and click — don't paste a paragraph.
- Maximum 2 short sentences of text per answer, unless the question is purely conceptual.
- Inline pointing tag: \`[POINT:#c-N:Short label]\`. The client strips the tag and flies a cursor to the element. Use this whenever you name a button, link or field.
- Tools: \`click\`, \`fill\`, \`navigate\`, \`highlight\`, \`read\`, \`done\`. Pass targets as #c-N.
- If the relevant UI is on another page, \`navigate\` first, then point/click after the new snapshot arrives next turn.
- Always \`done\` when the task is satisfied, with a one-sentence confirmation.
- Match the user's language (default French).`

type AgentListener = (state: { state: AgentState; messages: AgentMessage[] }) => void
export type PointingListener = (tag: PointTag) => void

interface InternalReadable {
  label: string
  get: ReadableGetter
}

export class ClickyAgent {
  readonly dom: DomReader
  readonly overlay: HighlightOverlay
  readonly actions: ActionRegistry
  readonly voice: VoiceIO
  readonly cursor: AnimatedCursor
  readonly voiceOutput: VoiceOutput

  private readonly provider: ChatProvider
  private readonly readables = new Map<string, InternalReadable>()
  private readonly listeners = new Set<AgentListener>()
  private readonly pointingListeners = new Set<PointingListener>()
  private messages: AgentMessage[] = []
  private historyForLLM: ChatMessage[] = []
  private currentState: AgentState = 'idle'
  private abortController: AbortController | null = null

  constructor(private readonly config: ClickyConfig) {
    this.dom = new DomReader()
    this.overlay = new HighlightOverlay()
    this.actions = new ActionRegistry()
    const lang = config.voice?.lang ?? (config.locale === 'fr' ? 'fr-FR' : 'en-US')
    this.voice = new VoiceIO(lang)
    this.cursor = new AnimatedCursor({
      persistent: config.cursor?.persistent ?? true,
      color: config.cursor?.color ?? config.theme?.primary ?? '#3b82f6',
      lerpFactor: config.cursor?.lerpFactor,
      idleAnimation: config.cursor?.idleAnimation ?? true,
    })
    this.voiceOutput = new VoiceOutput(lang)
    this.provider = resolveProvider(config)
    this.registerBuiltInActions()
  }

  static withMockProvider(config: Omit<ClickyConfig, 'apiUrl'>): ClickyAgent {
    return new ClickyAgent({ ...config, apiUrl: 'mock://', provider: new MockProvider() })
  }

  /* ----- public api ----- */

  mount(target: Element = document.body): void {
    this.dom.start()
    this.overlay.mount()
    this.cursor.mount()
    void target
  }

  unmount(): void {
    this.abortController?.abort()
    this.dom.stop()
    this.overlay.unmount()
    this.cursor.unmount()
    this.voiceOutput.stop()
  }

  onPointing(listener: PointingListener): () => void {
    this.pointingListeners.add(listener)
    return () => this.pointingListeners.delete(listener)
  }

  emitPointing(tag: PointTag): void {
    for (const listener of this.pointingListeners) listener(tag)
    void this.cursor.flyTo(tag.selector, { label: tag.label })
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
    this.dom.invalidate()
    const snapshot = this.dom.snapshot()
    const pageText = this.dom.snapshotAsText(snapshot)
    const readableValues: Record<string, unknown> = {}
    for (const readable of this.readables.values()) {
      try {
        readableValues[readable.label] = readable.get()
      } catch {
        readableValues[readable.label] = null
      }
    }
    const readablesBlock = Object.keys(readableValues).length
      ? `\n<app_state>${JSON.stringify(readableValues).slice(0, 4000)}</app_state>`
      : ''
    return `<user_request>${text}</user_request>\n<page_snapshot>\n${pageText.slice(0, 8000)}\n</page_snapshot>${readablesBlock}`
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

      // Some models (notably Gemini with customtools) return their final
      // user-facing answer ONLY through a `done` tool call, with zero text
      // deltas. We unwrap any `done` tool first so its message becomes the
      // visible assistant message even when `text` is empty.
      const doneCall = toolCalls.find((c) => c.name === 'done')
      const doneMessage =
        doneCall && typeof (doneCall.input as { message?: unknown }).message === 'string'
          ? ((doneCall.input as { message: string }).message ?? '').trim()
          : ''
      const visibleText = text.trim() || doneMessage

      if (visibleText) {
        const message: AgentMessage = { id: makeId(), role: 'assistant', text: visibleText, createdAt: Date.now() }
        this.appendMessage(message)
        this.historyForLLM.push({
          role: 'assistant',
          content: [{ type: 'text', text: visibleText }],
        })
        // Legacy-safe: if TTS output is enabled but autoSpeak is not (so we
        // did not stream per-sentence during the response), speak the whole
        // message now.
        if (this.config.voice?.output && !this.config.voice?.autoSpeak) {
          void this.voiceOutput.speak(visibleText)
        }
      }

      // If the model called `done`, the turn is over. Don't loop, don't
      // execute it as a tool — the message is already shown.
      if (doneCall) {
        this.setState('idle')
        return
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
    const pointParser = new InlinePointParser()
    const sentenceBuffer = new SentenceBuffer()
    const autoSpeak = Boolean(this.config.voice?.output && this.config.voice?.autoSpeak)
    const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown>; raw: string }> = []
    let active: { id: string; name: string; raw: string } | null = null
    for await (const event of events) {
      if (event.type === 'text_delta' && event.text) {
        const { visibleText, points } = pointParser.push(event.text)
        if (visibleText) {
          text += visibleText
          if (autoSpeak) {
            const sentences = sentenceBuffer.push(visibleText)
            for (const sentence of sentences) void this.voiceOutput.speak(sentence)
          }
        }
        for (const tag of points) this.emitPointing(tag)
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
    // Drain any pending text left in the parser (unterminated tag, trailing
    // characters held back to disambiguate a split delta).
    const tail = pointParser.flush()
    if (tail) {
      text += tail
      if (autoSpeak) {
        const sentences = sentenceBuffer.push(tail)
        for (const sentence of sentences) void this.voiceOutput.speak(sentence)
      }
    }
    if (autoSpeak) {
      const remaining = sentenceBuffer.flush()
      if (remaining) void this.voiceOutput.speak(remaining)
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
      cursor: this.cursor,
      // Fallback path: if `done` is somehow executed as a regular tool (older
      // call sites, custom providers), the message still surfaces in the chat.
      onAssistantText: (text: string) => {
        const trimmed = text.trim()
        if (!trimmed) return
        this.appendMessage({ id: makeId(), role: 'assistant', text: trimmed, createdAt: Date.now() })
      },
    })
    for (const action of builtIns) this.actions.register(action)
  }

  private appendMessage(message: AgentMessage): void {
    this.messages = [...this.messages, message]
    this.notify()
  }

  private setState(state: AgentState): void {
    this.currentState = state
    this.cursor.setState(state)
    this.notify()
  }

  private notify(): void {
    const snapshot = { state: this.currentState, messages: this.messages.slice() }
    for (const listener of this.listeners) listener(snapshot)
  }
}

const makeId = (): string => Math.random().toString(36).slice(2, 10)

/**
 * Resolve which ChatProvider to use based on the config. Explicit provider
 * instances win. Strings pick a built-in. Otherwise we sniff the model id:
 * anything vendor-prefixed (google/, openai/, meta-llama/, anthropic/…) is
 * routed through the OpenAI-compatible provider, which is the format spoken
 * by OpenRouter and most gateways. A bare "claude-*" keeps the native
 * Anthropic provider for backward compatibility.
 */
const resolveProvider = (config: ClickyConfig): ChatProvider => {
  const provider = config.provider
  if (provider && typeof provider === 'object') return provider
  if (provider === 'anthropic') return new AnthropicProvider(config.apiUrl)
  if (provider === 'openai') return new OpenAIProvider(config.apiUrl)
  const model = config.model ?? ''
  if (/^(google|openai|meta-llama|mistralai|deepseek|qwen|x-ai|anthropic)\//i.test(model)) {
    return new OpenAIProvider(config.apiUrl)
  }
  return new AnthropicProvider(config.apiUrl)
}
