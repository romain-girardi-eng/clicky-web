import { describe, it, expect, vi, afterEach } from 'vitest'
import { OpenAIProvider, convertMessages, convertTools } from '../src/openai-client'
import type { ChatMessage, StreamEvent, ToolDefinition } from '../src/types'

const encoder = new TextEncoder()

const sseStream = (chunks: string[]): ReadableStream<Uint8Array> => {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

const collect = async (iter: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> => {
  const out: StreamEvent[] = []
  for await (const ev of iter) out.push(ev)
  return out
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('convertMessages', () => {
  it('prepends a system message', () => {
    const out = convertMessages('you are helpful', [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ])
    expect(out[0]).toEqual({ role: 'system', content: 'you are helpful' })
    expect(out[1]).toEqual({ role: 'user', content: 'hi' })
  })

  it('converts assistant tool_use blocks to tool_calls with JSON-stringified args', () => {
    const msgs: ChatMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'let me click' },
          { type: 'tool_use', id: 'call_1', name: 'click', input: { selector: '#btn' } },
        ],
      },
    ]
    const [, assistant] = convertMessages('sys', msgs)
    if (!assistant) throw new Error('missing assistant message')
    expect(assistant.role).toBe('assistant')
    expect(assistant.content).toBe('let me click')
    expect(assistant.tool_calls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'click', arguments: '{"selector":"#btn"}' } },
    ])
  })

  it('converts user tool_result blocks into standalone tool messages', () => {
    const msgs: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_1', content: '{"ok":true}' },
          { type: 'text', text: 'what next?' },
        ],
      },
    ]
    const result = convertMessages('', msgs)
    // tool message + user text
    const tool = result.find((m) => m.role === 'tool')
    const user = result.find((m) => m.role === 'user')
    expect(tool).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' })
    expect(user?.content).toBe('what next?')
  })
})

describe('convertTools', () => {
  it('wraps each tool in OpenAI function schema', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'click',
        description: 'click something',
        input_schema: { type: 'object', properties: { selector: { type: 'string' } } },
      },
    ]
    expect(convertTools(tools)).toEqual([
      {
        type: 'function',
        function: {
          name: 'click',
          description: 'click something',
          parameters: { type: 'object', properties: { selector: { type: 'string' } } },
        },
      },
    ])
  })
})

describe('OpenAIProvider.streamChat', () => {
  it('parses text deltas and emits a message_stop', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          sseStream([
            'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
            'data: [DONE]\n\n',
          ]),
          { status: 200 },
        ),
      ),
    )

    const provider = new OpenAIProvider('/api/clicky')
    const events = await collect(
      provider.streamChat({ model: 'google/gemini-3.1-pro-preview-customtools', system: '', messages: [], tools: [] }),
    )
    const text = events
      .filter((e) => e.type === 'text_delta')
      .map((e) => e.text)
      .join('')
    expect(text).toBe('Hello')
    expect(events.at(-1)?.type).toBe('message_stop')
  })

  it('accumulates streamed tool_calls and emits tool_use_start/delta/end', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          sseStream([
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"highlight","arguments":""}}]}}]}\n\n',
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"target\\":"}}]}}]}\n\n',
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"#cta\\"}"}}]}}]}\n\n',
            'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
            'data: [DONE]\n\n',
          ]),
          { status: 200 },
        ),
      ),
    )

    const provider = new OpenAIProvider('/api/clicky')
    const events = await collect(
      provider.streamChat({ model: 'google/gemini-3.1-pro-preview-customtools', system: '', messages: [], tools: [] }),
    )
    const starts = events.filter((e) => e.type === 'tool_use_start')
    const deltas = events.filter((e) => e.type === 'tool_use_input_delta')
    const ends = events.filter((e) => e.type === 'tool_use_end')
    expect(starts).toHaveLength(1)
    expect(starts[0]).toMatchObject({ toolUseId: 'call_abc', toolName: 'highlight' })
    const joined = deltas.map((d) => d.inputJsonDelta).join('')
    expect(JSON.parse(joined)).toEqual({ target: '#cta' })
    expect(ends).toHaveLength(1)
  })

  it('yields an error event when the upstream response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    )
    const provider = new OpenAIProvider('/api/clicky')
    const events = await collect(
      provider.streamChat({ model: 'google/gemini-3.1-pro-preview-customtools', system: '', messages: [], tools: [] }),
    )
    expect(events[0]?.type).toBe('error')
    expect(events[0]?.error).toContain('500')
  })

  it('posts converted body with OpenAI-shaped messages and tools', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(sseStream(['data: [DONE]\n\n']), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const provider = new OpenAIProvider('/api/clicky')
    await collect(
      provider.streamChat({
        model: 'google/gemini-3.1-pro-preview-customtools',
        system: 'be nice',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        tools: [
          {
            name: 'click',
            description: 'click',
            input_schema: { type: 'object', properties: {} },
          },
        ],
      }),
    )

    expect(fetchMock).toHaveBeenCalledOnce()
    const call = fetchMock.mock.calls[0] as unknown as [string, { body: string }]
    const body = JSON.parse(call[1].body)
    expect(body.model).toBe('google/gemini-3.1-pro-preview-customtools')
    expect(body.stream).toBe(true)
    expect(body.messages[0]).toEqual({ role: 'system', content: 'be nice' })
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' })
    expect(body.tools[0].type).toBe('function')
    expect(body.tools[0].function.name).toBe('click')
    expect(body.tool_choice).toBe('auto')
  })
})
