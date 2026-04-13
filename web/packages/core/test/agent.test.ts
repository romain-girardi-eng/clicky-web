import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ClickyAgent } from '../src/agent'
import { MockProvider } from '../src/llm-client'
import type { ChatProvider, ChatRequest, StreamEvent } from '../src/types'

describe('ClickyAgent with MockProvider', () => {
  beforeEach(() => {
    document.body.innerHTML = '<h1>Hello</h1>'
  })

  it('streams a mock response and exposes messages', async () => {
    const agent = new ClickyAgent({ apiUrl: 'mock://', provider: new MockProvider() })
    agent.mount()
    await agent.ask('How do I checkout?')
    const messages = agent.getMessages()
    expect(messages.length).toBeGreaterThanOrEqual(2)
    expect(messages[0]?.role).toBe('user')
    expect(messages[1]?.role).toBe('assistant')
    expect(messages[1]?.text).toContain('Mock response')
    agent.unmount()
  })

  it('registers and unregisters readables', () => {
    const agent = new ClickyAgent({ apiUrl: 'mock://', provider: new MockProvider() })
    const off = agent.readable('userId', () => 'u-123')
    off()
    expect(typeof off).toBe('function')
  })

  it('deduplicates concurrent ask() calls so the user message appears once', async () => {
    const agent = new ClickyAgent({ apiUrl: 'mock://', provider: new MockProvider() })
    agent.mount()
    // Fire two back-to-back asks without awaiting the first. The second must
    // be dropped while the first is still in flight — this simulates the
    // widget's keydown + click double-dispatch path.
    const first = agent.ask('tu peux créer un reçu fiscal')
    const second = agent.ask('tu peux créer un reçu fiscal')
    await Promise.all([first, second])
    const userMessages = agent.getMessages().filter((m) => m.role === 'user')
    expect(userMessages).toHaveLength(1)
    expect(userMessages[0]?.text).toBe('tu peux créer un reçu fiscal')
    agent.unmount()
  })

  it('merges multi-turn assistant replies around a tool call into a single bubble', async () => {
    // A scripted provider: turn 1 emits text + a tool_use for a user-defined
    // action, turn 2 emits a follow-up text. Before the fix this produced
    // two assistant bubbles; now we expect exactly one, with both chunks
    // concatenated.
    let turn = 0
    const provider: ChatProvider = {
      async *streamChat(_request: ChatRequest): AsyncIterable<StreamEvent> {
        turn += 1
        if (turn === 1) {
          yield { type: 'text_delta', text: "J'ouvre le formulaire" }
          yield { type: 'tool_use_start', toolUseId: 'call_1', toolName: 'openNewTransactionPage' }
          yield { type: 'tool_use_input_delta', inputJsonDelta: '{}' }
          yield { type: 'tool_use_end' }
          yield { type: 'message_stop' }
          return
        }
        yield { type: 'text_delta', text: "J'ai ouvert le formulaire" }
        yield { type: 'message_stop' }
      },
    }
    const agent = new ClickyAgent({ apiUrl: 'mock://', provider })
    agent.action({
      name: 'openNewTransactionPage',
      description: 'Open the new transaction page',
      schema: { type: 'object' },
      handler: () => ({ ok: true }),
    })
    agent.mount()
    await agent.ask('tu peux créer un reçu fiscal')
    const assistantMessages = agent.getMessages().filter((m) => m.role === 'assistant')
    expect(assistantMessages).toHaveLength(1)
    expect(assistantMessages[0]?.text).toContain("J'ouvre le formulaire")
    expect(assistantMessages[0]?.text).toContain("J'ai ouvert le formulaire")
    agent.unmount()
  })

  it('drives the speech bubble with the assistant text when a reply arrives', async () => {
    const provider: ChatProvider = {
      async *streamChat(_request: ChatRequest): AsyncIterable<StreamEvent> {
        yield { type: 'text_delta', text: 'Salut ' }
        yield { type: 'text_delta', text: 'Romain' }
        yield { type: 'message_stop' }
      },
    }
    const agent = new ClickyAgent({ apiUrl: 'mock://', provider })
    const showSpy = vi.fn()
    const updateSpy = vi.fn()
    // Swap the bubble's public surface with spies.
    ;(agent as unknown as { speechBubble: { show: unknown; update: unknown; mount: () => void; unmount: () => void } }).speechBubble = {
      show: showSpy,
      update: updateSpy,
      mount: () => {},
      unmount: () => {},
    }
    agent.mount()
    await agent.ask('bonjour')
    expect(updateSpy).toHaveBeenCalled()
    const lastCall = updateSpy.mock.calls[updateSpy.mock.calls.length - 1]
    expect(String(lastCall?.[0] ?? '')).toContain('Salut Romain')
    expect(showSpy).toHaveBeenCalled()
    agent.unmount()
  })

  it('registers and exposes custom actions to the registry', () => {
    const agent = new ClickyAgent({ apiUrl: 'mock://', provider: new MockProvider() })
    agent.action({
      name: 'customNoop',
      description: 'noop',
      schema: { type: 'object' },
      handler: () => 'done',
    })
    expect(agent.actions.has('customNoop')).toBe(true)
    expect(agent.actions.has('highlight')).toBe(true)
  })
})
