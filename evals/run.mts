/**
 * Headless scenario evals: real apps, real Jev + Haiku through the gateway, no Electron.
 * Each utterance is fed word by word like live transcription, then ended.
 *
 *   pnpm eval            # all scenarios
 *   pnpm eval inbox pm   # scenarios whose name contains a filter
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Agent, createTextGen, type TickReport } from '@stanley/agent'
import { createJevClient } from '@stanley/jev'
import { Shell } from '../apps/desktop/src/main/shell'
import { apps } from '../apps/desktop/src/main/apps'
import { scenarios, type Check } from './scenarios.mts'

const envFile = join(import.meta.dirname, '..', '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)
if (!process.env.AI_GATEWAY_API_KEY) throw new Error('AI_GATEWAY_API_KEY not set')

const filters = process.argv.slice(2)
const WORD_MS = 180

let passed = 0
const selected = scenarios.filter((s) => !filters.length || filters.some((f) => s.name.includes(f)))
for (const scenario of selected) {
  const shell = new Shell(apps, { env: process.env, fetch }, () => {})
  const ticks: TickReport[] = []
  let idle!: () => void
  let settled = new Promise<void>((r) => (idle = r))
  const agent = new Agent(shell, createJevClient(), createTextGen(), {
    tick: (t) => ticks.push(t),
    status: (s) => {
      if (s !== 'thinking' && s !== 'acting') idle()
    },
  })

  for (const utterance of scenario.utterances) {
    agent.utteranceStart()
    const words = utterance.split(' ')
    for (let i = 1; i <= words.length; i++) {
      agent.partial(words.slice(0, i).join(' '))
      await sleep(WORD_MS)
    }
    agent.segment(utterance)
    agent.utteranceEnd()
    // Wait for the loop to go quiet.
    for (;;) {
      settled = new Promise<void>((r) => (idle = r))
      const quiet = await Promise.race([settled.then(() => false), sleep(4000).then(() => true)])
      if (quiet) break
    }
  }

  const failures = scenario.checks.map((c: Check) => c(shell, agent)).filter((r): r is string => typeof r === 'string')
  const ok = failures.length === 0
  if (ok) passed++
  console.log(`\n${ok ? '✓' : '✗'} ${scenario.name}`)
  for (const t of ticks) {
    console.log(`   ${t.outcome.padEnd(15)} ${t.choice}  c=${t.confidence.toFixed(2)}${t.detail ? ` (${t.detail})` : ''}`)
  }
  for (const f of failures) console.log(`   ! ${f}`)
}
console.log(`\n${passed}/${selected.length} scenarios passed`)

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}
