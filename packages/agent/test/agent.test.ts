import { describe, expect, it, vi } from 'vitest'
import type { AgentNode } from '@stanley/app-sdk'
import type { ChoiceRequest, ChoiceResult, DecisionClient } from '@stanley/jev'
import { Agent, type AgentDeps, type AgentStatus, type TickReport, type World } from '../src/agent'
import type { ConsequenceCheck, ConsequenceVerdict } from '../src/consequence'
import type { AgentDebugEvent } from '../src/debug'
import type { EscalationRequest, Escalator } from '../src/escalate'

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

const verdict = (v: Partial<ConsequenceVerdict> = {}): ConsequenceVerdict => ({
  effect: 'local',
  effects: {},
  consequential: false,
  allowed: true,
  cached: false,
  ...v,
})
const allowAll: ConsequenceCheck = { check: async () => verdict() }
/** Says nothing and does nothing; tests that need more pass their own. */
const silent: Escalator = { run: async () => ({ text: '' }) }

function make(world: World, jev: DecisionClient, gen: AgentDeps['textGen'], events: AgentDeps['events'] = {}, extra: Partial<AgentDeps> = {}) {
  return new Agent({ world, jev, textGen: gen, events, escalator: silent, check: allowAll, ...extra })
}
const settle = () => new Promise((r) => setTimeout(r, 20))

