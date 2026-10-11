/** Prints what the agent sees on each fixture site: `npx tsx web/peek.mts [site] [#/route]`. No model calls. */
import { stepOptions } from '@stanley/agent'
import { PageWorld } from '@stanley/browser'
import { freshContext, launch, SITES } from './browser.mts'

const [only, route = ''] = process.argv.slice(2)
const browser = await launch()
const context = await freshContext(browser)
const page = await context.newPage()
const world = new PageWorld(page, SITES)
for (const site of SITES.filter((s) => !only || s.id === only)) {
  await world.open(site.id)
  if (route) await page.goto(site.url + route)
  await page.waitForTimeout(100)
  const screen = await world.screen()
  const options = stepOptions(screen, world.appList(), 50)
  console.log(`\n===== ${screen.title} (${screen.id})\n${screen.markdown}\n----- options`)
  for (const [name, d] of Object.entries(options.criteria)) console.log(`  [${name}] ${d}`)
}
await browser.close()
