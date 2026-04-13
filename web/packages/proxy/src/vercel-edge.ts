/**
 * Vercel Edge Function template.
 * Copy this file to app/api/clicky/route.ts in your Next.js project.
 *
 *   ANTHROPIC_API_KEY=sk-ant-...   # set in your Vercel project env
 */

import { buildProxyResponse } from './index'

export const runtime = 'edge'

export async function POST(request: Request): Promise<Response> {
  return buildProxyResponse(request, {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  })
}

export async function OPTIONS(request: Request): Promise<Response> {
  return buildProxyResponse(request, {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  })
}
