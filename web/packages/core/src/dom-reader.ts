/**
 * DOMReader extracts a compact, semantically meaningful summary of the
 * current page so the agent can reason about it without ingesting the
 * full HTML tree. The snapshot is intentionally text-only and bounded.
 *
 * Pointing precision: every interactive element picked up in a snapshot
 * receives a stable `data-clicky-id` attribute (c-1, c-2, ...). These IDs
 * are included in the snapshot the agent sees, and the LLM is instructed
 * to point via `#c-N`. The resolver honours these IDs first, which makes
 * cursor pointing actually hit the intended DOM element instead of
 * relying on the LLM to invent correct selectors.
 */

export interface ClickableEntry {
  id: string // e.g. "c-3"
  role: 'button' | 'link' | 'input' | 'select' | 'textarea' | 'menuitem' | 'tab' | 'other'
  label: string
  position?: 'top' | 'header' | 'nav' | 'main' | 'footer'
}

export interface DomSnapshot {
  url: string
  title: string
  headings: Array<{ level: number; text: string }>
  landmarks: string[]
  forms: Array<{
    name?: string
    fields: Array<{ label: string; type: string; value?: string; id?: string }>
  }>
  buttons: Array<{ label: string; selectorHint: string; id?: string }>
  links: Array<{ label: string; href: string; id?: string }>
  clickables: ClickableEntry[]
  truncated: boolean
}

const MAX_BUTTONS = 40
const MAX_LINKS = 30
const MAX_HEADINGS = 25
const MAX_FORMS = 8
const MAX_CLICKABLES = 80

const CLICKY_ID_ATTR = 'data-clicky-id'

const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[data-clicky-target]',
].join(',')

const visible = (element: Element): boolean => {
  const view = element.ownerDocument?.defaultView
  if (!view) return true
  const style = view.getComputedStyle(element as HTMLElement)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  if (style.opacity === '0') return false
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
  const placeholder = element.getAttribute('placeholder')
  if (placeholder) return placeholder.trim()
  return ''
}

