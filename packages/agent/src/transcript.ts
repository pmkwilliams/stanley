/**
 * Decides whether the transcript has "new words" worth a Jev call.
 *
 * Parakeet partials are re-decoded, so the last word of the live segment is
 * volatile. We compare everything except that word.
 */
export function normalize(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean)
}

export interface TranscriptSnapshot {
  finalized: string[]
  partial: string
}

export function stableWords(t: TranscriptSnapshot): string[] {
  const partial = normalize(t.partial)
  return [...t.finalized.flatMap(normalize), ...partial.slice(0, -1)]
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
