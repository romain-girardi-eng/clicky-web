import { describe, it, expect, beforeEach, vi } from 'vitest'
import { VoiceInput } from '../src/voice-input'
import { VoiceOutput, SentenceBuffer } from '../src/voice-output'

describe('VoiceInput', () => {
  beforeEach(() => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
  })

  it('reports unsupported when no recognition constructor exists', () => {
    expect(VoiceInput.isSupported()).toBe(false)
    const vi1 = new VoiceInput()
    const onError = vi.fn()
    vi1.start({ onResult: () => {}, onError })
    expect(onError).toHaveBeenCalledWith('not-supported')
  })

  it('starts and delivers final + interim results', () => {
    const instances: unknown[] = []
    class FakeRecognition {
      continuous = false
      interimResults = false
      lang = ''
      onresult: ((e: unknown) => void) | null = null
      onerror: ((e: unknown) => void) | null = null
      onend: (() => void) | null = null
      onstart: (() => void) | null = null
      start() {
        instances.push(this)
        this.onstart?.()
        this.onresult?.({
          resultIndex: 0,
          results: [Object.assign([{ transcript: 'hello' }], { isFinal: false, length: 1 })],
        })
        this.onresult?.({
          resultIndex: 0,
          results: [Object.assign([{ transcript: 'hello world' }], { isFinal: true, length: 1 })],
        })
        this.onend?.()
      }
      stop() {}
      abort() {}
    }
    ;(window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition

    const voice = new VoiceInput()
    const results: Array<{ text: string; final: boolean }> = []
    voice.start({ onResult: (text, final) => results.push({ text, final }) })
    expect(results).toEqual([
      { text: 'hello', final: false },
      { text: 'hello world', final: true },
    ])
    expect(instances).toHaveLength(1)
  })
})

describe('VoiceOutput', () => {
  it('reports supported when speechSynthesis is available', () => {
    // jsdom does not ship speechSynthesis — stub it.
    const originalSynth = (window as unknown as { speechSynthesis?: unknown }).speechSynthesis
    const mock = {
      speak: vi.fn((u: { onend?: () => void }) => setTimeout(() => u.onend?.(), 0)),
      cancel: vi.fn(),
      getVoices: () => [],
      speaking: false,
    }
    ;(window as unknown as { speechSynthesis: unknown }).speechSynthesis = mock
    ;(globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class {
      text: string
      lang = ''
      rate = 1
      pitch = 1
      volume = 1
      voice: unknown = null
      onend: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(text: string) {
        this.text = text
      }
    } as never
    expect(VoiceOutput.isSupported()).toBe(true)
    const voice = new VoiceOutput('fr-FR')
    expect(voice.isSupported()).toBe(true)
    voice.stop()
    expect(mock.cancel).toHaveBeenCalled()
    ;(window as unknown as { speechSynthesis?: unknown }).speechSynthesis = originalSynth
  })
})

describe('SentenceBuffer', () => {
  it('splits on sentence-terminating punctuation', () => {
    const buffer = new SentenceBuffer()
    expect(buffer.push('Hello world. Second')).toEqual(['Hello world.'])
    expect(buffer.push(' sentence! Last')).toEqual(['Second sentence!'])
    expect(buffer.flush()).toBe('Last')
  })

  it('returns no sentences if no terminator seen yet', () => {
    const buffer = new SentenceBuffer()
    expect(buffer.push('incomplete')).toEqual([])
    expect(buffer.flush()).toBe('incomplete')
  })
})
