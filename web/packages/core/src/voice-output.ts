/**
 * VoiceOutput is a thin wrapper around window.speechSynthesis that handles
 * voice selection, sentence-level queuing, and barge-in cancellation. The
 * agent can feed this in streaming mode by passing each complete sentence
 * as soon as it arrives; the utterances are queued natively by the browser.
 */

export interface VoiceOutputOptions {
  lang?: string
  voice?: SpeechSynthesisVoice | null
  rate?: number
  pitch?: number
  volume?: number
}

export class VoiceOutput {
  private preferredLang: string
  private preferredVoice: SpeechSynthesisVoice | null = null
  private speaking = false

  constructor(lang = 'fr-FR') {
    this.preferredLang = lang
  }

  static isSupported(): boolean {
    return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined'
  }

  isSupported(): boolean {
    return VoiceOutput.isSupported()
  }

  getVoices(): SpeechSynthesisVoice[] {
    if (!VoiceOutput.isSupported()) return []
    try {
      return window.speechSynthesis.getVoices()
    } catch {
      return []
    }
  }

  setLang(lang: string): void {
    this.preferredLang = lang
    this.preferredVoice = null
  }

  isSpeaking(): boolean {
    if (!VoiceOutput.isSupported()) return false
    return this.speaking || window.speechSynthesis.speaking
  }

  speak(text: string, options: VoiceOutputOptions = {}): Promise<void> {
    if (!VoiceOutput.isSupported() || !text.trim()) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = options.lang ?? this.preferredLang
      utterance.rate = options.rate ?? 1.0
      utterance.pitch = options.pitch ?? 1.0
      utterance.volume = options.volume ?? 1.0
      const voice = options.voice ?? this.resolveVoice(utterance.lang)
      if (voice) utterance.voice = voice
      utterance.onend = () => {
        this.speaking = window.speechSynthesis.speaking
        resolve()
      }
      utterance.onerror = () => {
        this.speaking = window.speechSynthesis.speaking
        resolve()
      }
      this.speaking = true
      window.speechSynthesis.speak(utterance)
    })
  }

  stop(): void {
    if (!VoiceOutput.isSupported()) return
    try {
      window.speechSynthesis.cancel()
    } catch {
      // ignore
    }
    this.speaking = false
  }

  private resolveVoice(lang: string): SpeechSynthesisVoice | null {
    if (this.preferredVoice && this.preferredVoice.lang.startsWith(lang.slice(0, 2))) {
      return this.preferredVoice
    }
    const voices = this.getVoices()
    if (voices.length === 0) return null
    const shortLang = lang.slice(0, 2).toLowerCase()
    const exact = voices.find((voice) => voice.lang.toLowerCase() === lang.toLowerCase())
    if (exact) {
      this.preferredVoice = exact
      return exact
    }
    const partial = voices.find((voice) => voice.lang.toLowerCase().startsWith(shortLang))
    if (partial) {
      this.preferredVoice = partial
      return partial
    }
    return voices[0] ?? null
  }
}

/**
 * Accumulates streamed text and yields complete sentences suitable for
 * feeding into VoiceOutput.speak(). A sentence ends at `.`, `!`, `?`, or a
 * newline (double newline flushes whatever is pending).
 */
export class SentenceBuffer {
  private buffer = ''

  push(delta: string): string[] {
    this.buffer += delta
    const sentences: string[] = []
    const regex = /[^.!?\n]+[.!?\n]+/g
    let match: RegExpExecArray | null
    let lastIndex = 0
    while ((match = regex.exec(this.buffer)) !== null) {
      const sentence = match[0].trim()
      if (sentence.length > 0) sentences.push(sentence)
      lastIndex = match.index + match[0].length
    }
    if (lastIndex > 0) this.buffer = this.buffer.slice(lastIndex)
    return sentences
  }

  flush(): string {
    const remaining = this.buffer.trim()
    this.buffer = ''
    return remaining
  }

  reset(): void {
    this.buffer = ''
  }
}
