import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Agent, createThinker, type AgentDeps, type Thinker, type TickReport, type World } from '@stanley/agent'
import { createJevClient, type DecisionClient } from '@stanley/jev'
import { Shell } from '../apps/desktop/src/main/shell'
import { apps } from '../apps/desktop/src/main/apps'
import type { Check, Scenario } from './scenarios.mts'

/** The agent counts as settled once it has been idle (not thinking/acting) this long. */
const QUIET_MS = 500
const MAX_SETTLE_MS = 120_000

/** Paid model calls, so every run says what it spent. */
export const usage = { jev: 0, jevInputTokens: 0, thinking: 0, writing: 0, confirming: 0 }

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
  const filters = args.filter((a, i) => !a.startsWith('-') && !/^--(runs|concurrency)$/.test(args[i - 1] ?? ''))
  if (!filters.length && !args.includes('--all')) {
    console.log(`${items.length} available — each makes several paid Jev/Haiku calls:`)
    for (const t of items) console.log(`  ${name(t)}`)
    console.log(`\nRun some:  ${command} <filter...>\nRun all:   ${command} --all`)
    return null
  }
  return items.filter((t) => !filters.length || filters.some((f) => name(t).includes(f)))
}

export function printUsage() {
  console.log(`Paid calls: ${usage.jev} Jev (${usage.jevInputTokens.toLocaleString()} input tokens), ${usage.thinking} thinking turns, ${usage.writing} writes, ${usage.confirming} confirms (Haiku)`)
}

export interface ScenarioResult {
  ok: boolean
  failures: string[]
  ticks: TickReport[]
  said: string[]
  /** Per utterance: ms from the end of speech until the agent went quiet. */
  settleMs: number[]
  /** The context the models would read at the end, for reading what happened. */
  trace: string
}

/**
 * Runs one scenario with real apps and models. `speak` delivers each utterance to the agent
 * (typed words or played audio) and resolves once the utterance has ended.
 */
export async function runScenario(scenario: Scenario, speak: (agent: Agent, utterance: string, index: number) => Promise<void>): Promise<ScenarioResult> {
  const shell = new Shell(apps, { env: process.env, fetch }, () => {})
  const run = await drive(shell, scenario.utterances, speak)
  const failures = scenario.checks.map((c: Check) => c(shell, run.agent)).filter((r): r is string => typeof r === 'string')
  return { ok: failures.length === 0, failures, ...run.result }
}

/**
 * Speaks each utterance to a fresh agent over `world`, waiting after each for the agent to go
 * quiet, however long its steps take. Shared by the demo-app and website evals.
 */
export async function drive(world: World, utterances: string[], speak: (agent: Agent, utterance: string, index: number) => Promise<void>) {
  const ticks: TickReport[] = []
  const said: string[] = []
  let busy = false
  let changedAt = 0
  const agent = makeAgent(world, {
    tick: (t) => ticks.push(t),
    said: (text) => said.push(text),
    status: (s) => {
      busy = s === 'guessing' || s === 'thinking' || s === 'writing' || s === 'acting'
      changedAt = Date.now()
    },
  })
  const settleMs: number[] = []
  for (const [i, utterance] of utterances.entries()) {
    await speak(agent, utterance, i)
    const ended = Date.now()
    const deadline = Date.now() + MAX_SETTLE_MS
    while ((busy || Date.now() - changedAt < QUIET_MS) && Date.now() < deadline) await sleep(100)
    if (busy) console.warn(`   still busy after ${MAX_SETTLE_MS / 1000}s: ${utterance}`)
    settleMs.push(Math.max(0, changedAt - ended))
  }
  return { agent, result: { ticks, said, settleMs, trace: await agent.context() } }
}

function makeAgent(world: World, events: AgentDeps['events']): Agent {
  return new Agent({ world, jev: countedJev(createJevClient()), thinker: countedThinker(createThinker()), events })
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
  for (const f of result.failures) console.log(`   ! ${f}`)
}

/** Types an utterance word by word like live transcription, then ends it. */
export async function typeUtterance(agent: Agent, utterance: string) {
  agent.utteranceStart()
  const words = utterance.split(' ')
  for (let i = 1; i <= words.length; i++) {
    agent.partial(words.slice(0, i).join(' '))
    await sleep(180)
  }
  agent.segment(utterance)
  agent.utteranceEnd()
}

function countedJev(client: DecisionClient): DecisionClient {
  const count = <T extends { usage?: { inputTokens?: number } }>(result: T) => {
    usage.jev++
    usage.jevInputTokens += result.usage?.inputTokens ?? 0
    return result
  }
  return {
    choose: async (req) => count(await client.choose(req)),
    decide: async (req) => count(await client.decide(req)),
  }
}

function countedThinker(thinker: Thinker): Thinker {
  return {
    run(req) {
      usage.thinking++
      return thinker.run(req)
    },
    write(req) {
      usage.writing++
      return thinker.write(req)
    },
    confirm(req) {
      usage.confirming++
      return thinker.confirm(req)
    },
  }
}

export function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}
