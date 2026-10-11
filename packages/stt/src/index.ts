/// <reference path="./sherpa.d.ts" />
import { join } from 'node:path'
import type { OfflineRecognizer, Vad } from 'sherpa-onnx-node'

export { readWav, writeWav } from './wav'

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
  /**
   * `audioMs` is the audio the model saw, including any context before the segment.
   * `emitted` is false when a partial finished after the speaker paused or a new segment began, so it was dropped.
   */
  | { type: 'decode'; kind: 'partial' | 'segment'; audioMs: number; decodeMs: number; text: string; emitted: boolean }
  | { type: 'silence'; afterMs: number }

export interface TranscriberOptions {
  modelsDir: string
  partialIntervalMs?: number
  silenceMs?: number
  /**
   * Audio kept before the VAD's speech onset. Silero fires only after ~250 ms of speech, so a short
   * first word ("add", "mark") or a word after a pause can start well before the onset; at 300 ms
   * synthetic speech lost such words, at 600 ms it lost none.
   */
  prerollMs?: number
  /**
   * Earlier speech from the same utterance decoded along with each segment, so the model hears
   * what came before. Only the new words are emitted. 0 decodes each segment on its own.
   */
  contextMs?: number
}

const PARAKEET = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8'
const WINDOW = 512
const MAX_SPEECH_S = 20

/**
 * Parakeet TDT is not a streaming model, so "live" works by segmenting with
 * Silero VAD and re-decoding the in-progress segment every `partialIntervalMs`.
 *
 * Sample positions are absolute since the last `reset()`, matching the VAD's own indices.
 */
export class Transcriber {
  private pending: Float32Array = new Float32Array(0)
  /** Recent audio as VAD windows; `windows[0]` starts at sample `firstWindow * WINDOW`. */
  private windows: Float32Array[] = []
  private firstWindow = 0
  /** Samples handed to the VAD so far. */
  private fed = 0
  /** Where the segment being spoken starts, preroll included. */
  private speechFrom = 0
  /** End of the last emitted segment: new text starts after it. */
  private boundary = 0
  /** Start of the current utterance's speech; context never reaches before it. */
  private contextFrom = 0
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
  private readonly preroll: number
  private readonly context: number
  private readonly keepWindows: number

  private constructor(
    private recognizer: OfflineRecognizer,
    private vad: Vad,
    private events: TranscriberEvents,
    opts: TranscriberOptions,
  ) {
    this.partialIntervalMs = opts.partialIntervalMs ?? 400
    this.silenceMs = opts.silenceMs ?? 2000
    this.preroll = samples(opts.prerollMs ?? 600)
    this.context = samples(opts.contextMs ?? 10_000)
    this.keepWindows = Math.ceil((this.context + this.preroll + samples(MAX_SPEECH_S * 1000 + 2000)) / WINDOW)
  }

