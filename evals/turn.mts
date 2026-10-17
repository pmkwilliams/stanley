/**
 * Turn-detection eval on LiveKit's end-of-turn benchmark (CC-BY-4.0): 400 real English user turns
 * spoken to voice agents, with every pause marked. The last pause in each clip is where the user
 * really finished; every earlier one is a pause the agent should wait through.
 *
 *   pnpm eval:turn               # Smart Turn on every pause (free, local)
 *   pnpm eval:turn --jev 60      # also Jev's "has the user finished?" on the first 60 clips (paid)
 *   pnpm eval:turn --limit 100   # fewer clips
 *
 * Only pauses our VAD would report (≥ 0.4 s, it waits that long) need a decision. For each, it
 * replays the agent's endpoint rule (config `finished` and `endpoint`) and reports how often a
 * mid-thought pause would have ended the turn (a cut-in), and how long a real end takes to be
 * called. The old fixed 2 s silence is the baseline. The words come from the dataset's
 * timestamps, not our transcriber, and the conversation is customer service, not app commands,
 * so this measures the turn signals, not the whole agent.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { defaultConfig, HEARD, HEARD_INSTRUCTIONS } from '@stanley/agent'
import { createDecisionClient } from '@stanley/jev'
import { parseWav, TurnDetector } from '@stanley/stt'
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet'
import { flag, loadEnv } from './harness.mts'
import { MODELS_DIR } from './speech/feed.mts'

const URL = 'https://huggingface.co/datasets/livekit/eot-bench-data/resolve/main/data/en/validation-00000-of-00001.parquet'
const CACHE = join(import.meta.dirname, '.cache')
const FILE = join(CACHE, 'eot-bench-en.parquet')
/** Silero reports a pause this long after the last word; Smart Turn adds ~0.1 s. */
const VAD_S = 0.4
const JUDGE_S = 0.1

interface Row {
  id: string
  audio: { bytes: Uint8Array }
  silence_spans: { start: number; end: number }[]
  words: { start: number; end: number; word: string }[]
  messages: { role: string; content: string }[]
}

interface Pause {
  clip: number
  final: boolean
  /** Seconds the user stayed quiet. */
  length: number
  voice: number
  heard: number | null
  text: string
}

if (!existsSync(FILE)) {
  mkdirSync(CACHE, { recursive: true })
  console.log('Downloading the LiveKit EoT benchmark, English (~160 MB)…')
  execFileSync('curl', ['-fL', '-o', FILE, URL], { stdio: 'inherit' })
}

const limit = flag('limit', 400)
const jevClips = flag('jev', 0)
if (jevClips) loadEnv()
const jev = jevClips ? createDecisionClient() : null
const detector = await TurnDetector.create(MODELS_DIR)
const rows = (await parquetReadObjects({ file: await asyncBufferFromFile(FILE), columns: ['id', 'audio', 'silence_spans', 'words', 'messages'], rowEnd: limit, utf8: false })) as Row[]

