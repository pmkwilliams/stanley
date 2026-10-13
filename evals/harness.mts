import { cpSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent, createThinker, defaultConfig, type AgentDeps, type FileTools, type Thinker, type TickReport, type WebTools, type World } from '@stanley/agent'
import { parallelWeb } from '@stanley/app-web/parallel'
import { localFiles } from '@stanley/files'
import { createJevClient, type DecisionClient } from '@stanley/jev'
import { Shell } from '../apps/desktop/src/main/shell'
import { apps } from '../apps/desktop/src/main/apps'
import type { Check, Scenario } from './scenarios.mts'

/** The agent counts as settled once it has been idle (not thinking/acting) this long. */
const QUIET_MS = 500
const MAX_SETTLE_MS = 120_000
/** A `|` in a typed utterance: the user pauses mid-thought this long. */
export const PAUSE_MS = 800
/** The transcriber ends an utterance after this much silence if the agent hasn't. */
const SILENCE_BACKSTOP_MS = 4000

/** Paid model calls, so every run says what it spent. */
export const usage = {
  jev: 0,
  jevInputTokens: 0,
  jevMs: [] as number[],
  thinking: 0,
  writing: 0,
  confirming: 0,
  /** Thinking's input tokens, all calls and steps together, and how many of them were read from the cache. */
  thinkingInputTokens: 0,
  thinkingCachedTokens: 0,
  /** The largest input one thinking call (one step) was sent. */
  largestThinkingInput: 0,
  /** Writes and confirms that chose something else, and so handed over to a whole turn, and what they chose. */
  singleFallbacks: 0,
  fallbacks: [] as string[],
  searches: 0,
  reads: 0,
}

export function loadEnv() {
  const envFile = join(import.meta.dirname, '..', '.env')
  if (existsSync(envFile)) process.loadEnvFile(envFile)
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error('AI_GATEWAY_API_KEY not set')
}

/**
 * Agent evals cost money, so a bare run lists what it would do instead of doing it.
 * Returns the selected items, or null after printing the list.
 */
export function select<T>(items: T[], name: (t: T) => string, command: string): T[] | null {
  const args = process.argv.slice(2)
  const filters = args.filter((a, i) => !a.startsWith('-') && !/^--(runs|concurrency|jev-turns)$/.test(args[i - 1] ?? ''))
  if (!filters.length && !args.includes('--all')) {
    console.log(`${items.length} available — each makes several paid Jev/Sonnet calls:`)
    for (const t of items) console.log(`  ${name(t)}`)
    console.log(`\nRun some:  ${command} <filter...>\nRun all:   ${command} --all`)
    return null
  }
  return items.filter((t) => !filters.length || filters.some((f) => name(t).includes(f)))
}

export function printUsage() {
  const ratio = usage.thinkingInputTokens ? `${Math.round((usage.thinkingCachedTokens / usage.thinkingInputTokens) * 100)}%` : '—'
  console.log(`Paid calls: ${usage.jev} Jev (${usage.jevInputTokens.toLocaleString()} input tokens, p50 ${median(usage.jevMs)}s), ${usage.thinking} thinking turns, ${usage.writing} writes, ${usage.confirming} confirms (${usage.singleFallbacks} handed over to a whole turn) (Sonnet: ${usage.thinkingInputTokens.toLocaleString()} input tokens, ${ratio} read from cache, largest call ${usage.largestThinkingInput.toLocaleString()}), ${usage.searches} searches, ${usage.reads} page reads (Parallel)`)
  for (const f of usage.fallbacks) console.log(`  handed over: ${f}`)
}

export interface ScenarioResult {
  ok: boolean
  failures: string[]
  ticks: TickReport[]
  said: string[]
  /** Per utterance: ms from the user's last word until the agent went quiet. */
  settleMs: number[]
  /** Per utterance: ms from the user's last word until the agent ended their turn. */
  endMs: number[]
  /** Times the agent ended the user's turn while they were only pausing mid-thought. */
  cutIns: number
  /** The context Jev would read at the end, for reading what happened. */
  trace: string
  /** Thinking's input over the run: all of it, what was read from the cache, and the largest call. */
  thinking: { inputTokens: number; cachedTokens: number; largestInput: number }
}

/**
 * Runs one scenario with real apps and models. `speak` delivers each utterance to the agent
 * (typed words or played audio) and resolves once the utterance has ended.
 */
export async function runScenario(scenario: Scenario, speak: Speak): Promise<ScenarioResult> {
  const shell = new Shell(apps, { env: process.env, fetch }, () => {})
  const { files, root } = fixtureFiles()
  const run = await drive(shell, scenario.utterances, speak, files)
  const failures = [...run.turnFailures, ...scenario.checks.map((c: Check) => c(shell, run.agent, root)).filter((r): r is string => typeof r === 'string')]
  const t = run.result.thinking
  if (scenario.cache && t.inputTokens && t.cachedTokens / t.inputTokens < scenario.cache.minReadRatio) failures.push(`expected ≥ ${scenario.cache.minReadRatio * 100}% of thinking's input read from the cache, got ${Math.round((t.cachedTokens / t.inputTokens) * 100)}%`)
  if (scenario.cache && t.largestInput > scenario.cache.maxInputTokens) failures.push(`expected thinking calls under ${scenario.cache.maxInputTokens} input tokens, the largest was ${t.largestInput}`)
  return { ok: failures.length === 0, failures, ...run.result }
}