  static async create(opts: TranscriberOptions, events: TranscriberEvents): Promise<Transcriber> {
    const sherpa = await loadSherpa()
    const recognizer = await loadRecognizer(opts.modelsDir)
    const vad = new sherpa.Vad(
      {
        sileroVad: {
          model: join(opts.modelsDir, 'silero_vad.onnx'),
          threshold: 0.5,
          minSilenceDuration: 0.4,
          minSpeechDuration: 0.25,
          maxSpeechDuration: MAX_SPEECH_S,
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
    this.windows = []
    this.firstWindow = 0
    this.fed = 0
    this.boundary = 0
    this.contextFrom = 0
    this.setSpeaking(false)
    this.heardSpeech = false
    this.silenceSent = false
  }

  /** Feed 16 kHz mono float samples. */
  accept(chunk: Float32Array): void {
    this.pending = concat([this.pending, chunk])
    while (this.pending.length >= WINDOW) {
      const window = this.pending.slice(0, WINDOW)
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
    await this.drainSegments()
  }

  private track(window: Float32Array): void {
    const at = this.fed
    this.windows.push(window)
    this.fed += WINDOW
    if (this.windows.length > this.keepWindows) {
      const drop = this.windows.length - this.keepWindows
      this.windows.splice(0, drop)
      this.firstWindow += drop
    }
    const now = Date.now()
    if (this.vad.isDetected()) {
      if (!this.speaking) {
        this.setSpeaking(true)
        this.speechFrom = Math.max(at - this.preroll, this.boundary)
        this.segmentId++
        this.events.debug?.({ type: 'speech-start' })
      }
      this.lastSpeechAt = now
      this.heardSpeech = true
      this.silenceSent = false
    } else if (this.speaking) {
      this.setSpeaking(false)
      this.events.debug?.({ type: 'speech-end' })
    }
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
        const { start, samples } = this.vad.front(false)
        this.vad.pop()
        const end = start + samples.length
        const text = await this.decode(Math.max(start - this.preroll, this.boundary), end, 'segment', (text) => !!text)
        this.boundary = Math.max(this.boundary, end)
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
    this.decode(this.speechFrom, this.fed, 'partial', current)
      .then((text) => {
        if (current(text)) this.events.partial(text)
      })
      .finally(() => (this.decodingPartial = false))
  }

  private maybeSilence(): void {
    if (this.heardSpeech && !this.speaking && !this.silenceSent && Date.now() - this.lastSpeechAt >= this.silenceMs) {
      this.silenceSent = true
      // The utterance is over: the next one gets no context from this one.
      this.contextFrom = this.boundary = this.fed
      this.events.debug?.({ type: 'silence', afterMs: Date.now() - this.lastSpeechAt })
      this.events.silence()
    }
  }

  /** Decodes samples `from`–`to`, preceded by up to `contextMs` of this utterance's earlier speech. */
  private async decode(
    from: number,
    to: number,
    kind: 'partial' | 'segment',
    emits: (text: string) => boolean,
  ): Promise<string> {
    const started = performance.now()
    const oldest = this.firstWindow * WINDOW
    const contextStart = Math.max(from - this.context, this.contextFrom, oldest)
    const decodeFrom = Math.min(contextStart, from)
    const audio = this.slice(decodeFrom, to)
    const stream = this.recognizer.createStream()
    stream.acceptWaveform({ samples: audio, sampleRate: SAMPLE_RATE })
    const result = await this.recognizer.decodeAsync(stream)
    const text = decodeFrom < from ? textAfter(result, (from - decodeFrom) / SAMPLE_RATE) : result.text.trim()
    this.events.debug?.({
      type: 'decode',
      kind,
      audioMs: Math.round((audio.length / SAMPLE_RATE) * 1000),
      decodeMs: performance.now() - started,
      text,
      emitted: emits(text),
    })
    return text
  }

  private slice(from: number, to: number): Float32Array {
    const first = Math.max(0, Math.floor(from / WINDOW) - this.firstWindow)
    const last = Math.ceil(to / WINDOW) - this.firstWindow
    const joined = concat(this.windows.slice(first, last))
    const offset = from - (this.firstWindow + first) * WINDOW
    return joined.subarray(Math.max(0, offset), Math.max(0, offset) + (to - from))
  }
}

/** CommonJS native addon, loaded lazily so a broken install can't crash startup. */
async function loadSherpa() {
  return (await import('sherpa-onnx-node')).default
}

/** One recognizer per models dir, shared by every transcriber (it is ~600 MB in memory). */
const recognizers = new Map<string, Promise<OfflineRecognizer>>()

function loadRecognizer(modelsDir: string): Promise<OfflineRecognizer> {
  let recognizer = recognizers.get(modelsDir)
  if (!recognizer) {
    const dir = join(modelsDir, PARAKEET)
    recognizer = loadSherpa().then((sherpa) =>
      sherpa.OfflineRecognizer.createAsync({
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
      }),
    )
    recognizers.set(modelsDir, recognizer)
  }
  return recognizer
}

/** Decodes a whole recording in one pass, with no VAD segmenting. */
export async function transcribe(modelsDir: string, samples: Float32Array): Promise<string> {
  const recognizer = await loadRecognizer(modelsDir)
  const stream = recognizer.createStream()
  stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE })
  return (await recognizer.decodeAsync(stream)).text.trim()
}

/**
 * The words of a decode that start at or after `seconds`. Tokens beginning with a space start a
 * word, so a word is kept or dropped whole.
 */
export function textAfter(result: { tokens: string[]; timestamps: number[] }, seconds: number): string {
  let text = ''
  let keep = false
  result.tokens.forEach((token, i) => {
    if (i === 0 || token.startsWith(' ')) keep = (result.timestamps[i] ?? 0) >= seconds
    if (keep) text += token
  })
  return text.trim()
}

function samples(ms: number): number {
  return Math.round((ms / 1000) * SAMPLE_RATE)
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
