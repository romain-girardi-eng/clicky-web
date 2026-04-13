/**
 * AnthropicProvider streams Claude responses through a server-side proxy
 * (never directly to api.anthropic.com — that would leak the key). The
 * proxy must forward the body to /v1/messages with stream:true and pipe
 * the SSE stream back unchanged.
 *
 * The MockProvider is provided for offline demos and tests. It emits a
 * canned response without touching the network.
 */

import type { ChatProvider, ChatRequest, StreamEvent } from './types'

export class AnthropicProvider implements ChatProvider {
  constructor(private readonly endpoint: string) {}

  async *streamChat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<StreamEvent> {
    const body = {
      model: request.model,
      max_tokens: request.maxTokens ?? 1024,
      system: request.system,
      messages: request.messages,
      tools: request.tools,
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

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const event = JSON.parse(payload) as AnthropicStreamEvent
          const mapped = mapAnthropicEvent(event)
          if (mapped) yield mapped
        } catch {
          // ignore malformed lines
        }
      }
    }
  }
}

interface AnthropicStreamEvent {
  type: string
  index?: number
  delta?: {
    type?: string
    text?: string
    partial_json?: string
  }
  content_block?: {
    type: string
    id?: string
    name?: string
  }
}

const mapAnthropicEvent = (event: AnthropicStreamEvent): StreamEvent | null => {
  switch (event.type) {
    case 'content_block_start':
      if (event.content_block?.type === 'tool_use') {
        return {
          type: 'tool_use_start',
          toolName: event.content_block.name,
          toolUseId: event.content_block.id,
        }
      }
      return null
    case 'content_block_delta':
      if (event.delta?.type === 'text_delta' && event.delta.text) {
        return { type: 'text_delta', text: event.delta.text }
      }
      if (event.delta?.type === 'input_json_delta' && event.delta.partial_json !== undefined) {
        return { type: 'tool_use_input_delta', inputJsonDelta: event.delta.partial_json }
      }
      return null
    case 'content_block_stop':
      return { type: 'tool_use_end' }
    case 'message_stop':
      return { type: 'message_stop' }
    default:
      return null
  }
}

export class MockProvider implements ChatProvider {
  // eslint-disable-next-line require-yield
  async *streamChat(request: ChatRequest): AsyncIterable<StreamEvent> {
    const last = request.messages[request.messages.length - 1]
    const userText =
      typeof last?.content === 'string'
        ? last.content
        : Array.isArray(last?.content)
          ? last.content.map((block) => ('text' in block ? block.text : '')).join(' ')
          : ''
    const reply = `Mock response for: ${userText}`.slice(0, 200)
    for (const chunk of reply.match(/.{1,16}/g) ?? []) {
      await sleep(20)
      yield { type: 'text_delta', text: chunk }
    }
    yield { type: 'message_stop' }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
