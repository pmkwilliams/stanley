import type { AgentNode } from '@stanley/app-sdk'

export const GLOBALS = {
  wait: 'The request is incomplete or unclear, or the user is mid-thought. Need more from the user before acting.',
  stop: 'Everything the user asked for is done. Nothing left to do.',
  show: 'Bring the screen the agent is working on to the front so the user can see it.',
  home: 'Go to the home screen with the list of apps.',
  back: 'Go back to the previous screen.',
  escalate:
    'Hand this turn to a smarter assistant that can reason, answer, explain and talk to the user. Choose it when the user asked a question or needs a reply, the request is complicated, or you are not sure what to do.',
} as const

export type GlobalOption = keyof typeof GLOBALS

export interface OptionSet {
  /** Option name → description, sent as Jev `criteria`. */
  criteria: Record<string, string | null>
  /** Option name → node, for non-global options. */
  nodes: Map<string, AgentNode>
}

interface Indexed {
  node: AgentNode
  parent: string | null
  depth: number
  path: string[]
}

function index(root: AgentNode): Map<string, Indexed> {
  const map = new Map<string, Indexed>()
  const visit = (node: AgentNode, parent: Indexed | null) => {
    const entry: Indexed = {
      node,
      parent: parent?.node.id ?? null,
      depth: parent ? parent.depth + 1 : 0,
      path: parent ? [...parent.path, node.label] : [],
    }
    map.set(node.id, entry)
    node.children?.forEach((c) => visit(c, entry))
  }
  visit(root, null)
  return map
}

/**
 * The `limit` nodes nearest `currentId`, by BFS over the tree as an undirected
 * graph. Ties (same distance) are broken by shallower depth.
 */
export function nearestNodes(root: AgentNode, currentId: string, limit: number): AgentNode[] {
  const idx = index(root)
  const start = idx.has(currentId) ? currentId : root.id
  const dist = new Map<string, number>([[start, 0]])
  const queue = [start]
  while (queue.length) {
    const id = queue.shift()!
    const entry = idx.get(id)!
    const neighbours = [...(entry.node.children?.map((c) => c.id) ?? []), ...(entry.parent ? [entry.parent] : [])]
    for (const n of neighbours) {
      if (dist.has(n)) continue
      dist.set(n, dist.get(id)! + 1)
      queue.push(n)
    }
  }
  return [...dist.entries()]
    .filter(([id]) => id !== start && id !== root.id)
    .sort(([a, da], [b, db]) => da - db || idx.get(a)!.depth - idx.get(b)!.depth)
    .slice(0, limit)
    .map(([id]) => idx.get(id)!.node)
}

/** Globals + nearest nodes, with unique human-readable option names. */
export function buildOptions(root: AgentNode, currentId: string, limit: number): OptionSet {
  const idx = index(root)
  const criteria: Record<string, string | null> = { ...GLOBALS }
  const nodes = new Map<string, AgentNode>()
  for (const node of nearestNodes(root, currentId, limit)) {
    const path = idx.get(node.id)!.path
    let name = path.join(' › ')
    for (let n = 2; name in criteria; n++) name = `${path.join(' › ')} (${n})`
    const verb = node.kind === 'location' ? 'Go to' : node.kind === 'input' ? 'Type into the field (does not submit), once the user has said what to type' : 'Do'
    criteria[name] = [verb, node.description].filter(Boolean).join(': ')
    nodes.set(name, node)
  }
  return { criteria, nodes }
}
