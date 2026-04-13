/**
 * ActionRegistry holds tool definitions exposed to the LLM and validates
 * input payloads against the JSON Schema declared by each action. It is
 * deliberately framework-agnostic — handlers receive parsed input and
 * return a serialisable result that becomes the tool_result content.
 */

import type { ActionDefinition, JsonSchema, ToolDefinition } from './types'

export class ActionRegistry {
  private readonly actions = new Map<string, ActionDefinition>()

  register(action: ActionDefinition): void {
    if (!action.name || typeof action.name !== 'string') {
      throw new Error('action.name is required')
    }
    if (this.actions.has(action.name)) {
      throw new Error(`action "${action.name}" already registered`)
    }
    this.actions.set(action.name, action as ActionDefinition)
  }

  unregister(name: string): void {
    this.actions.delete(name)
  }

  has(name: string): boolean {
    return this.actions.has(name)
  }

  get(name: string): ActionDefinition | undefined {
    return this.actions.get(name)
  }

  list(): ActionDefinition[] {
    return Array.from(this.actions.values())
  }

  toToolDefinitions(): ToolDefinition[] {
    return this.list().map((action) => ({
      name: action.name,
      description: action.description,
      input_schema: action.schema,
    }))
  }

  async invoke(name: string, input: Record<string, unknown>): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
    const action = this.actions.get(name)
    if (!action) return { ok: false, error: `unknown action: ${name}` }
    const validation = validateAgainstSchema(input, action.schema)
    if (!validation.valid) return { ok: false, error: validation.errors.join('; ') }
    try {
      const result = await action.handler(input)
      return { ok: true, result }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}

interface ValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Minimal JSON Schema validator: enough for tool inputs (object/string/
 * number/boolean/array, required, enum). Avoids pulling a heavy dep.
 */
export const validateAgainstSchema = (value: unknown, schema: JsonSchema): ValidationResult => {
  const errors: string[] = []
  validate(value, schema, '$', errors)
  return { valid: errors.length === 0, errors }
}

const validate = (value: unknown, schema: JsonSchema, path: string, errors: string[]): void => {
  if (!schema || typeof schema !== 'object') return
  const expectedType = schema.type
  if (expectedType === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      errors.push(`${path}: expected object`)
      return
    }
    const obj = value as Record<string, unknown>
    for (const key of schema.required ?? []) {
      if (!(key in obj)) errors.push(`${path}.${key}: required`)
    }
    for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
      if (key in obj) validate(obj[key], propSchema, `${path}.${key}`, errors)
    }
    return
  }
  if (expectedType === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected array`)
      return
    }
    if (schema.items) {
      value.forEach((item, idx) => validate(item, schema.items as JsonSchema, `${path}[${idx}]`, errors))
    }
    return
  }
  if (expectedType === 'string' && typeof value !== 'string') {
    errors.push(`${path}: expected string`)
    return
  }
  if (expectedType === 'number' && typeof value !== 'number') {
    errors.push(`${path}: expected number`)
    return
  }
  if (expectedType === 'boolean' && typeof value !== 'boolean') {
    errors.push(`${path}: expected boolean`)
    return
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path}: must be one of ${schema.enum.join(', ')}`)
  }
}
