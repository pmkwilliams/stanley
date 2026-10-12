import { DEFAULT_SEGMENTER, Segmenter, type SegmenterOptions } from './segment'

export interface Audio {
  samples: Float32Array
  sampleRate: number
}

/** Turns text into speech. One call at a time. */
export interface Synth {
  synthesize(text: string): Promise<Audio>
}

/** One piece of a reply's audio, to play right after the one before it. */
export interface Piece extends Audio {
  reply: number
  seq: number
  text: string
}

export type TtsDebugEvent =
  | { type: 'synth'; reply: number; seq: number; text: string; synthMs: number; audioMs: number; queuedMs: number }
  | { type: 'synth-failed'; reply: number; text: string; error: string }
  | { type: 'stop'; reply: number; spoken: string }

export interface SpeakerEvents {
  /** Audio to play after everything sent before it. */
  audio(piece: Piece): void
  /** Stop playing `reply` now, including anything of it already sent. */
  stop(reply: number): void
  /** Ducking changed: play at this fraction of full volume. */
  volume?(level: number): void
  /** Stanley started or stopped talking. */
  speaking?(on: boolean): void
  debug?(event: TtsDebugEvent): void
}

interface Sent {
  seq: number
  /** The text as it was cut, spaces included, so the pieces add up to the reply. */
  text: string
  ms: number
  state: 'queued' | 'playing' | 'played'
  startedAt?: number
}

interface Reply {
  id: number
  segmenter: Segmenter
  sent: Sent[]
  synthesizing: boolean
}

export interface SpeakerOptions {
  segmenter?: SegmenterOptions
  /** Volume while the user may be cutting in. */
  ducked?: number
  now?: () => number
}

/**
 * Says replies as they are written: cuts them into pieces (see `Segmenter`), synthesizes one piece
 * at a time and sends the audio to the player, which reports back as each piece starts and ends.
 * Replies are said in order. Knows how much of a reply has been said, to the word, for when the
 * user cuts in.
 */
export class Speaker {
  private replies: Reply[] = []
  private synthesizing = false
  private timer?: ReturnType<typeof setTimeout>
  private talking = false
  private isDucked = false
  /** Synthesis time ≈ `base` + `perChar` × characters, learned as it goes. */
  private base = 200
  private perChar = 11
  private readonly now: () => number
  private readonly segmenter: SegmenterOptions
  private readonly duckedLevel: number

  constructor(
    private synth: Synth,
    private events: SpeakerEvents,
    opts: SpeakerOptions = {},
  ) {
    this.now = opts.now ?? (() => performance.now())
    this.segmenter = opts.segmenter ?? DEFAULT_SEGMENTER
    this.duckedLevel = opts.ducked ?? 0.3
  }

  /** Stanley is talking: from a reply's first audio until its last, pauses between pieces included. */
  get speaking(): boolean {
    return this.talking
  }

  get ducked(): boolean {
    return this.isDucked
  }

  /** A reply's text so far, and whether it is complete. */
  update(id: number, text: string, done: boolean): void {
    let reply = this.replies.find((r) => r.id === id)
    if (!reply) {
      if (done && !text.trim()) return
      reply = { id, segmenter: new Segmenter(this.segmenter), sent: [], synthesizing: false }
      this.replies.push(reply)
    }
    reply.segmenter.set(text)
    if (done) reply.segmenter.end()
    this.settle(reply)
    this.pump()
  }

  /** The player started playing a piece. */
  started(id: number, seq: number): void {
    const piece = this.replies.find((r) => r.id === id)?.sent[seq]
    if (!piece || piece.state !== 'queued') return
    piece.state = 'playing'
    piece.startedAt = this.now()
    this.setTalking()
  }

  /** The player finished a piece. */
  ended(id: number, seq: number): void {
    const reply = this.replies.find((r) => r.id === id)
    const piece = reply?.sent[seq]
    if (!reply || !piece) return
    piece.state = 'played'
    this.settle(reply)
    this.pump()
  }

  /**
   * Stops a reply. Returns what of it was said, to the last whole word, or null when none of it
   * was played yet.
   */
  stop(id: number): string | null {
    const reply = this.replies.find((r) => r.id === id)
    if (!reply) return null
    const spoken = reply.sent.some((s) => s.state !== 'queued') ? said(reply, this.now()) : null
    this.replies = this.replies.filter((r) => r !== reply)
    this.events.stop(id)
    this.events.debug?.({ type: 'stop', reply: id, spoken: spoken ?? '' })
    this.setTalking()
    this.pump()
    return spoken
  }

  /** Stops every reply; returns what was said of each (null for none of it). */
  stopAll(): { id: number; spoken: string | null }[] {
    return this.replies.map((r) => r.id).map((id) => ({ id, spoken: this.stop(id) }))
  }

