/**
 * Public type surface for @clicky/core.
 */

export type AgentState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'acting'

export type Role = 'user' | 'assistant' | 'system'

export interface JsonSchema {
  type?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: unknown[]
  description?: string
  [key: string]: unknown
}

export interface ActionDefinition<Input = Record<string, unknown>> {
  name: string
  description: string
  schema: JsonSchema
  handler: (input: Input) => Promise<unknown> | unknown
}

export interface ReadableGetter {
  (): unknown
}

export interface ChatMessage {
  role: Role
  content: string | ChatContentBlock[]
}

export type ChatContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

export interface ToolDefinition {
  name: string
  description: string
  input_schema: JsonSchema
}

export interface StreamEvent {
  type: 'text_delta' | 'tool_use_start' | 'tool_use_input_delta' | 'tool_use_end' | 'message_stop' | 'error'
  text?: string
  toolName?: string
  toolUseId?: string
  inputJsonDelta?: string
  error?: string
}

export interface ChatRequest {
  model: string
  system: string
  messages: ChatMessage[]
  tools: ToolDefinition[]
  maxTokens?: number
}

export interface ChatProvider {
  streamChat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<StreamEvent>
}

export interface ClickyTheme {
  primary?: string
  background?: string
  foreground?: string
  accent?: string
  radius?: string
}

export interface ClickyVoiceConfig {
  input?: boolean
  output?: boolean
}

export interface ClickyConfig {
  apiUrl: string
  model?: string
  systemPrompt?: string
  voice?: ClickyVoiceConfig
  theme?: ClickyTheme
  locale?: 'en' | 'fr'
  navigate?: (url: string) => void
  provider?: ChatProvider
  maxTokens?: number
}

export interface AgentMessage {
  id: string
  role: Role
  text: string
  createdAt: number
}
