const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/**
 * Lowercase words with punctuation and hyphens dropped, so "To-do." matches "to do", and number
 * words as digits, so "three thirty" matches "3:30" (both become "3 30").
 */
export function words(text: string): string[] {
  const raw = text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean)
  const out: string[] = []
  for (let i = 0; i < raw.length; i++) {
    const tens = TENS.indexOf(raw[i]!)
    const unit = UNITS.indexOf(raw[i + 1] ?? '')
    if (tens >= 2 && unit >= 1 && unit <= 9) out.push(String(tens * 10 + unit)), i++
    else if (tens >= 2) out.push(String(tens * 10))
    else if (UNITS.includes(raw[i]!)) out.push(String(UNITS.indexOf(raw[i]!)))
    else out.push(raw[i]!)
  }
  return out
}

export interface Alignment {
  errors: number
  /** Reference length in words. */
  length: number
  /** The hypothesis with mistakes marked: [heard→expected], [+inserted], [-missing]. */
  diff: string
}

/** Word-level edit distance between what was expected and what was heard. */
export function align(expected: string, heard: string): Alignment {
  const ref = words(expected)
  const hyp = words(heard)
  const d = Array.from({ length: ref.length + 1 }, (_, i) => Array.from({ length: hyp.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= ref.length; i++) {
    for (let j = 1; j <= hyp.length; j++) {
      const sub = d[i - 1]![j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1)
      d[i]![j] = Math.min(sub, d[i - 1]![j]! + 1, d[i]![j - 1]! + 1)
    }
  }
  const out: string[] = []
  let i = ref.length
  let j = hyp.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i]![j] === d[i - 1]![j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      out.push(ref[i - 1] === hyp[j - 1] ? hyp[j - 1]! : `[${hyp[j - 1]}→${ref[i - 1]}]`)
      i--
      j--
    } else if (j > 0 && d[i]![j] === d[i]![j - 1]! + 1) {
      out.push(`[+${hyp[--j]}]`)
    } else {
      out.push(`[-${ref[--i]}]`)
    }
  }
  return { errors: d[ref.length]![hyp.length]!, length: ref.length, diff: out.reverse().join(' ') }
}
