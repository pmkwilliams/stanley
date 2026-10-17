import type { ActionArgs, AgentNode, LivePage, PageView } from '@stanley/app-sdk'
import type { Extracted, ExtractedElement } from './extract'

/**
 * One browser page's controls, as a person uses them: whatever runs the page (Playwright in the
 * evals, the desktop's web view) implements these, and the rest is shared. Elements are named by
 * the `data-stanley-id` the extractor gave them.
 */
export interface PageDriver {
  /** Goes to an address and waits until the page can be read. Throws when it can't be loaded. */
  goto(url: string): Promise<void>
  /** Runs the extractor in the page. */
  extract(maxText: number): Promise<Extracted>
  /** Clicks an element. Throws soon when it can't be: gone, disabled, or covered by something else. */
  click(id: string): Promise<void>
  /** Replaces what is in a field with `text`, as typing would. */
  fill(id: string, text: string): Promise<void>
  press(id: string, key: 'Enter'): Promise<void>
  /** A dropdown's options, by label; null when the element isn't a dropdown. */
  dropdown(id: string): Promise<string[] | null>
  select(id: string, label: string): Promise<void>
  /** Scrolls most of a screenful. */
  scroll(direction: 'up' | 'down'): Promise<void>
  /** Waits for what a step started (a navigation, a re-render) to settle. */
  settle(): Promise<void>
}

/** A dropdown's options by label, or null when the element isn't one: run in the page with the element's id. */
export const DROPDOWN = String.raw`(function (id) {
  var el = document.querySelector('[data-stanley-id="' + id + '"]')
  return el && el.tagName === 'SELECT' ? Array.from(el.options).map(function (o) { return (o.textContent || '').trim() }) : null
})`

/** Extracted elements as agent nodes. Elements that share a container are grouped under it. */
export function toNodes(elements: ExtractedElement[]): AgentNode[] {
  const out: AgentNode[] = []
  const groups = new Map<string, AgentNode>()
  for (const e of elements) {
    const node: AgentNode = { id: e.id, kind: e.kind, role: e.role, label: e.name || e.role, description: e.state, offscreen: e.offscreen, ...(e.about && { about: e.about }) }
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
      group = { id: `group:${container}`, kind: 'group', label: container, children: [], ...(e.contextKind === 'section' && { role: 'section' }) }
      groups.set(container, group)
      out.push(group)
    }
    group.children!.push(node)
  }
  return out
}

/** What a page offers: its elements, then scrolling when there is more of it above or below. */
export function pageNodes(page: Extracted): AgentNode[] {
  return [
    ...toNodes(page.elements),
    ...(page.more.above ? [{ id: 'scroll/up', kind: 'action' as const, label: 'Scroll up' }] : []),
    ...(page.more.below ? [{ id: 'scroll/down', kind: 'action' as const, label: 'Scroll down' }] : []),
  ]
}

/** The page as the agent reads it. */
export function pageView(page: Extracted): PageView {
  return { url: page.url, title: page.title, markdown: page.markdown, elements: pageNodes(page) }
}

/**
 * Works one of the page's elements (`pageNodes` ids): types into a field (`input`), chooses from a
 * dropdown, presses Enter, scrolls, or clicks. Returns what visibly changed, since a generic page
 * can't say what a click did. Throws when the element can't be used.
 */
export async function stepOnPage(driver: PageDriver, nodeId: string, input: boolean, args: ActionArgs, maxText: number): Promise<string> {
  const [id, key] = nodeId.split('/') as [string, string | undefined]
  const before = await fingerprint(driver, maxText)
  if (id === 'scroll') await driver.scroll(key === 'up' ? 'up' : 'down')
  else if (key === 'enter') await driver.press(id, 'Enter')
  else if (input) {
    const labels = await driver.dropdown(id)
    if (labels) {
      const label = optionLabel(labels, args.text ?? '')
      await driver.select(id, label)
      await driver.settle()
      return `"${label}" is chosen`
    }
    await driver.fill(id, args.text ?? '')
  } else await driver.click(id)
  await driver.settle()
  if (input) return `"${args.text ?? ''}" is in the field`
  const after = await fingerprint(driver, maxText)
  if (after.url !== before.url) return `Now on "${after.title}"`
  return after.text === before.text ? 'Nothing on the page changed' : 'The page changed'
}

async function fingerprint(driver: PageDriver, maxText: number) {
  const page = await driver.extract(maxText)
  return { url: page.url, title: page.title, text: page.markdown }
}

/** The option a spoken choice means: exact, then case-insensitive, then the one that contains it. */
export function optionLabel(labels: string[], wanted: string): string {
  const w = wanted.trim().toLowerCase()
  const match = labels.find((l) => l === wanted) ?? labels.find((l) => l.toLowerCase() === w) ?? labels.filter((l) => l.toLowerCase().includes(w) || w.includes(l.toLowerCase()))[0]
  if (!match) throw new Error(`no option "${wanted}"; the options are ${labels.join(', ')}`)
  return match
}

/**
 * A page Stanley reads and works like a person in a browser, for an app that shows web pages
 * (`AppContext.page`): reads give its text and elements, and a step on one of them reports what
 * visibly changed.
 */
export function livePage(driver: PageDriver, opts: { maxText?: number } = {}): LivePage {
  const maxText = opts.maxText ?? 4000
  /** The kinds of the elements last read: a field is typed into, anything else pressed. */
  let fields = new Set<string>()
  return {
    goto: (url) => driver.goto(url),
    async read() {
      const page = await driver.extract(maxText)
      fields = new Set(page.elements.filter((e) => e.kind === 'input').map((e) => e.id))
      return pageView(page)
    },
    perform: (nodeId, args) => stepOnPage(driver, nodeId, fields.has(nodeId) || (!nodeId.includes('/') && args.text !== undefined), args, maxText),
  }
}
