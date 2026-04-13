import { describe, it, expect } from 'vitest'
import { InlinePointParser } from '../src/inline-point-parser'

describe('InlinePointParser', () => {
  it('passes through plain text unchanged', () => {
    const parser = new InlinePointParser()
    const { visibleText, points } = parser.push('Hello there')
    expect(visibleText).toBe('Hello there')
    expect(points).toHaveLength(0)
  })

  it('extracts a single tag surrounded by text', () => {
    const parser = new InlinePointParser()
    const { visibleText, points } = parser.push('Click [POINT:#save:Save button] now.')
    expect(visibleText).toBe('Click  now.')
    expect(points).toEqual([{ selector: '#save', label: 'Save button' }])
  })

  it('reassembles a tag split across two deltas', () => {
    const parser = new InlinePointParser()
    const first = parser.push('Click [POINT:#s')
    expect(first.visibleText).toBe('Click ')
    expect(first.points).toHaveLength(0)
    const second = parser.push('ave:Save]!')
    expect(second.visibleText).toBe('!')
    expect(second.points).toEqual([{ selector: '#save', label: 'Save' }])
  })

  it('extracts multiple tags in one push', () => {
    const parser = new InlinePointParser()
    const { visibleText, points } = parser.push('a[POINT:.x:X]b[POINT:.y:Y]c')
    expect(visibleText).toBe('abc')
    expect(points).toEqual([
      { selector: '.x', label: 'X' },
      { selector: '.y', label: 'Y' },
    ])
  })

  it('flush releases an unterminated tag as plain text', () => {
    const parser = new InlinePointParser()
    parser.push('start [POINT:#x:no closing')
    const tail = parser.flush()
    expect(tail).toContain('[POINT:')
  })

  it('drops malformed tags with no label', () => {
    const parser = new InlinePointParser()
    const { visibleText, points } = parser.push('x[POINT:nolabel]y')
    expect(visibleText).toBe('xy')
    expect(points).toHaveLength(0)
  })
})
