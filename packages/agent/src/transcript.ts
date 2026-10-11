/**
 * Decides whether the transcript has "new words" worth a Jev call.
 *
 * Parakeet re-decodes the whole live segment for every partial, so any of its
 * words can change, the last one most of all. A partial word counts only once
 * it is not the last word and the previous partial had the same words up to it.
 */
export function normalize(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean)
}

export interface TranscriptSnapshot {
  finalized: string[]
  partial: string
  /** The partial before this one in the same segment. */
  previous?: string
}

export function stableWords(t: TranscriptSnapshot): string[] {
  const partial = normalize(t.partial).slice(0, -1)
  const previous = normalize(t.previous ?? '')
  const agreed = partial.findIndex((word, i) => word !== previous[i])
  return [...t.finalized.flatMap(normalize), ...(agreed === -1 ? partial : partial.slice(0, agreed))]
}

export function fullText(t: TranscriptSnapshot): string {
  return [...t.finalized, t.partial].filter(Boolean).join(' ')
}

/** True when the stable prefix grew, or a segment finalized, since `seen`. */
export function hasNewWords(current: TranscriptSnapshot, seen: TranscriptSnapshot | null): boolean {
  if (!seen) return stableWords(current).length > 0 || current.finalized.length > 0
  if (current.finalized.length > seen.finalized.length) return true
  const a = stableWords(current)
  const b = stableWords(seen)
  return a.length > b.length && a.join(' ') !== b.join(' ')
}
