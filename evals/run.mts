/**
 * Headless scenario evals: real apps, real Jev + Sonnet through the gateway, no Electron.
 * Each utterance is typed word by word like live transcription, then ended.
 *
 *   pnpm eval                      # list scenarios (runs nothing)
 *   pnpm eval inbox pm             # scenarios whose name contains a filter
 *   pnpm eval --all                # every scenario
 *   pnpm eval --all --runs 3       # each scenario 3 times, reported as a pass rate
 *   pnpm eval todo --trace         # also print what the models read at the end of each run
 *
 * Options: --runs N (default 1), --concurrency N (default 4), --trace (every run), --verbose
 * (every run's ticks; by default only failed runs print them), --jev-turns N (user turns Jev reads).
 */
import { flag, loadEnv, median, pool, printUsage, report, runScenario, select, typeUtterance, type ScenarioResult } from './harness.mts'
import { scenarios, type Scenario } from './scenarios.mts'

const selected = select(scenarios, (s) => s.name, 'pnpm eval')
if (selected) {
  loadEnv()
  const runs = flag('runs', 1)
  const trace = process.argv.includes('--trace')
  const verbose = process.argv.includes('--verbose')
  const jobs = selected.flatMap((scenario) => Array.from({ length: runs }, (_, run) => ({ scenario, run })))
  const started = Date.now()
  const results = await pool(
    jobs.map(({ scenario, run }) => async () => {
      const result = await runScenario(scenario, typeUtterance)
      const label = runs > 1 ? `${scenario.name} #${run + 1}` : scenario.name
      if (verbose || !result.ok) report(label, result)
      else console.log(`✓ ${label}`)
      if (trace) console.log(`\n----- ${label}: context at the end -----\n${result.trace}\n`)
      return { scenario, result }
    }),
    flag('concurrency', 4),
  )
  summarize(selected, results)
  console.log(`Wall time ${((Date.now() - started) / 1000).toFixed(0)}s`)
  printUsage()
}

function summarize(selected: Scenario[], results: { scenario: Scenario; result: ScenarioResult }[]) {
  console.log('\nscenario                          pass   settle p50 (s)  turn end p50 (s)  early ends')
  let passed = 0
  for (const scenario of selected) {
    const mine = results.filter((r) => r.scenario === scenario).map((r) => r.result)
    const ok = mine.filter((r) => r.ok).length
    passed += ok
    const p50 = median(mine.flatMap((r) => r.settleMs))
    const endP50 = median(mine.flatMap((r) => r.endMs))
    const cutIns = mine.reduce((n, r) => n + r.cutIns, 0)
    console.log(`${ok === mine.length ? ' ' : '✗'} ${scenario.name.padEnd(32)} ${`${ok}/${mine.length}`.padEnd(6)} ${p50.padEnd(15)} ${endP50.padEnd(17)} ${cutIns || ''}`)
  }
  console.log(`\n${passed}/${results.length} runs passed (${Math.round((passed / results.length) * 100)}%)`)
}
