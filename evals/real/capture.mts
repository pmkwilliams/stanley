/**
 * Saves real pages for the evals: each rendered once in headless Chromium from the live site, its
 * stylesheets inlined (so what is shown and hidden is as on the site) and its scripts removed, so
 * it reads the same offline every time. Only openly licensed sources (see `SOURCES`).
 *
 *   npx tsx real/capture.mts            # every source not saved yet
 *   npx tsx real/capture.mts --force    # all of them again
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch } from '../web/browser.mts'
import { SOURCES, TEST_SOURCES } from './sources.mts'

const dir = join(import.meta.dirname, 'pages')
mkdirSync(dir, { recursive: true })
const force = process.argv.includes('--force')
const browser = await launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' })
for (const source of [...SOURCES, ...TEST_SOURCES]) {
  const file = join(dir, `${source.id}.html`)
  if (existsSync(file) && !force) continue
  const page = await context.newPage()
  // Stylesheets as they arrive, to put in the page; images and media aren't needed.
  const css = new Map<string, string>()
  page.on('response', async (r) => {
    if (r.request().resourceType() === 'stylesheet' && r.ok()) css.set(r.url(), await r.text().catch(() => ''))
  })
  await page.route('**/*', (route) => (['image', 'media', 'font'].includes(route.request().resourceType()) ? route.abort() : route.continue()))
  try {
    await page.goto(source.url, { waitUntil: 'networkidle', timeout: 45_000 })
  } catch (err) {
    console.log(`✗ ${source.id}: ${err instanceof Error ? err.message.split('\n')[0] : err}`)
    await page.close()
    continue
  }
  const html = await page.evaluate((sheets: [string, string][]) => {
    const byUrl = new Map(sheets)
    document.querySelectorAll('link[rel~="stylesheet"]').forEach((link) => {
      const text = byUrl.get((link as HTMLLinkElement).href)
      if (text === undefined) return link.remove()
      const style = document.createElement('style')
      style.textContent = text
      link.replaceWith(style)
    })
    document.querySelectorAll('script, noscript, iframe, link[rel="preload"], link[rel="modulepreload"]').forEach((e) => e.remove())
    return '<!doctype html>\n' + document.documentElement.outerHTML
  }, [...css])
  const head = `<!-- ${source.title}: ${source.url}, saved ${new Date().toISOString().slice(0, 10)}. ${source.license}. -->\n`
  writeFileSync(file, head + html)
  console.log(`✓ ${source.id}: ${Math.round(html.length / 1024)} KB, ${css.size} stylesheets`)
  await page.close()
}
await browser.close()
