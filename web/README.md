# clicky-web

Embeddable AI companion for the web. Drop a script tag (or a React provider) into any web app and the user gets a floating assistant that watches the page, talks back in streaming, and can spotlight, click, fill, and navigate UI elements on their behalf.

`clicky-web` is the multi-framework, MIT-licensed cousin of [farzaa/clicky](https://github.com/farzaa/clicky), which is a native macOS app. This project does the same job but lives inside the page, in vanilla JS or React, and ships an Edge-deployable proxy template so you never expose your model API key.

## Why

- **Onboarding** that actually shows the next button instead of describing it.
- **Context-aware support** that knows what page the user is on and what's in their cart, draft, or form.
- **Accessibility & training** without rewriting the host app — Clicky reads the live DOM and the values you choose to expose via `readable()`.

## Quickstart

```bash
pnpm add @clicky/core
```

```ts
import { createClicky } from '@clicky/core'

const clicky = createClicky({
  apiUrl: '/api/clicky',
  model: 'claude-sonnet-4-5',
})

clicky.readable('currentRoute', () => location.pathname)
clicky.readable('userName', () => store.user?.name)

clicky.action({
  name: 'goToCheckout',
  description: 'Navigate the user to the checkout page',
  schema: { type: 'object', properties: {} },
  handler: () => router.push('/checkout'),
})

clicky.mount(document.body)
```

For React:

```tsx
import { ClickyProvider, ClickyWidget, useClickyReadable, useClickyAction } from '@clicky/react'

export const App = () => (
  <ClickyProvider apiUrl="/api/clicky">
    <Routes>{/* ... */}</Routes>
    <ClickyWidget />
  </ClickyProvider>
)
```

For the proxy: copy `packages/proxy/src/vercel-edge.ts` into `app/api/clicky/route.ts`, set `ANTHROPIC_API_KEY`, deploy. For Cloudflare, use `packages/proxy/src/cloudflare-worker.ts` — or simply reuse the Worker that already powers the macOS version of Clicky in this same repo: it now exposes a `POST /web/chat` route with permissive CORS that does exactly the same thing.

## Architecture

```
+--------------------+        +--------------------+        +-----------------+
|  Host web app      |  DOM   |  @clicky/core      |  SSE   |  Edge proxy     |
|  (your React, Vue, +------->+  agent + widget    +<------>+  /api/clicky    |
|   vanilla, etc.)   |        |  (Shadow DOM UI)   |        |  Anthropic API  |
+--------------------+        +--------------------+        +-----------------+
        |                            |
        | readables() / actions()    | DOM observer + highlight overlay
        v                            v
   live app state                live page snapshot
```

The agent serializes the page into a compact textual snapshot (headings, buttons, links, inputs) plus your declared readables, sends it to the proxy alongside the message history and a JSON schema for each registered tool, streams the assistant response back, and executes any tool calls locally on the page.

## Capabilities matrix

| Feature                       | Status        |
|-------------------------------|---------------|
| Streaming chat                | yes           |
| DOM snapshot for context      | yes           |
| Highlight / spotlight overlay | yes           |
| Click / fill / navigate       | yes           |
| Voice input (Web Speech)      | yes (opt-in)  |
| Voice output (TTS)            | yes (opt-in)  |
| Custom host actions           | yes           |
| Shadow DOM isolation          | yes           |
| React 18 / 19 bindings        | yes           |
| Server Components compatible  | yes (`'use client'` boundary) |
| Multi-provider (OpenAI, etc.) | proxy-side only for v0.1 |

## Cost calculator

Average conversation: ~5 messages, ~5k tokens in / 1.5k out for Claude Sonnet 4.5.
At list pricing that's roughly **$0.04 per conversation**. A free-tier SaaS doing 1k conversations a day would spend ~$1,200/month on the model. Cache the system prompt and snapshot, and you can cut that by 60-80%.

## Why not Clicky?

[Clicky](https://github.com/farzaa/clicky) is a brilliant native macOS app that watches your screen at the OS level. It's the right choice if you want a system-wide assistant that crosses every app on your Mac.

`clicky-web` is the right choice when:

- you want the assistant inside *your* app, not over it
- you need it to work on Windows, Linux, ChromeOS, iPadOS — anywhere a browser runs
- you want the assistant to read app state directly (not via OCR)
- you want to ship it to your users, not just developers

The two projects share a name and a design instinct, nothing else.

## Differences vs the macOS version

The macOS app at the root of this repo (`leanring-buddy/`) and the web SDK in `web/` share a name and a design instinct. They differ everywhere it matters technically:

| Aspect              | macOS                                            | Web                                              |
|---------------------|--------------------------------------------------|--------------------------------------------------|
| Page understanding  | Screenshots via ScreenCaptureKit                 | DOM snapshot (text + landmarks + buttons + forms) |
| Element pointing    | `[POINT:x,y:label:screenN]` text tag, OS cursor  | Anthropic tool_use call, SVG spotlight on real DOM |
| Voice STT           | AssemblyAI streaming push-to-talk                | Native `SpeechRecognition` (opt-in)              |
| Voice TTS           | ElevenLabs Flash 2.5                             | Native `SpeechSynthesis` (opt-in)                |
| Trigger             | Global hotkey + menu bar panel                   | Floating launcher + drawer                       |
| Distribution        | DMG / Sparkle                                    | npm packages (`@clicky/core`, `@clicky/react`)   |

## Repository layout

```
web/
  packages/
    core/             vanilla TS, framework-agnostic widget + agent
    react/            React provider, hooks, widget wrapper
    proxy/            Vercel Edge + Cloudflare Worker templates
  examples/
    vanilla/          single index.html
    react-vite/       Vite + React + react-router
    nextjs/           Next.js 15 App Router with /api/clicky
  docs/
    architecture.md
    actions-api.md
    advanced.md
```

## Development

```bash
pnpm install
pnpm test         # vitest run for both packages
pnpm typecheck    # tsc --noEmit for both packages
pnpm build        # tsup ESM + CJS + .d.ts
```

## Contributing

Issues and PRs welcome. Please run `pnpm test && pnpm typecheck && pnpm build` before opening a PR.

## License

MIT — see [LICENSE](../LICENSE).
