import { describe, expect, it } from 'vitest'
import { boundaries, Segmenter } from '../src/segment'

/** ~11 ms a character, like Kokoro on 6 threads. */
const estimate = (text: string) => 200 + 11 * text.length

const cut = (s: Segmenter, queuedMs: number) => {
  const next = s.next(queuedMs, estimate)
  return next && 'text' in next ? next.text : next
}

describe('boundaries', () => {
  it('finds sentences and clauses only once whitespace follows', () => {
    const text = 'It costs 3.50 today, I think. Then'
    expect(boundaries(text, false).map((b) => [text.slice(0, b.at), b.kind])).toEqual([
      ['It costs 3.50 today,', 'clause'],
      ['It costs 3.50 today, I think.', 'sentence'],
    ])
  })

  it("doesn't end a sentence at an abbreviation", () => {
    expect(boundaries('Dr. Okonkwo wrote, e.g. this.', true).map((b) => b.kind)).toEqual(['clause', 'sentence'])
  })

  it('ends a clause at a dash and a sentence at a closing quote', () => {
    const text = 'I wrote: "Ramen? Always." The plan—first'
    expect(boundaries(text, false).map((b) => text.slice(0, b.at))).toEqual(['I wrote:', 'I wrote: "Ramen?', 'I wrote: "Ramen? Always."', 'I wrote: "Ramen? Always." The plan—'])
  })

  it('counts the end of complete text', () => {
    expect(boundaries('All done.', false)).toEqual([])
    expect(boundaries('All done.', true)).toEqual([{ at: 9, kind: 'sentence' }])
  })
})

describe('Segmenter', () => {
  it('cuts the first piece at the first sentence, without waiting for more', () => {
    const s = new Segmenter()
    s.set('Sure.')
    expect(cut(s, 0)).toBeNull()
    s.set('Sure. Your next meeting is at three')
    expect(cut(s, 0)).toBe('Sure.')
  })

  it('cuts the first piece at a clause once it has a few words', () => {
    const s = new Segmenter()
    s.set('Okay, so')
    expect(cut(s, 0)).toBeNull()
    s.set("It's going to be sunny in Denver today, with a high")
    expect(cut(s, 0)).toBe("It's going to be sunny in Denver today,")
  })

  it('waits while audio is queued, then cuts the latest sentence that fits', () => {
    const s = new Segmenter()
    s.set('First. Second sentence here. Third one too. And a fourth that is still')
    expect(cut(s, 0)).toBe('First.')
    // Plenty queued: wait, so more text can come.
    const wait = s.next(10_000, estimate)
    expect(wait).toEqual({ waitMs: expect.any(Number) })
    // About to run out: as much as there is, up to the last sentence.
    expect(cut(s, 400)).toBe(' Second sentence here. Third one too.')
  })

  it('takes the rest at once when no more text is coming', () => {
    const s = new Segmenter()
    s.set('One. Two and the rest')
    expect(cut(s, 0)).toBe('One.')
    s.end()
    expect(cut(s, 10_000)).toBe(' Two and the rest')
    expect(s.finished).toBe(true)
  })

  it('never cuts a piece longer than the limit', () => {
    const s = new Segmenter({ maxChars: 40, firstChars: 30, minWords: 3, marginMs: 300 })
    s.set('word '.repeat(30))
    s.end()
    const first = cut(s, 0) as string
    expect(first.length).toBeLessThanOrEqual(40)
    expect(first.endsWith('word')).toBe(true)
  })

  it('cuts a long first sentence between phrases, so the first words come quickly', () => {
    const s = new Segmenter()
    s.set("The Eiffel Tower was built between 1887 and 1889 by Gustave Eiffel's engineering company as the centrepiece of")
    expect(cut(s, 0)).toBe('The Eiffel Tower was built between 1887 and 1889')
    // Not rushed after that: the rest waits for its sentence.
    s.set("The Eiffel Tower was built between 1887 and 1889 by Gustave Eiffel's engineering company as the centrepiece of the fair. It")
    expect(cut(s, 500)).toBe(" by Gustave Eiffel's engineering company as the centrepiece of the fair.")
  })

  it('cuts between words when a long run has no punctuation or phrases', () => {
    const s = new Segmenter()
    s.set('blah '.repeat(30))
    const first = cut(s, 0) as string
    expect(first.length).toBeLessThanOrEqual(60)
    expect(first.endsWith(' ')).toBe(false)
  })

  it('keeps what was already cut when the text changes', () => {
    const s = new Segmenter()
    s.set('Hello there. How are')
    expect(cut(s, 0)).toBe('Hello there.')
    s.set('Hello there! How are you?')
    s.end()
    expect(s.received).toBe('Hello there. How are you?')
    expect(cut(s, 0)).toBe(' How are you?')
  })
})
