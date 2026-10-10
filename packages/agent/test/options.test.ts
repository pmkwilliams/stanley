import { describe, expect, it } from 'vitest'
import type { AgentNode } from '@stanley/app-sdk'
import { buildOptions, nearestNodes } from '../src/options'

const loc = (id: string, children: AgentNode[] = []): AgentNode => ({ id, kind: 'location', label: id, children })

const tree = loc('home', [
  loc('email', [loc('inbox', [loc('msg1'), loc('msg2')]), loc('sent')]),
  loc('todo', [loc('list')]),
])

describe('nearestNodes', () => {
  it('orders by undirected distance, then depth', () => {
    const ids = nearestNodes(tree, 'inbox', 10).map((n) => n.id)
    expect(ids.slice(0, 3)).toEqual(['email', 'msg1', 'msg2'])
    expect(ids).toContain('todo')
    expect(ids).not.toContain('home')
    expect(ids).not.toContain('inbox')
  })

  it('respects the limit', () => {
    expect(nearestNodes(tree, 'home', 2)).toHaveLength(2)
  })

  it('falls back to root for an unknown current node', () => {
    expect(nearestNodes(tree, 'nope', 2).map((n) => n.id)).toEqual(['email', 'todo'])
  })
})

describe('buildOptions', () => {
  it('includes globals and path-named nodes', () => {
    const { criteria, nodes } = buildOptions(tree, 'inbox', 50)
    expect(criteria).toHaveProperty('wait')
    expect(criteria).toHaveProperty('stop')
    expect(nodes.get('email › inbox › msg1')?.id).toBe('msg1')
  })
})
