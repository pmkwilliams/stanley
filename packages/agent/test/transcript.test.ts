import { describe, expect, it } from 'vitest'
import { hasNewWords } from '../src/transcript'

describe('hasNewWords', () => {
  it('ignores the volatile last word', () => {
    expect(hasNewWords({ finalized: [], partial: 'whats the' }, { finalized: [], partial: 'whats' })).toBe(true)
    expect(hasNewWords({ finalized: [], partial: 'whats the weath' }, { finalized: [], partial: 'whats the' })).toBe(true)
    expect(hasNewWords({ finalized: [], partial: 'whats the weather' }, { finalized: [], partial: 'whats the whether' })).toBe(false)
  })

  it('fires on finalize', () => {
    expect(hasNewWords({ finalized: ['hi there'], partial: '' }, { finalized: [], partial: 'hi there' })).toBe(true)
  })

  it('needs some stable words on the first call', () => {
    expect(hasNewWords({ finalized: [], partial: 'hi' }, null)).toBe(false)
    expect(hasNewWords({ finalized: [], partial: 'hi there' }, null)).toBe(true)
  })
})
