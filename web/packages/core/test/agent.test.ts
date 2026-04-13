import { describe, it, expect, beforeEach } from 'vitest'
import { ClickyAgent } from '../src/agent'
import { MockProvider } from '../src/llm-client'

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
