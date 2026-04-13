/**
 * OpenAIProvider streams chat completions through a server-side proxy that
 * forwards to an OpenAI-compatible endpoint (OpenAI, OpenRouter, Groq, etc.).
 *
 * Clicky's internal message shape is Anthropic-flavoured (content blocks,
 * tool_use, tool_result). This provider transparently converts to and from
 * the OpenAI Chat Completions format, and emits the same unified StreamEvent
 * shape as AnthropicProvider so ClickyAgent does not need to care which
 * backend is in use.
 */

import type {
  ChatContentBlock,
  ChatMessage,
  ChatProvider,
  ChatRequest,
  StreamEvent,
  ToolDefinition,
} from './types'

interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

interface OpenAIToolCall {
  id?: string
  type?: 'function'
  function?: { name?: string; arguments?: string }
  index?: number
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  name?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null
      tool_calls?: OpenAIToolCall[]
    }
    finish_reason?: string | null
    index?: number
  }>
}

export class OpenAIProvider implements ChatProvider {
  constructor(private readonly endpoint: string) {}

  async *streamChat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<StreamEvent> {
    const body = {
      model: request.model,
      messages: convertMessages(request.system, request.messages),
      tools: request.tools.length > 0 ? convertTools(request.tools) : undefined,
      tool_choice: request.tools.length > 0 ? 'auto' : undefined,
      max_tokens: request.maxTokens ?? 1024,
      stream: true,
    }

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })

    if (!response.ok || !response.body) {
      const errorText = await response.text().catch(() => '')
      yield { type: 'error', error: `proxy error ${response.status}: ${errorText.slice(0, 200)}` }
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    // Tool calls arrive as deltas indexed by position. We accumulate them
    // by index, and flush each one when the next index starts or the stream
    // ends. OpenRouter/OpenAI guarantee ordered deltas per index.
    const openStack: Map<number, { id: string; name: string; rawArgs: string; opened: boolean }> = new Map()
    const flushTool = function* (slot: { id: string; name: string; rawArgs: string; opened: boolean }): Generator<StreamEvent> {
      if (!slot.opened) {
        yield { type: 'tool_use_start', toolUseId: slot.id, toolName: slot.name }
        slot.opened = true
      }
      if (slot.rawArgs) {
        yield { type: 'tool_use_input_delta', inputJsonDelta: slot.rawArgs }
        slot.rawArgs = ''
      }
      yield { type: 'tool_use_end' }
    }

    let finishReason: string | null = null

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        let chunk: OpenAIStreamChunk
        try {
          chunk = JSON.parse(payload) as OpenAIStreamChunk
        } catch {
          continue
        }
        const choice = chunk.choices?.[0]
        if (!choice) continue
        const delta = choice.delta
        if (delta?.content) {
          yield { type: 'text_delta', text: delta.content }
        }
        if (delta?.tool_calls) {
          for (const call of delta.tool_calls) {
            const idx = call.index ?? 0
            let slot = openStack.get(idx)
            if (!slot) {
              slot = {
                id: call.id ?? `call_${idx}_${Math.random().toString(36).slice(2, 8)}`,
                name: call.function?.name ?? '',
                rawArgs: '',
                opened: false,
              }
              openStack.set(idx, slot)
            }
            if (call.id && !slot.opened) slot.id = call.id
            if (call.function?.name) slot.name = call.function.name
            // Open the tool_use span as soon as we have a name — this lets
            // downstream consumers start rendering.
            if (slot.name && !slot.opened) {
              yield { type: 'tool_use_start', toolUseId: slot.id, toolName: slot.name }
              slot.opened = true
            }
            if (call.function?.arguments) {
              if (slot.opened) {
                yield { type: 'tool_use_input_delta', inputJsonDelta: call.function.arguments }
              } else {
                slot.rawArgs += call.function.arguments
              }
            }
          }
        }
        if (choice.finish_reason) {
          finishReason = choice.finish_reason
        }
      }
    }

    // Close any still-open tool calls, then signal end of message.
    for (const slot of openStack.values()) {
      if (!slot.opened) {
        yield* flushTool(slot)
      } else {
        yield { type: 'tool_use_end' }
      }
    }
    void finishReason
    yield { type: 'message_stop' }
  }
}

/* ----- converters ----- */

export const convertTools = (tools: ToolDefinition[]): OpenAITool[] =>
  tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: (tool.input_schema as unknown as Record<string, unknown>) ?? { type: 'object', properties: {} },
    },
  }))

export const convertMessages = (system: string, messages: ChatMessage[]): OpenAIMessage[] => {
  const out: OpenAIMessage[] = []
  if (system) out.push({ role: 'system', content: system })

  for (const msg of messages) {
    const blocks: ChatContentBlock[] =
      typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : msg.content

    if (msg.role === 'user') {
      // A user message in Clicky's history can mix plain text and
      // tool_result blocks (results of the assistant's previous tool calls).
      // In OpenAI format, every tool_result becomes a standalone message
      // with role: 'tool'. Text blocks stay as role: 'user'.
      const textParts: string[] = []
      const toolMessages: OpenAIMessage[] = []
      for (const block of blocks) {
        if (block.type === 'text') {
          textParts.push(block.text)
        } else if (block.type === 'tool_result') {
          toolMessages.push({
            role: 'tool',
            tool_call_id: block.tool_use_id,
            content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
          })
        }
      }
      if (textParts.length > 0) {
        out.push({ role: 'user', content: textParts.join('\n') })
      }
      out.push(...toolMessages)
      continue
    }

    if (msg.role === 'assistant') {
      const textParts: string[] = []
      const toolCalls: NonNullable<OpenAIMessage['tool_calls']> = []
      for (const block of blocks) {
        if (block.type === 'text') {
          textParts.push(block.text)
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input ?? {}),
            },
          })
        }
      }
      const assistantMsg: OpenAIMessage = {
        role: 'assistant',
        content: textParts.length > 0 ? textParts.join('\n') : null,
      }
      if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls
      out.push(assistantMsg)
      continue
    }

    if (msg.role === 'system') {
      const text = blocks
        .map((b) => (b.type === 'text' ? b.text : ''))
        .filter(Boolean)
        .join('\n')
      if (text) out.push({ role: 'system', content: text })
    }
  }

  return out
}
