/**
 * A case's apps as they really are: each app's own state (its starting one, or a canned one where it
 * would need the network), after the steps the case takes in it. What Jev reads is the app's own
 * markdown, and a picture of the screen is the apps' real windows, drawn by the gallery
 * (`apps/desktop/gallery/Screen.svelte`) with the same states.
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AppContext, AppModule } from '@stanley/app-sdk'
import { emailApp } from '@stanley/app-email/core'
import { lightsApp } from '@stanley/app-lights/core'
import { musicApp } from '@stanley/app-music/core'
import { settingsApp } from '@stanley/app-settings/core'
import { tasksApp } from '@stanley/app-tasks/core'
import { weatherApp } from '@stanley/app-weather/core'
import { webApp, type WebState } from '@stanley/app-web/core'
import { chromium, type Browser } from 'playwright-core'
import { fixtures } from '../../apps/desktop/gallery/fixtures.ts'

export const APPS: Record<string, AppModule<any>> = { email: emailApp, tasks: tasksApp, music: musicApp, weather: weatherApp, lights: lightsApp, settings: settingsApp, web: webApp }

const saved = new Map<string, unknown>([['theme', 'dark']])
const ctx: AppContext = { env: {}, fetch, store: { get: (k) => saved.get(k), set: (k, v) => void saved.set(k, v) } }

const RECIPE = `# Lemon chicken traybake
Serves 4 · 1 hour
## Ingredients
- 8 chicken thighs
- 2 lemons, sliced
- 500 g baby potatoes, halved
- 4 cloves garlic
## Method
1. Heat the oven to 200°C.
2. Toss the chicken, potatoes, lemons and garlic with olive oil, salt and pepper.
3. Roast for 50 minutes, turning once, until golden.`

/** The recipe as its page draws it. */
const RECIPE_HTML = `<body style="font: 16px Georgia, serif; margin: 32px; color: #222">
<h1>Lemon chicken traybake</h1><p style="color:#666">Serves 4 · 1 hour</p>
<h2>Ingredients</h2><ul><li>8 chicken thighs</li><li>2 lemons, sliced</li><li>500 g baby potatoes, halved</li><li>4 cloves garlic</li></ul>
<h2>Method</h2><ol><li>Heat the oven to 200°C.</li><li>Toss the chicken, potatoes, lemons and garlic with olive oil, salt and pepper.</li><li>Roast for 50 minutes, turning once, until golden.</li></ol></body>`

const recipe: WebState = {
  route: 'page/0',
  error: null,
  view: null,
  tabs: [{ id: 1, page: 0 }],
  ready: 2,
  pages: [{ url: 'https://www.bbcgoodfood.com/recipes/lemon-chicken-traybake', title: 'Lemon chicken traybake', markdown: RECIPE, tab: 1 }],
}

/** Where each app starts: its own first state, or a canned one where that would need the network. */
async function start(id: string): Promise<unknown> {
  if (id === 'weather') return structuredClone(fixtures.weather!.denver)
  if (id === 'lights') return structuredClone(fixtures.lights!.home)
  if (id === 'music') return structuredClone(fixtures.music!.playing)
  if (id === 'web') return structuredClone(recipe)
  return APPS[id]!.init(ctx)
}

/** Steps written as the gallery takes them: a node id, or `id|text` for one that takes text. */
export type Steps = Partial<Record<string, string[]>>

export async function states(steps: Steps = {}): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  for (const id of Object.keys(APPS)) {
    let state = await start(id)
    for (const step of steps[id] ?? []) {
      const [nodeId, text] = step.split('|')
      state = (await APPS[id]!.perform(state, nodeId!, text === undefined ? {} : { text }, ctx)).state
    }
    out[id] = state
  }
  return out
}

export const markdown = (id: string, state: unknown) => APPS[id]!.toMarkdown(state, ctx)

/** Draws screens with the gallery's real app windows, as PNGs. */
export async function screens() {
  const desktop = join(import.meta.dirname, '..', '..', 'apps', 'desktop')
  const vite = (await import(pathToFileURL(createRequire(join(desktop, 'package.json')).resolve('vite')).href)) as typeof import('vite')
  const server = await vite.createServer({ configFile: join(desktop, 'gallery', 'vite.config.ts'), server: { port: 0 }, logLevel: 'error' })
  await server.listen()
  const base = server.resolvedUrls!.local[0]!
  const browser: Browser = await chromium.launch({ channel: 'chrome' })
  let queue: Promise<unknown> = Promise.resolve()
  return {
    /** One screen at a time: the page is shared. */
    shoot(sides: string[][], all: Record<string, unknown>): Promise<Buffer> {
      const run = queue.then(async () => {
        const page = await browser.newPage({ viewport: { width: 1280, height: 832 } })
        page.on('pageerror', (e) => console.error('screen:', e.message))
        page.on('console', (m) => m.type() === 'error' && console.error('screen:', m.text()))
        try {
          const given = { sides, states: Object.fromEntries(sides.flat().map((id) => [id, all[id]])), pages: { web: RECIPE_HTML } }
          await page.addInitScript((g) => ((window as any).__screen = g), given)
          await page.goto(base)
          await page.waitForSelector('body[data-ready]', { timeout: 15000 })
          await page.waitForTimeout(300)
          return await page.screenshot()
        } finally {
          await page.close()
        }
      })
      queue = run.catch(() => {})
      return run
    },
    async close() {
      await browser.close()
      await server.close()
    },
  }
}
