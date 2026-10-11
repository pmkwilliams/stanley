/**
 * Transcription eval: runs every labelled clip through several decoding strategies and scores
 * each against what was actually said. Local only — costs nothing.
 *
 *   pnpm eval:stt            # all labelled clips
 *   pnpm eval:stt -v         # also print each clip's diff
 *   pnpm eval:stt eggs       # clips whose id or expected text contains a filter
 */
import { readWav, SAMPLE_RATE, transcribe, type TranscriberOptions } from '@stanley/stt'
import { listClips } from './speech/clips.mts'
import { fastTranscriber, MODELS_DIR } from './speech/feed.mts'
import { align, type Alignment } from './speech/wer.mts'

const args = process.argv.slice(2)
const verbose = args.includes('-v')
const filters = args.filter((a) => !a.startsWith('-'))

/** Strategies to compare. The first is what the app ships. */
const STRATEGIES: { name: string; opts: Omit<TranscriberOptions, 'modelsDir'> }[] = [
  { name: 'context', opts: {} },
  { name: 'context-300', opts: { prerollMs: 300 } },
  { name: 'preroll', opts: { contextMs: 0 } },
  { name: 'segment', opts: { contextMs: 0, prerollMs: 0 } },
]

const all = listClips()
const clips = all.filter((c) => c.expected && (!filters.length || filters.some((f) => c.id.includes(f) || c.expected!.includes(f))))
if (!clips.length) {
  const unlabelled = all.filter((c) => !c.expected).length
  console.log(all.length ? `No labelled clips match (${unlabelled} unlabelled — run pnpm clips:label).` : 'No clips yet. See evals/README.md to record some.')
  process.exit(0)
}

const runners = await Promise.all(STRATEGIES.map(async (s) => ({ ...s, run: await fastTranscriber(s.opts) })))
const columns = [...STRATEGIES.map((s) => s.name), 'whole', 'live', 'wispr']
const totals = new Map(columns.map((c) => [c, { errors: 0, length: 0, clips: 0 }]))
let audioS = 0

for (const clip of clips) {
  const { samples, sampleRate } = readWav(clip.wav)
  if (sampleRate !== SAMPLE_RATE) throw new Error(`${clip.id}: ${sampleRate} Hz, expected ${SAMPLE_RATE}`)
  audioS += samples.length / SAMPLE_RATE
  const results = new Map<string, string>()
  for (const r of runners) results.set(r.name, await r.run(samples))
  results.set('whole', await transcribe(MODELS_DIR, samples))
  if (clip.heard) results.set('live', clip.heard)
  if (clip.wispr) results.set('wispr', clip.wispr)

  const scored = new Map<string, Alignment>()
  for (const [name, text] of results) {
    const a = align(clip.expected!, text)
    scored.set(name, a)
    const t = totals.get(name)!
    t.errors += a.errors
    t.length += a.length
    t.clips++
  }
  const marks = columns.map((c) => (scored.has(c) ? String(scored.get(c)!.errors).padStart(c.length) : ' '.repeat(c.length)))
  console.log(`${marks.join('  ')}  ${clip.id}  "${clip.expected}"`)
  if (verbose) {
    for (const [name, a] of scored) if (a.errors) console.log(`${' '.repeat(10)}${name.padEnd(8)} ${a.diff}`)
  }
}

console.log(`\nWord errors per clip above; word error rate over ${clips.length} clips (${audioS.toFixed(0)} s of audio):`)
for (const [name, t] of totals) {
  if (!t.clips) continue
  const wer = t.length ? (100 * t.errors) / t.length : 0
  const note = name === 'whole' ? '  (one pass over the whole clip — the ceiling for this model)' : name === 'live' ? '  (what the app heard when recording)' : ''
  console.log(`  ${name.padEnd(8)} ${wer.toFixed(1).padStart(5)}%  ${t.errors}/${t.length}${t.clips < clips.length ? ` over ${t.clips} clips` : ''}${note}`)
}
