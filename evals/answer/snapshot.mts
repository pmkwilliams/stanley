/**
 * Saves what the agent would read on a real page, through the same extractor, as a fixture for
 * `pnpm eval:answer`: `npx tsx answer/snapshot.mts <name> <url>`. No model calls. Pages change, so
 * the eval reads the saved copy; re-snapshot one only to refresh it, then check its cases still hold.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PageWorld } from '@stanley/browser'
import { launch } from '../web/browser.mts'

const [name, url] = process.argv.slice(2)
if (!name || !url) throw new Error('usage: snapshot.mts <name> <url>')
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US' })
// The whole page, not one screenful: answering reads past what is in view.
const world = new PageWorld(page, [{ id: 'site', title: new URL(url).host, description: 'live site', url }], { maxText: 400_000 })
await world.open('site')
await page.waitForTimeout(2000)
const screen = await world.screen()
const file = join(import.meta.dirname, 'pages', `${name}.md`)
writeFileSync(file, `<!-- ${url} · ${new Date().toISOString().slice(0, 10)} · ${screen.title} -->\n${screen.markdown}\n`)
console.log(`${name}: ${screen.title} · ${screen.markdown.length.toLocaleString()} chars → ${file}`)
await browser.close()
