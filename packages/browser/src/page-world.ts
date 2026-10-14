import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AppEntry, Screen, StepResult, World } from '@stanley/agent'
import type { ActionArgs, AgentNode } from '@stanley/app-sdk'
import type { Page } from 'playwright-core'
import { DROPDOWN, pageNodes, stepOnPage, type PageDriver } from './driver'
import { EXTRACT, type Extracted } from './extract'

/** A website Stanley can open from anywhere, like a bookmark. */
export interface Site extends AppEntry {
  url: string
}

/**
 * A Playwright page's controls. Short timeouts: a control that can't be used (covered by a banner,
 * disabled) should fail fast, so the agent sees the failure and tries something else.
 */
export function playwrightDriver(page: Page, opts: { settleMs?: number; actionTimeoutMs?: number } = {}): PageDriver {
  const timeout = opts.actionTimeoutMs ?? 1500
  const element = (id: string) => page.locator(`[data-stanley-id="${id}"]`)
  return {
    async goto(url) {
      await page.goto(url)
    },
    extract: (maxText) => page.evaluate(`${EXTRACT}(${JSON.stringify({ maxText })})`) as Promise<Extracted>,
    click: (id) => element(id).click({ timeout }),
    fill: (id, text) => element(id).fill(text, { timeout }),
    press: (id, key) => element(id).press(key, { timeout }),
    dropdown: (id) => page.evaluate(`${DROPDOWN}(${JSON.stringify(id)})`) as Promise<string[] | null>,
    async select(id, label) {
      await element(id).selectOption({ label }, { timeout })
    },
    scroll: (direction) => page.mouse.wheel(0, (direction === 'up' ? -0.8 : 0.8) * (page.viewportSize()?.height ?? 800)),
    async settle() {
      await page.waitForLoadState('domcontentloaded').catch(() => null)
      await page.waitForTimeout(opts.settleMs ?? 120)
    },
  }
}

/**
 * Any website as Stanley's world: the page is the screen, its elements come from the generic
 * extractor, and steps are real clicks, typing and key presses. Bookmarked sites are the apps.
 */
export class PageWorld implements World {
  /** Whether the user can see the page; a desktop adapter would track its window. */
  visible = true
  private driver: PageDriver

  constructor(
    readonly page: Page,
    private sites: Site[],
    private opts: { maxText?: number; settleMs?: number; actionTimeoutMs?: number } = {},
  ) {
    this.driver = playwrightDriver(page, opts)
  }

  appList(): AppEntry[] {
    return this.sites.map(({ id, title, description }) => ({ id, title, description }))
  }

  async screen(): Promise<Screen> {
    if (this.page.url() === 'about:blank') {
      const list = this.sites.map((s) => `- ${s.title}: ${s.description}`).join('\n')
      return { id: 'home', title: 'Home', visible: this.visible, markdown: `# Home\n${list}`, elements: [] }
    }
    const page = await this.driver.extract(this.maxText)
    const site = this.siteOf(page.url)
    return {
      id: `${site?.id ?? new URL(page.url).host}:${new URL(page.url).pathname}${new URL(page.url).hash}`,
      title: page.title || site?.title || new URL(page.url).host,
      visible: this.visible,
      url: page.url,
      markdown: page.markdown,
      elements: pageNodes(page),
    }
  }

  async open(appId: string): Promise<StepResult> {
    const site = this.sites.find((s) => s.id === appId)
    if (!site) throw new Error(`Unknown site ${appId}`)
    await this.driver.goto(site.url)
    await this.driver.settle()
    return { summary: `Opened ${site.title}` }
  }

  async openUrl(url: string): Promise<StepResult> {
    await this.driver.goto(url)
    await this.driver.settle()
    const title = await this.page.title()
    return { summary: `Opened "${title}"`, title }
  }

  async perform(node: AgentNode, args: ActionArgs): Promise<StepResult> {
    return { summary: await stepOnPage(this.driver, node.id, node.kind === 'input', args, this.maxText) }
  }

  async global(option: 'show' | 'home' | 'back'): Promise<void> {
    if (option === 'back') await this.page.goBack().catch(() => null)
    if (option === 'home') await this.page.goto('about:blank')
    if (option === 'show') this.visible = true
    await this.driver.settle()
  }

  private get maxText(): number {
    return this.opts.maxText ?? 4000
  }

  private siteOf(url: string): Site | undefined {
    return this.sites.find((s) => url.startsWith(new URL(s.url).origin))
  }
}

/** A headless Chromium to drive: $STANLEY_CHROMIUM, else the newest Playwright headless shell, else Homebrew's. */
export function findChromium(): string | undefined {
  if (process.env.STANLEY_CHROMIUM) return process.env.STANLEY_CHROMIUM
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright')
  const shells = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort() : []
  const cached = shells.length ? join(cache, shells.at(-1)!, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell') : undefined
  if (cached && existsSync(cached)) return cached
  return existsSync('/opt/homebrew/bin/chromium') ? '/opt/homebrew/bin/chromium' : undefined
}

