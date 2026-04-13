'use client'

import { useContext, useEffect, useState } from 'react'
import type { ClickyAgent, ActionDefinition, AgentMessage, AgentState } from '@clicky/core'
import { ClickyContext } from './context'

export const useClicky = (): ClickyAgent => {
  const context = useContext(ClickyContext)
  if (!context) throw new Error('useClicky must be used within a <ClickyProvider>')
  return context.agent
}

export const useClickyReadable = (label: string, value: unknown): void => {
  const agent = useClicky()
  useEffect(() => {
    const off = agent.readable(label, () => value)
    return () => {
      off()
    }
    // We re-register on every value change because the closure captures it.
  }, [agent, label, value])
}

export const useClickyAction = (definition: ActionDefinition): void => {
  const agent = useClicky()
  useEffect(() => {
    const off = agent.action(definition)
    return () => {
      off()
    }
    // Definitions should be stable references — wrap handlers in useCallback
    // upstream if they close over rapidly changing state.
  }, [agent, definition])
}

export interface ClickyStateSnapshot {
  state: AgentState
  messages: AgentMessage[]
}

export const useClickyState = (): ClickyStateSnapshot => {
  const agent = useClicky()
  const [snapshot, setSnapshot] = useState<ClickyStateSnapshot>({
    state: agent.getState(),
    messages: agent.getMessages(),
  })
  useEffect(() => {
    return agent.subscribe(setSnapshot)
  }, [agent])
  return snapshot
}
