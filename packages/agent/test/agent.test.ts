import { describe, expect, it } from 'vitest'
import type { AgentNode } from '@stanley/app-sdk'
import type { ChoiceRequest, ChoiceResult, DecideRequest, DecisionClient, MultiChoiceResult } from '@stanley/jev'
import { Agent, type AgentDeps, type AgentStatus, type TickReport } from '../src/agent'
import type { AgentDebugEvent } from '../src/debug'
import type { Effect } from '../src/effects'
import type { Confirmation, ThinkRequest, Thinker, Writing } from '../src/think'
import type { World } from '../src/world'

const elements: AgentNode[] = [
  { id: 'todo:title', kind: 'input', label: 'Add a task', value: '', children: [{ id: 'todo:add', kind: 'action', role: 'key', label: 'press Enter' }] },
  { id: 'todo:sort', kind: 'action', label: 'Sort' },
  { id: 'todo:item', kind: 'location', label: 'Buy milk' },
  { id: 'todo:delete', kind: 'action', label: 'Delete' },
]

function fakeWorld(opts: { screenChanges?: boolean; failOn?: string } = {}) {
  const performed: string[] = []
  const world: World = {
    screen: () => ({ id: 'todo:list', title: 'To-do', visible: true, markdown: opts.screenChanges ? `${performed.length} done` : '# To-do', elements }),
    appList: () => [
      { id: 'todo', title: 'To-do', description: 'tasks' },
      { id: 'email', title: 'Email', description: 'mail' },
    ],
    open: async (appId) => {
      performed.push(`open ${appId}`)
      return { summary: `Opened ${appId}` }
    },
    perform: async (node, args) => {
      if (node.id === opts.failOn) throw new Error(`${node.id} broke`)
      performed.push(args.text !== undefined ? `${node.id}=${args.text}` : node.id)
      return { summary: `did ${node.id}` }
    },
    global: async (option) => void performed.push(option),
  }
  return { world, performed }
}

interface Pick {
  next: 'listen' | 'act' | 'think' | 'done'
  step?: string
  nextConfidence?: number
  stepConfidence?: number
}
type Script = (req: DecideRequest, call: number) => Pick | Promise<Pick>

function scripted(script: Script, effect: Effect = 'changes'): DecisionClient & { calls: number; effectCalls: number } {
  const client = {
    calls: 0,
    effectCalls: 0,
    async decide(req: DecideRequest): Promise<MultiChoiceResult> {
      const { next, step = 'home', nextConfidence = 0.9, stepConfidence = 0.9 } = await script(req, client.calls++)
      if (!(step in req.questions.step!.options)) throw new Error(`"${step}" not in options: ${Object.keys(req.questions.step!.options).join(', ')}`)
      return {
        answers: {
          next: { choice: next, confidence: nextConfidence, probabilities: { [next]: nextConfidence } },
          step: { choice: step, confidence: stepConfidence, probabilities: { [step]: stepConfidence } },
        },
        latencyMs: 1,
      }
    },
    async choose(_req: ChoiceRequest): Promise<ChoiceResult> {
      client.effectCalls++
      return { choice: effect, probabilities: { [effect]: 1 }, confidence: 1, latencyMs: 1 }
    },
  }
  return client
}

/** Types what the user said, and otherwise says nothing and does nothing. Tests override parts. */
function fakeThinker(over: Partial<Thinker> = {}): Thinker & { runs: ThinkRequest[] } {
  const runs: ThinkRequest[] = []
  return {
    runs,
    run: async (req) => {
      runs.push(req)
      return { text: '' }
    },
    write: async (): Promise<Writing> => ({ source: 'user', text: 'Buy eggs', say: '' }),
    confirm: async (): Promise<Confirmation> => ({ press: true, say: '' }),
    ...over,
  }
}

const settle = () => new Promise((r) => setTimeout(r, 20))

/** A partial as the transcriber delivers it once its words have held across two decodes. */
const say = (agent: Agent, text: string) => {
  agent.partial(text)
  agent.partial(text)
}

