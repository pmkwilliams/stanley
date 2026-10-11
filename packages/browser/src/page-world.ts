import type { AppEntry, Screen, StepResult, World } from '@stanley/agent'
import type { ActionArgs, AgentNode } from '@stanley/app-sdk'
import type { Page } from 'playwright-core'
import { EXTRACT, type Extracted, type ExtractedElement } from './extract'

/** A website Stanley can open from anywhere, like a bookmark. */
export interface Site extends AppEntry {
  url: string
}

/**
 * Any website as Stanley's world: the page is the screen, its elements come from the generic
 * extractor, and steps are real clicks, typing and key presses. Bookmarked sites are the apps.
 */
export class PageWorld implements World {
  /** Whether the user can see the page; a desktop adapter would track its window. */
  visible = true

  constructor(
    readonly page: Page,
    private sites: Site[],
    private opts: { maxText?: number; settleMs?: number } = {},
  ) {}

  appList(): AppEntry[] {
    return this.sites.map(({ id, title, description }) => ({ id, title, description }))
  }

  async screen(): Promise<Screen> {
    if (this.page.url() === 'about:blank') {
      const list = this.sites.map((s) => `- ${s.title}: ${s.description}`).join('\n')
      return { id: 'home', title: 'Home', visible: this.visible, markdown: `# Home\n${list}`, elements: [] }
    }
    const page = await this.extract()
    const site = this.siteOf(page.url)
    return {
      id: `${site?.id ?? new URL(page.url).host}:${new URL(page.url).pathname}${new URL(page.url).hash}`,
      title: page.title || site?.title || new URL(page.url).host,
      visible: this.visible,
      markdown: page.markdown,
      elements: [
        ...toNodes(page.elements),
        ...(page.more.above ? [{ id: 'scroll/up', kind: 'action' as const, label: 'Scroll up' }] : []),
        ...(page.more.below ? [{ id: 'scroll/down', kind: 'action' as const, label: 'Scroll down' }] : []),
      ],
    }
  }

  async open(appId: string): Promise<StepResult> {
    const site = this.sites.find((s) => s.id === appId)
    if (!site) throw new Error(`Unknown site ${appId}`)
    await this.page.goto(site.url)
    await this.settle()
    return { summary: `Opened ${site.title}` }
  }

  async perform(node: AgentNode, args: ActionArgs): Promise<StepResult> {
    const [id, key] = node.id.split('/')
    const element = this.page.locator(`[data-stanley-id="${id}"]`)
    const before = await this.fingerprint()
    if (id === 'scroll') await this.page.mouse.wheel(0, (key === 'up' ? -0.8 : 0.8) * (this.page.viewportSize()?.height ?? 800))
    else if (key === 'enter') await element.press('Enter')
    else if (node.kind === 'input') await element.fill(args.text ?? '')
    else await element.click()
    await this.settle()
    const after = await this.fingerprint()
    // A generic page can't say what a click did, so report what visibly changed.
    if (node.kind === 'input') return { summary: `"${args.text ?? ''}" is in the field` }
    if (after.url !== before.url) return { summary: `Now on "${after.title}"` }
    return { summary: after.text === before.text ? 'Nothing on the page changed' : 'The page changed' }
  }

  async global(option: 'show' | 'home' | 'back'): Promise<void> {
    if (option === 'back') await this.page.goBack().catch(() => null)
    if (option === 'home') await this.page.goto('about:blank')
    if (option === 'show') this.visible = true
    await this.settle()
  }

  private extract(): Promise<Extracted> {
    return this.page.evaluate(`${EXTRACT}(${JSON.stringify({ maxText: this.opts.maxText ?? 4000 })})`) as Promise<Extracted>
  }

  private async fingerprint() {
    if (this.page.url() === 'about:blank') return { url: 'about:blank', title: '', text: '' }
    const page = await this.extract()
    return { url: page.url, title: page.title, text: page.markdown }
  }

  private async settle() {
    await this.page.waitForLoadState('domcontentloaded').catch(() => null)
    await this.page.waitForTimeout(this.opts.settleMs ?? 120)
  }

  private siteOf(url: string): Site | undefined {
    return this.sites.find((s) => url.startsWith(new URL(s.url).origin))
  }
}

/** Extracted elements as agent nodes. Elements that share a container are grouped under it. */
export function toNodes(elements: ExtractedElement[]): AgentNode[] {
  const out: AgentNode[] = []
  const groups = new Map<string, AgentNode>()
  for (const e of elements) {
    const node: AgentNode = { id: e.id, kind: e.kind, role: e.role, label: e.name || e.role, description: e.state, offscreen: e.offscreen }
    if (e.kind === 'input') {
      node.value = e.value ?? ''
      if (e.submits) node.children = [{ id: `${e.id}/enter`, kind: 'action', role: 'key', label: 'press Enter' }]
    }
    const container = e.context.at(-1)
    if (!container) {
      out.push(node)
      continue
    }
    let group = groups.get(container)
    if (!group) {
      group = { id: `group:${container}`, kind: 'group', label: container, children: [] }
      groups.set(container, group)
      out.push(group)
    }
    group.children!.push(node)
  }
  return out
}
