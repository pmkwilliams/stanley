import { join } from 'node:path'
import type { Audio, Synth } from './speaker'

export const KOKORO = 'kokoro-multi-lang-v1_0'

/** Kokoro v1.0's voices, in speaker-id order. `af_heart` is the one its authors rate best. */
export const VOICES = [
  'af_alloy', 'af_aoede', 'af_bella', 'af_heart', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky',
  'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'am_santa',
  'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily', 'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis',
] as const

export interface KokoroOptions {
  /** One of `VOICES`. */
  voice?: string
  speed?: number
  /** On an M1 Pro, 6 threads synthesize at ~0.23× real time, 2 at ~0.55×. */
  threads?: number
}

interface OfflineTts {
  generateAsync(req: { text: string; sid: number; speed: number; enableExternalBuffer: boolean }): Promise<Audio>
}

interface SherpaTts {
  OfflineTts: { createAsync(config: unknown): Promise<OfflineTts> }
}

/** Kokoro 82M through sherpa-onnx, English only. Warmed up before it's returned: the first call is slow. */
export async function loadKokoro(modelsDir: string, opts: KokoroOptions = {}): Promise<Synth> {
  const dir = join(modelsDir, KOKORO)
  // A native addon, loaded lazily. Imported by name: the speech recognizer declares its types, for its own parts.
  const name = 'sherpa-onnx-node'
  const mod: unknown = await import(/* @vite-ignore */ name)
  const sherpa = ((mod as { default?: unknown }).default ?? mod) as SherpaTts
  const tts = await sherpa.OfflineTts.createAsync({
    model: {
      kokoro: {
        model: join(dir, 'model.onnx'),
        voices: join(dir, 'voices.bin'),
        tokens: join(dir, 'tokens.txt'),
        dataDir: join(dir, 'espeak-ng-data'),
        lexicon: join(dir, 'lexicon-us-en.txt'),
        lang: 'en-us',
      },
      numThreads: opts.threads ?? 6,
      provider: 'cpu',
    },
    maxNumSentences: 1,
  })
  const voice = opts.voice ?? 'af_heart'
  const sid = VOICES.indexOf(voice as (typeof VOICES)[number])
  if (sid === -1) throw new Error(`Unknown Kokoro voice "${voice}". Voices: ${VOICES.join(', ')}`)
  const speed = opts.speed ?? 1
  // Electron doesn't allow buffers backed by native memory, so the audio is copied out.
  const synth: Synth = { synthesize: (text) => tts.generateAsync({ text, sid, speed, enableExternalBuffer: false }) }
  await synth.synthesize('Ready.')
  return synth
}