function setup(script: Script, opts: { world?: Parameters<typeof fakeWorld>[0]; thinker?: Partial<Thinker>; effect?: Effect; deps?: Partial<AgentDeps> } = {}) {
  const { world, performed } = fakeWorld(opts.world)
  const jev = scripted(script, opts.effect)
  const thinker = fakeThinker(opts.thinker)
  const ticks: TickReport[] = []
  const statuses: AgentStatus[] = []
  const debug: AgentDebugEvent[] = []
  const said: string[] = []
  const agent = new Agent({
    world,
    jev,
    thinker,
    events: { tick: (t) => ticks.push(t), status: (s) => statuses.push(s), debug: (e) => debug.push(e), said: (t) => said.push(t) },
    ...opts.deps,
  })
  return { agent, jev, thinker, performed, ticks, statuses, debug, said }
}

const plan = (...picks: Pick[]): Script => (_, i) => picks[i] ?? { next: 'done' }

describe('Agent status', () => {
  it('guesses until it acts, then thinks, writes and acts until done', async () => {
    const { agent, statuses } = setup(plan({ next: 'act', step: 'open To-do' }, { next: 'act', step: 'Add a task' }, { next: 'act', step: 'Add a task › press Enter' }, { next: 'done' }))
    agent.utteranceStart()
    agent.segment('add buy eggs to my list')
    await settle()
    expect(statuses).toEqual(['guessing', 'acting', 'thinking', 'writing', 'acting', 'thinking', 'acting', 'thinking', 'done'])
  })

  it('listens while the utterance is open, and thinks instead of giving up once it ended', async () => {
    const { agent, statuses, thinker } = setup(() => ({ next: 'listen' }))
    agent.utteranceStart()
    agent.segment('hmm')
    await settle()
    expect(statuses).toEqual(['guessing', 'listening'])
    agent.utteranceEnd()
    await settle()
    expect(statuses.slice(2)).toEqual(['thinking', 'thinking', 'done'])
    expect(thinker.runs).toHaveLength(1)
  })

  it('did not get it when the utterance ended without any words', async () => {
    const { agent, statuses } = setup(() => ({ next: 'listen' }))
    agent.utteranceStart()
    say(agent, 'hmm let me think')
    await settle()
    agent.utteranceStart() // a new utterance, ended before anything was said
    agent.utteranceEnd()
    await settle()
    expect(statuses.at(-1)).toBe('didnt-get-that')
  })
})

