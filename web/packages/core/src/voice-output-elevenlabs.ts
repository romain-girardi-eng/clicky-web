/**
 * ElevenLabsVoiceOutput — high-quality TTS via an edge proxy that
 * forwards to ElevenLabs. Mirrors the VoiceOutput surface
 * (speak / stop / isSupported / isSpeaking) so the agent can swap
 * providers without branching logic.
 *
 * The proxy returns audio/mpeg; we decode via an HTMLAudioElement per
 * utterance and queue them so sentence-streamed speech plays in order
 * without overlap.
 */

export interface ElevenLabsVoiceOutputConfig {
  proxyUrl: string
  voiceId?: string
  onError?: (err: Error) => void
}

export class ElevenLabsVoiceOutput {
  private queue: string[] = []
  private playing = false
  private currentAudio: HTMLAudioElement | null = null
  private stopped = false

  constructor(private readonly config: ElevenLabsVoiceOutputConfig) {}

  static isSupported(): boolean {
    return typeof Audio !== 'undefined' && typeof fetch !== 'undefined'
  }

  isSupported(): boolean {
    return ElevenLabsVoiceOutput.isSupported()
  }

  isSpeaking(): boolean {
    return this.playing
  }

  speak(text: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) return Promise.resolve()
    this.stopped = false
    this.queue.push(trimmed)
    if (!this.playing) void this.drain()
    return Promise.resolve()
  }

  stop(): void {
    this.stopped = true
    this.queue.length = 0
    if (this.currentAudio) {
      try {
        this.currentAudio.pause()
      } catch {
        // ignore
      }
      this.currentAudio = null
    }
    this.playing = false
  }

  private async drain(): Promise<void> {
    this.playing = true
    while (this.queue.length > 0 && !this.stopped) {
      const text = this.queue.shift() as string
      try {
        const res = await fetch(this.config.proxyUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, voiceId: this.config.voiceId }),
        })
        if (!res.ok) throw new Error(`TTS failed: ${res.status}`)
        const blob = await res.blob()
        if (this.stopped) break
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        this.currentAudio = audio
        await new Promise<void>((resolve) => {
          audio.onended = (): void => {
            URL.revokeObjectURL(url)
            resolve()
          }
          audio.onerror = (): void => {
            URL.revokeObjectURL(url)
            this.config.onError?.(new Error('Audio playback failed'))
            resolve()
          }
          audio.play().catch((err: unknown) => {
            URL.revokeObjectURL(url)
            this.config.onError?.(err instanceof Error ? err : new Error(String(err)))
            resolve()
          })
        })
      } catch (err) {
        this.config.onError?.(err instanceof Error ? err : new Error(String(err)))
        // Bail out of this chunk but keep draining; caller decides what to do.
      }
    }
    this.playing = false
    this.currentAudio = null
  }
}

/**
 * Shape-compatible VoiceOutput interface used by the agent: both
 * VoiceOutput (Web Speech) and ElevenLabsVoiceOutput satisfy it.
 */
export interface VoiceOutputLike {
  speak(text: string): Promise<void>
  stop(): void
  isSpeaking(): boolean
  isSupported(): boolean
}
