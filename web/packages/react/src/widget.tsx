'use client'

import { useEffect, useRef } from 'react'
import { Widget } from '@clicky/core'
import { useClicky } from './hooks'

export interface ClickyWidgetProps {
  locale?: 'en' | 'fr'
  primary?: string
}

export const ClickyWidget = ({ locale, primary }: ClickyWidgetProps): JSX.Element => {
  const agent = useClicky()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widgetRef = useRef<Widget | null>(null)

  useEffect(() => {
    if (!containerRef.current) return undefined
    const widget = new Widget(agent, { locale, theme: primary ? { primary } : undefined })
    widget.mount(containerRef.current)
    widgetRef.current = widget
    return () => {
      widget.unmount()
      widgetRef.current = null
    }
  }, [agent, locale, primary])

  return <div ref={containerRef} data-clicky-widget-mount />
}
