import { describe, expect, it, vi } from 'vitest'
import type { AgentNode } from '@stanley/app-sdk'
import type { ChoiceRequest, ChoiceResult, DecisionClient } from '@stanley/jev'
import { Agent, type AgentStatus, type TickReport, type World } from '../src/agent'

const tree: AgentNode = {
  id: 'home',
  kind: 'location',
  label: 'home',
  children: [
    {
      id: 'todo',
      kind: 'location',
      label: 'To-do',
      children: [
        { id: 'todo:add', kind: 'input', label: 'add task', input: { instructions: 'title' } },
        { id: 'todo:sort', kind: 'action', label: 'sort' },
      ],
    },
    { id: 'email', kind: 'location', label: 'Email', children: [{ id: 'email:delete', kind: 'action', label: 'delete', destructive: true }] },
  ],
}

function fakeWorld(opts: { screenChanges?: boolean; failOn?: string } = {}) {
  const performed: string[] = []
  const world: World = {
    tree: () => tree,
    currentNodeId: () => 'home',
    now: () => ({ surfaceTitle: 'Home', surfaceMarkdown: opts.screenChanges ? `${performed.length} done` : '', visible: true }),
    perform: async (node, args) => {
      if (node.id === opts.failOn) throw new Error(`${node.id} broke`)
      performed.push(args.text ? `${node.id}=${args.text}` : node.id)
      return { summary: `did ${node.id}` }
    },
    global: async (option) => void performed.push(option),
  }
  return { world, performed }
}

type Script = (req: ChoiceRequest, call: number) => { choice: string; confidence?: number } | Promise<{ choice: string; confidence?: number }>

function scripted(script: Script): DecisionClient & { calls: number } {
  const client = {
    calls: 0,
    async choose(req: ChoiceRequest): Promise<ChoiceResult> {
      const { choice, confidence = 0.9 } = await script(req, client.calls++)
      if (!(choice in req.options)) throw new Error(`"${choice}" not in options: ${Object.keys(req.options).join(', ')}`)
      return { choice, confidence, probabilities: { [choice]: confidence }, latencyMs: 1 }
    },
  }
  return client
}

const textGen = { fill: async () => 'Buy eggs' }
const settle = () => new Promise((r) => setTimeout(r, 20))

function setup(script: Script, worldOpts?: Parameters<typeof fakeWorld>[0]) {
  const { world, performed } = fakeWorld(worldOpts)
  const jev = scripted(script)
  const ticks: TickReport[] = []
  const statuses: AgentStatus[] = []
  const agent = new Agent(world, jev, textGen, { tick: (t) => ticks.push(t), status: (s) => statuses.push(s) })
  return { agent, jev, performed, ticks, statuses }
}