  /** The reply being said: its id, what has been said so far and what is still to come. */
  position(): { id: number; spoken: string; rest: string } | null {
    const reply = this.replies.find((r) => r.sent.some((s) => s.state !== 'queued'))
    if (!reply) return null
    const spoken = said(reply, this.now())
    return { id: reply.id, spoken, rest: reply.segmenter.received.slice(spoken.length) }
  }

  /** Lowers the voice while the user may be cutting in, and back. */
  duck(on: boolean): void {
    if (on === this.isDucked) return
    this.isDucked = on
    this.events.volume?.(on ? this.duckedLevel : 1)
  }

  /** Audio sent and not yet played. */
  private queuedMs(): number {
    const now = this.now()
    let ms = 0
    for (const r of this.replies)
      for (const s of r.sent) {
        if (s.state === 'queued') ms += s.ms
        else if (s.state === 'playing') ms += Math.max(0, s.ms - (now - s.startedAt!))
      }
    return ms
  }

  private estimate(text: string): number {
    return this.base + this.perChar * text.length
  }

  /** Synthesizes the next piece of the earliest reply that has text left to cut, when it's time. */
  private pump(): void {
    clearTimeout(this.timer)
    if (this.synthesizing) return
    const reply = this.replies.find((r) => !r.segmenter.finished)
    if (!reply) return
    const queued = this.queuedMs()
    const cut = reply.segmenter.next(queued, (t) => this.estimate(t))
    // Nothing to cut yet: look again when the audio runs out, when a short piece will do.
    if (!cut) {
      if (queued > 0) this.timer = setTimeout(() => this.pump(), queued)
      return
    }
    if ('waitMs' in cut) {
      this.timer = setTimeout(() => this.pump(), cut.waitMs)
      return
    }
    void this.synthesize(reply, cut.text, queued)
  }

  private async synthesize(reply: Reply, text: string, queuedMs: number): Promise<void> {
    this.synthesizing = true
    reply.synthesizing = true
    const seq = reply.sent.length
    const spoken = text.trim()
    const started = this.now()
    let audio: Audio | null = null
    try {
      if (/[\p{L}\p{N}]/u.test(spoken)) audio = await this.synth.synthesize(spoken)
    } catch (err) {
      this.events.debug?.({ type: 'synth-failed', reply: reply.id, text: spoken, error: err instanceof Error ? err.message : String(err) })
    }
    this.synthesizing = false
    reply.synthesizing = false
    const synthMs = this.now() - started
    if (this.replies.includes(reply)) {
      const ms = audio ? (audio.samples.length / audio.sampleRate) * 1000 : 0
      // Text that couldn't be said still counts as gone by, so what was said adds up.
      reply.sent.push({ seq, text, ms, state: audio ? 'queued' : 'played' })
      if (audio) {
        this.learn(spoken.length, synthMs)
        this.events.debug?.({ type: 'synth', reply: reply.id, seq, text: spoken, synthMs, audioMs: ms, queuedMs })
        this.events.audio({ reply: reply.id, seq, text: spoken, ...audio })
      }
      this.settle(reply)
    }
    this.pump()
  }

  private learn(chars: number, ms: number): void {
    if (chars < 20) return
    const perChar = Math.max(1, (ms - this.base) / chars)
    this.perChar += (perChar - this.perChar) * 0.3
  }

  /** Drops a reply once all of it has been played. */
  private settle(reply: Reply): void {
    if (reply.segmenter.finished && !reply.synthesizing && reply.sent.every((s) => s.state === 'played')) {
      this.replies = this.replies.filter((r) => r !== reply)
    }
    this.setTalking()
  }

  private setTalking(): void {
    const talking = this.replies.some((r) => r.sent.some((s) => s.state !== 'queued'))
    if (talking === this.talking) return
    this.talking = talking
    if (!talking) this.duck(false)
    this.events.speaking?.(talking)
  }
}

/** What of a reply has been played: whole pieces, then the words of the playing one heard so far. */
function said(reply: Reply, now: number): string {
  let text = ''
  for (const s of reply.sent) {
    if (s.state === 'played') text += s.text
    else if (s.state === 'playing') {
      const heard = Math.min(1, (now - s.startedAt!) / Math.max(1, s.ms))
      text += wordsUpTo(s.text, heard)
      break
    } else break
  }
  return text
}

/** The words of `text` within the first `fraction` of it, whole words only. */
export function wordsUpTo(text: string, fraction: number): string {
  if (fraction >= 0.97) return text
  const at = Math.floor(text.length * fraction)
  if (/\s/.test(text[at] ?? ' ')) return text.slice(0, at)
  const space = text.lastIndexOf(' ', at)
  return space > 0 ? text.slice(0, space) : ''
}
