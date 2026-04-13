import { describe, it, expect, beforeEach } from 'vitest'
import { DomReader } from '../src/dom-reader'

const setupDom = (html: string): void => {
  document.body.innerHTML = html
}

describe('DomReader', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.title = 'Test Page'
  })

  it('extracts headings, buttons and links from a fixture', () => {
    setupDom(`
      <header><nav>nav</nav></header>
      <main>
        <h1>Welcome</h1>
        <h2>Section</h2>
        <button aria-label="Add to cart">Add</button>
        <a href="/checkout">Checkout</a>
      </main>
    `)
    const reader = new DomReader(document)
    const snap = reader.snapshot()
    expect(snap.headings).toContainEqual({ level: 1, text: 'Welcome' })
    expect(snap.headings).toContainEqual({ level: 2, text: 'Section' })
    expect(snap.buttons.find((b) => b.label === 'Add to cart')).toBeTruthy()
    expect(snap.links.find((l) => l.href === '/checkout')).toBeTruthy()
    expect(snap.landmarks).toContain('navigation')
    expect(snap.landmarks).toContain('main')
  })

  it('caches snapshots and invalidates on demand', () => {
    setupDom('<button>One</button>')
    const reader = new DomReader(document)
    const first = reader.snapshot()
    const second = reader.snapshot()
    expect(first).toBe(second)
    reader.invalidate()
    const third = reader.snapshot()
    expect(third).not.toBe(first)
  })

  it('extracts form fields with labels', () => {
    setupDom(`
      <form name="signup">
        <label for="email">Email</label>
        <input id="email" type="email" />
        <textarea name="bio"></textarea>
      </form>
    `)
    const reader = new DomReader(document)
    const snap = reader.snapshot()
    expect(snap.forms).toHaveLength(1)
    const form = snap.forms[0]
    expect(form?.name).toBe('signup')
    expect(form?.fields.some((f) => f.label === 'Email')).toBe(true)
    expect(form?.fields.some((f) => f.type === 'textarea')).toBe(true)
  })

  it('resolves elements by data-testid', () => {
    setupDom('<button data-testid="checkout-btn">Go</button>')
    const reader = new DomReader(document)
    const el = reader.resolveElement('checkout-btn')
    expect(el).toBeTruthy()
    expect((el as HTMLElement).textContent).toBe('Go')
  })

  it('resolves elements by aria-label exact match', () => {
    setupDom('<button aria-label="Save changes">x</button>')
    const reader = new DomReader(document)
    const el = reader.resolveElement('Save changes')
    expect(el).toBeTruthy()
  })

  it('resolves elements by fuzzy text content', () => {
    setupDom('<button>Add to my cart</button>')
    const reader = new DomReader(document)
    const el = reader.resolveElement('add to')
    expect(el).toBeTruthy()
    expect((el as HTMLElement).tagName).toBe('BUTTON')
  })

  it('returns null when nothing matches', () => {
    setupDom('<button>Hello</button>')
    const reader = new DomReader(document)
    expect(reader.resolveElement('nonexistent')).toBeNull()
  })
})
