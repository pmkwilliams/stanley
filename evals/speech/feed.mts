import { join } from 'node:path'
import { SAMPLE_RATE, Transcriber, type TranscriberEvents, type TranscriberOptions } from '@stanley/stt'

export const MODELS_DIR = join(import.meta.dirname, '..', '..', 'models')

/** 100 ms, the size of the app's mic chunks. */
const CHUNK = SAMPLE_RATE / 10

/** A transcriber that decodes clips as fast as it can and returns the joined segment texts. */
export async function fastTranscriber(opts: Omit<TranscriberOptions, 'modelsDir'>) {
  const segments: string[] = []
  const transcriber = await Transcriber.create(
    { modelsDir: MODELS_DIR, turn: false, ...opts },
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
 * utterance is over: the listener ended it (`ended`), or the transcriber's silence backstop did.
 * When the listener ends it while the clip is still playing, the transcriber is told, as the app
 * does. Returns when the speaker's last word ended.
 */
export async function playRealtime(
  samples: Float32Array,
  events: TranscriberEvents,
  opts: Omit<TranscriberOptions, 'modelsDir'> & { ended?: () => boolean; hotwords?: string[] } = {},
): Promise<{ lastWordAt: number }> {
  let backstop = false
  let lastWordAt = Date.now()
  const { ended: endedByListener = () => false, hotwords = [], ...transcriberOpts } = opts
  const transcriber = await Transcriber.create(
    { modelsDir: MODELS_DIR, ...transcriberOpts },
    {
      ...events,
      speaking: (on) => {
        // Silero reports the end 0.4 s after the last word.
        if (!on) lastWordAt = Date.now() - 400
        events.speaking?.(on)
      },
      silence: () => {
        backstop = true
        events.silence()
      },
    },
  )
  transcriber.reset()
  transcriber.setHotwords(hotwords)
  let told = false
  const tell = () => {
    if (!told && endedByListener()) {
      told = true
      transcriber.endUtterance()
    } else if (!endedByListener()) told = false
  }
  const started = Date.now()
  for (let i = 0; i < samples.length; i += CHUNK) {
    transcriber.accept(samples.subarray(i, i + CHUNK))
    tell()
    await sleepUntil(started + ((i + CHUNK) / SAMPLE_RATE) * 1000)
  }
  const silence = new Float32Array(CHUNK)
  const tailEnd = Date.now() + (opts.silenceMs ?? 4000) + 1500
  while (!backstop && !endedByListener() && Date.now() < tailEnd) {
    transcriber.accept(silence)
    tell()
    await sleep(100)
  }
  await transcriber.flush()
  if (!backstop && !endedByListener()) events.silence()
  return { lastWordAt }
}

function sleepUntil(at: number) {
  return sleep(Math.max(0, at - Date.now()))
}

export function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}
