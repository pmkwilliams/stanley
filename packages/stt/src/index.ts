/// <reference path="./sherpa.d.ts" />
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OfflineRecognizer, Vad } from 'sherpa-onnx-node'
// Each size holds only the words new at it, so a level is the sizes up to it together.
import american10 from 'wordlist-english/american-words-10.json' with { type: 'json' }
import american20 from 'wordlist-english/american-words-20.json' with { type: 'json' }
import american35 from 'wordlist-english/american-words-35.json' with { type: 'json' }
import american40 from 'wordlist-english/american-words-40.json' with { type: 'json' }
import american50 from 'wordlist-english/american-words-50.json' with { type: 'json' }
import english10 from 'wordlist-english/english-words-10.json' with { type: 'json' }
import english20 from 'wordlist-english/english-words-20.json' with { type: 'json' }
import english35 from 'wordlist-english/english-words-35.json' with { type: 'json' }
import english40 from 'wordlist-english/english-words-40.json' with { type: 'json' }
import english50 from 'wordlist-english/english-words-50.json' with { type: 'json' }
import { SMART_TURN, TurnDetector } from './turn'

export { parseWav, readWav, writeWav } from './wav'
export { TurnDetector, whisperFeatures } from './turn'

export const SAMPLE_RATE = 16000

/** A decoded word and how sure the model was of it: its least likely token's probability. */
export interface HeardWord {
  word: string
  confidence: number
}

export interface TranscriberEvents {
  /** Re-decoded text of the segment currently being spoken. Earlier words may change. */
  partial(text: string, words: HeardWord[]): void
  /** A segment ended at a pause. Final text. */
  segment(text: string, words: HeardWord[]): void
  /**
   * No speech for `silenceMs` after some speech. A backstop: whoever listens to `pause` usually
   * ends the utterance sooner, through `endUtterance()`.
   */
  silence(): void
  /** The VAD started or stopped hearing speech. */
  speaking?(speaking: boolean): void
  /**
   * The speaker paused. `complete` is Smart Turn's P(they finished their turn), from how the
   * audio up to the pause sounds; null without the model. Not sent if they spoke again first.
   */
  pause?(turn: { complete: number | null }): void
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
  | { type: 'decode'; kind: 'partial' | 'segment'; audioMs: number; decodeMs: number; text: string; emitted: boolean; unsure?: string[] }
  | { type: 'silence'; afterMs: number }
  | { type: 'turn'; complete: number; audioMs: number; latencyMs: number; emitted: boolean }

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
  /** Judge each pause with Smart Turn when its model is in `modelsDir` (default true). */
  turn?: boolean
}

const PARAKEET = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8'
/**
 * How strongly beam search favours the hotwords. At 1.5 a name on screen ("Okonkwo") is heard
 * instead of a sound-alike ("Aconquo"); at 2.5 it starts replacing other words with them.
 */
