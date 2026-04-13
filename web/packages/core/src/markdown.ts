/**
 * Tiny markdown renderer tailored for Clicky chat bubbles. This is not a
 * full CommonMark implementation — it supports exactly the subset we need:
 *
 *   - **bold**, *italic*
 *   - `inline code`
 *   - fenced code blocks ```lang\ncode\n```
 *   - unordered lists (`- `, `* `)
 *   - ordered lists (`1. `)
 *   - paragraphs
 *   - links [text](url)
 *
 * All output is HTML-escaped first, so untrusted LLM output cannot inject
 * script tags. The returned string is safe to drop into innerHTML.
 */

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const renderInline = (input: string): string => {
  // Links — escape text + url.
  let out = input.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, url: string) => {
    const safeUrl = /^(https?:|mailto:|\/)/i.test(url) ? url : '#'
    return `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`
  })
  // Inline code.
  out = out.replace(/`([^`]+)`/g, (_m, code: string) => `<code>${escapeHtml(code)}</code>`)
  // Bold (**x**) then italic (*x*). Order matters.
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  return out
}

export const renderMarkdown = (source: string): string => {
  const escaped = escapeHtml(source)
  const lines = escaped.split('\n')
  const out: string[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''

    // Fenced code block.
    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, '').trim()
      const codeLines: string[] = []
      i += 1
      while (i < lines.length && !/^```/.test(lines[i] ?? '')) {
        codeLines.push(lines[i] ?? '')
        i += 1
      }
      i += 1 // skip closing fence
      const langClass = lang ? ` class="lang-${escapeHtml(lang)}"` : ''
      out.push(`<pre><code${langClass}>${codeLines.join('\n')}</code></pre>`)
      continue
    }

    // Unordered list.
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*[-*]\s+/, ''))
        i += 1
      }
      out.push(`<ul>${items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>`)
      continue
    }

    // Ordered list.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*\d+\.\s+/, ''))
        i += 1
      }
      out.push(`<ol>${items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ol>`)
      continue
    }

    // Blank line.
    if (line.trim() === '') {
      i += 1
      continue
    }

    // Paragraph — collect contiguous non-blank, non-special lines.
    const paragraphLines: string[] = []
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() !== '' &&
      !/^```/.test(lines[i] ?? '') &&
      !/^\s*[-*]\s+/.test(lines[i] ?? '') &&
      !/^\s*\d+\.\s+/.test(lines[i] ?? '')
    ) {
      paragraphLines.push(lines[i] ?? '')
      i += 1
    }
    out.push(`<p>${renderInline(paragraphLines.join(' '))}</p>`)
  }

  return out.join('')
}
