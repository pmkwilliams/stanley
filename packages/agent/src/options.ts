import type { AgentNode } from '@stanley/app-sdk'
import type { AppEntry, Screen } from './world'

/** What a step does when chosen. */
export type Target =
  | { kind: 'element'; node: AgentNode; role: string }
  | { kind: 'app'; app: AppEntry }
  | { kind: 'back' }
  | { kind: 'home' }

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
 * Which elements to offer when a page has more than `limit`: what is in view first, then what
 * matches the user's words, in screen order. A long page shouldn't bury what the user asked for
 * under menus and banners, and the agent shouldn't have to scroll to reach something they named.
 */
function pick(flat: Flat[], limit: number, focus: string): Flat[] {
  if (flat.length <= limit) return flat
  const want = words(focus)
  const score = (f: Flat) => {
    const have = words([...f.path, f.node.label].join(' '))
    let overlap = 0
    for (const w of want) if (have.has(w)) overlap++
    return overlap * 2 + (f.node.offscreen ? 0 : 1)
  }
  const ranked = flat.map((f, i) => ({ f, i, s: score(f) })).sort((a, b) => b.s - a.s || a.i - b.i)
  return ranked
    .slice(0, limit)
    .sort((a, b) => a.i - b.i)
    .map((r) => r.f)
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
 * What Stanley can do next: the screen's elements in screen order (up to `limit`, see `pick`),
 * the apps, and back / home. Names are unique; a clash gets a counter. `focus` is what the user
 * is asking for, used to choose elements on long pages.
 */
export function stepOptions(screen: Screen, apps: AppEntry[], limit: number, focus = ''): OptionSet {
  const criteria: Record<string, string | null> = {}
  const targets = new Map<string, Target>()
  const add = (name: string, description: string, target: Target) => {
    let unique = name
    for (let n = 2; unique in criteria; n++) unique = `${name} (${n})`
    criteria[unique] = description
    targets.set(unique, target)
  }
  for (const { node, path } of pick(flatten(screen.elements), limit, focus)) {
    add(elementName(path, node), describe(node), { kind: 'element', node, role: roleOf(node) })
  }
  for (const app of apps) add(`open ${app.title}`, `app: ${app.description}`, { kind: 'app', app })
  add('back', NAVIGATION.back, { kind: 'back' })
  add('home', NAVIGATION.home, { kind: 'home' })
  return { criteria, targets }
}
