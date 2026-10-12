/**
 * Cuts text that is still being written into pieces to synthesize. The first piece is short and cut
 * as soon as it can be, so Stanley starts talking quickly: Kokoro takes ~11 ms a character, so a
 * 140-character opening clause kept the user waiting ~3 s. After that nothing is rushed: while audio is
 * playing, text piles up, and the next piece is cut only when the audio queued ahead is about to
 * run out, as large as it can be, at the most natural place. Bigger pieces mean fewer seams.
 */
export interface SegmenterOptions {
  /** Longest piece, in characters: Kokoro reads at most 510 phonemes at once. */
  maxChars: number
  /** The first piece ends within this many characters, at the most natural place there. */
  firstChars: number
  /** A clause or phrase can end the first piece once it has this many words. */
  minWords: number
  /** Synthesis of the next piece starts this long before the audio queued ahead runs out. */
  marginMs: number
}

export const DEFAULT_SEGMENTER: SegmenterOptions = { maxChars: 400, firstChars: 60, minWords: 3, marginMs: 300 }

/** Synthesize `text` now, or ask again in `waitMs`, or (null) wait for more text. */
export type Cut = { text: string } | { waitMs: number } | null

export class Segmenter {
  private text = ''
  /** Characters of `text` already cut. */
  private cut = 0
  private pieces = 0
  private ended = false

  constructor(private readonly opts: SegmenterOptions = DEFAULT_SEGMENTER) {}

  /** The whole text so far. A later version may differ from an earlier one, but only after what was already cut. */
  set(text: string): void {
    this.text = this.text.slice(0, this.cut) + text.slice(this.cut)
  }

  /** No more text is coming. */
  end(): void {
    this.ended = true
  }

  /** All of it has been cut, and no more is coming. */
  get finished(): boolean {
    return this.ended && !/[\p{L}\p{N}]/u.test(this.pending)
  }

  /** The text so far, as cut. */
  get received(): string {
    return this.text
  }

  private get pending(): string {
    return this.text.slice(this.cut)
  }

  /**
   * The next piece to synthesize, given how much audio is queued ahead of it and how long a
   * piece takes to synthesize.
   */
  next(queuedMs: number, estimate: (text: string) => number): Cut {
    const pending = this.pending
    if (!/[\p{L}\p{N}]/u.test(pending)) return null
    // Nothing is playing: the first piece, or the text fell behind the voice. Speak what can be spoken.
    if (this.pieces === 0 || queuedMs <= 0) {
      const end = this.first(pending)
      return end === null ? null : this.take(end)
    }
    const end = this.largest(pending)
    if (end === null) return null
    const need = estimate(pending.slice(0, end).trim()) + this.opts.marginMs
    // Waiting lets more text come, so the piece can be bigger. Once it has all come, there's nothing to wait for.
    if (!this.ended && queuedMs > need) return { waitMs: Math.ceil(queuedMs - need) }
    return this.take(end)
  }

  private take(end: number): Cut {
    const text = this.pending.slice(0, end)
    this.cut += end
    this.pieces++
    return { text }
  }

  /**
   * An early natural end: a sentence or a clause within `firstChars`. A longer opening sentence is
   * cut between phrases ("…built in 1889 | by Gustave Eiffel"), not made to wait for its comma.
   */
  private first(pending: string): number | null {
    const { maxChars, firstChars, minWords } = this.opts
    const soon = Math.min(firstChars, maxChars)
    for (const b of boundaries(pending, this.ended)) {
      if (b.at > soon) break
      if (b.kind === 'sentence' || words(pending.slice(0, b.at)) >= minWords) return b.at
    }
    if (pending.length <= soon) return this.ended ? pending.length : null
    return phraseBreak(pending, soon, minWords) ?? wordBreak(pending, soon)
  }

  /** The latest end that fits: a sentence if there is one, else a clause. */
  private largest(pending: string): number | null {
    const { maxChars } = this.opts
    if (this.ended && pending.length <= maxChars) return pending.length
    const fits = boundaries(pending, this.ended).filter((b) => b.at <= maxChars)
    const end = fits.findLast((b) => b.kind === 'sentence') ?? fits.at(-1)
    if (end) return end.at
    return this.ended || pending.length > maxChars ? wordBreak(pending, maxChars) : null
  }
}

interface Boundary {
  /** Index just after the punctuation (and any closing quote or bracket). */
  at: number
  kind: 'sentence' | 'clause'
}

/** Abbreviations whose full stop doesn't end a sentence. */
const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'jr', 'sr', 'vs', 'etc', 'e.g', 'i.e', 'a.m', 'p.m', 'no', 'inc', 'ltd', 'co', 'mt', 'ft', 'approx'])

/**
 * Where text can be cut. Punctuation counts only once whitespace follows it: until then, "3." may
 * be "3.5". At the end of text that is complete, the end counts too.
 */
export function boundaries(text: string, complete: boolean): Boundary[] {
  const found: Boundary[] = []
  const re = /\n\s*|[.!?…]+["'”’)\]]*(?=\s|$)|[,;:]["'”’)\]]*(?=\s|$)|[—–]|\s-(?=\s)/g
  for (const m of text.matchAll(re)) {
    const at = m.index + m[0].length
    if (at === text.length && !complete) continue
    const mark = m[0]
    if (/^\.["'”’)\]]*$/.test(mark) && ABBREVIATIONS.has(text.slice(0, m.index).match(/([\p{L}.]+)$/u)?.[1]?.toLowerCase() ?? '')) continue
    found.push({ at, kind: /[.!?…\n]/.test(mark) ? 'sentence' : 'clause' })
  }
  return found
}

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/**
 * Words a new phrase starts with, the most natural first. "And" and "or" often join just two
 * words ("1887 and 1889"), so they rank with prepositions.
 */
const PHRASES = [
  /^(but|so|because|which|who|whose|when|while|where|although|though|since|until|unless|if|than|after|before)\b/i,
  /^(and|or|by|for|with|from|in|on|at|to|of|as|about|into|through|over|under|during)\b/i,
]

/** The last break before a new phrase within `max` characters, after at least `minWords` words. */
function phraseBreak(text: string, max: number, minWords: number): number | null {
  for (const phrase of PHRASES) {
    let best: number | null = null
    for (const m of text.slice(0, max + 1).matchAll(/ (?=\S)/g)) {
      if (phrase.test(text.slice(m.index + 1)) && words(text.slice(0, m.index)) >= minWords) best = m.index
    }
    if (best !== null) return best
  }
  return null
}

/** The last break between words at or before `max`, or `max` itself in one long word. */
function wordBreak(text: string, max: number): number {
  if (text.length <= max) return text.length
  const space = text.lastIndexOf(' ', max)
  return space > 0 ? space : max
}
