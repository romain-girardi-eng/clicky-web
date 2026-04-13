import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ElevenLabsVoiceOutput } from '../src/voice-output-elevenlabs'

describe('ElevenLabsVoiceOutput', () => {
  let originalFetch: typeof fetch
  let originalAudio: typeof Audio
  let playCalls: string[] = []

  beforeEach(() => {
    originalFetch = globalThis.fetch
    originalAudio = globalThis.Audio
    playCalls = []

    globalThis.fetch = vi.fn(async () =>
      new Response(new Blob(['fake-mp3'], { type: 'audio/mpeg' }), { status: 200 }),
    ) as unknown as typeof fetch
    // Minimal Audio stub that resolves synchronously
    class FakeAudio {
      public onended: (() => void) | null = null
      public onerror: (() => void) | null = null
      constructor(public src: string) {
        playCalls.push(src)
      }
      play(): Promise<void> {
        setTimeout(() => this.onended?.(), 1)
        return Promise.resolve()
      }
      pause(): void {}
    }
    globalThis.Audio = FakeAudio as unknown as typeof Audio
    // URL stubs
    if (typeof globalThis.URL.createObjectURL !== 'function') {
      globalThis.URL.createObjectURL = () => 'blob:fake'
    }
    if (typeof globalThis.URL.revokeObjectURL !== 'function') {
      globalThis.URL.revokeObjectURL = () => {}
    }
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    globalThis.Audio = originalAudio
  })

  it('queues and plays audio clips from the proxy', async () => {
    const tts = new ElevenLabsVoiceOutput({ proxyUrl: '/api/tts' })
    expect(tts.isSupported()).toBe(true)
    await tts.speak('Bonjour')
    await tts.speak('Ça va')
    // Flush microtasks
    await new Promise((r) => setTimeout(r, 20))
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBe(2)
    expect(playCalls.length).toBe(2)
  })

  it('stop clears the queue and prevents further playback', async () => {
    const tts = new ElevenLabsVoiceOutput({ proxyUrl: '/api/tts' })
    await tts.speak('one')
    await tts.speak('two')
    tts.stop()
    expect(tts.isSpeaking()).toBe(false)
  })

  it('calls onError when the upstream proxy fails', async () => {
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch
    const onError = vi.fn()
    const tts = new ElevenLabsVoiceOutput({ proxyUrl: '/api/tts', onError })
    await tts.speak('fail')
    await new Promise((r) => setTimeout(r, 30))
    expect(onError).toHaveBeenCalled()
  })
})
