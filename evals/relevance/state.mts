import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ActionArgs, AgentNode } from '@stanley/app-sdk'
import { PageWorld, type Site } from '@stanley/browser'
import { findElement, type AppEntry, type Screen, type StepResult, type World } from '@stanley/agent'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { launch } from '../web/browser.mts'

/** Large pages, served at made-up `.test` origins: thousands of elements between them. */
export const SITES: Site[] = [
  { id: 'megamart', title: 'MegaMart', description: 'Online shop', url: 'https://megamart.test/' },
  { id: 'wikifacts', title: 'Wikifacts', description: 'Encyclopedia', url: 'https://wikifacts.test/' },
  { id: 'metronews', title: 'Metro News', description: 'News', url: 'https://metronews.test/' },
  { id: 'quickmail', title: 'Quickmail', description: 'Email', url: 'https://quickmail.test/' },
  { id: 'threadhub', title: 'Threadhub', description: 'Forum', url: 'https://threadhub.test/' },
  { id: 'devdocs', title: 'DevDocs', description: 'Programming reference', url: 'https://devdocs.test/' },
]

/** Which site Stanley works on, which others are in front of the user, which are in the background, and which aren't open yet (opened when asked for). */
export interface Layout {
  focused: string
  shown: string[]
  background: string[]
  closed?: string[]
}

/** The usual state: two big pages side by side, four more in the background. */
export const LAYOUT: Layout = { focused: 'megamart', shown: ['wikifacts'], background: ['metronews', 'quickmail', 'threadhub', 'devdocs'] }

const shared = readFileSync(join(import.meta.dirname, 'sites', 'site.js'), 'utf8')
const html = Object.fromEntries(SITES.map((s) => [new URL(s.url).host, readFileSync(join(import.meta.dirname, 'sites', `${s.id}.html`), 'utf8').replace('/*SITE*/', shared)]))

/** A fresh browser profile with the large sites routed in. */
export async function context(browser: Browser): Promise<BrowserContext> {
  const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' })
  await c.route(/https:\/\/[a-z]+\.test\//, (route) => {
    const page = html[new URL(route.request().url()).host]
    return page ? route.fulfill({ contentType: 'text/html', body: page }) : route.abort()
  })
  return c
}

/** Every site's screen as the agent reads it, through the generic page extractor in headless Chromium. */
export async function extractAll(sites: Site[] = SITES, open: (browser: Browser) => Promise<BrowserContext> = context): Promise<Map<string, Screen>> {
  const browser = await launch()
  try {
    const pages = await Pages.open(await open(browser), { focused: sites[0]!.id, shown: [], background: sites.slice(1).map((s) => s.id) }, sites)
    return new Map(sites.map((s) => [s.id, pages.screenOf(s.id)]))
  } finally {
    await browser.close()
  }
}

/** The screen Stanley works on and the other apps open, as the agent gets them from the world. */
export function arrange(screens: Map<string, Screen>, layout: Layout): { screen: Screen; others: Screen[] } {
  const get = (id: string, visible: boolean) => ({ ...screens.get(id)!, visible })
  return { screen: get(layout.focused, true), others: [...layout.shown.map((id) => get(id, true)), ...layout.background.map((id) => get(id, false))] }
}

const SEP = '|'
/** An element's id with its site's in front, so a step finds the page it is on. */
const tag = (site: string, node: AgentNode): AgentNode => ({ ...node, id: `${site}${SEP}${node.id}`, ...(node.children && { children: node.children.map((c) => tag(site, c)) }) })

/**
 * A world of several live pages, each in its own tab: one Stanley works on, some in front of the
 * user, the rest in the background. As in the app, a button or field of another page is used where
 * it is, and a link goes there; opening a site makes it the one Stanley works on, without changing
 * what is in front of the user.
 */
export class Pages implements World {
  private screens = new Map<string, Screen>()
  /** Every step taken in the world, in order: what was opened or used (by its name as an option, without its app's), on which site, and when. */
  readonly log: { kind: 'open' | 'use'; site: string; label: string; at: number }[] = []

