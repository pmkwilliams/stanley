import { describe, expect, it, vi } from 'vitest'
import type { AgentNode } from '@stanley/app-sdk'
import type { ChoiceRequest, ChoiceResult, DecisionClient } from '@stanley/jev'
import { Agent, type AgentStatus, type TickReport, type World } from '../src/agent'
import type { AgentDebugEvent } from '../src/debug'

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

/** A partial as the transcriber delivers it once its words have held across two decodes. */
const say = (agent: Agent, text: string) => {
  agent.partial(text)
  agent.partial(text)
}

function setup(script: Script, worldOpts?: Parameters<typeof fakeWorld>[0]) {
  const { world, performed } = fakeWorld(worldOpts)
  const jev = scripted(script)
  const ticks: TickReport[] = []
  const statuses: AgentStatus[] = []
  const agent = new Agent(world, jev, textGen, { tick: (t) => ticks.push(t), status: (s) => statuses.push(s) })
  return { agent, jev, performed, ticks, statuses }
}

describe('Agent status', () => {
  it('guesses until it acts, then thinks, writes and acts until done', async () => {
    const plan = ['To-do', 'To-do › add task', 'stop']
    const { agent, statuses } = setup((_, i) => ({ choice: plan[i]! }))
    agent.utteranceStart()
    agent.segment('add buy eggs to my list')
    await settle()
    expect(statuses).toEqual(['guessing', 'acting', 'thinking', 'writing', 'acting', 'thinking', 'done'])
  })

  it('listens for more while the utterance is open, and did not get it once it ended', async () => {
    const { agent, statuses } = setup(() => ({ choice: 'wait' }))
    agent.utteranceStart()
    agent.segment('hmm')
    await settle()
    expect(statuses).toEqual(['guessing', 'listening'])
    agent.utteranceEnd()
    await settle()
    expect(statuses.slice(2)).toEqual(['thinking', 'didnt-get-that'])
  })
})