describe('Agent loop', () => {
  it('keeps taking steps mid-utterance until done', async () => {
    const { agent, performed } = setup(plan({ next: 'act', step: 'open To-do' }, { next: 'act', step: 'Buy milk' }, { next: 'done' }))
    agent.utteranceStart()
    agent.segment('open buy milk')
    await settle()
    expect(performed).toEqual(['open todo', 'todo:item', 'show'])
  })

  it('navigates mid-word but holds a button press until the user pauses', async () => {
    const { agent, performed, debug } = setup((_, i) => (i === 0 ? { next: 'act', step: 'open To-do' } : { next: 'act', step: 'Sort' }))
    agent.utteranceStart()
    say(agent, 'open my to do and sort')
    await settle()
    expect(performed).toEqual(['open todo'])
    expect(debug.some((e) => e.type === 'gate' && e.rule === 'mid-speech')).toBe(true)
    agent.segment('open my to do and sort')
    await settle()
    expect(performed).toContain('todo:sort')
  })

  it('does not call again after listen until new words arrive', async () => {
    const { agent, jev } = setup(() => ({ next: 'listen' }))
    agent.utteranceStart()
    say(agent, 'add a')
    await settle()
    const calls = jev.calls
    say(agent, 'add a')
    await settle()
    expect(jev.calls).toBe(calls)
    say(agent, 'add a task called')
    await settle()
    expect(jev.calls).toBeGreaterThan(calls)
  })

  it('discards a step decided from a stale transcript and re-decides', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { agent, performed, ticks } = setup(async (_, i) => {
      if (i === 0) {
        await gate
        return { next: 'act', step: 'Sort' }
      }
      return { next: 'done' }
    })
    agent.utteranceStart()
    agent.segment('sort')
    await settle()
    agent.segment('actually delete it')
    release()
    await settle()
    expect(performed).not.toContain('todo:sort')
    expect(ticks[0]!.outcome).toBe('stale-discarded')
  })

  it('still runs a confident navigation decided from a stale transcript', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { agent, performed } = setup(async (_, i) => {
      if (i === 0) {
        await gate
        return { next: 'act', step: 'open Email', stepConfidence: 0.95 }
      }
      return { next: 'listen' }
    })
    agent.utteranceStart()
    say(agent, 'open my email')
    await settle()
    say(agent, 'open my email and')
    release()
    await settle()
    expect(performed).toContain('open email')
  })

  it('re-asks a listen when the utterance ends mid-call', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { agent, jev, thinker } = setup(async (_, i) => {
      if (i === 0) await gate
      return { next: 'listen' }
    })
    agent.utteranceStart()
    agent.segment('hmm')
    await settle()
    agent.utteranceEnd()
    release()
    await settle()
    expect(jev.calls).toBe(2)
    expect(thinker.runs).toHaveLength(1)
  })

  it('needs more confidence to act while the user is speaking than after they finish', async () => {
    const { agent, performed, debug, thinker } = setup(() => ({ next: 'act', step: 'open Email', nextConfidence: 0.5 }))
    agent.utteranceStart()
    say(agent, 'open my email')
    await settle()
    expect(performed).toEqual([])
    expect(debug.find((e) => e.type === 'gate')).toMatchObject({ rule: 'act-confidence', detail: expect.stringContaining('speakingAct 0.6 → listen') })
    agent.segment('open my email')
    agent.utteranceEnd()
    await settle()
    expect(performed).toContain('open email')
    expect(thinker.runs).toHaveLength(0)
  })

  it('hands an unsure step to thinking once the user has finished', async () => {
    const { agent, performed, thinker, debug } = setup(() => ({ next: 'act', step: 'Delete', stepConfidence: 0.2 }))
    agent.utteranceStart()
    agent.segment('get rid of it')
    agent.utteranceEnd()
    await settle()
    expect(performed).not.toContain('todo:delete')
    expect(debug.some((e) => e.type === 'gate' && e.rule === 'step-confidence')).toBe(true)
    expect(thinker.runs[0]!.reason).toContain('[Delete]')
  })

  it('stops when it keeps choosing the same step from the same screen', async () => {
    const { agent, statuses, performed } = setup(() => ({ next: 'act', step: 'Buy milk' }))
    agent.utteranceStart()
    agent.segment('go')
    await settle()
    expect(performed.filter((p) => p === 'todo:item')).toHaveLength(2)
    expect(statuses.at(-1)).toBe('stuck')
    expect(agent.context()).toContain('Stanley stopped: it kept repeating the same step.')
  })

  it('repeats a step that keeps changing the screen', async () => {
    const { agent, performed } = setup((_, i) => (i < 4 ? { next: 'act', step: 'Sort' } : { next: 'done' }), { world: { screenChanges: true } })
    agent.utteranceStart()
    agent.segment('sort four times')
    await settle()
    expect(performed.filter((p) => p === 'todo:sort')).toHaveLength(4)
  })

  it('discards a decision when the user barges in with a new utterance', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { agent, performed } = setup(async (_, i) => {
      if (i === 0) {
        await gate
        return { next: 'act', step: 'Sort' }
      }
      return { next: 'listen' }
    })
    agent.utteranceStart()
    agent.segment('sort')
    await settle()
    agent.utteranceStart()
    say(agent, 'no wait')
    release()
    await settle()
    expect(performed).not.toContain('todo:sort')
  })

  it('logs a step that throws as its result, and reports the error', async () => {
    const { agent, statuses, ticks, debug } = setup(() => ({ next: 'act', step: 'Sort' }), { world: { failOn: 'todo:sort' } })
    agent.utteranceStart()
    agent.segment('sort')
    await settle()
    expect(statuses.at(-1)).toBe('error')
    expect(ticks.at(-1)!.outcome).toBe('error')
    expect(debug.at(-1)).toMatchObject({ type: 'tick-end', outcome: 'error', detail: expect.stringContaining('broke') })
    expect(agent.context()).toContain('Stanley pressed [Sort]: failed (todo:sort broke).')
  })

  it('retries a failed decision when the utterance ends', async () => {
    const { agent, performed } = setup((_, i) => {
      if (i === 0) throw new Error('network')
      return { next: 'act', step: 'Sort' }
    })
    agent.utteranceStart()
    agent.segment('sort')
    await settle()
    expect(performed).toEqual([])
    agent.utteranceEnd()
    await settle()
    expect(performed).toContain('todo:sort')
  })
})

