'use client'

import type { ReactNode } from 'react'
import { ClickyProvider, ClickyWidget } from '@clicky/react'

export const ClickyShell = ({ children }: { children: ReactNode }) => (
  <ClickyProvider apiUrl="/api/clicky" model="claude-sonnet-4-5" locale="en">
    {children}
    <ClickyWidget />
  </ClickyProvider>
)
