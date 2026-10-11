/** What the agent would see on a live page: `npx tsx web/peek-live.mts <url>`. No model calls. */
import { stepOptions } from '@stanley/agent'
import { PageWorld } from '@stanley/browser'
import { launch } from './browser.mts'

const url = process.argv[2]!
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const world = new PageWorld(page, [{ id: 'site', title: new URL(url).host, description: 'live site', url }])
await world.open('site')
await page.waitForTimeout(1500)
const screen = await world.screen()
const all = stepOptions(screen, [], 1000)
const names = Object.keys(all.criteria).filter((n) => n !== 'back' && n !== 'home')
console.log(`${screen.title}\nelements: ${names.length}, markdown: ${screen.markdown.length} chars`)
console.log('first 50 offered:', names.slice(0, 50).join(' | ').slice(0, 1500))
await browser.close()
