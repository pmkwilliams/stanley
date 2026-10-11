import { join } from 'node:path'
import { SAMPLE_RATE, Transcriber, type TranscriberEvents, type TranscriberOptions } from '@stanley/stt'

export const MODELS_DIR = join(import.meta.dirname, '..', '..', 'models')

/** 100 ms, the size of the app's mic chunks. */
const CHUNK = SAMPLE_RATE / 10

/** A transcriber that decodes clips as fast as it can and returns the joined segment texts. */
export async function fastTranscriber(opts: Omit<TranscriberOptions, 'modelsDir'>) {
  const segments: string[] = []
  const transcriber = await Transcriber.create(
    { modelsDir: MODELS_DIR, ...opts },
    { partial: () => {}, segment: (t) => segments.push(t), silence: () => {} },
  )
  return async (samples: Float32Array): Promise<string> => {
    segments.length = 0
    transcriber.reset()
    for (let i = 0; i < samples.length; i += CHUNK) transcriber.accept(samples.subarray(i, i + CHUNK))
    await transcriber.flush()
    return segments.join(' ')
  }
}

/**
 * Plays a clip into a transcriber at real speed, as the mic would, then feeds silence until the
 * transcriber reports the utterance over (or `tailMs` passes).
 */
export async function playRealtime(samples: Float32Array, events: TranscriberEvents, opts: Omit<TranscriberOptions, 'modelsDir'> = {}): Promise<void> {
  let ended = false
  const transcriber = await Transcriber.create(
    { modelsDir: MODELS_DIR, ...opts },
    {
      ...events,
      silence: () => {
        ended = true
        events.silence()
      },
    },
  )
  transcriber.reset()
  const started = Date.now()
  for (let i = 0; i < samples.length; i += CHUNK) {
    transcriber.accept(samples.subarray(i, i + CHUNK))
    await sleepUntil(started + ((i + CHUNK) / SAMPLE_RATE) * 1000)
  }
  const silence = new Float32Array(CHUNK)
  const tailEnd = Date.now() + (opts.silenceMs ?? 2000) + 1500
  while (!ended && Date.now() < tailEnd) {
    transcriber.accept(silence)
    await sleep(100)
  }
  await transcriber.flush()
  if (!ended) events.silence()
}

function sleepUntil(at: number) {
  return sleep(Math.max(0, at - Date.now()))
}

export function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}
