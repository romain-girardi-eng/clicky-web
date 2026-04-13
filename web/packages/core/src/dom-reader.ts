/**
 * DOMReader extracts a compact, semantically meaningful summary of the
 * current page so the agent can reason about it without ingesting the
 * full HTML tree. The snapshot is intentionally text-only and bounded.
 */

export interface DomSnapshot {
  url: string
  title: string
  headings: Array<{ level: number; text: string }>
  landmarks: string[]
  forms: Array<{
    name?: string
    fields: Array<{ label: string; type: string; value?: string }>
  }>
  buttons: Array<{ label: string; selectorHint: string }>
  links: Array<{ label: string; href: string }>
  truncated: boolean
}

const MAX_BUTTONS = 40
const MAX_LINKS = 30
const MAX_HEADINGS = 25
const MAX_FORMS = 8

const visible = (element: Element): boolean => {
  const view = element.ownerDocument?.defaultView
  if (!view) return true
  const style = view.getComputedStyle(element as HTMLElement)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  // jsdom returns zero-sized rects for everything, so we cannot rely on
  // dimensions in tests. In real browsers display:none / visibility:hidden
  // already covers the common "not on screen" cases.
  return true
}

const accessibleLabel = (element: Element): string => {
  const ariaLabel = element.getAttribute('aria-label')
  if (ariaLabel) return ariaLabel.trim()
  const ariaLabelledBy = element.getAttribute('aria-labelledby')
  if (ariaLabelledBy) {
    const labelEl = element.ownerDocument?.getElementById(ariaLabelledBy)
    if (labelEl?.textContent) return labelEl.textContent.trim()
  }
  const text = element.textContent?.trim() ?? ''
  if (text) return text.replace(/\s+/g, ' ').slice(0, 120)
  const title = element.getAttribute('title')
  if (title) return title.trim()
  return ''
}

const selectorHintFor = (element: Element): string => {
  const id = element.getAttribute('id')
  if (id) return `#${id}`
  const testId = element.getAttribute('data-testid')
  if (testId) return `[data-testid="${testId}"]`
  const ariaLabel = element.getAttribute('aria-label')
  if (ariaLabel) return `[aria-label="${ariaLabel}"]`
  const name = element.getAttribute('name')
  if (name) return `[name="${name}"]`
  return element.tagName.toLowerCase()
}

const inputLabel = (input: HTMLElement): string => {
  const id = input.getAttribute('id')
  if (id) {
    const label = input.ownerDocument?.querySelector(`label[for="${id}"]`)
    if (label?.textContent) return label.textContent.trim()
  }
  const closestLabel = input.closest('label')
  if (closestLabel?.textContent) return closestLabel.textContent.trim()
  return accessibleLabel(input) || input.getAttribute('placeholder') || input.getAttribute('name') || ''
}

export class DomReader {
  private cached: DomSnapshot | null = null
  private observer: MutationObserver | null = null

  constructor(private readonly root: Document = typeof document !== 'undefined' ? document : (null as unknown as Document)) {}

