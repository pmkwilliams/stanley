// Synthesizes the three bundled demo tracks into ../assets as 22050 Hz mono 16-bit WAV.
// Each track is a looped chord progression: an arpeggio over a soft pad and a bass note.
// Run: node packages/app-music/scripts/make-tracks.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RATE = 22050
const SECONDS = 20
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12)

/** Waveforms as small additive harmonic stacks, so nothing aliases at 22 kHz. */
const voices = {
  sine: [1],
  warm: [1, 0.35, 0.12],
  hollow: [1, 0, 0.3, 0, 0.12],
}

function tone(buf, start, dur, midi, amp, harmonics, attack, decay) {
  const f = hz(midi)
  const from = Math.floor(start * RATE)
  const to = Math.min(buf.length, Math.floor((start + dur) * RATE))
  for (let i = from; i < to; i++) {
    const t = (i - from) / RATE
    const env = Math.min(1, t / attack) * Math.exp(-t / decay) * Math.min(1, (to - i) / (RATE * 0.02))
    let s = 0
    for (let h = 0; h < harmonics.length; h++) s += harmonics[h] * Math.sin(2 * Math.PI * f * (h + 1) * t)
    buf[i] += amp * env * s
  }
}

/**
 * chords: arrays of MIDI notes (root first); pattern: indices into the chord (+12 per wrap);
 * steps: arpeggio notes per chord.
 */
function render({ bpm, chords, pattern, steps, voice, decay }) {
  const buf = new Float32Array(RATE * SECONDS)
  const step = 60 / bpm / (steps / 4)
  const bar = step * steps
  for (let c = 0, t = 0; t < SECONDS; c++, t += bar) {
    const chord = chords[c % chords.length]
    // Pad: the whole chord, slow attack, sustained for the bar.
    for (const n of chord) tone(buf, t, bar + 0.3, n - 12, 0.05, voices.sine, 0.4, bar * 1.5)
    // Bass: root two octaves down on the downbeat.
    tone(buf, t, bar, chord[0] - 24, 0.22, voices.warm, 0.01, bar * 0.6)
    // Arpeggio.
    for (let k = 0; k < steps; k++) {
      const idx = pattern[k % pattern.length]
      const note = chord[idx % chord.length] + 12 * Math.floor(idx / chord.length)
      tone(buf, t + k * step, step * 3, note, 0.18, voices[voice], 0.005, decay)
    }
  }
  // Fade in/out and normalise to -2 dBFS.
  const fade = RATE * 0.6
  let peak = 0
  for (let i = 0; i < buf.length; i++) {
    buf[i] *= Math.min(1, i / fade, (buf.length - i) / fade)
    peak = Math.max(peak, Math.abs(buf[i]))
  }
  const gain = 0.8 / peak
  const pcm = Buffer.alloc(buf.length * 2)
  for (let i = 0; i < buf.length; i++) pcm.writeInt16LE(Math.round(buf[i] * gain * 32767), i * 2)
  return pcm
}

function wav(pcm) {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + pcm.length, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16) // fmt chunk size
  h.writeUInt16LE(1, 20) // PCM
  h.writeUInt16LE(1, 22) // mono
  h.writeUInt32LE(RATE, 24)
  h.writeUInt32LE(RATE * 2, 28) // byte rate
  h.writeUInt16LE(2, 32) // block align
  h.writeUInt16LE(16, 34) // bits per sample
  h.write('data', 36)
  h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

const tracks = {
  // C major, I–V–vi–IV, bright and plucky.
  sunrise: {
    bpm: 104,
    chords: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]],
    pattern: [0, 1, 2, 3, 4, 3, 2, 1],
    steps: 8,
    voice: 'warm',
    decay: 0.35,
  },
  // D minor, i–VI–III–VII, slow and spacious.
  drift: {
    bpm: 72,
    chords: [[62, 65, 69], [58, 62, 65], [53, 57, 60], [60, 64, 67]],
    pattern: [0, 2, 4, 2, 1, 3, 5, 3],
    steps: 8,
    voice: 'sine',
    decay: 0.8,
  },
  // A minor, i–VI–III–VII, quick sixteenth-note pulse.
  pulse: {
    bpm: 118,
    chords: [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]],
    pattern: [0, 1, 2, 1, 3, 2, 4, 2],
    steps: 16,
    voice: 'hollow',
    decay: 0.18,
  },
}

mkdirSync(out, { recursive: true })
for (const [key, spec] of Object.entries(tracks)) {
  const file = join(out, `${key}.wav`)
  writeFileSync(file, wav(render(spec)))
  console.log(`wrote ${file}`)
}
