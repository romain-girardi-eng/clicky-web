'use client'

import { useEffect, useMemo, type ReactNode } from 'react'
import { ClickyAgent, type ClickyConfig } from '@clicky/core'
import { ClickyContext } from './context'

export interface ClickyProviderProps extends ClickyConfig {
  children: ReactNode
  /**
   * When true (default) the agent's DOM observer + overlay are mounted on the
   * document body when the provider mounts. Disable if you want to control
   * mount lifecycle manually.
   */
  autoMount?: boolean
}

export const ClickyProvider = ({ children, autoMount = true, ...config }: ClickyProviderProps): JSX.Element => {
  const agent = useMemo(() => new ClickyAgent(config), [
    // We deliberately only re-create the agent when the proxy URL or model
    // changes. Mutating the system prompt mid-session would discard history.
    config.apiUrl,
    config.model,
  ])

  useEffect(() => {
    if (!autoMount) return undefined
    agent.mount()
    return () => {
      agent.unmount()
    }
  }, [agent, autoMount])

  return <ClickyContext.Provider value={{ agent }}>{children}</ClickyContext.Provider>
}
