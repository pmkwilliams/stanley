import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { InferenceSession } from 'onnxruntime-node'

/**
 * Smart Turn v3 (pipecat-ai, BSD-2): whether the speaker has finished their turn, judged from the
 * last 8 s of audio rather than the words. It hears what text can't: a voice that trails off or
 * stays up mid-thought, a filler before more words. A Whisper Tiny encoder with a linear head.
 */
export const SMART_TURN = 'smart-turn-v3.2-cpu.onnx'

const RATE = 16000
const WINDOW_S = 8
const N_FFT = 400
const HOP = 160
const MELS = 80
const FRAMES = (WINDOW_S * RATE) / HOP

export class TurnDetector {
  private constructor(
    private session: InferenceSession,
    private ort: typeof import('onnxruntime-node'),
  ) {}

  static async create(modelsDir: string): Promise<TurnDetector> {
    // CommonJS native addon, loaded lazily so a broken install can't crash startup.
    const ort = createRequire(import.meta.url)('onnxruntime-node') as typeof import('onnxruntime-node')
    const session = await ort.InferenceSession.create(join(modelsDir, SMART_TURN), {
      executionMode: 'sequential',
      interOpNumThreads: 1,
      intraOpNumThreads: 1,
      graphOptimizationLevel: 'all',
    })
    return new TurnDetector(session, ort)
  }

  /** P(the turn is complete) for audio that ends now. Only the last 8 s are heard. */
  async complete(audio: Float32Array): Promise<number> {
    const features = whisperFeatures(audio)
    const out = await this.session.run({ input_features: new this.ort.Tensor('float32', features, [1, MELS, FRAMES]) })
    return (out.logits!.data as Float32Array)[0]!
  }
}

/**
 * Whisper's log-mel input for an 8 s window, as `WhisperFeatureExtractor(chunk_length=8)` computes
 * it with `do_normalize=True`: the last 8 s (zeros in front if shorter), normalized to zero mean
 * and unit variance, then a 400-point STFT every 10 ms, 80 Slaney mel bands, log10, clamped to
 * 8 below the peak and scaled. Row-major [80][800].
 */
export function whisperFeatures(audio: Float32Array): Float32Array {
  const n = WINDOW_S * RATE
  const x = new Float32Array(n)
  const tail = audio.subarray(Math.max(0, audio.length - n))
  x.set(tail, n - tail.length)
  let mean = 0
  for (let i = 0; i < n; i++) mean += x[i]!
  mean /= n
  let variance = 0
  for (let i = 0; i < n; i++) variance += (x[i]! - mean) ** 2
  const scale = 1 / Math.sqrt(variance / n + 1e-7)
  for (let i = 0; i < n; i++) x[i] = (x[i]! - mean) * scale

  // Centred frames: reflect-pad N_FFT/2 on each side.
  const half = N_FFT / 2
  const padded = new Float32Array(n + N_FFT)
  for (let i = 0; i < padded.length; i++) {
    let j = i - half
    if (j < 0) j = -j
    else if (j >= n) j = 2 * (n - 1) - j
    padded[i] = x[j]!
  }

  const { window, filters, fft } = tables()
  const bins = N_FFT / 2 + 1
  const out = new Float32Array(MELS * FRAMES)
  const re = new Float64Array(N_FFT)
  const im = new Float64Array(N_FFT)
  const power = new Float64Array(bins)
  let peak = -Infinity
  for (let f = 0; f < FRAMES; f++) {
    const offset = f * HOP
    for (let i = 0; i < N_FFT; i++) {
      re[i] = padded[offset + i]! * window[i]!
      im[i] = 0
    }
    fft(re, im)
    for (let k = 0; k < bins; k++) power[k] = re[k]! * re[k]! + im[k]! * im[k]!
    for (let m = 0; m < MELS; m++) {
      const row = filters[m]!
      let sum = 0
      for (let k = row.from; k < row.to; k++) sum += row.weights[k - row.from]! * power[k]!
      const v = Math.log10(Math.max(sum, 1e-10))
      out[m * FRAMES + f] = v
      if (v > peak) peak = v
    }
  }
  const floor = peak - 8
  for (let i = 0; i < out.length; i++) out[i] = (Math.max(out[i]!, floor) + 4) / 4
  return out
}

interface Tables {
  window: Float64Array
  /** Each mel band's non-zero weights over FFT bins `from`–`to`. */
  filters: { from: number; to: number; weights: Float64Array }[]
  fft: (re: Float64Array, im: Float64Array) => void
}

