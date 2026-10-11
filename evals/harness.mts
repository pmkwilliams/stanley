import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Agent, createEscalator, createTextGen, toJevState, type AgentDeps, type Escalator, type TextGen, type TickReport } from '@stanley/agent'
import { createJevClient, type DecisionClient } from '@stanley/jev'
import { Shell } from '../apps/desktop/src/main/shell'
import { apps } from '../apps/desktop/src/main/apps'
import type { Check, Scenario } from './scenarios.mts'

/** The agent counts as settled once it has been idle (not thinking/acting) this long. */
const QUIET_MS = 500
const MAX_SETTLE_MS = 120_000

/** Paid model calls, so every run says what it spent. */
export const usage = { jev: 0, jevInputTokens: 0, textGen: 0, escalations: 0 }

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
  console.log(`Paid calls: ${usage.jev} Jev (${usage.jevInputTokens.toLocaleString()} input tokens), ${usage.textGen} Haiku text_gen, ${usage.escalations} escalations`)
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
  const ticks: TickReport[] = []
  let busy = false
  let changedAt = 0
  const said: string[] = []
  const agent = makeAgent(shell, {
    tick: (t) => ticks.push(t),
    said: (text) => said.push(text),
    status: (s) => {
      busy = s === 'guessing' || s === 'thinking' || s === 'writing' || s === 'acting'
      changedAt = Date.now()
    },
  })

  const settleMs: number[] = []
  for (const [i, utterance] of scenario.utterances.entries()) {
    await speak(agent, utterance, i)
    const ended = Date.now()
    // Wait for the loop to go idle, however long a step takes.
    const deadline = Date.now() + MAX_SETTLE_MS
    while ((busy || Date.now() - changedAt < QUIET_MS) && Date.now() < deadline) await sleep(100)
    if (busy) console.warn(`   ${scenario.name}: still busy after ${MAX_SETTLE_MS / 1000}s`)
    settleMs.push(Math.max(0, changedAt - ended))
  }

  const failures = scenario.checks.map((c: Check) => c(shell, agent)).filter((r): r is string => typeof r === 'string')
  return { ok: failures.length === 0, failures, ticks, said, settleMs, trace: traceOf(agent, shell) }
}

function makeAgent(shell: Shell, events: AgentDeps['events']): Agent {
  return new Agent({
    world: shell,
    jev: countedJev(createJevClient()),
    textGen: countedTextGen(createTextGen()),
    escalator: countedEscalator(createEscalator()),
    // `--no-check` lets every action through, to see how the decision loop does on its own.
    ...(process.argv.includes('--no-check') && { check: { check: async () => ({ effect: 'none', effects: {}, consequential: false, allowed: true, cached: false }) } }),
    events,
  })
}

function traceOf(agent: Agent, shell: Shell): string {
  return toJevState('', agent.log.entries, { ...shell.now(), liveUtterance: '', utteranceFinal: true }).trim()
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
    const runnersUp = t.top.filter((o) => o.option !== t.choice).slice(0, 2).map((o) => `${o.option} ${o.p.toFixed(2)}`).join(', ')
    console.log(`   ${t.outcome.padEnd(15)} ${t.choice}  c=${t.confidence.toFixed(2)}${runnersUp ? `  | ${runnersUp}` : ''}${t.detail ? ` (${t.detail})` : ''}`)
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
  return {
    async choose(req) {
      usage.jev++
      const result = await client.choose(req)
      usage.jevInputTokens += result.usage?.inputTokens ?? 0
      return result
    },
  }
}

function countedTextGen(gen: TextGen): TextGen {
  return {
    fill(req) {
      usage.textGen++
      return gen.fill(req)
    },
  }
}

function countedEscalator(escalator: Escalator): Escalator {
  return {
    run(req) {
      usage.escalations++
      return escalator.run(req)
    },
  }
}

export function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}
