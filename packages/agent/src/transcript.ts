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

/**
 * The words as one run of letters and digits, so the same words read the same however the
 * transcriber punctuated, cased or spaced them: "Lofi Chillout" and "Lo-Fi, chill out".
 */
export function letters(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
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

/**
 * True when more of the words have settled since `seen` and they aren't just the words `seen`
 * already had: the same words settling, finalizing or coming back re-punctuated are nothing new.
 */
export function hasNewWords(current: TranscriptSnapshot, seen: TranscriptSnapshot | null): boolean {
  if (!seen) return stableWords(current).length > 0 || current.finalized.length > 0
  const settled = (t: TranscriptSnapshot) => letters(stableWords(t).join(' ')).length
  return settled(current) > settled(seen) && letters(fullText(current)) !== letters(fullText(seen))
}

/** True when `current` only adds words after all of `seen`'s, its last partial word included. */
export function extendsWords(current: TranscriptSnapshot, seen: TranscriptSnapshot): boolean {
  const a = normalize(fullText(current))
  const b = normalize(fullText(seen))
  return a.length >= b.length && b.every((w, i) => a[i] === w)
}
