## @clicky/proxy

Reference proxy templates for Clicky. The web SDK never talks to Anthropic directly — it always goes through a server you control so the API key stays out of the browser bundle.

You have three options:

### 1. Vercel Edge Function (Next.js App Router)

Copy `src/vercel-edge.ts` to `app/api/clicky/route.ts`. Set `ANTHROPIC_API_KEY` in your Vercel project. Point the SDK at `/api/clicky`.

### 2. Standalone Cloudflare Worker

Copy `src/cloudflare-worker.ts`, set the `ANTHROPIC_API_KEY` secret with `wrangler secret put`, deploy. Point the SDK at the Worker URL.

### 3. Reuse the macOS Worker that ships with this repo

The macOS Clicky app uses a Cloudflare Worker at `worker/src/index.ts`. That Worker has been extended with a `POST /web/chat` route that does exactly what the templates above do — forward to Anthropic Messages API in streaming mode and pipe SSE back. If you already deployed the macOS Worker, you can point the web SDK at `https://your-worker.workers.dev/web/chat` and you are done.

### Shared helper

Both templates call `buildProxyResponse(request, { anthropicApiKey })` from `src/index.ts`. It handles CORS preflight, validates the method, forwards the body to `https://api.anthropic.com/v1/messages` and pipes the streamed response back unchanged.
