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

  it('fires on finalize', () => {
    expect(hasNewWords({ finalized: ['hi there'], partial: '' }, { finalized: [], partial: 'hi there' })).toBe(true)
  })

  it('needs some stable words on the first call', () => {
    expect(hasNewWords({ finalized: [], partial: 'hi', previous: '' }, null)).toBe(false)
    expect(hasNewWords({ finalized: [], partial: 'hi there', previous: 'hi' }, null)).toBe(true)
  })
})
