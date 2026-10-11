import { describe, expect, it } from 'vitest'
import { align, words } from './wer.mts'

describe('words', () => {
  it('ignores case, punctuation and hyphens', () => {
    expect(words('Add eggs to my To-do list.')).toEqual(['add', 'eggs', 'to', 'my', 'to', 'do', 'list'])
  })

  it('reads number words as digits', () => {
    expect(words("I'll be there at three thirty")).toEqual(words("I'll be there at 3:30"))
    expect(words('twenty five')).toEqual(['25'])
  })
})

describe('align', () => {
  it('counts substitutions, insertions and deletions', () => {
    const a = align('open the email from Priya', 'open email from Korea')
    expect(a).toEqual({ errors: 2, length: 5, diff: 'open [-the] email from [korea→priya]' })
    expect(align('yes', 'yes please')).toEqual({ errors: 1, length: 1, diff: 'yes [+please]' })
  })

  it('scores an exact match as zero', () => {
    expect(align('Yes, the second one.', 'yes the second one').errors).toBe(0)
  })
})