function setup(script: Script, worldOpts?: Parameters<typeof fakeWorld>[0]) {
  const { world, performed } = fakeWorld(worldOpts)
  const jev = scripted(script)
  const ticks: TickReport[] = []
  const statuses: AgentStatus[] = []
  const agent = make(world, jev, textGen, { tick: (t) => ticks.push(t), status: (s) => statuses.push(s) })
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

  it('listens for more while the utterance is open, and escalates instead of giving up once it ended', async () => {
    const { agent, statuses } = setup(() => ({ choice: 'wait' }))
    agent.utteranceStart()
    agent.segment('hmm')
    await settle()
    expect(statuses).toEqual(['guessing', 'listening'])
    agent.utteranceEnd()
    await settle()
    expect(statuses.slice(2)).toEqual(['thinking', 'thinking', 'done'])
  })

  it("did not get it when the utterance ended without any words", async () => {
    const { agent, statuses } = setup(() => ({ choice: 'wait' }))
    agent.utteranceStart()
    agent.partial('hmm let me think')
    await settle()
    agent.utteranceStart() // a new utterance, ended before anything was said
    agent.utteranceEnd()
    await settle()
    expect(statuses.at(-1)).toBe('didnt-get-that')
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
    agent.partial('add new to do called')
    await settle()
    expect(performed).toEqual(['todo'])
    expect(ticks.map((t) => t.outcome)).toEqual(['executed', 'gated'])
    agent.segment('add new to do called get eggs')
    await settle()
    expect(performed).toEqual(['todo', 'todo:add=Buy eggs', 'show'])
  })

  it('waits through a pause until the user says the value, and asks for it once they finish without it', async () => {
    const { world, performed } = fakeWorld()
    const ticks: TickReport[] = []
    const statuses: AgentStatus[] = []
    const reasons: string[] = []
    const escalator: Escalator = { run: async ({ reason }) => (reasons.push(reason), { text: 'What should it be called?' }) }
    const jev = scripted(() => ({ choice: performed.some((p) => p.startsWith('todo:add')) ? 'stop' : 'To-do › add task' }))
    const gen = { fill: async ({ context }: { context: string }) => (context.includes('get eggs') ? 'Get eggs' : '') }
    const agent = make(world, jev, gen, { tick: (t) => ticks.push(t), status: (s) => statuses.push(s) }, { escalator })
    agent.utteranceStart()
    agent.segment('create a new to-do called')
    await settle()
    agent.segment('um')
    await settle()
    expect(statuses.at(-1)).toBe('idle')
    expect(reasons).toEqual([])
    agent.utteranceEnd() // the pause outlasts the silence timeout
    await settle()
    expect(performed).toEqual(['show'])
    expect(reasons[0]).toContain("hasn't said what to type")
    agent.utteranceStart()
    agent.segment('get eggs')
    await settle()
    expect(performed).toEqual(['show', 'todo:add=Get eggs', 'show'])
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
    const agent = make(world, scripted((_, i) => ({ choice: plan[i]! })), gen, { tick: (t) => ticks.push(t) })
    agent.utteranceStart()
    agent.segment('add new to do called')
    await settle()
    agent.partial('get eggs please')
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
    expect(statuses.at(-1)).toBe('error')
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

describe('Agent debug trace', () => {
  function traced(script: Script, world = fakeWorld().world) {
    const events: AgentDebugEvent[] = []
    const agent = make(world, scripted(script), textGen, { debug: (e) => events.push(e) })
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
    agent.partial('hmm let')
    await settle()
    agent.partial('hmm let') // re-decoded, nothing new
    await settle()
    expect(of('request').map((e) => e.result)).toEqual(['tick', 'no-new-words'])
  })

  it('explains gating with the threshold that applied', async () => {
    const { agent, of } = traced((_, i) => (i === 0 ? { choice: 'Email', confidence: 0.2 } : { choice: 'wait' }))
    agent.utteranceStart()
    agent.partial('maybe email')
    await settle()
    expect(of('gate')[0]).toMatchObject({ tickId: 1, rule: 'min-confidence' })
    expect(of('gate')[0]!.detail).toContain('0.2')
    expect(of('tick-end')[0]).toMatchObject({ outcome: 'gated', effective: 'wait' })
  })

  it('ends the tick as an error and reports it when an action throws', async () => {
    const world = { ...fakeWorld().world, perform: async () => Promise.reject(new Error('boom')) }
    const statuses: string[] = []
    const events: AgentDebugEvent[] = []
    const agent = make(world, scripted(() => ({ choice: 'Email' })), textGen, { debug: (e) => events.push(e), status: (s) => statuses.push(s) })
    agent.utteranceStart()
    agent.partial('open email')
    await settle()
    expect(events.find((e) => e.type === 'tick-end')).toMatchObject({ outcome: 'error', detail: 'Error: boom' })
    expect(statuses.at(-1)).toBe('error')
  })
})

describe('Agent consequences', () => {
  it('escalates an action the user has not explicitly asked for instead of doing it', async () => {
    const { world, performed } = fakeWorld()
    const runs: EscalationRequest[] = []
    const escalator: Escalator = { run: async (req) => (runs.push(req), { text: 'Delete it?' }) }
    const check: ConsequenceCheck = { check: async () => verdict({ effect: 'destructive', consequential: true, asked: 0.2, allowed: false }) }
    const ticks: TickReport[] = []
    const agent = make(world, scripted(() => ({ choice: 'Email › delete' })), textGen, { tick: (t) => ticks.push(t) }, { escalator, check })
    agent.utteranceStart()
    agent.segment('that email is junk')
    await settle()
    expect(performed).toEqual(['show'])
    expect(ticks[0]!.outcome).toBe('gated')
    expect(runs[0]!.reason).toContain('Email › delete')
  })

  it('does an action the user explicitly asked for', async () => {
    const { world, performed } = fakeWorld()
    const plan = ['Email › delete', 'stop']
    const check: ConsequenceCheck = { check: async () => verdict({ effect: 'destructive', consequential: true, asked: 0.95, allowed: true }) }
    const agent = make(world, scripted((_, i) => ({ choice: plan[i]! })), textGen, {}, { check })
    agent.utteranceStart()
    agent.segment('delete that email')
    await settle()
    expect(performed).toEqual(['email:delete', 'show'])
  })

  it('asks Jev what an action does once per action, and whether it was asked for only when it matters', async () => {
    const { createConsequenceCheck } = await import('../src/consequence')
    const questions: string[] = []
    const jev: DecisionClient = {
      async choose(req) {
        questions.push(req.instructions)
        const p = 'external' in req.options ? { none: 0.1, local: 0.1, destructive: 0.1, external: 0.7 } : { yes: 0.9, no: 0.1 }
        return { choice: Object.entries(p).sort(([, a], [, b]) => b - a)[0]![0], probabilities: p, confidence: 0.9, latencyMs: 1 }
      },
    }
    const check = createConsequenceCheck(jev, { consequential: 0.35, explicitAsk: 0.8 })
    const node = { id: 'email:send', kind: 'action' as const, label: 'send' }
    const first = await check.check({ state: 'send it', option: 'Email › send', description: null, node })
    const second = await check.check({ state: 'send it', option: 'Email › send', description: null, node })
    expect(first).toMatchObject({ effect: 'external', consequential: true, asked: 0.9, allowed: true, cached: false })
    expect(second.cached).toBe(true)
    expect(questions.filter((q) => q.startsWith('What would'))).toHaveLength(1)
    expect(questions.filter((q) => q.startsWith('Has the user'))).toHaveLength(2)
  })
})

describe('Agent escalation', () => {
  function escalating(run: Escalator['run'], script: Script = () => ({ choice: 'escalate' }), check = allowAll) {
    const { world, performed } = fakeWorld()
    const said: string[] = []
    const statuses: AgentStatus[] = []
    const events: AgentDebugEvent[] = []
    const jev = scripted(script)
    const agent = make(world, jev, textGen, { said: (t) => said.push(t), status: (s) => statuses.push(s), debug: (e) => events.push(e) }, { escalator: { run }, check })
    return { agent, jev, performed, said, statuses, events }
  }

  it('lets the escalation model act on the same options and says its text', async () => {
    const { agent, performed, said, statuses } = escalating(async ({ act, options }) => {
      expect(options).toContain('To-do › add task')
      expect(options).not.toContain('wait')
      await act('To-do')
      await act('To-do › add task', 'Call mom')
      return { text: 'Added it.' }
    })
    agent.utteranceStart()
    agent.segment('can you remind me to call mom')
    await settle()
    expect(performed).toEqual(['todo', 'todo:add=Call mom', 'show'])
    expect(said).toEqual(['Added it.'])
    expect(agent.log.entries.filter((e) => e.role === 'said')).toMatchObject([{ content: 'Added it.' }])
    expect(statuses.at(-1)).toBe('done')
  })

  it('refuses the escalation model an action the user has not asked for', async () => {
    let result = ''
    const check: ConsequenceCheck = { check: async () => verdict({ effect: 'external', consequential: true, asked: 0.1, allowed: false }) }
    const { agent, performed } = escalating(
      async ({ act }) => {
        result = await act('Email › delete')
        return { text: 'Should I delete it?' }
      },
      undefined,
      check,
    )
    agent.utteranceStart()
    agent.segment('what about that email')
    await settle()
    expect(result).toContain('Not done')
    expect(performed).toEqual(['show'])
  })

  it('only hands over at a pause, never mid-word', async () => {
    let runs = 0
    const { agent } = escalating(async () => (runs++, { text: '' }))
    agent.utteranceStart()
    agent.partial('what is the capital of')
    await settle()
    expect(runs).toBe(0)
    agent.segment('what is the capital of France')
    await settle()
    expect(runs).toBe(1)
  })

  it('drops its run when the user says more, and re-decides with the whole turn', async () => {
    const contexts: string[] = []
    const { agent, said, events } = escalating(async ({ context, signal }) => {
      contexts.push(context)
      if (contexts.length === 1) await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)))
      return { text: 'Paris.' }
    })
    agent.utteranceStart()
    agent.segment('what is the capital')
    await settle()
    agent.segment('of France')
    await settle()
    expect(said).toEqual(['Paris.'])
    expect(contexts[1]).toContain('of France')
    expect(events.filter((e) => e.type === 'escalation-end').map((e) => (e as { aborted: boolean }).aborted)).toEqual([true, false])
  })
})
