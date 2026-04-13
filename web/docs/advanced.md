# Advanced

## Custom chat provider

`@clicky/core` ships with `AnthropicProvider` (talks to your proxy via
SSE) and `MockProvider` (canned reply, used for offline examples). To
plug in any other backend, implement the `ChatProvider` interface and
pass the instance to `createClicky({ provider })`.

```ts
import type { ChatProvider, ChatRequest, StreamEvent } from '@clicky/core'

class OpenAiProvider implements ChatProvider {
  async *streamChat(req: ChatRequest, signal?: AbortSignal): AsyncIterable<StreamEvent> {
    // ... fetch your backend, translate its events into Clicky's StreamEvent format
  }
}

const clicky = createClicky({ apiUrl: 'unused', provider: new OpenAiProvider() })
```

## Theming

Override the CSS variables exposed by the widget root:

```ts
createClicky({
  theme: {
    primary: '#9d6cff',
    background: '#0d0d12',
    foreground: '#ececf2',
    radius: '12px',
  },
})
```

The widget renders inside a Shadow Root, so these are the only knobs that
leak into its styling.

## Voice mode

```ts
createClicky({ voice: { input: true, output: true } })
```

This wires the Web Speech APIs (`SpeechRecognition` for input, the
browser TTS for output). Both are gracefully no-op when unsupported.

## Disabling auto-mount in React

By default `<ClickyProvider>` mounts the agent (DOM observer + overlay)
when it mounts. Pass `autoMount={false}` if you want to control the
lifecycle manually:

```tsx
<ClickyProvider apiUrl="/api/clicky" autoMount={false}>
  ...
</ClickyProvider>
```

Then call `agent.mount()` and `agent.unmount()` from a component that
owns the lifecycle.

## CSP and Shadow DOM

The widget injects a `<style>` element inside its Shadow Root. If your
host page enforces a strict `Content-Security-Policy`, you may need to
add `'unsafe-inline'` to `style-src` or move to a `nonce`-based CSP.
The widget reads its own primary color via CSS variables, so swapping
the theme does not require a new style block.
