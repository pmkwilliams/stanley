import { describe, expect, it } from 'vitest'
import { heardAfter, textAfter } from '../src/index'

// "Add buy eggs. And then," as Parakeet returns it: a leading space starts a word.
const decode = {
  tokens: [' A', 'd', 'd', ' bu', 'y', ' e', 'g', 'g', 's', '.', ' And', ' then', ','],
  timestamps: [0, 0.16, 0.16, 0.32, 0.48, 0.64, 0.72, 0.8, 0.88, 1.2, 2.56, 2.88, 3.12],
}

describe('textAfter', () => {
  it('keeps only words that start after the cut', () => {
    expect(textAfter(decode, 2)).toBe('And then,')
  })

  it('keeps a word whole when only its later tokens fall after the cut', () => {
    expect(textAfter(decode, 0.7)).toBe('And then,')
    expect(textAfter(decode, 0.6)).toBe('eggs. And then,')
  })

  it('returns everything from zero and nothing past the end', () => {
    expect(textAfter(decode, 0)).toBe('Add buy eggs. And then,')
    expect(textAfter(decode, 4)).toBe('')
  })
})

describe('heardAfter', () => {
  it("scores each word by its least likely token, ignoring punctuation", () => {
    const logs = [0, -0.05, 0, Math.log(0.3), 0, 0, 0, 0, Math.log(0.6), Math.log(0.1), 0, 0, 0]
    const heard = heardAfter({ ...decode, ys_log_probs: logs }, 0)
    expect(heard.text).toBe('Add buy eggs. And then,')
    expect(heard.words.map((w) => [w.word, Number(w.confidence.toFixed(2))])).toEqual([
      ['Add', 0.95],
      ['buy', 0.3],
      ['eggs.', 0.6],
      ['And', 1],
      ['then,', 1],
    ])
  })
})
