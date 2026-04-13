/**
 * Clicky proxy template for Cloudflare Workers.
 *
 * Setup:
 *   wrangler init my-clicky-proxy
 *   cp template/worker.ts src/index.ts
 *   wrangler secret put ANTHROPIC_API_KEY
 *   wrangler deploy
 *
 * The worker exposes a single POST handler that streams SSE events back to
 * @clicky/core's HttpProxyProvider. The wire format matches packages/proxy-vercel.
 */

export interface Env {
  ANTHROPIC_API_KEY: string
}

interface ClickyRequestBody {
  model?: string
  system?: string
  messages: unknown
  tools?: unknown
  maxTokens?: number
}

const encoder = new TextEncoder()
const sse = (event: unknown): Uint8Array => encoder.encode(`data: ${JSON.stringify(event)}\n\n`)

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== 'POST') return new Response('Use POST', { status: 405 })
    if (!env.ANTHROPIC_API_KEY) return new Response('No ANTHROPIC_API_KEY configured', { status: 500 })

    let body: ClickyRequestBody
    try {
      body = (await req.json()) as ClickyRequestBody
    } catch {
      return new Response('Invalid JSON', { status: 400 })
    }

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: body.model ?? 'claude-sonnet-4-5',
        system: body.system,
        messages: body.messages,
        tools: body.tools,
        max_tokens: body.maxTokens ?? 1024,
        stream: true,
      }),
    })

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text()
      return new Response(`Upstream error ${upstream.status}: ${text}`, { status: 502 })
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = upstream.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        try {
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const parts = buffer.split('\n')
            buffer = parts.pop() ?? ''
            for (const line of parts) {
              const trimmed = line.trim()
              if (!trimmed.startsWith('data:')) continue
              const payload = trimmed.slice(5).trim()
              if (!payload || payload === '[DONE]') continue
              try {
                const evt = JSON.parse(payload) as Record<string, unknown>
                const translated = translate(evt)
                if (translated) controller.enqueue(sse(translated))
              } catch {
                // ignore malformed lines
              }
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        } catch (err) {
          controller.enqueue(
            sse({ type: 'error', error: err instanceof Error ? err.message : String(err) }),
          )
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        'access-control-allow-origin': '*',
      },
    })
  },
}

const translate = (raw: Record<string, unknown>): Record<string, unknown> | null => {
  const type = raw.type as string | undefined
  if (type === 'content_block_delta') {
    const delta = raw.delta as { type?: string; text?: string; partial_json?: string } | undefined
    if (delta?.type === 'text_delta') return { type: 'text_delta', text: delta.text }
    if (delta?.type === 'input_json_delta') return { type: 'tool_use_input_delta', inputJsonDelta: delta.partial_json }
    return null
  }
  if (type === 'content_block_start') {
    const block = raw.content_block as { type?: string; id?: string; name?: string } | undefined
    if (block?.type === 'tool_use') {
      return { type: 'tool_use_start', toolUseId: block.id, toolName: block.name }
    }
    return null
  }
  if (type === 'content_block_stop') return { type: 'tool_use_end' }
  if (type === 'message_stop') return { type: 'message_stop' }
  return null
}
