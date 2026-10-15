import { describe, expect, it } from 'vitest'
import { voiceMayStart } from './duck'

describe('voiceMayStart', () => {
  it('hears a burst of speech through the echo canceller', () => {
    expect([-40, -26, -19].every(voiceMayStart)).toBe(true)
  })

  it('ignores a quiet room and what the canceller leaves of music', () => {
    expect([-62, -59, -52, -48].some(voiceMayStart)).toBe(false)
  })
})