const pauses: Pause[] = []
let jevCalls = 0
for (const [i, row] of rows.entries()) {
  const { samples } = parseWav(Buffer.from(row.audio.bytes))
  const spans = row.silence_spans
  for (const [j, span] of spans.entries()) {
    const final = j === spans.length - 1
    const length = span.end - span.start
    if (!final && length < VAD_S) continue
    // What the pipeline has when the pause is reported: audio up to then, words before it.
    const at = Math.min(samples.length, Math.round((span.start + VAD_S) * 16000))
    const voice = await detector.complete(samples.subarray(0, at))
    const text = row.words.filter((w) => w.end <= span.start + 0.05).map((w) => w.word).join(' ')
    // No words yet: nothing has been said, so nothing is finished.
    let heard: number | null = jev && i < jevClips && !text ? 0 : null
    if (jev && i < jevClips && text) {
      jevCalls++
      const history = row.messages.map((m) => `${m.role === 'user' ? 'User' : 'You said'}: ${m.content}`).join('\n')
      const state = `## Conversation\n${history}\nUser (still speaking): ${text}`
      const answer = await jev.choose({ state, instructions: HEARD_INSTRUCTIONS, options: HEARD })
      heard = answer.probabilities.finished ?? (answer.choice === 'finished' ? answer.confidence : 1 - answer.confidence)
    }
    pauses.push({ clip: i, final, length, voice, heard, text })
  }
  if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${rows.length} clips`)
}

type Policy = { name: string; delay: (p: Pause) => number | null }
const { finished: f, endpoint: e } = defaultConfig

/** The agent's rule (Agent.scheduleEnd): seconds after the pause is reported until the turn ends. */
const agentRule = (useVoice: boolean, useWords: boolean) => (p: Pause) => {
  const heard = useWords ? p.heard : null
  const voice = useVoice ? p.voice : null
  if (useWords && heard === null) return null
  const more = (heard !== null && heard < e.moreBelow) || (voice !== null && voice < e.moreBelow)
  const done = voice !== null ? (heard ?? f.heard) >= f.heard && voice >= f.voice : heard !== null && heard >= f.heardAlone
  return (more ? e.slowMs : done ? e.fastMs : e.normalMs) / 1000
}

const policies: Policy[] = [
  { name: 'fixed 2 s silence (before)', delay: () => 2 - VAD_S - JUDGE_S },
  { name: 'voice (Smart Turn)', delay: agentRule(true, false) },
  ...(jevClips ? [{ name: 'words (Jev)', delay: agentRule(false, true) }, { name: 'voice + words (shipped)', delay: agentRule(true, true) }] : []),
]

// With Jev, every policy is scored on the clips Jev judged, so they compare like for like.
const scoped = jevClips ? pauses.filter((p) => p.clip < jevClips) : pauses
console.log(`\n${pauses.filter((p) => p.final).length} turn ends, ${pauses.filter((p) => !p.final).length} pauses mid-turn (≥ ${VAD_S} s) in ${rows.length} clips`)
console.log(`Smart Turn alone at 0.5: ${accuracy(pauses, (p) => p.voice >= 0.5)}`)
if (jevClips) {
  const judged = pauses.filter((p) => p.heard !== null)
  console.log(`Jev alone at ${f.heard}: ${accuracy(judged, (p) => p.heard! >= f.heard)} (${judged.length} pauses)`)
  console.log(`Both ("thought finished"): ${accuracy(judged, (p) => p.heard! >= f.heard && p.voice >= f.voice)}`)
}

console.log('\npolicy                           cut-ins            end called after (p50 / p90)')
for (const policy of policies) {
  const mid = scoped.filter((p) => !p.final)
  // A cut-in: the user was still quiet when the turn was called, though they had more to say.
  const cutIns = mid.filter((p) => p.length > VAD_S + JUDGE_S + policy.delay(p)!).length
  const ends = scoped.filter((p) => p.final).map((p) => VAD_S + JUDGE_S + policy.delay(p)!)
  console.log(`${policy.name.padEnd(32)} ${`${cutIns}/${mid.length} (${pct(cutIns, mid.length)})`.padEnd(18)} ${quantile(ends, 0.5).toFixed(2)} s / ${quantile(ends, 0.9).toFixed(2)} s`)
}
if (jevClips) console.log(`\nPaid calls: ${jevCalls} Jev`)

function accuracy(ps: Pause[], says: (p: Pause) => boolean): string {
  const ends = ps.filter((p) => p.final)
  const mids = ps.filter((p) => !p.final)
  return `${pct(ends.filter(says).length, ends.length)} of real ends called finished, ${pct(mids.filter(says).length, mids.length)} of mid-turn pauses wrongly called finished`
}

function pct(n: number, of: number): string {
  return of ? `${Math.round((n / of) * 100)}%` : '—'
}

function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!
}
