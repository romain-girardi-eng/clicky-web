'use client'

import { useEffect, useRef } from 'react'
import { Widget } from '@clicky/core'
import type { ClickyHotkeyConfig, ClickyVoiceConfig } from '@clicky/core'
import { useClicky } from './hooks'

export interface ClickyWidgetProps {
  locale?: 'en' | 'fr'
  primary?: string
  voice?: ClickyVoiceConfig
  hotkey?: ClickyHotkeyConfig
  autoOpenOnMessage?: boolean
}

export const ClickyWidget = ({ locale, primary, voice, hotkey, autoOpenOnMessage = false }: ClickyWidgetProps): JSX.Element => {
  const agent = useClicky()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widgetRef = useRef<Widget | null>(null)

  useEffect(() => {
    if (!containerRef.current) return undefined
    const widget = new Widget(agent, {
      locale,
      theme: primary ? { primary } : undefined,
      voice: voice ? { input: voice.input, output: voice.output, lang: voice.lang } : undefined,
      hotkey,
      autoOpenOnMessage,
    })
    widget.mount(containerRef.current)
    widgetRef.current = widget
    return () => {
      widget.unmount()
      widgetRef.current = null
    }
  }, [agent, locale, primary, voice, hotkey, autoOpenOnMessage])

  return <div ref={containerRef} data-clicky-widget-mount />
}
