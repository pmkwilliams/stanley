import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Recorded utterances: `<id>.wav` (16 kHz mono) next to `<id>.json`. Not committed. */
export const CLIPS_DIR = join(import.meta.dirname, 'clips')

export interface ClipMeta {
  recordedAt: string
  /** What Stanley transcribed live when the clip was recorded. */
  heard: string
  /** What was actually said. Unlabelled clips are skipped by the evals. */
  expected?: string
  /** Optional: another tool's transcript of the same speech (e.g. Wispr Flow), scored alongside. */
  wispr?: string
  /** Optional: name of a scenario in scenarios.mts whose checks this clip should pass. */
  scenario?: string
}

export interface Clip extends ClipMeta {
  id: string
  wav: string
}

export function listClips(): Clip[] {
  if (!existsSync(CLIPS_DIR)) return []
  return readdirSync(CLIPS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const id = f.slice(0, -5)
      return { id, wav: join(CLIPS_DIR, `${id}.wav`), ...(JSON.parse(readFileSync(join(CLIPS_DIR, f), 'utf8')) as ClipMeta) }
    })
    .filter((c) => existsSync(c.wav))
}

export function saveClip({ id, wav: _, ...meta }: Clip): void {
  writeFileSync(join(CLIPS_DIR, `${id}.json`), JSON.stringify(meta, null, 2) + '\n')
}

export function deleteClip(clip: Clip): void {
  rmSync(clip.wav, { force: true })
  rmSync(join(CLIPS_DIR, `${clip.id}.json`), { force: true })
}
