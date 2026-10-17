/**
 * Jev on a large state: the six big pages of `eval:relevance`, live in headless Chromium, two in
 * front of the user and four in the background. Each scenario asks for something done to one
 * element deep in a page, and checks what was done, to what, and where Stanley is after. Thinking
 * isn't called: a turn handed to it does nothing and is counted, so each step taken is Jev's own.
 *
 *   pnpm eval:large                    # list scenarios (runs nothing)
 *   pnpm eval:large mail shop          # scenarios whose name contains a filter
 *   pnpm eval:large --all --runs 3     # every scenario, 3 times each
 *   pnpm eval:large --holdout --all    # the scenarios kept out of tuning
 *
 * Passes when, in the end, the right thing is done and nothing wrong is left: opening an app first
 * to get there, or a wrong step undone on the way, still passes. It reports how many steps it
 * took and when the last one came.
 *
 * Options: --runs N, --concurrency N (default 2), --set key=value, --no-embed, --verbose, --trace
 * (the conversation as thinking sees it),
 * --thinking (scenarios marked `thinking` run with thinking itself, a paid model; still no web search).
 */
import type { Thinker } from '@stanley/agent'
import { drive, flag, loadEnv, median, pool, printUsage, report, select, typeUtterance, type ScenarioResult } from './harness.mts'
import { HOLDOUT, judge, SCENARIOS, type LargeScenario } from './large/scenarios.mts'
import { context, LAYOUT, Pages } from './relevance/state.mts'
import { launch } from './web/browser.mts'

const holdout = process.argv.includes('--holdout')
const selected = select(holdout ? HOLDOUT : SCENARIOS, (s) => s.name, `pnpm eval:large${holdout ? ' --holdout' : ''}`)
if (selected) {
  loadEnv()
  const runs = flag('runs', 1)
  const verbose = process.argv.includes('--verbose')
  const browser = await launch()
  const started = Date.now()
  const jobs = selected.flatMap((scenario) => Array.from({ length: runs }, (_, run) => ({ scenario, run })))
  const results = await pool(
    jobs.map(({ scenario, run }) => async () => {
      const result = await runLarge(scenario)
      const label = runs > 1 ? `${scenario.name} #${run + 1}` : scenario.name
      if (verbose || !result.ok) report(label, result)
      else console.log(`✓ ${label}`)
      if (process.argv.includes('--trace')) console.log(result.trace)
      return { scenario, result }
    }),
    flag('concurrency', 2),
  )
  await browser.close()

  console.log('\nscenario                          pass   in 1 step  in ≤2 steps  last step p50 (s)  settle p50 (s)  to thinking')
  let passed = 0
  for (const scenario of selected) {
    const mine = results.filter((r) => r.scenario === scenario).map((r) => r.result)
    const ok = mine.filter((r) => r.ok).length
    passed += ok
    const handed = mine.reduce((n, r) => n + r.handed, 0)
    // Steps the request needs: one for each thing asked (a correction asks once), so a scenario's
    // fewest is the number of acts it expects; going to the app first adds one.
    const need = Math.max(1, scenario.checks.filter((e) => 'id' in e).length)
    const within = (extra: number) => mine.filter((r) => r.ok && r.steps <= need + extra).length
    console.log(`${ok === mine.length ? ' ' : '✗'} ${scenario.name.padEnd(32)} ${`${ok}/${mine.length}`.padEnd(6)} ${`${within(0)}/${mine.length}`.padEnd(10)} ${`${within(1)}/${mine.length}`.padEnd(12)} ${median(mine.flatMap((r) => r.lastStepMs)).padEnd(18)} ${median(mine.flatMap((r) => r.settleMs)).padEnd(15)} ${handed || ''}`)
  }
  const steps = (extra: number) => results.filter(({ scenario, result }) => result.ok && result.steps <= Math.max(1, scenario.checks.filter((e) => 'id' in e).length) + extra).length
  console.log(`\n${passed}/${results.length} runs passed (${Math.round((passed / results.length) * 100)}%); in the fewest steps ${steps(0)}, with one more ${steps(1)}`)
  console.log(`Wall time ${((Date.now() - started) / 1000).toFixed(0)}s`)
  printUsage()

  async function runLarge(scenario: LargeScenario): Promise<ScenarioResult & { handed: number; steps: number }> {
    const ctx = await context(browser)
    try {
      const pages = await Pages.open(ctx, scenario.layout ?? LAYOUT)
      let handed = 0
      // Thinking is a paid model: a turn handed to it does nothing here, and is counted, unless the
      // scenario is one run with it (`--thinking`).
      const real = scenario.thinking && process.argv.includes('--thinking')
      const thinker: Thinker | undefined = real ? undefined : { run: async () => (handed++, { text: '', messages: [], sent: 0 }) }
      const run = await drive(pages, scenario.utterances, typeUtterance, undefined, { thinker, noWeb: true })
      // A turn handed to thinking after the step (to say it's done) is as in the app; handed
      // instead of the step, the checks fail, since here thinking does nothing.
      const failures = [...run.turnFailures, ...(await judge(pages, pages.openSites(), scenario.checks))]
      return { ok: failures.length === 0, failures, ...run.result, handed, steps: pages.log.length }
    } finally {
      await ctx.close()
    }
  }
}
