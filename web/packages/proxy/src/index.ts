/**
 * Shared helpers for proxying Anthropic Messages API streaming responses
 * back to the browser. Both the Vercel Edge template and the Cloudflare
 * Worker template use these.
 */

export interface ProxyEnv {
  anthropicApiKey: string
  upstream?: string
  allowedOrigin?: string
}

export const buildProxyResponse = async (request: Request, env: ProxyEnv): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(env.allowedOrigin) })
  }
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders(env.allowedOrigin) })
  }
  if (!env.anthropicApiKey) {
    return new Response('Missing ANTHROPIC_API_KEY', { status: 500 })
  }
  const body = await request.text()
  const upstream = env.upstream ?? 'https://api.anthropic.com/v1/messages'
  const response = await fetch(upstream, {
    method: 'POST',
    headers: {
      'x-api-key': env.anthropicApiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body,
  })
  if (!response.ok || !response.body) {
    const errorText = await response.text().catch(() => '')
    return new Response(errorText || 'Upstream error', {
      status: response.status,
      headers: corsHeaders(env.allowedOrigin),
    })
  }
  return new Response(response.body, {
    status: 200,
    headers: {
      ...corsHeaders(env.allowedOrigin),
      'content-type': response.headers.get('content-type') ?? 'text/event-stream',
      'cache-control': 'no-cache',
    },
  })
}

export const corsHeaders = (allowedOrigin: string = '*'): Record<string, string> => ({
  'access-control-allow-origin': allowedOrigin,
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  vary: 'origin',
})
