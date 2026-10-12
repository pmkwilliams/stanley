import { describe, expect, it } from 'vitest'
import { mixedRadixFft, whisperFeatures } from '../src/turn'

describe('Smart Turn features', () => {
  it('computes the same 400-point FFT as a direct DFT', () => {
    const n = 400
    const x = Array.from({ length: n }, (_, i) => Math.sin(i * 0.37) + 0.5 * Math.cos(i * 1.91) + ((i * 7919) % 13) / 13)
    const re = Float64Array.from(x)
    const im = new Float64Array(n)
    mixedRadixFft(n)(re, im)
    for (const k of [0, 1, 7, 100, 199, 200, 333]) {
      let sr = 0
      let si = 0
      for (let t = 0; t < n; t++) {
        sr += x[t]! * Math.cos((-2 * Math.PI * k * t) / n)
        si += x[t]! * Math.sin((-2 * Math.PI * k * t) / n)
      }
      expect(re[k]).toBeCloseTo(sr, 8)
      expect(im[k]).toBeCloseTo(si, 8)
    }
  })

  it('always gives 80 mel bands × 800 frames in Whisper’s range, padding short audio in front', () => {
    const short = Float32Array.from({ length: 16000 }, (_, i) => Math.sin(i / 10))
    const f = whisperFeatures(short)
    expect(f.length).toBe(80 * 800)
    const max = f.reduce((a, b) => Math.max(a, b), -Infinity)
    const min = f.reduce((a, b) => Math.min(a, b), Infinity)
    // log10 clamped to 8 below the peak, then (x + 4) / 4: a 2-wide range.
    expect(max - min).toBeLessThanOrEqual(2 + 1e-6)
  })
})
