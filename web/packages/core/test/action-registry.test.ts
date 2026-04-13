import { describe, it, expect } from 'vitest'
import { ActionRegistry, validateAgainstSchema } from '../src/action-registry'

describe('ActionRegistry', () => {
  it('registers and lists actions', () => {
    const reg = new ActionRegistry()
    reg.register({
      name: 'noop',
      description: 'does nothing',
      schema: { type: 'object', properties: {} },
      handler: () => 'ok',
    })
    expect(reg.has('noop')).toBe(true)
    expect(reg.list()).toHaveLength(1)
    expect(reg.toToolDefinitions()[0]?.name).toBe('noop')
  })

  it('rejects duplicate registrations', () => {
    const reg = new ActionRegistry()
    reg.register({ name: 'a', description: 'a', schema: { type: 'object' }, handler: () => 1 })
    expect(() => reg.register({ name: 'a', description: 'a', schema: { type: 'object' }, handler: () => 1 })).toThrow()
  })

  it('validates inputs and rejects bad ones', async () => {
    const reg = new ActionRegistry()
    reg.register({
      name: 'greet',
      description: 'greet',
      schema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
      handler: ({ name }) => `hello ${name as string}`,
    })
    const bad = await reg.invoke('greet', {})
    expect(bad.ok).toBe(false)
    const good = await reg.invoke('greet', { name: 'Romain' })
    expect(good.ok).toBe(true)
    if (good.ok) expect(good.result).toBe('hello Romain')
  })

  it('catches handler errors', async () => {
    const reg = new ActionRegistry()
    reg.register({
      name: 'boom',
      description: 'boom',
      schema: { type: 'object' },
      handler: () => {
        throw new Error('exploded')
      },
    })
    const result = await reg.invoke('boom', {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('exploded')
  })

  it('returns error for unknown action', async () => {
    const reg = new ActionRegistry()
    const result = await reg.invoke('ghost', {})
    expect(result.ok).toBe(false)
  })
})

describe('validateAgainstSchema', () => {
  it('validates required fields', () => {
    const r = validateAgainstSchema({}, { type: 'object', required: ['x'] })
    expect(r.valid).toBe(false)
  })

  it('validates enums', () => {
    const r = validateAgainstSchema(
      { color: 'purple' },
      { type: 'object', properties: { color: { type: 'string', enum: ['red', 'blue'] } } },
    )
    expect(r.valid).toBe(false)
  })

  it('validates nested arrays', () => {
    const r = validateAgainstSchema(
      { tags: ['a', 1] },
      { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } } } },
    )
    expect(r.valid).toBe(false)
  })

  it('accepts well-formed payloads', () => {
    const r = validateAgainstSchema(
      { name: 'x', count: 3 },
      {
        type: 'object',
        properties: { name: { type: 'string' }, count: { type: 'number' } },
        required: ['name'],
      },
    )
    expect(r.valid).toBe(true)
  })
})