/** A fresh copy of `evals/files` for one run, as the user's files (macOS only: the sandbox needs it). */
function fixtureFiles(): { files?: FileTools; root: string } {
  const dir = mkdtempSync(join(tmpdir(), 'stanley-eval-'))
  const root = join(dir, 'Stanley')
  cpSync(join(import.meta.dirname, 'files'), root, { recursive: true })
  // `--no-files`: without them, to compare.
  const on = process.platform === 'darwin' && !process.argv.includes('--no-files')
  return { files: on ? localFiles({ root, history: join(dir, 'history.git') }) : undefined, root }
}

/**
 * How an utterance was delivered: when its last word was out, and how many times the agent ended
 * the turn before it was (each restarted it, as the app does when speech follows an ended turn).
 */
export interface Delivery {
  lastWordAt: number
  cutIns: number
}

export type Speak = (agent: Agent, utterance: string, index: number, turn: TurnWatch, world: World) => Promise<Delivery>

/** When the agent ended the user's turn, for the speakers. */
export interface TurnWatch {
  endedAt: number | null
}

/**
 * Speaks each utterance to a fresh agent over `world`, waiting after each for the agent to go
 * quiet, however long its steps take. Shared by the demo-app and website evals.
 *
 * Turn-taking is checked on every scenario: Stanley must never say anything before the user's last
 * word. Ending the turn early (a cut-in) is counted, not failed: the next words start a new turn.
 */
export async function drive(world: World, utterances: string[], speak: Speak, files?: FileTools) {
  const ticks: TickReport[] = []
  const said: string[] = []
  const saidAt: number[] = []
  const turn: TurnWatch = { endedAt: null }
  let busy = false
  let changedAt = 0
  const thinking = { inputTokens: 0, cachedTokens: 0, largestInput: 0 }
  const agent = makeAgent(world, {
    debug: (e) => {
      if (e.type === 'think-start' && e.mode === 'run' && /^asked (to type|whether to press)/.test(e.handover)) {
        usage.singleFallbacks++
        usage.fallbacks.push(e.handover)
      }
      if (e.type !== 'think-end' || !e.usage) return
      thinking.inputTokens += e.usage.inputTokens ?? 0
      thinking.cachedTokens += e.usage.cacheReadTokens ?? 0
      thinking.largestInput = Math.max(thinking.largestInput, e.usage.lastInputTokens ?? 0)
    },
    tick: (t) => ticks.push(t),
    said: (text) => {
      said.push(text)
      saidAt.push(Date.now())
    },
    status: (s) => {
      busy = s === 'guessing' || s === 'thinking' || s === 'writing' || s === 'acting'
      changedAt = Date.now()
    },
    turnEnd: () => (turn.endedAt = Date.now()),
  }, files)
  const settleMs: number[] = []
  const endMs: number[] = []
  const turnFailures: string[] = []
  let cutIns = 0
  for (const [i, utterance] of utterances.entries()) {
    turn.endedAt = null
    const saidBefore = said.length
    const delivery = await speak(agent, utterance, i, turn, world)
    cutIns += delivery.cutIns
    const early = said.slice(saidBefore).filter((_, j) => saidAt[saidBefore + j]! < delivery.lastWordAt)
    for (const text of early) turnFailures.push(`spoke before the user finished "${utterance}": "${text}"`)
    endMs.push(Math.max(0, (turn.endedAt ?? Date.now()) - delivery.lastWordAt))
    const deadline = Date.now() + MAX_SETTLE_MS
    while ((busy || Date.now() - changedAt < QUIET_MS) && Date.now() < deadline) await sleep(100)
    if (busy) console.warn(`   still busy after ${MAX_SETTLE_MS / 1000}s: ${utterance}`)
    settleMs.push(Math.max(0, changedAt - delivery.lastWordAt))
  }
  return { agent, turnFailures, result: { ticks, said, settleMs, endMs, cutIns, trace: await agent.context(), thinking } }
}

function makeAgent(world: World, events: AgentDeps['events'], files?: FileTools): Agent {
  const key = process.env.PARALLEL_API_KEY
  // `--jev-turns N`: how many user turns Jev reads, to compare its input and latency.
  const config = process.argv.includes('--jev-turns') ? { ...defaultConfig, jevTurns: flag('jev-turns', defaultConfig.jevTurns) } : defaultConfig
  return new Agent({ world, jev: countedJev(createJevClient()), thinker: countedThinker(createThinker()), web: key ? countedWeb(parallelWeb(key)) : undefined, files, events, config })
}

