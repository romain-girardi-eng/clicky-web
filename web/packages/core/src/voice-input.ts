/**
 * VoiceInput is a focused, event-oriented wrapper around the browser Web
 * Speech API (SpeechRecognition). It supersedes the older VoiceIO.startListening
 * helper, giving the caller a proper options bag and richer callbacks.
 *
 * On browsers lacking Web Speech (Firefox, Safari in some versions, older
 * Chromium forks), isSupported() returns false and the widget surfaces a
 * graceful fallback.
 */

interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  abort?(): void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error?: string; message?: string }) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean; length: number }>
  resultIndex: number
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

interface VoiceWindow extends Window {
  SpeechRecognition?: SpeechRecognitionCtor
  webkitSpeechRecognition?: SpeechRecognitionCtor
}

export interface VoiceInputOptions {
  onResult: (text: string, isFinal: boolean) => void
  onError?: (error: string) => void
  onStart?: () => void
  onEnd?: () => void
  lang?: string
  continuous?: boolean
}

export class VoiceInput {
  private recognition: SpeechRecognitionLike | null = null
  private active = false

  static isSupported(): boolean {
    if (typeof window === 'undefined') return false
    const w = window as VoiceWindow
    return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition)
  }

  isSupported(): boolean {
    return VoiceInput.isSupported()
  }

  isActive(): boolean {
    return this.active
  }

  start(options: VoiceInputOptions): void {
    if (this.active) return
    if (typeof window === 'undefined') {
      options.onError?.('no-window')
      return
    }
    const w = window as VoiceWindow
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!Ctor) {
      options.onError?.('not-supported')
      return
    }
    const rec = new Ctor()
    rec.continuous = options.continuous ?? false
    rec.interimResults = true
    rec.lang = options.lang ?? 'fr-FR'

    rec.onstart = () => {
      this.active = true
      options.onStart?.()
    }
    rec.onresult = (event) => {
      let interim = ''
      let finalText = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        if (!result || result.length === 0) continue
        const alt = result[0]
        if (!alt) continue
        if (result.isFinal) finalText += alt.transcript
        else interim += alt.transcript
      }
      if (finalText) options.onResult(finalText.trim(), true)
      else if (interim) options.onResult(interim.trim(), false)
    }
    rec.onerror = (event) => {
      const code = event.error ?? event.message ?? 'unknown'
      options.onError?.(code)
      this.active = false
    }
    rec.onend = () => {
      this.active = false
      options.onEnd?.()
    }

    try {
      rec.start()
      this.recognition = rec
    } catch (error) {
      options.onError?.(error instanceof Error ? error.message : String(error))
      this.active = false
    }
  }

  stop(): void {
    if (!this.recognition) return
    try {
      this.recognition.stop()
    } catch {
      // already stopped
    }
    this.active = false
  }

  abort(): void {
    if (!this.recognition) return
    try {
      this.recognition.abort?.()
    } catch {
      // ignore
    }
    this.active = false
  }
}
