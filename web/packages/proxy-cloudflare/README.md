# @clicky/proxy-cloudflare

Copy-paste template for hosting the Clicky LLM proxy on Cloudflare Workers.

## Use

```bash
npm create cloudflare@latest my-clicky-proxy
cp template/worker.ts my-clicky-proxy/src/index.ts
cd my-clicky-proxy
wrangler secret put ANTHROPIC_API_KEY
wrangler deploy
```

Then point your client at the worker URL:

```ts
import { createClicky } from '@clicky/core'
const clicky = createClicky({ apiUrl: 'https://my-clicky-proxy.workers.dev' })
clicky.mount(document.body)
```
