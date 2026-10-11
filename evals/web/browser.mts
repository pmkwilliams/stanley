import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findChromium, type Site } from '@stanley/browser'
import { chromium, type Browser, type BrowserContext } from 'playwright-core'

/** Fixture sites, served at made-up `.test` origins so pages behave as if they were on the web. */
export const SITES: Site[] = [
  { id: 'postbox', title: 'Postbox', description: 'Email', url: 'https://postbox.test/' },
  { id: 'cornerstore', title: 'Corner Store', description: 'Online shop for kitchen and home goods', url: 'https://cornerstore.test/' },
  { id: 'account', title: 'Lumen account', description: 'Account settings', url: 'https://account.test/' },
  { id: 'dailypost', title: 'The Daily Post', description: 'Local news', url: 'https://dailypost.test/' },
]

/** Real sites for --live runs. The ids double as starting points. */
export const LIVE_SITES: Site[] = [
  { id: 'wikipedia', title: 'Wikipedia', description: 'The free encyclopedia', url: 'https://en.wikipedia.org/wiki/Main_Page' },
  { id: 'wikipedia-eiffel', title: 'Wikipedia: Eiffel Tower', description: 'Encyclopedia article', url: 'https://en.wikipedia.org/wiki/Eiffel_Tower' },
  { id: 'hn', title: 'Hacker News', description: 'Tech news and discussion', url: 'https://news.ycombinator.com/' },
]

const html = Object.fromEntries(SITES.map((s) => [new URL(s.url).host, readFileSync(join(import.meta.dirname, 'sites', `${s.id}.html`), 'utf8')]))

export function launch(): Promise<Browser> {
  const executablePath = findChromium()
  if (!executablePath) throw new Error('No Chromium found: set STANLEY_CHROMIUM, or run `npx playwright install chromium-headless-shell`')
  return chromium.launch({ executablePath })
}

/** A fresh browser profile with the fixture sites routed in (live sites load from the web). */
export async function freshContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' })
  await context.route(/https:\/\/[a-z]+\.test\//, (route) => {
    const page = html[new URL(route.request().url()).host]
    return page ? route.fulfill({ contentType: 'text/html', body: page }) : route.abort()
  })
  return context
}

/** A site's saved state, read from its own origin in the same profile. */
export function siteState(context: BrowserContext, siteId: string): Promise<any> {
  return readSite(context, siteId, `JSON.parse(localStorage.getItem('state') || 'null')`)
}

/** Evaluates `fn` (a JS expression) on a fresh load of a site in the same profile. */
export async function readSite(context: BrowserContext, siteId: string, fn: string): Promise<any> {
  const site = [...SITES, ...LIVE_SITES].find((s) => s.id === siteId)!
  const page = await context.newPage()
  await page.goto(site.url)
  const value = await page.evaluate(fn)
  await page.close()
  return value
}
