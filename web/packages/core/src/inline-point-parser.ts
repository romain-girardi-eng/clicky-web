/**
 * InlinePointParser scans a streaming text buffer for `[POINT:selector:label]`
 * tags. The LLM emits these inline while talking to signal that the cursor
 * should fly to a given element. Because the text arrives as deltas (and
 * tags can be split across delta boundaries), this parser is stateful: it
 * holds a pending buffer of characters that might still be part of an
 * unfinished tag, and flushes complete tags as soon as it sees the closing
 * bracket.
 *
 * Tag grammar (permissive):
 *   [POINT:<selector>:<label>]
 * Where <selector> is anything up to the first colon (may contain spaces),
 * and <label> is anything up to the closing bracket.
 */

export interface PointTag {
  selector: string
  label: string
}

export interface InlinePointParserResult {
  /** Text that is safe to render now (all pending tags removed). */
  visibleText: string
  /** Tags that have been fully parsed in this call. */
  points: PointTag[]
}

const TAG_OPEN = '[POINT:'

export class InlinePointParser {
  private buffer = ''

  /**
   * Feed a new delta and receive (a) the portion of text ready to display
   * (with any completed tags stripped) and (b) any tags that closed during
   * this push.
   */
  push(delta: string): InlinePointParserResult {
    this.buffer += delta
    let visibleText = ''
    const points: PointTag[] = []

    while (this.buffer.length > 0) {
      const openIdx = this.buffer.indexOf(TAG_OPEN)
      if (openIdx === -1) {
        // No tag start in buffer. But it might be the *beginning* of
        // `[POINT:` across a split — hold back the last few chars just in case.
        const holdback = Math.min(this.buffer.length, TAG_OPEN.length - 1)
        const release = this.buffer.length - holdback
        if (release > 0) {
          visibleText += this.buffer.slice(0, release)
          this.buffer = this.buffer.slice(release)
        }
        // If the holdback does not even start with `[` we can release it all.
        if (!this.buffer.includes('[')) {
          visibleText += this.buffer
          this.buffer = ''
        }
        break
      }

      // Flush any text before the tag start.
      if (openIdx > 0) {
        visibleText += this.buffer.slice(0, openIdx)
        this.buffer = this.buffer.slice(openIdx)
      }

      // Now buffer begins with `[POINT:`. Find the closing bracket.
      const closeIdx = this.buffer.indexOf(']')
      if (closeIdx === -1) {
        // Incomplete tag — wait for more deltas.
        break
      }

      const inner = this.buffer.slice(TAG_OPEN.length, closeIdx)
      const firstColon = inner.indexOf(':')
      if (firstColon === -1) {
        // Malformed (no label). Drop the tag and continue.
        this.buffer = this.buffer.slice(closeIdx + 1)
        continue
      }
      const selector = inner.slice(0, firstColon).trim()
      const label = inner.slice(firstColon + 1).trim()
      if (selector) points.push({ selector, label })
      this.buffer = this.buffer.slice(closeIdx + 1)
    }

    return { visibleText, points }
  }

  /**
   * Flush whatever is still pending. Call this at message_stop — any
   * unterminated tag is released as plain text so the user still sees it.
   */
  flush(): string {
    const remaining = this.buffer
    this.buffer = ''
    return remaining
  }

  reset(): void {
    this.buffer = ''
  }
}
