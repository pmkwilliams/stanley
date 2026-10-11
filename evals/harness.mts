import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Agent, createTextGen, type TextGen, type TickReport } from '@stanley/agent'
import { createJevClient, type DecisionClient } from '@stanley/jev'
import { Shell } from '../apps/desktop/src/main/shell'
import { apps } from '../apps/desktop/src/main/apps'
import type { Check, Scenario } from './scenarios.mts'

/** The agent counts as settled once it has been idle (not thinking/acting) this long. */
const QUIET_MS = 500
const MAX_SETTLE_MS = 120_000

/** Paid model calls, so every run says what it spent. */
export const usage = { jev: 0, jevInputTokens: 0, textGen: 0 }

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
  const filters = args.filter((a) => !a.startsWith('-'))
  if (!filters.length && !args.includes('--all')) {
    console.log(`${items.length} available — each makes several paid Jev/Haiku calls:`)
    for (const t of items) console.log(`  ${name(t)}`)
    console.log(`\nRun some:  ${command} <filter...>\nRun all:   ${command} --all`)
    return null
  }
  return items.filter((t) => !filters.length || filters.some((f) => name(t).includes(f)))
}

export function printUsage() {
  console.log(`Paid calls: ${usage.jev} Jev (${usage.jevInputTokens.toLocaleString()} input tokens), ${usage.textGen} Haiku`)
}

/**
 * Runs one scenario with real apps and models. `speak` delivers each utterance to the agent
 * (typed words or played audio) and resolves once the utterance has ended.
 */
export async function runScenario(scenario: Scenario, speak: (agent: Agent, utterance: string, index: number) => Promise<void>) {
  const shell = new Shell(apps, { env: process.env, fetch }, () => {})
  const ticks: TickReport[] = []
  let busy = false
  let changedAt = 0
  const agent = new Agent(shell, countedJev(createJevClient()), countedTextGen(createTextGen()), {
    tick: (t) => ticks.push(t),
    status: (s) => {
      busy = s === 'guessing' || s === 'thinking' || s === 'writing' || s === 'acting'
      changedAt = Date.now()
    },
  })

  for (const [i, utterance] of scenario.utterances.entries()) {
    await speak(agent, utterance, i)
    // Wait for the loop to go idle, however long a step takes.
    const deadline = Date.now() + MAX_SETTLE_MS
    while ((busy || Date.now() - changedAt < QUIET_MS) && Date.now() < deadline) await sleep(100)
    if (busy) console.warn(`   ${scenario.name}: still busy after ${MAX_SETTLE_MS / 1000}s`)
  }

  const failures = scenario.checks.map((c: Check) => c(shell, agent)).filter((r): r is string => typeof r === 'string')
  return { ok: failures.length === 0, failures, ticks }
}

export function report(label: string, result: Awaited<ReturnType<typeof runScenario>>) {
  console.log(`\n${result.ok ? '✓' : '✗'} ${label}`)
  for (const t of result.ticks) {
    console.log(`   ${t.outcome.padEnd(15)} ${t.choice}  c=${t.confidence.toFixed(2)}${t.detail ? ` (${t.detail})` : ''}`)
  }
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

export function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}
