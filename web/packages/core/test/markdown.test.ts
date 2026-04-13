import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../src/markdown'

describe('renderMarkdown', () => {
  it('escapes HTML by default', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).not.toContain('<script>')
  })

  it('renders bold and italic', () => {
    const out = renderMarkdown('This is **bold** and *italic*.')
    expect(out).toContain('<strong>bold</strong>')
    expect(out).toContain('<em>italic</em>')
  })

  it('renders unordered lists', () => {
    const out = renderMarkdown('- one\n- two')
    expect(out).toContain('<ul>')
    expect(out).toContain('<li>one</li>')
    expect(out).toContain('<li>two</li>')
  })

  it('renders fenced code blocks', () => {
    const out = renderMarkdown('```js\nconst x = 1\n```')
    expect(out).toContain('<pre><code class="lang-js">')
    expect(out).toContain('const x = 1')
  })

  it('renders safe links', () => {
    const out = renderMarkdown('See [docs](https://example.com).')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('rel="noopener noreferrer"')
  })

  it('rejects javascript: URLs', () => {
    const out = renderMarkdown('[x](javascript:alert(1))')
    expect(out).not.toContain('javascript:')
  })
})
