import { readFileSync, writeFileSync } from 'node:fs'

/** Reads a 16-bit PCM mono WAV as float samples. */
export function readWav(file: string): { samples: Float32Array; sampleRate: number } {
  const buf = readFileSync(file)
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${file}: not a WAV file`)
  let offset = 12
  let format: { channels: number; sampleRate: number; bits: number } | null = null
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      format = { channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) }
    } else if (id === 'data') {
      if (!format || format.channels !== 1 || format.bits !== 16) throw new Error(`${file}: expected 16-bit mono PCM`)
      const samples = new Float32Array(Math.min(size, buf.length - body) / 2)
      for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(body + i * 2) / 32768
      return { samples, sampleRate: format.sampleRate }
    }
    offset = body + size + (size % 2)
  }
  throw new Error(`${file}: no audio data`)
}

/** Writes float samples as a 16-bit PCM mono WAV. */
export function writeWav(file: string, samples: Float32Array, sampleRate: number): void {
  const buf = Buffer.alloc(44 + samples.length * 2)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + samples.length * 2, 4)
  buf.write('WAVEfmt ', 8, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(samples.length * 2, 40)
  samples.forEach((s, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), 44 + i * 2))
  writeFileSync(file, buf)
}
