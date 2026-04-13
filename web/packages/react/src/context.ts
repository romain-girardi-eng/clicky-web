'use client'

import { createContext } from 'react'
import type { ClickyAgent } from '@clicky/core'

export interface ClickyContextValue {
  agent: ClickyAgent
}

export const ClickyContext = createContext<ClickyContextValue | null>(null)
