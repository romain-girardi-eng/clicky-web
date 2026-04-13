# Architecture

`@clicky/core` is a small set of cooperating modules. The public entrypoint
is `createClicky()`, which returns an instance with `mount`, `readable`,
`action`, `ask`, and `unmount`.

## Modules

- **`ClickyAgent`** — central state machine. Holds the chat history, the
  registry of readables (live snapshots of host-app state), and the action
  registry (tools the LLM can call). On every user message it builds a
  context blob, streams a response, parses tool calls, executes them, and
  loops until the LLM stops asking for tools.
- **`DomReader`** — extracts a compact textual snapshot of the page (title,
  headings, landmarks, visible buttons, links, inputs) and resolves natural
  language queries to elements. Uses a `MutationObserver` to invalidate the
  cache when the page changes.
- **`HighlightOverlay`** — fixed-position overlay that draws a spotlight,
  ring, pulse, or arrow around any element. Lives at z-index `2147483646`,
  scrolls the target into view, and respects `prefers-reduced-motion`.
- **`ActionRegistry`** — JSON-Schema-validated map of tool definitions.
  Built-in tools (`highlight`, `click`, `fill`, `navigate`, `read`, `done`)
  are registered automatically; host apps add their own via
  `clicky.action(...)`.
- **`LLMClient`** — `ChatProvider` interface plus two implementations:
  `AnthropicProvider` (talks to your proxy via SSE) and `MockProvider`
  (used for examples and tests, replies with a canned message). Both yield
  `StreamEvent` objects.
- **`Widget`** — vanilla DOM rendering of the floating launcher and chat
  drawer. Lives in a Shadow DOM so host CSS cannot leak in. Subscribes to
  the agent and re-renders messages and status on every state change.
- **`VoiceIO`** — wrapper around the Web Speech APIs (`SpeechRecognition`
  and `speechSynthesis`). Opt-in via `voice: { input: true, output: true }`.

## Flow of a single turn

1. User types a message into the widget.
2. Widget calls `agent.ask(text)`.
3. Agent appends the message and runs `composeUserMessage()`, which
   bundles the DOM snapshot and current readable values into a JSON blob.
4. Agent streams the assistant response from the proxy. Text deltas are
   forwarded to listeners (the widget renders them live). Tool use blocks
   are accumulated.
5. If the response contains tool calls, each one is dispatched through the
   `ActionRegistry`. Built-in tools manipulate the DOM directly; custom
   tools call into host-app code.
6. Tool results are appended to the history and the loop runs again
   (capped at 5 turns) until the LLM stops asking for tools.
7. Final assistant text is committed to the visible message list.

## Wire format (client <-> proxy)

Request body (POST JSON):

```json
{
  "model": "claude-sonnet-4-5",
  "system": "You are Clicky...",
  "messages": [{ "role": "user", "content": [...] }],
  "tools": [{ "name": "highlight", "description": "...", "input_schema": {...} }],
  "maxTokens": 1024
}
```

Response: `text/event-stream`. Each `data: ...` line is a JSON object
matching `StreamEvent`:

```ts
type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; toolUseId: string; toolName: string }
  | { type: 'tool_use_input_delta'; inputJsonDelta: string }
  | { type: 'tool_use_end' }
  | { type: 'message_stop' }
  | { type: 'error'; error: string }
```

The proxy is the only component that imports `@anthropic-ai/sdk` and the
only place that ever sees your API key.