describe('Agent loop', () => {
  it('keeps acting mid-utterance until stop, filling inputs via text_gen', async () => {
    const plan = ['To-do', 'To-do › add task', 'stop']
    const { agent, performed } = setup((_, i) => ({ choice: plan[i]! }))
    agent.utteranceStart()
    agent.segment('add buy eggs to my list') // paused, but the utterance has not ended
    await settle()
    expect(performed).toEqual(['todo', 'todo:add=Buy eggs', 'show'])
  })

  it('navigates mid-word but holds a data change until the user pauses', async () => {
    const plan = ['To-do', 'To-do › add task', 'To-do › add task', 'stop']
    const { agent, performed, ticks } = setup((_, i) => ({ choice: plan[i]! }))
    agent.utteranceStart()
    say(agent, 'add new to do called')
    await settle()
    expect(performed).toEqual(['todo'])
    expect(ticks.map((t) => t.outcome)).toEqual(['executed', 'gated'])
    agent.segment('add new to do called get eggs')
    await settle()
    expect(performed).toEqual(['todo', 'todo:add=Buy eggs', 'show'])
  })

  it('waits through a long pause until the user says the value', async () => {
    const { world, performed } = fakeWorld()
    const ticks: TickReport[] = []
    const statuses: AgentStatus[] = []
    const jev = scripted(() => ({ choice: performed.some((p) => p.startsWith('todo:add')) ? 'stop' : 'To-do › add task' }))
    const gen = { fill: async ({ context }: { context: string }) => (context.includes('get eggs') ? 'Get eggs' : '') }
    const agent = new Agent(world, jev, gen, { tick: (t) => ticks.push(t), status: (s) => statuses.push(s) })
    agent.utteranceStart()
    agent.segment('create a new to-do called')
    await settle()
    agent.segment('um')
    await settle()
    agent.utteranceEnd() // the pause outlasts the silence timeout
    await settle()
    expect(performed).toEqual([])
    expect(statuses.at(-1)).toBe('idle')
    agent.utteranceStart()
    agent.segment('get eggs')
    await settle()
    expect(performed).toEqual(['todo:add=Get eggs', 'show'])
    expect(ticks.map((t) => t.outcome)).not.toContain('forced-stop')
  })

  it('discards filled text when the user keeps talking during the fill', async () => {
    let release!: (text: string) => void
    const fills = ['New to-do item', 'Get eggs']
    const { world, performed } = fakeWorld()
    // Discarded, held while "get eggs" is still a partial, then committed at the pause.
    const plan = ['To-do › add task', 'To-do › add task', 'To-do › add task', 'stop']
    const ticks: TickReport[] = []
    const gen = { fill: () => new Promise<string>((r) => (release = r)) }
    const agent = new Agent(world, scripted((_, i) => ({ choice: plan[i]! })), gen, { tick: (t) => ticks.push(t) })
    agent.utteranceStart()
    agent.segment('add new to do called')
    await settle()
    say(agent, 'get eggs please')
    release(fills[0]!)
    await settle()
    expect(ticks.map((t) => t.outcome)).toEqual(['stale-discarded', 'gated'])
    expect(performed).toEqual([])
    agent.segment('get eggs please')
    await settle()
    release(fills[1]!)
    await settle()
    expect(performed).toEqual(['todo:add=Get eggs', 'show'])
  })

  it('does not call again after wait until new words arrive', async () => {
    const { agent, jev } = setup(() => ({ choice: 'wait' }))
    agent.utteranceStart()
    say(agent, 'open my')
    await settle()
    say(agent, 'open my') // same words
    await settle()
    expect(jev.calls).toBe(1)
    say(agent, 'open my email now')
    await settle()
    // "my" settles on the first decode, "email" on the second.
    expect(jev.calls).toBe(3)
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
    say(agent, 'open my email')
    await settle()
    say(agent, 'open my email no wait the to-do list')
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
    say(agent, 'hello there friend')
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
    say(agent, 'maybe email something')
    await settle()
    expect(ticks[0]!.outcome).toBe('gated')
    expect(performed).toEqual([])
  })

  it('force-stops on oscillation', async () => {
    const { agent, performed, ticks } = setup((_, i) => ({ choice: i % 2 ? 'Email' : 'To-do' }))
    agent.utteranceStart()
    say(agent, 'do the thing please')
    await settle()
    expect(ticks.at(-1)!.outcome).toBe('forced-stop')
    expect(performed.filter((p) => p === 'todo')).toHaveLength(2)
    expect(performed.at(-1)).toBe('show')
  })

  it('repeats an action that keeps changing the screen', async () => {
    const { agent, performed, ticks } = setup((_, i) => ({ choice: i < 4 ? 'To-do › sort' : 'stop' }), { screenChanges: true })
    agent.utteranceStart()
    agent.segment('sort it four times please')
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
    say(agent, 'no the to-do list') // no more words than the first utterance
    release()
    await settle()
    expect(ticks[0]!.outcome).toBe('stale-discarded')
    expect(performed).not.toContain('email')
  })

  it('reports an action that throws, logs its result, and keeps working', async () => {
    const { agent, performed, ticks, statuses } = setup((_, i) => ({ choice: i === 0 ? 'Email' : 'stop' }), { failOn: 'email' })
    agent.utteranceStart()
    say(agent, 'open my email please')
    await settle()
    expect(ticks.map((t) => t.outcome)).toEqual(['error'])
    expect(statuses.at(-1)).toBe('error')
    const results = agent.log.entries.filter((e) => e.role === 'tool')
    expect(results).toMatchObject([{ toolCallId: 'call-1', summary: 'Failed: email broke' }])
    say(agent, 'open my email please now')
    await settle()
    expect(performed).toEqual(['show'])
  })

  it('retries a failed decision when the utterance ends', async () => {
    const { agent, jev, performed } = setup((_, i) => {
      if (i === 0) throw new Error('gateway down')
      return { choice: 'stop' }
    })
    agent.utteranceStart()
    say(agent, 'open my email please')
    await settle()
    agent.utteranceEnd()
    await settle()
    expect(jev.calls).toBe(2)
    expect(performed).toEqual(['show'])
  })

  it('logs every decision, including stop, as an assistant message', async () => {
    const { agent } = setup(() => ({ choice: 'stop' }))
    agent.utteranceStart()
    say(agent, 'thanks that is all')
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
    say(agent, 'open my email please')
    await settle()
    agent.utteranceEnd()
    await settle()
    expect(jev.calls).toBe(1)
    agent.utteranceStart()
    say(agent, 'and now the to-do list')
    await settle()
    const starts = agent.log.entries.filter((e) => e.role === 'event' && e.kind === 'task-start')
    expect(starts).toHaveLength(2)
    expect(jev.calls).toBe(2)
  })

  it('re-decides on utterance end after wait', async () => {
    const { agent, jev } = setup(() => ({ choice: 'wait' }))
    agent.utteranceStart()
    say(agent, 'hmm let me think')
    await settle()
    agent.utteranceEnd()
    await settle()
    expect(jev.calls).toBe(2)
  })
})

