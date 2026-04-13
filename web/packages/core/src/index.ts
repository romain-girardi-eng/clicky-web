/**
 * @clicky/core public entrypoint.
 */

import { ClickyAgent } from './agent'
import { Widget } from './widget'
import type { ClickyConfig } from './types'

export { ClickyAgent } from './agent'
export { Widget } from './widget'
export { DomReader } from './dom-reader'
export { HighlightOverlay } from './highlight-overlay'
export { ActionRegistry, validateAgainstSchema } from './action-registry'
export { AnthropicProvider, MockProvider } from './llm-client'
export { VoiceIO } from './voice-io'
export { createBuiltInActions } from './built-in-actions'
export type {
  ActionDefinition,
  AgentMessage,
  AgentState,
  ChatMessage,
  ChatProvider,
  ChatRequest,
  ClickyConfig,
  ClickyTheme,
  ClickyVoiceConfig,
  JsonSchema,
  ReadableGetter,
  StreamEvent,
  ToolDefinition,
} from './types'

export interface ClickyInstance {
  agent: ClickyAgent
  widget: Widget
  mount: (target?: Element) => void
  unmount: () => void
  ask: (text: string) => Promise<void>
  readable: ClickyAgent['readable']
  action: ClickyAgent['action']
  subscribe: ClickyAgent['subscribe']
}

export const createClicky = (config: ClickyConfig): ClickyInstance => {
  const agent = new ClickyAgent(config)
  const widget = new Widget(agent, { theme: config.theme, locale: config.locale })
  return {
    agent,
    widget,
    mount: (target?: Element) => {
      agent.mount(target)
      widget.mount(target ?? document.body)
    },
    unmount: () => {
      widget.unmount()
      agent.unmount()
    },
    ask: (text: string) => agent.ask(text),
    readable: agent.readable.bind(agent),
    action: agent.action.bind(agent),
    subscribe: agent.subscribe.bind(agent),
  }
}
