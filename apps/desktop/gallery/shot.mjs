// Screenshots apps in the gallery: node apps/desktop/gallery/shot.mjs <out-dir> "<query>" ["<query>" …]
// e.g. node apps/desktop/gallery/shot.mjs /tmp/shots "app=tasks&theme=dark" "app=tasks&theme=light&do=item/t1"
// Each query is the gallery's URL query (see README.md); files are named after it.
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const [out, ...queries] = process.argv.slice(2)
if (!out || !queries.length) {
  console.error('usage: shot.mjs <out-dir> "<query>" ["<query>" …]')
  process.exit(1)
}
mkdirSync(out, { recursive: true })

const server = await createServer({ configFile: fileURLToPath(new URL('./vite.config.ts', import.meta.url)), server: { port: 0 }, logLevel: 'error' })
await server.listen()
const base = server.resolvedUrls.local[0]
const browser = await chromium.launch({ channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 832 }, deviceScaleFactor: 2 })
  page.on('pageerror', (e) => console.error('page error:', e.message))
  page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()))
  for (const q of queries) {
    await page.goto(`${base}?${q}`)
    await page.waitForSelector('body[data-ready]', { timeout: 15000 })
    await page.waitForTimeout(400)
    // Named after the query; long ones are cut and made unique with a hash.
    const slug = q.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
    const name = slug.length <= 80 ? slug : `${slug.slice(0, 72)}-${createHash('sha1').update(q).digest('hex').slice(0, 7)}`
    const file = join(out, `${name}.png`)
    await page.screenshot({ path: file })
    console.log(file)
  }
} finally {
  await browser.close()
  await server.close()
}
