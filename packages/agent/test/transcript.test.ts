import { describe, expect, it } from 'vitest'
import { hasNewWords, stableWords } from '../src/transcript'

describe('stableWords', () => {
  it('counts a partial word once it is not last and the previous partial agreed up to it', () => {
    expect(stableWords({ finalized: [], partial: 'whats the weath', previous: 'whats the' })).toEqual(['whats', 'the'])
    expect(stableWords({ finalized: [], partial: 'whats the weath', previous: '' })).toEqual([])
  })

  it('stops at the first word the re-decode changed', () => {
    expect(stableWords({ finalized: [], partial: 'fly reply to mom', previous: 'flight reply to' })).toEqual([])
    expect(stableWords({ finalized: [], partial: 'add buy eggs to', previous: 'add by eggs' })).toEqual(['add'])
  })

  it('always counts finalized segments', () => {
    expect(stableWords({ finalized: ['open my email'], partial: 'the', previous: '' })).toEqual(['open', 'my', 'email'])
  })
})

describe('hasNewWords', () => {
  it('fires when agreed words grow, not on the volatile tail', () => {
    expect(hasNewWords({ finalized: [], partial: 'whats the weath', previous: 'whats the' }, { finalized: [], partial: 'whats the', previous: 'whats' })).toBe(true)
    expect(hasNewWords({ finalized: [], partial: 'whats the weather', previous: 'whats the whether' }, { finalized: [], partial: 'whats the whether', previous: 'whats the' })).toBe(false)
  })

  it('does not fire on words the re-decode is still changing', () => {
    expect(hasNewWords({ finalized: [], partial: 'by eggs to my', previous: 'buy eggs to' }, null)).toBe(false)
  })

  it('fires when a segment finalizes with words that were not read', () => {
    expect(hasNewWords({ finalized: ['add buy eggs'], partial: '' }, { finalized: [], partial: 'add buy eg', previous: 'add buy' })).toBe(true)
  })

  it('does not fire when the same words settle, finalize or come back re-punctuated', () => {
    // As in a session: the words were read with marks, decoded again, then finalized as other tokens.
    const read = { finalized: [], partial: 'Play Lofi Chillout and go to my Email.', previous: 'Play Lofi Chillout and' }
    expect(hasNewWords({ finalized: [], partial: 'Play Lofi Chillout and go to my Email.', previous: 'Play Lofi Chillout and go to my Email.' }, read)).toBe(false)
    expect(hasNewWords({ finalized: ['Play Lo-Fi, chill out, and go to my email.'], partial: '' }, read)).toBe(false)
    expect(hasNewWords({ finalized: ['hi there'], partial: '' }, { finalized: [], partial: 'hi there' })).toBe(false)
  })

  it('needs some stable words on the first call', () => {
    expect(hasNewWords({ finalized: [], partial: 'hi', previous: '' }, null)).toBe(false)
    expect(hasNewWords({ finalized: [], partial: 'hi there', previous: 'hi' }, null)).toBe(true)
  })
})
