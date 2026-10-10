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
  /** The VAD started or stopped hearing speech. */
  speaking?(speaking: boolean): void
  /** Timing trace for the debug window. */
  debug?(event: SttDebugEvent): void
}

export type SttDebugEvent =
  | { type: 'speech-start' }
  | { type: 'speech-end' }
  /** `emitted` is false when a partial finished after the speaker paused or a new segment began, so it was dropped. */
  | { type: 'decode'; kind: 'partial' | 'segment'; audioMs: number; decodeMs: number; text: string; emitted: boolean }
  | { type: 'silence'; afterMs: number }

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
  /** Bumped when a new speech segment starts, so a slow partial decode can't land on the next one. */
  private segmentId = 0
  /** Segments decode one at a time so they are emitted in order. */
  private draining: Promise<void> = Promise.resolve()
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
    this.setSpeaking(false)
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
    this.setSpeaking(false)
    this.speech = []
    await this.drainSegments()
  }

  private track(window: Float32Array): void {
    const now = Date.now()
    if (this.vad.isDetected()) {
      if (!this.speaking) {
        this.setSpeaking(true)
        this.speech = [this.recent.slice(-PREROLL)]
        this.segmentId++
        this.events.debug?.({ type: 'speech-start' })
      }
      this.speech.push(window.slice())
      this.lastSpeechAt = now
      this.heardSpeech = true
      this.silenceSent = false
    } else if (this.speaking) {
      this.setSpeaking(false)
      this.speech = []
      this.events.debug?.({ type: 'speech-end' })
    }
    this.recent = concat([this.recent, window]).slice(-PREROLL)
  }

  private setSpeaking(speaking: boolean): void {
    if (speaking === this.speaking) return
    this.speaking = speaking
    this.events.speaking?.(speaking)
  }

  /** Resolves once every queued segment, including ones queued by earlier calls, is emitted. */
  private drainSegments(): Promise<void> {
    const run = this.draining.then(async () => {
      while (!this.vad.isEmpty()) {
        const { samples } = this.vad.front(false)
        this.vad.pop()
        const text = await this.decode(samples, 'segment', (text) => !!text)
        if (text) this.events.segment(text)
      }
    })
    this.draining = run.catch(() => {})
    return run
  }

  private maybePartial(): void {
    const now = Date.now()
    if (!this.speaking || this.decodingPartial || now - this.lastPartialAt < this.partialIntervalMs) return
    this.lastPartialAt = now
    this.decodingPartial = true
    const segment = this.segmentId
    const current = (text: string) => this.speaking && segment === this.segmentId && !!text
    this.decode(concat(this.speech), 'partial', current)
      .then((text) => {
        if (current(text)) this.events.partial(text)
      })
      .finally(() => (this.decodingPartial = false))
  }

  private maybeSilence(): void {
    if (this.heardSpeech && !this.speaking && !this.silenceSent && Date.now() - this.lastSpeechAt >= this.silenceMs) {
      this.silenceSent = true
      this.events.debug?.({ type: 'silence', afterMs: Date.now() - this.lastSpeechAt })
      this.events.silence()
    }
  }

  private async decode(samples: Float32Array, kind: 'partial' | 'segment', emits: (text: string) => boolean): Promise<string> {
    const started = performance.now()
    const stream = this.recognizer.createStream()
    stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE })
    const text = (await this.recognizer.decodeAsync(stream)).text.trim()
    this.events.debug?.({
      type: 'decode',
      kind,
      audioMs: Math.round((samples.length / SAMPLE_RATE) * 1000),
      decodeMs: performance.now() - started,
      text,
      emitted: emits(text),
    })
    return text
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