describe('Agent debug trace', () => {
  function traced(script: Script, world = fakeWorld().world) {
    const events: AgentDebugEvent[] = []
    const agent = new Agent(world, scripted(script), textGen, { debug: (e) => events.push(e) })
    return { agent, events, of: <T extends AgentDebugEvent['type']>(type: T) => events.filter((e): e is Extract<AgentDebugEvent, { type: T }> => e.type === type) }
  }

  it('records the exact Jev input, the fill, the action and the outcome of a tick', async () => {
    const plan = ['To-do › add task', 'stop']
    const { agent, of } = traced((_, i) => ({ choice: plan[i]! }))
    agent.utteranceStart()
    agent.segment('add buy eggs to my list')
    await settle()

    const start = of('tick-start')[0]!
    expect(start).toMatchObject({ tickId: 1, reason: 'words', currentNodeId: 'home', utteranceEnded: false })
    expect(start.state).toContain('add buy eggs to my list')
    expect(Object.keys(start.options)).toContain('To-do › add task')
    expect(of('fill')[0]).toMatchObject({ tickId: 1, instructions: 'title', text: 'Buy eggs' })
    expect(of('act')[0]).toMatchObject({ tickId: 1, nodeId: 'todo:add', args: { text: 'Buy eggs' }, summary: 'did todo:add' })
    expect(of('tick-end').map((e) => [e.tickId, e.outcome, e.effective])).toEqual([
      [1, 'executed', 'To-do › add task'],
      [2, 'executed', 'stop'],
    ])
  })

  it('records requests that did not become a tick', async () => {
    const { agent, of } = traced(() => ({ choice: 'wait' }))
    agent.utteranceStart()
    say(agent, 'hmm let')
    await settle()
    say(agent, 'hmm let') // re-decoded, nothing new
    await settle()
    // The first decode of a segment has nothing settled yet.
    expect(of('request').map((e) => e.result)).toEqual(['no-new-words', 'tick', 'no-new-words', 'no-new-words'])
  })

  it('needs more confidence to act while the user is still speaking than after they finish', async () => {
    const { agent, performed, ticks } = setup((req) => (req.state.includes('(finished)') && performed.length ? { choice: 'stop' } : { choice: 'Email', confidence: 0.5 }))
    agent.utteranceStart()
    agent.segment('check my email')
    await settle()
    expect(ticks[0]!.outcome).toBe('gated')
    expect(performed).toEqual([])
    agent.utteranceEnd()
    await settle()
    expect(performed).toContain('email')
  })

  it('explains gating with the threshold that applied', async () => {
    const { agent, of } = traced((_, i) => (i === 0 ? { choice: 'Email', confidence: 0.2 } : { choice: 'wait' }))
    agent.utteranceStart()
    say(agent, 'maybe email')
    await settle()
    expect(of('gate')[0]).toMatchObject({ tickId: 1, rule: 'min-confidence' })
    expect(of('gate')[0]!.detail).toContain('0.2')
    expect(of('tick-end')[0]).toMatchObject({ outcome: 'gated', effective: 'wait' })
  })

  it('ends the tick as an error and reports it when an action throws', async () => {
    const world = { ...fakeWorld().world, perform: async () => Promise.reject(new Error('boom')) }
    const statuses: string[] = []
    const events: AgentDebugEvent[] = []
    const agent = new Agent(world, scripted(() => ({ choice: 'Email' })), textGen, { debug: (e) => events.push(e), status: (s) => statuses.push(s) })
    agent.utteranceStart()
    say(agent, 'open email')
    await settle()
    expect(events.find((e) => e.type === 'tick-end')).toMatchObject({ outcome: 'error', detail: 'Error: boom' })
    expect(statuses.at(-1)).toBe('error')
  })
})
