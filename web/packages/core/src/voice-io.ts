/**
 * VoiceIO is a thin wrapper over the browser's native Web Speech APIs.
 * STT uses SpeechRecognition (webkit prefix on Safari/Chrome). TTS uses
 * SpeechSynthesis. Both are opt-in and gracefully degrade when missing.
 */

interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: unknown) => void) | null
  onend: (() => void) | null
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

interface VoiceWindow extends Window {
  SpeechRecognition?: SpeechRecognitionCtor
  webkitSpeechRecognition?: SpeechRecognitionCtor
}

export class VoiceIO {
  private recognition: SpeechRecognitionLike | null = null
  private listening = false

  constructor(private readonly locale: string = 'en-US') {}

  static isSupported(): boolean {
    if (typeof window === 'undefined') return false
    const w = window as VoiceWindow
    return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition)
  }

  startListening(onTranscript: (text: string, final: boolean) => void): void {
    if (typeof window === 'undefined') return
    const w = window as VoiceWindow
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!Ctor) return
    if (this.listening) return
    const rec = new Ctor()
    rec.continuous = false
    rec.interimResults = true
    rec.lang = this.locale
    rec.onresult = (event) => {
      const last = event.results[event.results.length - 1]
      if (!last) return
      onTranscript(last[0].transcript, last.isFinal)
    }
    rec.onerror = () => {
      this.listening = false
    }
    rec.onend = () => {
      this.listening = false
    }
    rec.start()
    this.recognition = rec
    this.listening = true
  }

  stopListening(): void {
    this.recognition?.stop()
    this.listening = false
  }

  speak(text: string): void {
    if (typeof speechSynthesis === 'undefined') return
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = this.locale
    speechSynthesis.cancel()
    speechSynthesis.speak(utterance)
  }

  cancelSpeaking(): void {
    if (typeof speechSynthesis === 'undefined') return
    speechSynthesis.cancel()
  }
}
