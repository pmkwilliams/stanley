/**
 * Replays real decisions from recorded sessions with a different way of asking Jev, to compare
 * against what the app decided at the time. Results are cached per decision, so a re-run only
 * pays for decisions it has not seen.
 *
 *   pnpm eval:replay          # show which decisions would be replayed (runs nothing)
 *   pnpm eval:replay --run    # replay them (paid: one Jev call per uncached decision)
 *
 * Variant "split" (after browser-use/jev-ultrafast): one call with an operation question
 * (wait / stop / navigate / act / fill / …) plus one target question per operation. Only the
 * target matching the chosen operation is used.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { GLOBALS } from '@stanley/agent'
import { chooseMany, type MultiChoiceResult, type Question } from '@stanley/jev'
import { loadEnv } from './harness.mts'

const SESSIONS = join(homedir(), 'Library', 'Application Support', 'Stanley', 'sessions')
const CACHE = join(import.meta.dirname, '.cache', 'replay-split.json')
const run = process.argv.includes('--run')

interface Decision {
  key: string
  transcript: string
  ended: boolean
  state: string
  options: Record<string, string | null>
  choice: string
  probabilities: Record<string, number>
  confidence: number
}

// ── Collect real decisions ────────────────────────────────────────────────

const decisions: Decision[] = []
for (const file of readdirSync(SESSIONS).filter((f) => f.endsWith('.debug.jsonl')).sort()) {
  const events = readFileSync(join(SESSIONS, file), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  if (events.some((e) => e.event.type === 'session-start' && e.event.mock)) continue
  const starts = new Map<number, any>()
  for (const { source, event } of events) {
    if (source !== 'agent') continue
    if (event.type === 'tick-start') starts.set(event.tickId, event)
    if (event.type === 'decision' && event.result) {
      const start = starts.get(event.tickId)
      if (!start) continue
      const t = start.transcript
      decisions.push({
        key: createHash('sha1').update(start.state + JSON.stringify(start.options)).digest('hex').slice(0, 12),
        transcript: [...t.finalized, t.partial].filter(Boolean).join(' '),
        ended: start.utteranceEnded,
        state: start.state,
        options: start.options,
        choice: event.result.choice,
        probabilities: event.result.probabilities,
        confidence: event.result.confidence,
      })
    }
  }
}

// Every unsure action, plus a spread of confident actions and of waits while the user spoke.
const isAction = (d: Decision) => d.choice !== 'wait' && d.choice !== 'stop'
const unique = (list: Decision[]) => [...new Map(list.map((d) => [`${d.transcript}|${d.choice}`, d])).values()]
const spread = (list: Decision[], n: number) => list.filter((_, i) => i % Math.max(1, Math.floor(list.length / n)) === 0).slice(0, n)
const selected = [
  ...unique(decisions.filter((d) => isAction(d) && d.confidence < 0.6)),
  ...spread(unique(decisions.filter((d) => isAction(d) && d.confidence >= 0.9)), 6),
  ...spread(unique(decisions.filter((d) => d.choice === 'wait' && !d.ended && d.transcript)), 6),
]

const cache: Record<string, MultiChoiceResult> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {}
const uncached = selected.filter((d) => !cache[d.key])
if (!run) {
  console.log(`${selected.length} decisions selected from ${decisions.length} real ones; ${uncached.length} not yet replayed.`)
  console.log(`Run with --run to replay them: ${uncached.length} paid Jev calls.`)
  process.exit(0)
}

// ── The split variant ─────────────────────────────────────────────────────

type Operation = 'navigate' | 'act' | 'fill'
const OPERATIONS: Record<Operation, string> = {
  navigate: 'Go to a screen in one of the apps.',
  act: 'Do something on a screen: play, pause, mark done, archive, delete…',
  fill: 'Fill in and submit a field (search, add a task, reply, look up a city), once the user has said what to fill in.',
}

function kindOf(description: string | null): Operation {
  if (description?.startsWith('Go to')) return 'navigate'
  if (description?.startsWith('Fill in')) return 'fill'
  return 'act'
}

function splitQuestions(options: Record<string, string | null>): Record<string, Question> {
  const targets: Partial<Record<Operation, Record<string, string | null>>> = {}
  for (const [name, description] of Object.entries(options)) {
    if (name in GLOBALS) continue
    ;(targets[kindOf(description)] ??= {})[name] = description
  }
  const operation: Record<string, string> = { ...GLOBALS }
  for (const op of Object.keys(targets) as Operation[]) operation[op] = OPERATIONS[op]
  const questions: Record<string, Question> = {
    operation: { instructions: 'Which kind of step best moves toward what the user wants right now?', options: operation },
  }
  for (const [op, opts] of Object.entries(targets)) {
    questions[op] = {
      instructions: `If the next step is to ${op === 'navigate' ? 'go to a screen' : op === 'act' ? 'do something on a screen' : 'fill in a field'}, which option best moves toward what the user wants? Another question decides whether to take this kind of step at all.`,
      options: opts,
    }
  }
  return questions
}

loadEnv()
let calls = 0
let inputTokens = 0
for (const d of uncached) {
  const result = await chooseMany({ state: d.state, questions: splitQuestions(d.options) })
  cache[d.key] = result
  calls++
  inputTokens += result.usage?.inputTokens ?? 0
  mkdirSync(join(import.meta.dirname, '.cache'), { recursive: true })
  writeFileSync(CACHE, JSON.stringify(cache))
  process.stdout.write('.')
}
if (calls) console.log(`\nPaid calls: ${calls} Jev (${inputTokens.toLocaleString()} input tokens)\n`)

// ── Compare ───────────────────────────────────────────────────────────────

/** Total probability of the chosen option and every option on the same route through the tree. */
function routeTotal(d: Decision): number {
  const path = d.choice.split(' › ')
  return Object.entries(d.probabilities)
    .filter(([name]) => {
      const other = name.split(' › ')
      const n = Math.min(path.length, other.length)
      return !(d.choice in GLOBALS) && !(name in GLOBALS) && other.slice(0, n).join() === path.slice(0, n).join()
    })
    .reduce((sum, [, p]) => sum + p, d.choice in GLOBALS ? d.confidence : 0)
}

const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s).padEnd(n)
const pct = (p: number | undefined) => (p === undefined ? '   ' : String(Math.round(p * 100)).padStart(3))
console.log(`${short('said', 38)} ${short('flat choice', 34)} top route │ ${short('split choice', 34)}  op wait target`)
for (const d of selected) {
  const r = cache[d.key]
  if (!r) continue
  const op = r.answers.operation!
  const target = r.answers[op.choice]
  const choice = target ? target.choice : op.choice
  const same = choice === d.choice ? ' ' : '≠'
  console.log(
    `${short(`${d.transcript}${d.ended ? '' : ' …'}`, 38)} ${short(d.choice, 34)} ${pct(d.confidence)} ${pct(routeTotal(d))}   │${same}${short(choice, 34)} ${pct(op.confidence)} ${pct(op.probabilities.wait)} ${pct(target?.confidence)}`,
  )
}
console.log('\n… = user still speaking. op = confidence in the operation, wait = P(wait) from it, target = confidence in the target.')
