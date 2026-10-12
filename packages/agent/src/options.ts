import type { AgentNode } from '@stanley/app-sdk'
import { domainOf, sameUrl, type KnownPage } from './web'
import type { AppEntry, Screen } from './world'

/** What a step does when chosen. */
export type Target =
  | { kind: 'element'; node: AgentNode; role: string }
  | { kind: 'app'; app: AppEntry }
  | { kind: 'back' }
  | { kind: 'home' }
  | { kind: 'page'; url: string; title: string }

export interface OptionSet {
  /** Option name → description, sent to Jev as one question's options. */
  criteria: Record<string, string | null>
  targets: Map<string, Target>
}

export const NAVIGATION = {
  back: 'Go back to the previous screen.',
  home: 'Go to the home screen, which lists the apps.',
} as const

export function roleOf(node: AgentNode): string {
  return node.role ?? { location: 'link', action: 'button', input: 'field', group: 'group' }[node.kind]
}

/** Navigation is cheap to undo, so it may run while the user is still speaking. */
export function navigates(target: Target): boolean {
  return target.kind !== 'element' || target.node.kind === 'location'
}

/** How an option reads to Jev: its role, then whatever the screen shows about it. */
function describe(node: AgentNode): string {
  const parts = [roleOf(node)]
  if (node.kind === 'input') parts.push(node.value ? `containing "${node.value}"` : 'empty')
  if (node.description) parts.push(node.description)
  if (node.offscreen) parts.push('out of view')
  return parts.join(', ')
}

const STOP = new Set('a an and are as at be but by can could do for from get go have i in is it its let me my of on or please so the then this to up us want we what with would you your'.split(' '))
const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}']+/gu)?.filter((w) => !STOP.has(w)) ?? [])

/**
 * What to offer when there are more than `limit` candidates (the screen's elements and the pages
 * Stanley knows): what matches the user's words first, then what is in view or was found last, in
 * their original order. A long page shouldn't bury what the user asked for under menus and banners,
 * and the agent shouldn't have to scroll to reach something they named.
 */
function pick<T>(items: T[], limit: number, focus: string, text: (t: T) => string, near: (t: T) => boolean): T[] {
  if (items.length <= limit) return items
  const want = words(focus)
  const score = (t: T) => {
    const have = words(text(t))
    let overlap = 0
    for (const w of want) if (have.has(w)) overlap++
    return overlap * 2 + (near(t) ? 1 : 0)
  }
  const ranked = items.map((t, i) => ({ t, i, s: score(t) })).sort((a, b) => b.s - a.s || a.i - b.i)
  return ranked
    .slice(0, limit)
    .sort((a, b) => a.i - b.i)
    .map((r) => r.t)
}

interface Flat {
  node: AgentNode
  /** Labels of the containers it sits in, outermost first. */
  path: string[]
}

function flatten(nodes: AgentNode[], path: string[] = [], out: Flat[] = []): Flat[] {
  for (const node of nodes) {
    if (node.kind !== 'group') out.push({ node, path })
    if (node.children) flatten(node.children, [...path, node.label], out)
  }
  return out
}

/** `"Lunch Friday?" › Archive`: the element's label after the containers that tell it apart. */
export function elementName(path: string[], node: AgentNode): string {
  return [...path, node.label].join(' › ')
}

/** Finds an element on a screen by node id, with the name it has as an option. */
export function findElement(screen: Screen, nodeId: string): { node: AgentNode; name: string } | undefined {
  const hit = flatten(screen.elements).find((f) => f.node.id === nodeId)
  return hit && { node: hit.node, name: elementName(hit.path, hit.node) }
}

/**
 * What Stanley can do next: the screen's elements in screen order, the pages it found or read on
 * the web (up to `limit` together, see `pick`), the apps, and back / home. Names are unique; a clash
 * gets a counter. `focus` is what the user is asking for, used to choose when there are too many.
 * The page already on screen isn't offered: opening it again does nothing.
 */
export function stepOptions(screen: Screen, apps: AppEntry[], limit: number, focus = '', pages: KnownPage[] = []): OptionSet {
  const criteria: Record<string, string | null> = {}
  const targets = new Map<string, Target>()
  const add = (name: string, description: string, target: Target) => {
    let unique = name
    for (let n = 2; unique in criteria; n++) unique = `${name} (${n})`
    criteria[unique] = description
    targets.set(unique, target)
  }
  type Candidate = { flat: Flat } | { page: KnownPage }
  const candidates: Candidate[] = [
    ...flatten(screen.elements).map((flat) => ({ flat })),
    ...pages.filter((p) => !screen.url || !sameUrl(p.url, screen.url)).map((page) => ({ page })),
  ]
  const text = (c: Candidate) => ('flat' in c ? [...c.flat.path, c.flat.node.label].join(' ') : `${c.page.title} ${domainOf(c.page.url)}`)
  const near = (c: Candidate) => ('flat' in c ? !c.flat.node.offscreen : c.page.latest)
  const chosen = pick(candidates, limit, focus, text, near)
  // Two pages with the same title are told apart by their site.
  const titles = new Map<string, number>()
  for (const c of chosen) if ('page' in c) titles.set(c.page.title, (titles.get(c.page.title) ?? 0) + 1)
  for (const c of chosen) {
    if ('flat' in c) {
      const { node, path } = c.flat
      add(elementName(path, node), describe(node), { kind: 'element', node, role: roleOf(node) })
    } else {
      const { url, title } = c.page
      const domain = domainOf(url)
      add(`open page: ${title}${titles.get(title)! > 1 ? ` (${domain})` : ''}`, `web page on ${domain}`, { kind: 'page', url, title })
    }
  }
  for (const app of apps) add(`open ${app.title}`, `app: ${app.description}`, { kind: 'app', app })
  add('back', NAVIGATION.back, { kind: 'back' })
  add('home', NAVIGATION.home, { kind: 'home' })
  return { criteria, targets }
}
