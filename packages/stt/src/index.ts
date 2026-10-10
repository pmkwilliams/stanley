/// <reference path="./sherpa.d.ts" />
import { join } from 'node:path'
import type { OfflineRecognizer, Vad } from 'sherpa-onnx-node'

export const SAMPLE_RATE = 16000

export interface TranscriberEvents {
  /** Re-decoded text of the segment currently being spoken. Earlier words may change. */
  partial(text: string): void
  /** A segment ended at a pause. Final text. */
  segment(text: string): void
  /** No speech for `silenceMs` after some speech — used to auto-end the utterance. */
  silence(): void
}

export interface TranscriberOptions {
  modelsDir: string
  partialIntervalMs?: number
  silenceMs?: number
}

const PARAKEET = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8'
const WINDOW = 512
const PREROLL = Math.round(0.3 * SAMPLE_RATE)

/**
 * Parakeet TDT is not a streaming model, so "live" works by segmenting with
 * Silero VAD and re-decoding the in-progress segment every `partialIntervalMs`.
 */
export class Transcriber {
  private pending: Float32Array = new Float32Array(0)
  private recent: Float32Array = new Float32Array(0)
  private speech: Float32Array[] = []
  private speaking = false
  private heardSpeech = false
  private lastSpeechAt = 0
  private lastPartialAt = 0
  private decodingPartial = false
  private silenceSent = false
  private readonly partialIntervalMs: number
  private readonly silenceMs: number

  private constructor(
    private recognizer: OfflineRecognizer,
    private vad: Vad,
    private events: TranscriberEvents,
    opts: TranscriberOptions,
  ) {
    this.partialIntervalMs = opts.partialIntervalMs ?? 400
    this.silenceMs = opts.silenceMs ?? 2000
  }

  static async create(opts: TranscriberOptions, events: TranscriberEvents): Promise<Transcriber> {
    // CommonJS native addon, loaded lazily so a broken install can't crash startup.
    const { default: sherpa } = await import('sherpa-onnx-node')
    const dir = join(opts.modelsDir, PARAKEET)
    const recognizer = await sherpa.OfflineRecognizer.createAsync({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: join(dir, 'encoder.int8.onnx'),
          decoder: join(dir, 'decoder.int8.onnx'),
          joiner: join(dir, 'joiner.int8.onnx'),
        },
        tokens: join(dir, 'tokens.txt'),
        modelType: 'nemo_transducer',
        numThreads: 2,
        provider: 'cpu',
      },
    })
    const vad = new sherpa.Vad(
      {
        sileroVad: {
          model: join(opts.modelsDir, 'silero_vad.onnx'),
          threshold: 0.5,
          minSilenceDuration: 0.4,
          minSpeechDuration: 0.25,
          maxSpeechDuration: 20,
          windowSize: WINDOW,
        },
        sampleRate: SAMPLE_RATE,
        numThreads: 1,
      },
      60,
    )
    return new Transcriber(recognizer, vad, events, opts)
  }

  /** Start of an utterance: drop any leftover audio. */
  reset(): void {
    this.vad.reset()
    this.pending = new Float32Array(0)
    this.recent = new Float32Array(0)
    this.speech = []
    this.speaking = false
    this.heardSpeech = false
    this.silenceSent = false
  }

  /** Feed 16 kHz mono float samples. */
  accept(chunk: Float32Array): void {
    this.pending = concat([this.pending, chunk])
    while (this.pending.length >= WINDOW) {
      const window = this.pending.subarray(0, WINDOW)
      this.pending = this.pending.slice(WINDOW)
      this.vad.acceptWaveform(window)
      this.track(window)
    }
    void this.drainSegments()
    this.maybePartial()
    this.maybeSilence()
  }

  /** End of an utterance: finalize whatever is still being spoken. */
  async flush(): Promise<void> {
    this.vad.flush()
    await this.drainSegments()
    this.speaking = false
    this.speech = []
  }

  private track(window: Float32Array): void {
    const now = Date.now()
    if (this.vad.isDetected()) {
      if (!this.speaking) {
        this.speaking = true
        this.speech = [this.recent.slice(-PREROLL)]
      }
      this.speech.push(window.slice())
      this.lastSpeechAt = now
      this.heardSpeech = true
      this.silenceSent = false
    } else if (this.speaking) {
      this.speaking = false
      this.speech = []
    }
    this.recent = concat([this.recent, window]).slice(-PREROLL)
  }

  private async drainSegments(): Promise<void> {
    while (!this.vad.isEmpty()) {
      const { samples } = this.vad.front(false)
      this.vad.pop()
      const text = await this.decode(samples)
      if (text) this.events.segment(text)
    }
  }

  private maybePartial(): void {
    const now = Date.now()
    if (!this.speaking || this.decodingPartial || now - this.lastPartialAt < this.partialIntervalMs) return
    this.lastPartialAt = now
    this.decodingPartial = true
    this.decode(concat(this.speech))
      .then((text) => {
        if (this.speaking && text) this.events.partial(text)
      })
      .finally(() => (this.decodingPartial = false))
  }

  private maybeSilence(): void {
    if (this.heardSpeech && !this.speaking && !this.silenceSent && Date.now() - this.lastSpeechAt >= this.silenceMs) {
      this.silenceSent = true
      this.events.silence()
    }
  }

  private async decode(samples: Float32Array): Promise<string> {
    const stream = this.recognizer.createStream()
    stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE })
    const { text } = await this.recognizer.decodeAsync(stream)
    return text.trim()
  }
}

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}
