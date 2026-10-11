/**
 * Website evals: the agent drives real pages in headless Chromium through the generic page
 * extractor. No site-specific code: these test whether Stanley works on screens it has never seen.
 *
 *   pnpm eval:web                    # list scenarios (runs nothing)
 *   pnpm eval:web mail shop          # scenarios whose name contains a filter
 *   pnpm eval:web --all --runs 3     # every scenario, 3 times each
 *
 * Options: --runs N, --concurrency N (default 4), --trace, --verbose. --live runs read-only
 * scenarios on real websites instead (they change, so they aren't part of the default suite).
 */
import { PageWorld } from '@stanley/browser'
import { drive, flag, loadEnv, pool, printUsage, report, select, typeUtterance, type ScenarioResult } from './harness.mts'
import { freshContext, launch, LIVE_SITES, readSite, siteState, SITES } from './web/browser.mts'
import { liveScenarios, webScenarios, type WebScenario } from './web/scenarios.mts'

const live = process.argv.includes('--live')
const sites = live ? LIVE_SITES : SITES
const selected = select(live ? liveScenarios : webScenarios, (s) => s.name, `pnpm eval:web${live ? ' --live' : ''}`)
if (selected) {
  loadEnv()
  const runs = flag('runs', 1)
  const trace = process.argv.includes('--trace')
  const verbose = process.argv.includes('--verbose')
  const browser = await launch()
  const started = Date.now()
  const jobs = selected.flatMap((scenario) => Array.from({ length: runs }, (_, run) => ({ scenario, run })))
  const results = await pool(
    jobs.map(({ scenario, run }) => async () => {
      const result = await runWebScenario(scenario)
      const label = runs > 1 ? `${scenario.name} #${run + 1}` : scenario.name
      if (verbose || !result.ok) report(label, result)
      else console.log(`✓ ${label}`)
      if (trace) console.log(`\n----- ${label}: context at the end -----\n${result.trace}\n`)
      return { scenario, result }
    }),
    flag('concurrency', 4),
  )
  await browser.close()

  console.log('\nscenario                          pass   settle p50 (s)')
  let passed = 0
  for (const scenario of selected) {
    const mine = results.filter((r) => r.scenario === scenario).map((r) => r.result)
    const ok = mine.filter((r) => r.ok).length
    passed += ok
    const settle = mine.flatMap((r) => r.settleMs).sort((a, b) => a - b)
    const p50 = settle.length ? (settle[Math.floor(settle.length / 2)]! / 1000).toFixed(1) : '—'
    console.log(`${ok === mine.length ? ' ' : '✗'} ${scenario.name.padEnd(32)} ${`${ok}/${mine.length}`.padEnd(6)} ${p50}`)
  }
  console.log(`\n${passed}/${results.length} runs passed (${Math.round((passed / results.length) * 100)}%)`)
  console.log(`Wall time ${((Date.now() - started) / 1000).toFixed(0)}s`)
  printUsage()

  async function runWebScenario(scenario: WebScenario): Promise<ScenarioResult> {
    const context = await freshContext(browser)
    try {
      const page = await context.newPage()
      const world = new PageWorld(page, sites)
      if (scenario.start) await world.open(scenario.start)
      const run = await drive(world, scenario.utterances, typeUtterance)
      const checks = await Promise.all(
        scenario.checks.map((c) => c({ state: (id) => siteState(context, id), read: (id, fn) => readSite(context, id, fn), agent: run.agent, url: page.url() })),
      )
      const failures = checks.filter((r): r is string => typeof r === 'string')
      return { ok: failures.length === 0, failures, ...run.result }
    } finally {
      await context.close()
    }
  }
}
