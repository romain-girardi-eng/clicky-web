/**
 * Cloudflare Worker template.
 * Either deploy as a standalone Worker, or graft this handler into an
 * existing Worker on a path like /web/chat (the macOS-side worker in
 * this repo already does exactly that — see worker/src/index.ts).
 */

import { buildProxyResponse } from './index'

interface Env {
  ANTHROPIC_API_KEY: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return buildProxyResponse(request, { anthropicApiKey: env.ANTHROPIC_API_KEY })
  },
}