describe('Agent writing', () => {
  it("types the user's words into a field, then carries on with the fast part", async () => {
    const { agent, performed } = setup(plan({ next: 'act', step: 'Add a task' }, { next: 'act', step: 'Add a task › press Enter' }, { next: 'done' }))
    agent.utteranceStart()
    agent.segment('add buy eggs')
    await settle()
    expect(performed).toEqual(['todo:title=Buy eggs', 'todo:add', 'show'])
    expect(agent.context()).toContain('Stanley typed "Buy eggs" into [Add a task].')
  })

  it("marks words Stanley wrote itself, and ends the turn when it has something to say", async () => {
    const { agent, performed, said } = setup(plan({ next: 'act', step: 'Add a task' }), {
      thinker: { write: async () => ({ source: 'stanley', text: 'Ramen? I was born ready.', say: 'I wrote "Ramen? I was born ready." Send it?' }) },
    })
    agent.utteranceStart()
    agent.segment('reply with something funny')
    agent.utteranceEnd()
    await settle()
    expect(performed).toEqual(['todo:title=Ramen? I was born ready.', 'show'])
    expect(said).toEqual(['I wrote "Ramen? I was born ready." Send it?'])
    expect(agent.context()).toContain('Stanley wrote its own words into [Add a task]: "Ramen? I was born ready."')
  })

  it('keeps listening when there is nothing to type yet and the user is mid-turn', async () => {
    const { agent, performed, statuses } = setup(plan({ next: 'act', step: 'Add a task' }), { thinker: { write: async () => ({ source: 'missing', text: '', say: '' }) } })
    agent.utteranceStart()
    agent.segment('add one called')
    await settle()
    expect(performed).toEqual([])
    expect(statuses.at(-1)).toBe('listening')
  })

  it('asks through thinking when the user finished without saying what to type', async () => {
    const { agent, thinker } = setup(plan({ next: 'act', step: 'Add a task' }), { thinker: { write: async () => ({ source: 'missing', text: '', say: '' }) } })
    agent.utteranceStart()
    agent.segment('add one')
    agent.utteranceEnd()
    await settle()
    expect(thinker.runs[0]!.reason).toContain('nothing to type yet')
  })

  it('drops what it was writing when the user keeps talking', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { agent, performed, debug } = setup((_, i) => (i === 0 ? { next: 'act', step: 'Add a task' } : { next: 'listen' }), {
      thinker: {
        write: async ({ signal }) => {
          await gate
          signal.throwIfAborted()
          return { source: 'user', text: 'Buy', say: '' }
        },
      },
    })
    agent.utteranceStart()
    agent.segment('add buy')
    await settle()
    agent.segment('eggs and milk')
    release()
    await settle()
    expect(performed).toEqual([])
    expect(debug.some((e) => e.type === 'write' && e.aborted)).toBe(true)
  })
})

describe('Agent buttons that commit', () => {
  it('runs a button that only changes things without asking', async () => {
    const { agent, performed, jev } = setup(plan({ next: 'act', step: 'Sort' }, { next: 'done' }), { effect: 'changes' })
    agent.utteranceStart()
    agent.segment('sort')
    await settle()
    expect(performed).toContain('todo:sort')
    expect(jev.effectCalls).toBe(1)
  })

  it('asks thinking before pressing a button that commits, and presses it when the user asked', async () => {
    let asked = ''
    const { agent, performed } = setup(plan({ next: 'act', step: 'Delete' }, { next: 'done' }), {
      effect: 'commits',
      thinker: {
        confirm: async ({ option, context }) => {
          asked = `${option} | ${context.split('\n')[1]}`
          return { press: true, say: '' }
        },
      },
    })
    agent.utteranceStart()
    agent.segment('delete it')
    agent.utteranceEnd()
    await settle()
    expect(asked).toBe('Delete | User: delete it')
    expect(performed).toEqual(['todo:delete', 'show'])
  })

  it('says what is ready instead when the user has not asked for it', async () => {
    const { agent, performed, said, statuses } = setup(plan({ next: 'act', step: 'Delete' }), {
      effect: 'commits',
      thinker: { confirm: async () => ({ press: false, say: 'Should I delete it?' }) },
    })
    agent.utteranceStart()
    agent.segment('tidy up')
    agent.utteranceEnd()
    await settle()
    expect(performed).toEqual(['show'])
    expect(said).toEqual(['Should I delete it?'])
    expect(statuses.at(-1)).toBe('done')
  })

  it('judges what a button does once per app and label', async () => {
    const { agent, jev } = setup((_, i) => (i < 2 ? { next: 'act', step: 'Sort' } : { next: 'done' }), { world: { screenChanges: true } })
    agent.utteranceStart()
    agent.segment('sort twice')
    await settle()
    expect(jev.effectCalls).toBe(1)
  })
})