/** Runs `tasks` with at most `limit` in flight. */
export async function pool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let next = 0
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++
      results[i] = await tasks[i]!()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}

/** The median of some durations in ms, as seconds; '—' for none. */
export function median(ms: number[]): string {
  if (!ms.length) return '—'
  const sorted = [...ms].sort((a, b) => a - b)
  return (sorted[Math.floor(sorted.length / 2)]! / 1000).toFixed(1)
}

/** `--name value` from the command line. */
export function flag(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : Number(process.argv[i + 1])
}

export function report(label: string, result: ScenarioResult) {
  console.log(`\n${result.ok ? '✓' : '✗'} ${label}`)
  for (const t of result.ticks) {
    const next = t.next ? Object.entries(t.next.probabilities).sort(([, a], [, b]) => b - a).slice(0, 2).map(([k, p]) => `${k} ${p.toFixed(2)}`).join(' ') : '—'
    const step = t.step ? `${t.step.choice} ${t.step.confidence.toFixed(2)}` : '—'
    const runnersUp = t.step?.top.filter((o) => o.option !== t.step!.choice).slice(0, 2).map((o) => `${o.option} ${o.p.toFixed(2)}`).join(', ')
    console.log(`   ${t.outcome.padEnd(15)} → ${t.effective.padEnd(10)} next: ${next.padEnd(22)} step: ${step}${runnersUp ? `  | ${runnersUp}` : ''}${t.detail ? ` (${t.detail})` : ''}`)
  }
  for (const text of result.said) console.log(`   said: "${text}"`)
  const t = result.thinking
  if (t.inputTokens) console.log(`   thinking input: ${t.inputTokens.toLocaleString()} tokens, ${Math.round((t.cachedTokens / t.inputTokens) * 100)}% from the cache, largest call ${t.largestInput.toLocaleString()}`)
  if (result.cutIns) console.log(`   ended the user's turn early ${result.cutIns}×`)
  for (const f of result.failures) console.log(`   ! ${f}`)
}

/**
 * Types an utterance word by word like live transcription. Each `|` is a pause mid-thought
 * (`PAUSE_MS`), which finalizes a segment as the VAD would. Typing has no voice, so pauses carry no
 * Smart Turn verdict and the agent judges them by the words alone. After the last word the agent
 * ends the turn itself, or the silence backstop does.
 */
export async function typeUtterance(agent: Agent, utterance: string, _index = 0, turn: TurnWatch = { endedAt: null }): Promise<Delivery> {
  const parts = utterance.split('|').map((p) => p.trim()).filter(Boolean)
  let cutIns = 0
  let lastWordAt = Date.now()
  agent.utteranceStart()
  for (const [i, part] of parts.entries()) {
    if (i > 0) {
      await sleep(PAUSE_MS)
      // The agent ended the turn during the pause: these words start a new one, as in the app.
      if (!agent.turnOpen) {
        cutIns++
        agent.utteranceStart()
      }
    }
    agent.voice(true)
    const words = part.split(' ')
    for (let w = 1; w <= words.length; w++) {
      agent.partial(words.slice(0, w).join(' '))
      await sleep(180)
    }
    agent.voice(false)
    lastWordAt = Date.now()
    agent.segment(part)
    agent.pause({ complete: null })
  }
  const backstop = Date.now() + SILENCE_BACKSTOP_MS
  while (agent.turnOpen && Date.now() < backstop) await sleep(50)
  if (agent.turnOpen) {
    turn.endedAt = Date.now()
    agent.utteranceEnd()
  }
  return { lastWordAt, cutIns }
}

function countedJev(client: DecisionClient): DecisionClient {
  const count = <T extends { usage?: { inputTokens?: number }; latencyMs: number }>(result: T) => {
    usage.jev++
    usage.jevInputTokens += result.usage?.inputTokens ?? 0
    usage.jevMs.push(result.latencyMs)
    return result
  }
  return {
    choose: async (req) => count(await client.choose(req)),
    decide: async (req) => count(await client.decide(req)),
  }
}

function countedWeb(web: WebTools): WebTools {
  return {
    search(query, signal) {
      usage.searches++
      return web.search(query, signal)
    },
    fetch(url, signal) {
      usage.reads++
      return web.fetch(url, signal)
    },
  }
}

function countedThinker(thinker: Thinker): Thinker {
  return {
    async run(req) {
      if (req.single?.kind === 'write') usage.writing++
      else if (req.single?.kind === 'confirm') usage.confirming++
      else usage.thinking++
      const result = await thinker.run(req)
      usage.thinkingInputTokens += result.usage?.inputTokens ?? 0
      usage.thinkingCachedTokens += result.usage?.inputTokenDetails.cacheReadTokens ?? 0
      usage.largestThinkingInput = Math.max(usage.largestThinkingInput, result.lastInputTokens ?? 0)
      return result
    },
  }
}

export function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}
