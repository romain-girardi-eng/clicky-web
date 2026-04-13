import { describe, it, expect } from 'vitest'
import { render, renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MockProvider } from '@clicky/core'
import { ClickyProvider } from '../src/provider'
import { useClicky, useClickyReadable, useClickyAction, useClickyState } from '../src/hooks'

const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
  <ClickyProvider apiUrl="mock://" provider={new MockProvider()} autoMount={false}>
    {children}
  </ClickyProvider>
)

describe('ClickyProvider + hooks', () => {
  it('renders children and exposes the agent via useClicky', () => {
    const { result } = renderHook(() => useClicky(), { wrapper })
    expect(result.current).toBeDefined()
    expect(typeof result.current.ask).toBe('function')
  })

  it('throws when useClicky is used outside the provider', () => {
    expect(() => renderHook(() => useClicky())).toThrow(/ClickyProvider/)
  })

  it('registers a readable that the agent can read back', () => {
    const { result } = renderHook(
      () => {
        useClickyReadable('cartTotal', 42)
        return useClicky()
      },
      { wrapper },
    )
    expect(result.current).toBeDefined()
  })

  it('registers an action and unregisters on unmount', () => {
    const { result, unmount } = renderHook(
      () => {
        useClickyAction({
          name: 'reactCustom',
          description: 'react custom action',
          schema: { type: 'object' },
          handler: () => 'ok',
        })
        return useClicky()
      },
      { wrapper },
    )
    expect(result.current.actions.has('reactCustom')).toBe(true)
    unmount()
  })

  it('useClickyState reflects ask() updates', async () => {
    const { result } = renderHook(
      () => ({
        agent: useClicky(),
        snapshot: useClickyState(),
      }),
      { wrapper },
    )
    expect(result.current.snapshot.messages).toHaveLength(0)
    await act(async () => {
      await result.current.agent.ask('Hi')
    })
    expect(result.current.snapshot.messages.length).toBeGreaterThan(0)
  })

  it('mounts and unmounts cleanly', () => {
    const { unmount } = render(
      <ClickyProvider apiUrl="mock://" provider={new MockProvider()} autoMount={false}>
        <div>hello</div>
      </ClickyProvider>,
    )
    unmount()
  })
})
