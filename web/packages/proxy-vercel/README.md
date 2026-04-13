# @clicky/proxy-vercel

Copy-paste template for hosting the Clicky LLM proxy on a Vercel Edge Function.

## Install

```bash
pnpm add @anthropic-ai/sdk
```

## Use

1. Copy `template/route.ts` into your Next.js app:
   - App Router: `app/api/clicky/route.ts`
   - Pages Router: `pages/api/clicky.ts` (and remove `export const runtime = 'edge'`)
2. Set `ANTHROPIC_API_KEY` in the Vercel dashboard or:

   ```bash
   vercel env add ANTHROPIC_API_KEY production
   vercel env add ANTHROPIC_API_KEY preview
   vercel env add ANTHROPIC_API_KEY development
   vercel env pull .env.local
   ```

3. Point your client at the route:

   ```ts
   import { createClicky } from '@clicky/core'
   const clicky = createClicky({ apiUrl: '/api/clicky' })
   clicky.mount(document.body)
   ```

## Wire format

The proxy speaks the same SSE format as `HttpProxyProvider` in `@clicky/core`.
See `template/route.ts` for the full event mapping (text deltas, tool use start/end, message stop, errors).