  private constructor(
    private worlds: Map<string, PageWorld>,
    public focus: string,
    public shown: Set<string>,
    private sites: Site[],
  ) {}

  private context!: BrowserContext
  /** Each open site's tab, to read what was done on it. */
  private tabs = new Map<string, Page>()

  static async open(context: BrowserContext, layout: Layout, sites: Site[] = SITES): Promise<Pages> {
    const pages = new Pages(new Map(), layout.focused, new Set([layout.focused, ...layout.shown]), sites)
    pages.context = context
    for (const site of sites.filter((s) => !layout.closed?.includes(s.id))) await pages.load(site.id)
    await pages.refresh()
    return pages
  }

  /** Opens `site` in a tab of its own. */
  private async load(site: string): Promise<void> {
    const tab = await this.context.newPage()
    const world = new PageWorld(tab, this.sites)
    await world.open(site)
    this.worlds.set(site, world)
    this.tabs.set(site, tab)
  }

  /** What a site has had done to it: every act in order, and which are on at the end (a second press undoes the first). Empty when it was never opened. */
  async state(site: string): Promise<{ acts: { act: string; id: string }[]; on: Record<string, boolean> }> {
    const tab = this.tabs.get(site)
    if (!tab) return { acts: [], on: {} }
    const state = (await tab.evaluate(`JSON.parse(localStorage.getItem('state') || 'null')`)) as { acts: { act: string; id: string }[]; on: Record<string, boolean> } | null
    return state ?? { acts: [], on: {} }
  }

  /** Where a site's tab is: its route (`#/…`), `/` on its front page. */
  async route(site: string): Promise<string> {
    const tab = this.tabs.get(site)
    return tab ? ((await tab.evaluate('location.hash')) as string).replace(/^#/, '') || '/' : 'not open'
  }

  /** The sites open now. */
  openSites(): string[] {
    return [...this.worlds.keys()]
  }

  screenOf(site: string): Screen {
    return { ...this.screens.get(site)!, visible: this.shown.has(site) }
  }

  private async refresh(): Promise<void> {
    for (const [site, world] of this.worlds) {
      const screen = await world.screen()
      this.screens.set(site, { ...screen, elements: screen.elements.map((e) => tag(site, e)) })
    }
  }

  async screen(): Promise<Screen> {
    await this.refresh()
    return this.screenOf(this.focus)
  }

  others(): Screen[] {
    const ids = this.sites.map((s) => s.id).filter((id) => id !== this.focus && this.worlds.has(id))
    return [...ids.filter((id) => this.shown.has(id)), ...ids.filter((id) => !this.shown.has(id))].map((id) => this.screenOf(id))
  }

  appList(): AppEntry[] {
    return this.sites.map(({ id, title, description }) => ({ id, title, description }))
  }

  async open(appId: string): Promise<StepResult> {
    if (!this.sites.some((s) => s.id === appId)) throw new Error(`Unknown site ${appId}`)
    // A site not open yet loads now, as an app opening does.
    if (!this.worlds.has(appId)) await this.load(appId)
    this.log.push({ kind: 'open', site: appId, label: appId, at: Date.now() })
    this.focus = appId
    await this.refresh()
    return { summary: `Opened ${this.sites.find((s) => s.id === appId)!.title}` }
  }

  async perform(node: AgentNode, args: ActionArgs): Promise<StepResult> {
    const at = node.id.indexOf(SEP)
    const site = node.id.slice(0, at)
    this.log.push({ kind: 'use', site, label: findElement(this.screens.get(site)!, node.id)?.name ?? node.label, at: Date.now() })
    const result = await this.worlds.get(site)!.perform({ ...node, id: node.id.slice(at + 1) }, args)
    if (node.kind === 'location') this.focus = site
    await this.refresh()
    return result
  }

  async global(option: 'show' | 'home' | 'back'): Promise<void> {
    if (option === 'show') this.shown.add(this.focus)
    else if (option === 'back') await this.worlds.get(this.focus)!.global('back')
    await this.refresh()
  }
}
