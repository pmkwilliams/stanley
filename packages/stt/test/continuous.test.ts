import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readWav, SAMPLE_RATE, Transcriber, type SttDebugEvent } from '../src'

const MODELS = join(import.meta.dirname, '..', '..', '..', 'models')
const PHRASES = ['Add a new to do.', "Book doctor's appointment.", 'Mark buy oat milk as done.', 'Send it.']

/**
 * The mic stays open across utterances, so silence between them reaches the transcriber. Each
 * utterance must be decoded, and judged by Smart Turn, on its own speech: long silence or the
 * previous utterance in the window garbles both. Needs the models and macOS `say`.
 */
describe.skipIf(process.platform !== 'darwin' || !existsSync(join(MODELS, 'silero_vad.onnx')))('Transcriber with the mic open across utterances', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stanley-stt-'))
  const clips = PHRASES.map((text, i) => {
    const wav = join(dir, `${i}.wav`)
    execFileSync('say', ['-o', wav, '--file-format=WAVE', '--data-format=LEI16@16000', text])
    return readWav(wav).samples
  })

  for (const ending of ['the listener', 'the silence backstop'] as const) {
    it(`decodes each utterance without the silence before it, when ${ending} ends them`, async () => {
      const segments: string[] = []
      const decodes: number[] = []
      const turns: number[] = []
      const transcriber = await Transcriber.create(
        // A 0 ms backstop fires as soon as speech stops, since audio is fed faster than real time.
        { modelsDir: MODELS, silenceMs: ending === 'the silence backstop' ? 0 : 60_000 },
        {
          partial: () => {},
          segment: (t) => segments.push(t),
          silence: () => {},
          pause: () => {},
          debug: (e: SttDebugEvent) => {
            if (e.type === 'decode' && e.kind === 'segment') decodes.push(e.audioMs)
            if (e.type === 'turn') turns.push(e.audioMs)
          },
        },
      )
      transcriber.reset()
      const feed = (samples: Float32Array) => {
        for (let i = 0; i < samples.length; i += 1600) transcriber.accept(samples.subarray(i, i + 1600))
      }
      const gap = new Float32Array(7 * SAMPLE_RATE)
      for (const clip of clips) {
        feed(clip)
        feed(new Float32Array(SAMPLE_RATE))
        await new Promise((r) => setTimeout(r, 300))
        if (ending === 'the listener') transcriber.endUtterance()
        feed(gap)
      }
      await transcriber.flush()
      await new Promise((r) => setTimeout(r, 300))

      const words = (t: string) => t.toLowerCase().replace(/[^a-z' ]/g, '').trim()
      expect(segments).toHaveLength(PHRASES.length)
      expect(words(segments.join(' '))).toContain("book doctor's appointment")
      expect(words(segments.at(-1)!)).toBe('send it')
      // Each phrase is under 2.5 s; with the 7 s gaps in the window decodes ran 7–11 s.
      for (const ms of decodes) expect(ms).toBeLessThan(3500)
      for (const ms of turns) expect(ms).toBeLessThan(3500)
    }, 60_000)
  }
})

describe.skipIf(process.platform !== 'darwin' || !existsSync(join(MODELS, 'silero_vad.onnx')))('Transcriber hotwords', () => {
  it('hears a name on screen instead of a sound-alike, and leaves common words alone', async () => {
    const wav = join(mkdtempSync(join(tmpdir(), 'stanley-stt-')), 'names.wav')
    execFileSync('say', ['-o', wav, '--file-format=WAVE', '--data-format=LEI16@16000', 'Reply to Siobhan about the Okonkwo invoice.'])
    const audio = readWav(wav).samples
    const hear = async (hotwords: string[]) => {
      const segments: string[] = []
      const t = await Transcriber.create({ modelsDir: MODELS, turn: false }, { partial: () => {}, segment: (s) => segments.push(s), silence: () => {} })
      t.reset()
      t.setHotwords(hotwords)
      for (let i = 0; i < audio.length; i += 1600) t.accept(audio.subarray(i, i + 1600))
      t.accept(new Float32Array(SAMPLE_RATE))
      await t.flush()
      return segments.join(' ')
    }
    expect(await hear([])).not.toContain('Okonkwo')
    // Common words on screen ("Reply", "Archive") are dropped: favouring them distorts.
    const biased = await hear(['Reply', 'Archive', 'Inbox', 'Send', 'Siobhan', 'Okonkwo', 'Priya'])
    expect(biased).toContain('Okonkwo')
    expect(biased).toMatch(/^Reply to Siobhan/)
  }, 60_000)
})