  start(): void {
    if (typeof MutationObserver === 'undefined' || !this.root) return
    this.observer = new MutationObserver(() => {
      this.cached = null
    })
    this.observer.observe(this.root.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label', 'id', 'data-testid', 'href'],
    })
  }

  stop(): void {
    this.observer?.disconnect()
    this.observer = null
  }

  invalidate(): void {
    this.cached = null
  }

  snapshot(): DomSnapshot {
    if (this.cached) return this.cached
    const snapshot = this.build()
    this.cached = snapshot
    return snapshot
  }

  private build(): DomSnapshot {
    const doc = this.root
    const headings: DomSnapshot['headings'] = []
    const headingNodes = Array.from(doc.querySelectorAll('h1, h2, h3'))
    for (const node of headingNodes.slice(0, MAX_HEADINGS)) {
      if (!visible(node)) continue
      headings.push({ level: Number(node.tagName[1]), text: node.textContent?.trim().slice(0, 160) ?? '' })
    }

    const landmarks: string[] = []
    const landmarkSelectors: Array<[string, string]> = [
      ['banner', 'header'],
      ['navigation', 'nav'],
      ['main', 'main'],
      ['complementary', 'aside'],
      ['contentinfo', 'footer'],
      ['search', '[role="search"]'],
    ]
    for (const [role, fallback] of landmarkSelectors) {
      const node = doc.querySelector(`[role="${role}"]`) ?? doc.querySelector(fallback)
      if (node) landmarks.push(role)
    }

    const buttons: DomSnapshot['buttons'] = []
    const buttonNodes = Array.from(
      doc.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'),
    )
    for (const node of buttonNodes) {
      if (!visible(node)) continue
      const label = accessibleLabel(node)
      if (!label) continue
      buttons.push({ label, selectorHint: selectorHintFor(node) })
      if (buttons.length >= MAX_BUTTONS) break
    }

    const links: DomSnapshot['links'] = []
    const linkNodes = Array.from(doc.querySelectorAll('a[href]'))
    for (const node of linkNodes) {
      if (!visible(node)) continue
      const label = accessibleLabel(node)
      const href = (node as HTMLAnchorElement).getAttribute('href') ?? ''
      if (!label || !href) continue
      links.push({ label, href })
      if (links.length >= MAX_LINKS) break
    }

    const forms: DomSnapshot['forms'] = []
    const formNodes = Array.from(doc.querySelectorAll('form'))
    for (const formNode of formNodes.slice(0, MAX_FORMS)) {
      if (!visible(formNode)) continue
      const fields: DomSnapshot['forms'][number]['fields'] = []
      for (const fieldNode of Array.from(formNode.querySelectorAll('input, select, textarea'))) {
        const type = fieldNode.getAttribute('type') ?? fieldNode.tagName.toLowerCase()
        if (type === 'hidden') continue
        const label = inputLabel(fieldNode as HTMLElement)
        fields.push({ label, type, value: (fieldNode as HTMLInputElement).value || undefined })
      }
      forms.push({ name: formNode.getAttribute('name') ?? undefined, fields })
    }

    const truncated =
      buttonNodes.length > MAX_BUTTONS || linkNodes.length > MAX_LINKS || headingNodes.length > MAX_HEADINGS

    return {
      url: typeof location !== 'undefined' ? location.pathname + location.search : '',
      title: doc.title,
      headings,
      landmarks,
      forms,
      buttons,
      links,
      truncated,
    }
  }

  /**
   * Best-effort mapping of a free-text "semantic description" to a real
   * DOM element. Tried in priority order: data-testid, id, aria-label,
   * exact text, fuzzy text contains.
   */
  resolveElement(query: string): Element | null {
    const doc = this.root
    if (!doc) return null
    const normalized = query.trim()
    if (!normalized) return null

    const direct =
      doc.querySelector(`[data-testid="${cssEscape(normalized)}"]`) ??
      doc.querySelector(`#${cssEscape(normalized)}`) ??
      doc.querySelector(`[aria-label="${cssEscape(normalized)}"]`) ??
      doc.querySelector(`[name="${cssEscape(normalized)}"]`)
    if (direct) return direct

    if (normalized.startsWith('.') || normalized.startsWith('#') || normalized.startsWith('[')) {
      try {
        const el = doc.querySelector(normalized)
        if (el) return el
      } catch {
        // ignore invalid selectors
      }
    }

    const lower = normalized.toLowerCase()
    const candidates = Array.from(
      doc.querySelectorAll('button, a, [role="button"], input, select, textarea, h1, h2, h3, label'),
    )
    let best: { element: Element; score: number } | null = null
    for (const candidate of candidates) {
      if (!visible(candidate)) continue
      const label = (accessibleLabel(candidate) || '').toLowerCase()
      if (!label) continue
      const score = label === lower ? 1000 : label.includes(lower) ? 500 - Math.abs(label.length - lower.length) : 0
      if (score > 0 && (!best || score > best.score)) {
        best = { element: candidate, score }
      }
    }
    return best?.element ?? null
  }
}

const cssEscape = (value: string): string => {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/["\\]/g, '\\$&')
}
