import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Browser, BrowserContext } from 'playwright-core'
import { SOURCES, TEST_SOURCES } from './sources.mts'

const html = new Map([...SOURCES, ...TEST_SOURCES].map((s) => [s.url, readFileSync(join(import.meta.dirname, 'pages', `${s.id}.html`), 'utf8')]))

/**
 * A browser profile serving the saved real pages (`capture.mts`) at their own addresses, and nothing
 * else. A link or button used on one is noted on the page and goes nowhere: these pages are copies,
 * and leaving one would leave the eval with an error page.
 */
export async function realContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' })
  await context.route('**/*', (route) => {
    const page = route.request().resourceType() === 'document' ? html.get(route.request().url()) : undefined
    return page ? route.fulfill({ contentType: 'text/html', body: page }) : route.abort()
  })
  await context.addInitScript(() => {
    const stop = (e: Event) => {
      const el = (e.target as Element | null)?.closest('a, button, input, select, summary, [role=button], [role=link]')
      if (!el) return
      if (e.type === 'click' && !(el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio'))) e.preventDefault()
    }
    document.addEventListener('click', stop, true)
    document.addEventListener('submit', (e) => e.preventDefault(), true)
  })
  return context
}
