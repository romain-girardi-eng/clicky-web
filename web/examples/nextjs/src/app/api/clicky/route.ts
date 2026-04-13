// Drop-in copy of @clicky/proxy-vercel/template/route.ts
// Set ANTHROPIC_API_KEY in your environment before deploying.
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'edge'

interface ClickyRequestBody {
  model?: string
  system?: string
  messages: Array<{ role: string; content: unknown }>
  tools?: Array<{ name: string; description: string; input_schema: unknown }>
  maxTokens?: number
}

const encoder = new TextEncoder()
const sse = (event: unknown): Uint8Array => encoder.encode(`data: ${JSON.stringify(event)}\n\n`)

export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return new Response('ANTHROPIC_API_KEY is not configured', { status: 500 })

  let body: ClickyRequestBody
  try {
    body = (await req.json()) as ClickyRequestBody
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const client = new Anthropic({ apiKey })

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const upstream = await client.messages.stream({
          model: body.model ?? 'claude-sonnet-4-5',
          system: body.system,
          max_tokens: body.maxTokens ?? 1024,
          messages: body.messages as Anthropic.MessageParam[],
          tools: body.tools as Anthropic.Tool[] | undefined,
        })

        for await (const event of upstream) {
          if (event.type === 'content_block_delta') {
            const delta = event.delta
            if (delta.type === 'text_delta') {
              controller.enqueue(sse({ type: 'text_delta', text: delta.text }))
            } else if (delta.type === 'input_json_delta') {
              controller.enqueue(sse({ type: 'tool_use_input_delta', inputJsonDelta: delta.partial_json }))
            }
          } else if (event.type === 'content_block_start') {
            if (event.content_block.type === 'tool_use') {
              controller.enqueue(
                sse({
                  type: 'tool_use_start',
                  toolUseId: event.content_block.id,
                  toolName: event.content_block.name,
                }),
              )
            }
          } else if (event.type === 'content_block_stop') {
            controller.enqueue(sse({ type: 'tool_use_end' }))
          } else if (event.type === 'message_stop') {
            controller.enqueue(sse({ type: 'message_stop' }))
          }
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      } catch (err) {
        controller.enqueue(sse({ type: 'error', error: err instanceof Error ? err.message : String(err) }))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
    },
  })
}