const selectorHintFor = (element: Element): string => {
  const clickyId = element.getAttribute(CLICKY_ID_ATTR)
  if (clickyId) return `#${clickyId}`
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

const roleFor = (el: Element): ClickableEntry['role'] => {
  const explicit = el.getAttribute('role')
  if (explicit === 'button' || explicit === 'link' || explicit === 'menuitem' || explicit === 'tab') return explicit
  const tag = el.tagName.toLowerCase()
  if (tag === 'button') return 'button'
  if (tag === 'a') return 'link'
  if (tag === 'input') return 'input'
  if (tag === 'select') return 'select'
  if (tag === 'textarea') return 'textarea'
  return 'other'
}

const positionFor = (el: Element): ClickableEntry['position'] | undefined => {
  if (el.closest('header')) return 'header'
  if (el.closest('nav')) return 'nav'
  if (el.closest('footer')) return 'footer'
  if (el.closest('main')) return 'main'
  return undefined
}

export class DomReader {
  private cached: DomSnapshot | null = null
  private observer: MutationObserver | null = null
  private nextIdNumber = 1
  private readonly clickyIds = new WeakMap<Element, string>()

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

  /**
   * Render the snapshot as a compact text block optimised for LLM
   * consumption. Emits stable `[c-N]` IDs that the model can echo back
   * as `#c-N` selectors in its tool calls.
   */
  snapshotAsText(snapshot?: DomSnapshot): string {
    const snap = snapshot ?? this.snapshot()
    const lines: string[] = []
    lines.push(`CURRENT PAGE: ${snap.url}`)
    if (snap.title) lines.push(`TITLE: ${snap.title}`)
    if (snap.headings.length) {
      lines.push('HEADINGS:')
      for (const h of snap.headings.slice(0, 8)) {
        lines.push(`  H${h.level} ${h.text}`)
      }
    }
    if (snap.clickables.length) {
      lines.push('INTERACTIVE ELEMENTS VISIBLE:')
      for (const c of snap.clickables) {
        const pos = c.position ? ` (${c.position})` : ''
        lines.push(`  [${c.id}] ${c.role} "${c.label.replace(/"/g, "'").slice(0, 80)}"${pos}`)
      }
    }
    if (snap.forms.length) {
      lines.push('FORMS:')
      for (const form of snap.forms) {
        lines.push(`  form ${form.name ?? '(anonymous)'}`)
        for (const f of form.fields) {
          const idPart = f.id ? `[${f.id}] ` : ''
          lines.push(`    ${idPart}${f.type} "${f.label.replace(/"/g, "'").slice(0, 60)}"${f.value ? ` = "${String(f.value).slice(0, 40)}"` : ''}`)
        }
      }
    }
    if (snap.landmarks.length) lines.push(`LANDMARKS: ${snap.landmarks.join(', ')}`)
    if (snap.truncated) lines.push('(truncated: more elements exist than listed)')
    return lines.join('\n')
  }

  private assignClickyId(el: Element): string {
    const existing = this.clickyIds.get(el)
    if (existing) {
      if (el.getAttribute(CLICKY_ID_ATTR) !== existing) el.setAttribute(CLICKY_ID_ATTR, existing)
      return existing
    }
    const already = el.getAttribute(CLICKY_ID_ATTR)
    if (already && /^c-\d+$/.test(already)) {
      this.clickyIds.set(el, already)
      return already
    }
    const id = `c-${this.nextIdNumber++}`
    this.clickyIds.set(el, id)
    el.setAttribute(CLICKY_ID_ATTR, id)
    return id
  }

  private build(): DomSnapshot {
    const doc = this.root
    // Reset ID counter each snapshot so numbering follows the current DOM
    // order instead of drifting monotonically after navigations.
    this.nextIdNumber = 1
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

    // Collect every interactive element once, in DOM order, and assign IDs.
    const clickables: ClickableEntry[] = []
    const buttons: DomSnapshot['buttons'] = []
    const links: DomSnapshot['links'] = []
    const interactive = Array.from(doc.querySelectorAll(INTERACTIVE_SELECTOR))
    const seen = new Set<Element>()
    for (const node of interactive) {
      if (seen.has(node)) continue
      seen.add(node)
      if (!visible(node)) continue
      const label = accessibleLabel(node)
      if (!label && node.tagName !== 'INPUT' && node.tagName !== 'SELECT' && node.tagName !== 'TEXTAREA') continue
      const id = this.assignClickyId(node)
      const role = roleFor(node)
      const position = positionFor(node)
      if (clickables.length < MAX_CLICKABLES) {
        clickables.push({ id, role, label: label || `(${role})`, position })
      }
      if (role === 'button' && buttons.length < MAX_BUTTONS && label) {
        buttons.push({ label, selectorHint: selectorHintFor(node), id })
      }
      if (role === 'link' && links.length < MAX_LINKS && label) {
        const href = (node as HTMLAnchorElement).getAttribute('href') ?? ''
        if (href) links.push({ label, href, id })
      }
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
        const id = this.assignClickyId(fieldNode)
        fields.push({ label, type, value: (fieldNode as HTMLInputElement).value || undefined, id })
      }
      forms.push({ name: formNode.getAttribute('name') ?? undefined, fields })
    }

    const truncated =
      interactive.length > MAX_CLICKABLES || headingNodes.length > MAX_HEADINGS

    return {
      url: typeof location !== 'undefined' ? location.pathname + location.search : '',
      title: doc.title,
      headings,
      landmarks,
      forms,
      buttons,
      links,
      clickables,
      truncated,
    }
  }

  /**
   * Best-effort mapping of a free-text "semantic description" to a real
   * DOM element. Tried in priority order:
   *   1) stable `#c-N` / `c-N` id we injected in the last snapshot
   *   2) valid CSS selector
   *   3) data-testid / id / aria-label / name exact match
   *   4) fuzzy text contains on visible interactive elements
   */
  resolveElement(query: string): Element | null {
    const doc = this.root
    if (!doc) return null
    const normalized = query.trim()
    if (!normalized) return null

    // 1) stable clicky id — the happy path.
    const clickyIdMatch = normalized.match(/^#?(c-\d+)$/)
    if (clickyIdMatch) {
      const el = doc.querySelector(`[${CLICKY_ID_ATTR}="${clickyIdMatch[1]}"]`)
      if (el) return el
    }

    // 2) CSS selector (explicit)
    if (normalized.startsWith('.') || normalized.startsWith('#') || normalized.startsWith('[')) {
      try {
        const el = doc.querySelector(normalized)
        if (el) return el
      } catch {
        // ignore invalid selectors
      }
    }

    // 2b) bare tag-ish selector that still parses (e.g. "button[aria-label='x']")
    if (/[[\]='"]/.test(normalized)) {
      try {
        const el = doc.querySelector(normalized)
        if (el) return el
      } catch {
        // ignore
      }
    }

    // 3) direct attribute lookups
    const direct =
      doc.querySelector(`[data-testid="${cssEscape(normalized)}"]`) ??
      (isIdentifier(normalized) ? doc.querySelector(`#${cssEscape(normalized)}`) : null) ??
      doc.querySelector(`[aria-label="${cssEscape(normalized)}"]`) ??
      doc.querySelector(`[name="${cssEscape(normalized)}"]`)
    if (direct) return direct

    // 4) fuzzy label match on visible interactive elements
    const lower = normalized.toLowerCase()
    const candidates = Array.from(
      doc.querySelectorAll('button, a, [role="button"], [role="link"], [role="menuitem"], [role="tab"], input, select, textarea, h1, h2, h3, label'),
    )
    let best: { element: Element; score: number } | null = null
    for (const candidate of candidates) {
      if (!visible(candidate)) continue
      const label = (accessibleLabel(candidate) || '').toLowerCase()
      if (!label) continue
      let score = 0
      if (label === lower) score = 1000
      else if (label.includes(lower)) score = 500 - Math.abs(label.length - lower.length)
      else if (lower.includes(label) && label.length >= 4) score = 300 - Math.abs(label.length - lower.length)
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

const isIdentifier = (value: string): boolean => /^[A-Za-z_][\w-]*$/.test(value)