describe('Agent thinking', () => {
  it('acts on the same options, accepts a paraphrased name, and says its text', async () => {
    const { agent, performed, said, thinker } = setup(() => ({ next: 'think' }), {
      thinker: {
        run: async (req) => {
          thinker.runs.push(req)
          const seen = await req.act('add a task', 'Call mom')
          expect(seen).toContain('## Screen: To-do')
          return { text: 'Added it.' }
        },
      },
    })
    agent.utteranceStart()
    agent.segment('remind me to call mom')
    agent.utteranceEnd()
    await settle()
    expect(performed).toEqual(['todo:title=Call mom', 'show'])
    expect(said).toEqual(['Added it.'])
    expect(thinker.runs[0]!.options).toContain('- [Add a task] field, empty')
  })

  it('only takes the turn at a pause, never mid-word', async () => {
    const { agent, thinker, debug } = setup(() => ({ next: 'think' }))
    agent.utteranceStart()
    say(agent, 'what is the')
    await settle()
    expect(thinker.runs).toHaveLength(0)
    expect(debug.some((e) => e.type === 'gate' && e.rule === 'mid-speech')).toBe(true)
  })

  it('drops its run when the user says more, and re-decides with the whole turn', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { agent, said, jev } = setup((_, i) => (i === 0 ? { next: 'think' } : { next: 'listen' }), {
      thinker: {
        run: async ({ signal }) => {
          await gate
          signal.throwIfAborted()
          return { text: 'Here you go.' }
        },
      },
    })
    agent.utteranceStart()
    agent.segment('what is')
    await settle()
    agent.segment('the weather')
    release()
    await settle()
    expect(said).toEqual([])
    expect(jev.calls).toBe(2)
  })
})

describe('Agent task boundaries', () => {
  it('does not re-decide on utterance end after done, and opens a new task on later speech', async () => {
    const { agent, jev } = setup(() => ({ next: 'done' }))
    agent.utteranceStart()
    agent.segment('thanks')
    await settle()
    const calls = jev.calls
    agent.utteranceEnd()
    await settle()
    expect(jev.calls).toBe(calls)
    agent.utteranceStart()
    agent.segment('open email')
    await settle()
    expect(jev.calls).toBe(calls + 1)
    expect(agent.log.entries.filter((e) => e.role === 'event' && e.kind === 'task-start')).toHaveLength(2)
  })
})

describe('Agent debug trace', () => {
  it('records the exact Jev input: the state and both questions', async () => {
    const { agent, debug } = setup(() => ({ next: 'done' }))
    agent.utteranceStart()
    agent.segment('open email')
    await settle()
    const start = debug.find((e) => e.type === 'tick-start')
    expect(start).toMatchObject({ screenId: 'todo:list', questions: { next: { options: { listen: expect.any(String) } }, step: { options: { 'open Email': 'app: mail' } } } })
    if (start?.type !== 'tick-start') throw new Error('no tick-start')
    expect(start.state).toContain('## Conversation\nUser (still speaking): open email')
  })

  it('records requests that did not become a tick', async () => {
    const { agent, debug } = setup(() => ({ next: 'listen' }))
    agent.utteranceStart()
    say(agent, 'open')
    await settle()
    say(agent, 'open')
    expect(debug.filter((e) => e.type === 'request').map((e) => (e.type === 'request' ? e.result : ''))).toContain('no-new-words')
  })
})
