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
  return parts.join(', ')
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
 * What Stanley can do next: the screen's elements in screen order (up to `limit`), the apps,
 * and back / home. Names are unique; a clash gets a counter.
 */
export function stepOptions(screen: Screen, apps: AppEntry[], limit: number): OptionSet {
  const criteria: Record<string, string | null> = {}
  const targets = new Map<string, Target>()
  const add = (name: string, description: string, target: Target) => {
    let unique = name
    for (let n = 2; unique in criteria; n++) unique = `${name} (${n})`
    criteria[unique] = description
    targets.set(unique, target)
  }
  for (const { node, path } of flatten(screen.elements).slice(0, limit)) {
    add(elementName(path, node), describe(node), { kind: 'element', node, role: roleOf(node) })
  }
  for (const app of apps) add(`open ${app.title}`, `app: ${app.description}`, { kind: 'app', app })
  add('back', NAVIGATION.back, { kind: 'back' })
  add('home', NAVIGATION.home, { kind: 'home' })
  return { criteria, targets }
}