describe('Agent loop', () => {
  it('keeps acting mid-utterance until stop, filling inputs via text_gen', async () => {
    const plan = ['To-do', 'To-do › add task', 'stop']
    const { agent, performed } = setup((_, i) => ({ choice: plan[i]! }))
    agent.utteranceStart()
    agent.partial('add buy eggs to my list') // still speaking: no utteranceEnd
    await settle()
    expect(performed).toEqual(['todo', 'todo:add=Buy eggs', 'show'])
  })

  it('does not call again after wait until new words arrive', async () => {
    const { agent, jev } = setup(() => ({ choice: 'wait' }))
    agent.utteranceStart()
    agent.partial('open my')
    await settle()
    agent.partial('open my') // same words
    await settle()
    expect(jev.calls).toBe(1)
    agent.partial('open my email now')
    await settle()
    expect(jev.calls).toBe(2)
  })

  it('discards an action computed from a stale transcript and re-decides', async () => {
    let release!: () => void
    const { agent, performed, ticks } = setup(async (req, i) => {
      if (i === 0) {
        await new Promise<void>((r) => (release = r))
        return { choice: 'Email', confidence: 0.5 }
      }
      return { choice: req.state.includes('to-do') ? 'stop' : 'wait' }
    })
    agent.utteranceStart()
    agent.partial('open my email')
    await settle()
    agent.partial('open my email no wait the to-do list')
    release()
    await settle()
    expect(ticks[0]!.outcome).toBe('stale-discarded')
    expect(performed).not.toContain('email')
  })

  it('re-asks a wait when the utterance ends mid-call, without discarding', async () => {
    let release!: () => void
    const { agent, jev, ticks } = setup(async (req, i) => {
      if (i === 0) {
        await new Promise<void>((r) => (release = r))
        return { choice: 'wait' }
      }
      return { choice: req.state.includes('(finished)') ? 'stop' : 'wait' }
    })
    agent.utteranceStart()
    agent.partial('hello there friend')
    await settle()
    agent.utteranceEnd()
    release()
    await settle()
    expect(jev.calls).toBe(2)
    expect(ticks.map((t) => t.outcome)).toEqual(['executed', 'executed'])
  })

  it('gates low confidence to wait and destructive actions below threshold', async () => {
    const { agent, performed, ticks } = setup((_, i) => (i === 0 ? { choice: 'Email', confidence: 0.2 } : { choice: 'wait' }))
    agent.utteranceStart()
    agent.partial('maybe email something')
    await settle()
    expect(ticks[0]!.outcome).toBe('gated')
    expect(performed).toEqual([])
  })

  it('force-stops on oscillation', async () => {
    const { agent, performed, ticks } = setup((_, i) => ({ choice: i % 2 ? 'Email' : 'To-do' }))
    agent.utteranceStart()
    agent.partial('do the thing please')
    await settle()
    expect(ticks.at(-1)!.outcome).toBe('forced-stop')
    expect(performed.filter((p) => p === 'todo')).toHaveLength(2)
    expect(performed.at(-1)).toBe('show')
  })

  it('repeats an action that keeps changing the screen', async () => {
    const { agent, performed, ticks } = setup((_, i) => ({ choice: i < 4 ? 'To-do › sort' : 'stop' }), { screenChanges: true })
    agent.utteranceStart()
    agent.partial('sort it four times please')
    await settle()
    expect(performed).toEqual(['todo:sort', 'todo:sort', 'todo:sort', 'todo:sort', 'show'])
    expect(ticks.map((t) => t.outcome)).not.toContain('forced-stop')
  })

  it('discards a decision when the user barges in with new words', async () => {
    let release!: () => void
    const { agent, performed, ticks } = setup(async (req, i) => {
      if (i === 0) {
        await new Promise<void>((r) => (release = r))
        return { choice: 'Email', confidence: 0.5 }
      }
      return { choice: req.state.includes('to-do') ? 'stop' : 'wait' }
    })
    agent.utteranceStart()
    agent.segment('open my email please')
    await settle()
    agent.utteranceStart()
    agent.partial('no the to-do list') // no more words than the first utterance
    release()
    await settle()
    expect(ticks[0]!.outcome).toBe('stale-discarded')
    expect(performed).not.toContain('email')
  })

  it('reports an action that throws, logs its result, and keeps working', async () => {
    const { agent, performed, ticks, statuses } = setup((_, i) => ({ choice: i === 0 ? 'Email' : 'stop' }), { failOn: 'email' })
    agent.utteranceStart()
    agent.partial('open my email please')
    await settle()
    expect(ticks.map((t) => t.outcome)).toEqual(['error'])
    expect(statuses.at(-1)).toBe('idle')
    const results = agent.log.entries.filter((e) => e.role === 'tool')
    expect(results).toMatchObject([{ toolCallId: 'call-1', summary: 'Failed: email broke' }])
    agent.partial('open my email please now')
    await settle()
    expect(performed).toEqual(['show'])
  })

  it('retries a failed decision when the utterance ends', async () => {
    const { agent, jev, performed } = setup((_, i) => {
      if (i === 0) throw new Error('gateway down')
      return { choice: 'stop' }
    })
    agent.utteranceStart()
    agent.partial('open my email please')
    await settle()
    agent.utteranceEnd()
    await settle()
    expect(jev.calls).toBe(2)
    expect(performed).toEqual(['show'])
  })

  it('logs every decision, including stop, as an assistant message', async () => {
    const { agent } = setup(() => ({ choice: 'stop' }))
    agent.utteranceStart()
    agent.partial('thanks that is all')
    await settle()
    const options = agent.log.entries.flatMap((e) => (e.role === 'assistant' ? [e.toolCall.option] : []))
    expect(options).toEqual(['stop'])
  })
})

vi.setConfig({ testTimeout: 2000 })

describe('Agent task boundaries', () => {
  it('does not re-decide on utterance end after stop, and opens a new task on later speech', async () => {
    const { agent, jev } = setup(() => ({ choice: 'stop' }))
    agent.utteranceStart()
    agent.partial('open my email please')
    await settle()
    agent.utteranceEnd()
    await settle()
    expect(jev.calls).toBe(1)
    agent.utteranceStart()
    agent.partial('and now the to-do list')
    await settle()
    const starts = agent.log.entries.filter((e) => e.role === 'event' && e.kind === 'task-start')
    expect(starts).toHaveLength(2)
    expect(jev.calls).toBe(2)
  })

  it('re-decides on utterance end after wait', async () => {
    const { agent, jev } = setup(() => ({ choice: 'wait' }))
    agent.utteranceStart()
    agent.partial('hmm let me think')
    await settle()
    agent.utteranceEnd()
    await settle()
    expect(jev.calls).toBe(2)
  })
})
