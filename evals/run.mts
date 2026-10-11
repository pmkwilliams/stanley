/**
 * Headless scenario evals: real apps, real Jev + Haiku through the gateway, no Electron.
 * Each utterance is typed word by word like live transcription, then ended.
 *
 *   pnpm eval            # list scenarios (runs nothing)
 *   pnpm eval inbox pm   # scenarios whose name contains a filter
 *   pnpm eval --all      # every scenario
 */
import { loadEnv, printUsage, report, runScenario, select, typeUtterance } from './harness.mts'
import { scenarios } from './scenarios.mts'

const selected = select(scenarios, (s) => s.name, 'pnpm eval')
if (selected) {
  loadEnv()
  let passed = 0
  for (const scenario of selected) {
    const result = await runScenario(scenario, typeUtterance)
    if (result.ok) passed++
    report(scenario.name, result)
  }
  console.log(`\n${passed}/${selected.length} scenarios passed`)
  printUsage()
}