const HOTWORD_SCORE = 1.5
const MAX_HOTWORDS = 30
/** A word below this confidence is reported as unsure in the decode trace. */
const UNSURE = 0.5
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
  private readonly modelsDir: string
  private readonly partialIntervalMs: number
  private readonly silenceMs: number
  private readonly preroll: number
  private readonly context: number
  private readonly keepWindows: number
  /** Newline-separated words beam search favours, or '' for none. */
  private hotwords = ''

  private constructor(
    private recognizer: OfflineRecognizer,
    private vad: Vad,
    private events: TranscriberEvents,
    opts: TranscriberOptions,
    private turn: TurnDetector | null,
  ) {
    this.modelsDir = opts.modelsDir
    this.partialIntervalMs = opts.partialIntervalMs ?? 400
    this.silenceMs = opts.silenceMs ?? 4000
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
    const turn = opts.turn !== false && existsSync(join(opts.modelsDir, SMART_TURN)) ? await loadTurn(opts.modelsDir) : null
    return new Transcriber(recognizer, vad, events, opts, turn)
  }

  /**
   * Words to favour, usually names and labels on screen. Only rare words are kept: not one of the
   * model's pieces and not a common English word. Common ones need no help, and favouring them
   * distorts: with "Music" on screen, a little background noise before "play music" was heard as
   * "Music Music Music Music Music Previous Play Music", and with "Archived" on screen "Alex" was
   * heard as "Archived".
   */
  setHotwords(candidates: Iterable<string>): void {
    const vocab = this.vocab()
    const common = commonWords()
    const kept = new Set<string>()
    for (const raw of candidates) {
      const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
      const lower = word.toLowerCase().replace(/’/g, "'")
      if (word.length < 3 || vocab.has(`▁${word}`) || vocab.has(`▁${lower}`) || common.has(lower)) continue
      kept.add(word)
      if (kept.size >= MAX_HOTWORDS) break
    }
    this.hotwords = [...kept].join('\n')
  }

  private vocabCache?: Set<string>
  private vocab(): Set<string> {
    return (this.vocabCache ??= readVocab(this.modelsDir))
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
        // First speech of an utterance: context starts here, not at the silence before it.
        if (!this.heardSpeech || this.silenceSent) this.contextFrom = this.speechFrom
        this.segmentId++
        this.events.debug?.({ type: 'speech-start' })
      }
      this.lastSpeechAt = now
      this.heardSpeech = true
      this.silenceSent = false
    } else if (this.speaking) {
      this.setSpeaking(false)
      this.events.debug?.({ type: 'speech-end' })
      this.judgePause()
    }
  }

  /**
   * Asks Smart Turn whether the utterance so far sounds finished. Reported after the pause's
   * segment, so a listener that ends the utterance on it never loses the last words.
   */
  private judgePause(): void {
    if (!this.events.pause) return
    const segment = this.segmentId
    const current = () => !this.speaking && segment === this.segmentId
    const started = performance.now()
    const audio = this.slice(Math.max(this.contextFrom, this.fed - samples(8000)), this.fed)
    const judged = this.turn ? this.turn.complete(audio).catch(() => null) : Promise.resolve(null)
    // The VAD queues the segment a window or two after it stops detecting speech.
    const decoded = new Promise((r) => setTimeout(r, 50)).then(() => this.drainSegments()).catch(() => {})
    void Promise.all([judged, decoded]).then(([complete]) => {
      const emitted = current()
      if (complete !== null) this.events.debug?.({ type: 'turn', complete, audioMs: Math.round((audio.length / SAMPLE_RATE) * 1000), latencyMs: performance.now() - started, emitted })
      if (emitted) this.events.pause?.({ complete })
    })
  }

  /**
   * The listener decided the utterance is over before the silence backstop: the next speech
   * starts a new utterance, with no context from this one.
   */
  endUtterance(): void {
    if (!this.heardSpeech || this.silenceSent) return
    this.closeUtterance()
  }

  /**
   * The next speech starts a new utterance: its context starts at its own first speech (see
   * `track`), and its audio after everything fed so far. A segment the VAD has queued but not yet
   * decoded still belongs to this utterance, so the boundary moves once it is out.
   */
  private closeUtterance(): void {
    this.silenceSent = true
    const at = this.fed
    void this.drainSegments()
      .catch(() => {})
      .then(() => (this.boundary = Math.max(this.boundary, at)))
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
        const { text, words } = await this.decode(Math.max(start - this.preroll, this.boundary), end, 'segment', (text) => !!text)
        this.boundary = Math.max(this.boundary, end)
        if (text) this.events.segment(text, words)
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
      .then(({ text, words }) => {
        if (current(text)) this.events.partial(text, words)
      })
      .finally(() => (this.decodingPartial = false))
  }

  private maybeSilence(): void {
    if (this.heardSpeech && !this.speaking && !this.silenceSent && Date.now() - this.lastSpeechAt >= this.silenceMs) {
      // The utterance is over: the next one gets no context from this one.
      this.closeUtterance()
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
  ): Promise<Heard> {
    const started = performance.now()
    const oldest = this.firstWindow * WINDOW
    const contextStart = Math.max(from - this.context, this.contextFrom, oldest)
    const decodeFrom = Math.min(contextStart, from)
    const audio = this.slice(decodeFrom, to)
    const stream = this.hotwords ? this.recognizer.createStream(this.hotwords) : this.recognizer.createStream()
    stream.acceptWaveform({ samples: audio, sampleRate: SAMPLE_RATE })
    const result = await this.recognizer.decodeAsync(stream)
    const heard = heardAfter(result, (from - decodeFrom) / SAMPLE_RATE)
    const unsure = heard.words.filter((w) => w.confidence < UNSURE).map((w) => w.word)
    this.events.debug?.({
      type: 'decode',
      kind,
      audioMs: Math.round((audio.length / SAMPLE_RATE) * 1000),
      decodeMs: performance.now() - started,
      text: heard.text,
      emitted: emits(heard.text),
      ...(unsure.length && { unsure }),
    })
    return heard
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

const detectors = new Map<string, Promise<TurnDetector | null>>()

/** Smart Turn is optional: without it, pauses carry no audio judgement. */
function loadTurn(modelsDir: string): Promise<TurnDetector | null> {
  let detector = detectors.get(modelsDir)
  if (!detector) {
    detector = TurnDetector.create(modelsDir).catch((err) => {
      console.warn('Smart Turn failed to load; pauses will be judged by words alone', err)
      return null
    })
    detectors.set(modelsDir, detector)
  }
  return detector
}

/** One recognizer per models dir, shared by every transcriber (it is ~600 MB in memory). */
const recognizers = new Map<string, Promise<OfflineRecognizer>>()

function loadRecognizer(modelsDir: string): Promise<OfflineRecognizer> {
  let recognizer = recognizers.get(modelsDir)
  if (!recognizer) {
    const dir = join(modelsDir, PARAKEET)
    // Beam search (4 paths, ~7% slower than greedy) so hotwords can steer it. sherpa splits
    // hotwords into the model's pieces with a BPE vocabulary, made from tokens.txt.
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
          modelingUnit: 'bpe',
          bpeVocab: bpeVocab(dir),
          numThreads: 2,
          provider: 'cpu',
        },
        decodingMethod: 'modified_beam_search',
        maxActivePaths: 4,
        hotwordsScore: HOTWORD_SCORE,
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

let commonCache: Set<string> | undefined

/**
 * Common English words, lowercased: SCOWL's up to size 50, every form ("archived", "emails") and no
 * names. The dictionary macOS ships was used before, but it has only base forms and does have
 * first names, so it passed "Archived" as rare and "Alex" as common.
 */
function commonWords(): Set<string> {
  return (commonCache ??= new Set(
    [english10, english20, english35, english40, english50, american10, american20, american35, american40, american50]
      .flat()
      .map((w) => w.toLowerCase()),
  ))
}

/** The model's pieces, as in tokens.txt (`▁` starts a word). */
function readVocab(modelsDir: string): Set<string> {
  const lines = readFileSync(join(modelsDir, PARAKEET, 'tokens.txt'), 'utf8').split('\n')
  return new Set(lines.map((l) => l.split(' ')[0]!).filter(Boolean))
}

/**
 * A sentencepiece-style vocabulary (`piece<TAB>score`) for sherpa to split hotwords with. The
 * pieces' order in tokens.txt stands in for their frequency.
 */
function bpeVocab(dir: string): string {
  const lines = readFileSync(join(dir, 'tokens.txt'), 'utf8')
    .split('\n')
    .map((l) => l.split(' '))
    .filter(([piece, id]) => piece && id && piece !== '<unk>' && piece !== '<blk>')
    .map(([piece, id]) => `${piece}\t-${id}`)
  for (const file of [join(dir, 'bpe.vocab'), join(tmpdir(), `stanley-${PARAKEET}.bpe.vocab`)]) {
    if (existsSync(file)) return file
    try {
      writeFileSync(file, lines.join('\n') + '\n')
      return file
    } catch {
      // The models dir may be read-only in a packaged app.
    }
  }
  throw new Error('could not write a BPE vocabulary for hotwords')
}

/** A decode's text and words with their confidence. */
export interface Heard {
  text: string
  words: HeardWord[]
}

interface DecodeResult {
  tokens: string[]
  timestamps: number[]
  ys_log_probs?: number[]
}

/**
 * The words of a decode that start at or after `seconds`. Tokens beginning with a space start a
 * word, so a word is kept or dropped whole. A word's confidence is its least likely token's
 * probability, punctuation aside.
 */
export function heardAfter(result: DecodeResult, seconds: number): Heard {
  const words: HeardWord[] = []
  let keep = false
  result.tokens.forEach((token, i) => {
    const starts = i === 0 || token.startsWith(' ')
    if (starts) keep = (result.timestamps[i] ?? 0) >= seconds
    if (!keep) return
    const logProb = result.ys_log_probs?.[i]
    const p = logProb === undefined || /^[^\p{L}\p{N}]+$/u.test(token.trim()) ? 1 : Math.exp(logProb)
    const last = words.at(-1)
    if (starts || !last) words.push({ word: token.trim(), confidence: p })
    else {
      last.word += token
      last.confidence = Math.min(last.confidence, p)
    }
  })
  return { text: words.map((w) => w.word).join(' '), words }
}

export function textAfter(result: DecodeResult, seconds: number): string {
  return heardAfter(result, seconds).text
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