let cached: Tables | undefined

function tables(): Tables {
  if (cached) return cached
  // Periodic Hann, as numpy's `window_function(400, "hann")` in transformers.
  const window = new Float64Array(N_FFT)
  for (let i = 0; i < N_FFT; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT)

  // Slaney-scale triangular filters with Slaney area normalization, 0–8000 Hz.
  const bins = N_FFT / 2 + 1
  const toMel = (hz: number) => (hz < 1000 ? (3 * hz) / 200 : 15 + (Math.log(hz / 1000) * 27) / Math.log(6.4))
  const toHz = (mel: number) => (mel < 15 ? (200 * mel) / 3 : 1000 * Math.exp(((mel - 15) * Math.log(6.4)) / 27))
  const top = toMel(RATE / 2)
  const edges = Array.from({ length: MELS + 2 }, (_, i) => toHz((top * i) / (MELS + 1)))
  const fftHz = Array.from({ length: bins }, (_, k) => (k * RATE) / 2 / (bins - 1))
  const filters = Array.from({ length: MELS }, (_, m) => {
    const [lo, mid, hi] = [edges[m]!, edges[m + 1]!, edges[m + 2]!]
    const norm = 2 / (hi - lo)
    const all = fftHz.map((hz) => Math.max(0, Math.min((hz - lo) / (mid - lo), (hi - hz) / (hi - mid))) * norm)
    const from = all.findIndex((w) => w > 0)
    const to = all.length - [...all].reverse().findIndex((w) => w > 0)
    return from === -1 ? { from: 0, to: 0, weights: new Float64Array(0) } : { from, to, weights: Float64Array.from(all.slice(from, to)) }
  })
  cached = { window, filters, fft: mixedRadixFft(N_FFT) }
  return cached
}

/**
 * An in-place complex FFT for any length whose prime factors are small (400 = 2⁴·5²): recursive
 * Cooley–Tukey, a direct DFT of size p at each level.
 */
export function mixedRadixFft(n: number): (re: Float64Array, im: Float64Array) => void {
  const factors: number[] = []
  for (let m = n, p = 2; m > 1; ) {
    if (m % p === 0) {
      factors.push(p)
      m /= p
    } else p++
  }
  const cos = new Float64Array(n)
  const sin = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    cos[i] = Math.cos((-2 * Math.PI * i) / n)
    sin[i] = Math.sin((-2 * Math.PI * i) / n)
  }
  const scratchRe = new Float64Array(n)
  const scratchIm = new Float64Array(n)

  /** FFT of the `size` samples at `inRe[start + k·stride]`, written to `out*` from `at`. */
  const run = (inRe: Float64Array, inIm: Float64Array, start: number, stride: number, size: number, outRe: Float64Array, outIm: Float64Array, at: number, level: number) => {
    if (size === 1) {
      outRe[at] = inRe[start]!
      outIm[at] = inIm[start]!
      return
    }
    const p = factors[level]!
    const m = size / p
    // Sub-FFTs of the p interleaved sequences, side by side.
    for (let r = 0; r < p; r++) run(inRe, inIm, start + r * stride, stride * p, m, outRe, outIm, at + r * m, level + 1)
    // Combine: X[k + q·m] = Σ_r W_size^(r(k + q·m)) · Sub_r[k].
    const twiddle = n / size
    const tRe = new Float64Array(p)
    const tIm = new Float64Array(p)
    for (let k = 0; k < m; k++) {
      for (let r = 0; r < p; r++) {
        tRe[r] = outRe[at + r * m + k]!
        tIm[r] = outIm[at + r * m + k]!
      }
      for (let q = 0; q < p; q++) {
        const kk = k + q * m
        let sr = 0
        let si = 0
        for (let r = 0; r < p; r++) {
          const w = ((r * kk) % size) * twiddle
          sr += tRe[r]! * cos[w]! - tIm[r]! * sin[w]!
          si += tRe[r]! * sin[w]! + tIm[r]! * cos[w]!
        }
        scratchRe[at + kk] = sr
        scratchIm[at + kk] = si
      }
    }
    for (let i = at; i < at + size; i++) {
      outRe[i] = scratchRe[i]!
      outIm[i] = scratchIm[i]!
    }
  }

  const bufRe = new Float64Array(n)
  const bufIm = new Float64Array(n)
  return (re, im) => {
    run(re, im, 0, 1, n, bufRe, bufIm, 0, 0)
    re.set(bufRe)
    im.set(bufIm)
  }
}
