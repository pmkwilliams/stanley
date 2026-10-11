import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Site } from '@stanley/browser'
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

/** A headless Chromium: $STANLEY_CHROMIUM, else the newest Playwright headless shell, else Homebrew's. */
export function launch(): Promise<Browser> {
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright')
  const shells = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort() : []
  const cached = shells.length ? join(cache, shells.at(-1)!, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell') : undefined
  const executablePath = process.env.STANLEY_CHROMIUM ?? (cached && existsSync(cached) ? cached : '/opt/homebrew/bin/chromium')
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
