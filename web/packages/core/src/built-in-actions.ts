/**
 * Built-in actions exposed to the agent on every page. They cover the
 * core "guide me through this UI" surface: highlight, click, fill,
 * navigate, read, done.
 */

import type { ActionDefinition, ClickyConfig } from './types'
import type { DomReader } from './dom-reader'
import type { HighlightOverlay } from './highlight-overlay'

export interface BuiltInDeps {
  dom: DomReader
  overlay: HighlightOverlay
  config: ClickyConfig
  onAssistantText: (text: string) => void
}

export const createBuiltInActions = (deps: BuiltInDeps): ActionDefinition[] => {
  const { dom, overlay, config, onAssistantText } = deps

  const resolveTarget = (target: string): Element => {
    const element = dom.resolveElement(target)
    if (!element) throw new Error(`element not found for "${target}"`)
    return element
  }

  return [
    {
      name: 'highlight',
      description:
        'Visually highlight an element on the page so the user can see what you are referring to. The target is a CSS selector or a short semantic description like "checkout button".',
      schema: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'CSS selector or semantic description of the element.' },
          message: { type: 'string', description: 'Optional short label rendered next to the highlight.' },
        },
        required: ['target'],
      },
      handler: async (input) => {
        const { target, message } = input as { target: string; message?: string }
        const element = resolveTarget(target)
        overlay.spotlight(element, { message })
        return { ok: true }
      },
    },
    {
      name: 'click',
      description: 'Click an element on behalf of the user. Use only when the user explicitly asks you to.',
      schema: {
        type: 'object',
        properties: { target: { type: 'string' } },
        required: ['target'],
      },
      handler: async (input) => {
        const { target } = input as { target: string }
        const element = resolveTarget(target) as HTMLElement
        element.click()
        return { ok: true }
      },
    },
    {
      name: 'fill',
      description: 'Fill a text input or textarea with a value. Dispatches a real input event so frameworks update.',
      schema: {
        type: 'object',
        properties: {
          target: { type: 'string' },
          value: { type: 'string' },
        },
        required: ['target', 'value'],
      },
      handler: async (input) => {
        const { target, value } = input as { target: string; value: string }
        const element = resolveTarget(target) as HTMLInputElement | HTMLTextAreaElement
        const setter = Object.getOwnPropertyDescriptor(
          element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
          'value',
        )?.set
        if (setter) setter.call(element, value)
        else element.value = value
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
        return { ok: true }
      },
    },
    {
      name: 'navigate',
      description: 'Navigate to a different URL within the application. Uses the navigate callback if provided, falls back to location assignment.',
      schema: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url'],
      },
      handler: async (input) => {
        const { url } = input as { url: string }
        if (config.navigate) config.navigate(url)
        else if (typeof location !== 'undefined') location.assign(url)
        return { ok: true }
      },
    },
    {
      name: 'read',
      description: 'Read the visible text content of an element. Useful when the agent needs to verify a value before answering.',
      schema: {
        type: 'object',
        properties: { target: { type: 'string' } },
        required: ['target'],
      },
      handler: async (input) => {
        const { target } = input as { target: string }
        const element = resolveTarget(target)
        return { text: (element.textContent ?? '').trim().slice(0, 500) }
      },
    },
    {
      name: 'done',
      description: 'Signal that the task is complete and deliver a final natural-language message to the user.',
      schema: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
      },
      handler: async (input) => {
        const { message } = input as { message: string }
        onAssistantText(message)
        return { ok: true }
      },
    },
  ]
}
