import { describe, expect, it, vi } from 'vitest'
import type { AgentNode } from '@stanley/app-sdk'
import type { ChoiceRequest, ChoiceResult, DecideRequest, DecisionClient, MultiChoiceResult } from '@stanley/jev'
import { Agent, type AgentDeps, type AgentStatus, type TickReport } from '../src/agent'
import { defaultConfig } from '../src/config'
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
    screen: async () => ({ id: 'todo:list', title: 'To-do', visible: true, markdown: opts.screenChanges ? `${performed.length} done` : '# To-do', elements }),
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
  /** P(the user finished saying what the next part needs); default 0.9. */
  heard?: number
}
type Script = (req: DecideRequest, call: number) => Pick | Promise<Pick>

function scripted(script: Script, effect: Effect = 'changes'): DecisionClient & { calls: number; effectCalls: number } {
  const client = {
    calls: 0,
    effectCalls: 0,
    async decide(req: DecideRequest): Promise<MultiChoiceResult> {
      const { next, step = 'home', nextConfidence = 0.9, stepConfidence = 0.9, heard = 0.9 } = await script(req, client.calls++)
      if (!(step in req.questions.step!.options)) throw new Error(`"${step}" not in options: ${Object.keys(req.questions.step!.options).join(', ')}`)
      return {
        answers: {
          next: { choice: next, confidence: nextConfidence, probabilities: { [next]: nextConfidence } },
          step: { choice: step, confidence: stepConfidence, probabilities: { [step]: stepConfidence } },
          heard: { choice: heard >= 0.5 ? 'finished' : 'more', confidence: Math.max(heard, 1 - heard), probabilities: { finished: heard, more: 1 - heard } },
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

/** A segment at a pause whose voice sounds finished, as the transcriber delivers it with Smart Turn. */
const spoke = (agent: Agent, text: string, voice = 0.9) => {
  agent.voice(false)
  agent.pause({ complete: voice })
  agent.segment(text)
}

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
    spoke(agent, 'add buy eggs to my list')
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
    spoke(agent, 'open my to do and sort')
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

  it('thinks instead of listening when the utterance ends mid-call', async () => {
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
    // The decision already sees the utterance over, so the listen goes straight to thinking.
    expect(jev.calls).toBe(1)
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
    expect(thinker.runs[0]!.reason).toBe('No step stood out clearly.')
  })

  it('stops when it keeps choosing the same step from the same screen', async () => {
    const { agent, statuses, performed } = setup(() => ({ next: 'act', step: 'Buy milk' }))
    agent.utteranceStart()
    agent.segment('go')
    await settle()
    expect(performed.filter((p) => p === 'todo:item')).toHaveLength(2)
    expect(statuses.at(-1)).toBe('stuck')
    expect(await agent.context()).toContain('Stanley stopped: it kept repeating the same step.')
  })

  it('repeats a step that keeps changing the screen', async () => {
    const { agent, performed } = setup((_, i) => (i < 4 ? { next: 'act', step: 'Sort' } : { next: 'done' }), { world: { screenChanges: true } })
    agent.utteranceStart()
    spoke(agent, 'sort four times')
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

  it('logs a step that fails and keeps going, so the next decision can work around it', async () => {
    const seen: string[] = []
    const { agent, performed, statuses } = setup(
      (req, i) => {
        seen.push(req.state)
        return i === 0 ? { next: 'act', step: 'Sort' } : i === 1 ? { next: 'act', step: 'Buy milk' } : { next: 'done' }
      },
      { world: { failOn: 'todo:sort' } },
    )
    agent.utteranceStart()
    spoke(agent, 'sort')
    await settle()
    expect(seen[1]).toContain('Stanley pressed [Sort]: failed (todo:sort broke).')
    expect(performed).toEqual(['todo:item', 'show'])
    expect(statuses.at(-1)).toBe('done')
  })

  it('stops a step that keeps failing', async () => {
    const { agent, statuses } = setup(() => ({ next: 'act', step: 'Sort' }), { world: { failOn: 'todo:sort' } })
    agent.utteranceStart()
    spoke(agent, 'sort')
    await settle()
    expect(statuses.at(-1)).toBe('stuck')
  })

  it('reports an error when the decision itself fails', async () => {
    const { agent, statuses, ticks } = setup(() => {
      throw new Error('gateway down')
    })
    agent.utteranceStart()
    agent.segment('sort')
    await settle()
    expect(statuses.at(-1)).toBe('error')
    expect(ticks.at(-1)!.outcome).toBe('error')
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
    spoke(agent, 'add buy eggs')
    await settle()
    expect(performed).toEqual(['todo:title=Buy eggs', 'todo:add', 'show'])
    expect(await agent.context()).toContain('Stanley typed "Buy eggs" into [Add a task].')
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
    expect(await agent.context()).toContain('Stanley wrote its own words into [Add a task]: "Ramen? I was born ready."')
  })

  it('writes a field Jev is sure of with one call, even when it chose to think', async () => {
    const { agent, performed, thinker } = setup(plan({ next: 'think', step: 'Add a task', stepConfidence: 0.97 }, { next: 'done' }))
    agent.utteranceStart()
    agent.segment('add buy eggs')
    agent.utteranceEnd()
    await settle()
    expect(performed[0]).toBe('todo:title=Buy eggs')
    expect(thinker.runs).toHaveLength(0)
  })

  it('reads back its own words word for word, even when thinking paraphrased them', async () => {
    const { agent, said } = setup(plan({ next: 'act', step: 'Add a task' }), {
      thinker: { write: async () => ({ source: 'stanley', text: 'Ramen? I was born ready.', say: 'I drafted something playful.' }) },
    })
    agent.utteranceStart()
    agent.segment('reply with something funny')
    agent.utteranceEnd()
    await settle()
    expect(said).toEqual(['I wrote: "Ramen? I was born ready." Should I go ahead?'])
  })

  it('fills in a short value without reading it back, even when thinking calls it its own', async () => {
    const { agent, performed, said } = setup(plan({ next: 'act', step: 'Add a task' }, { next: 'done' }), {
      thinker: { write: async () => ({ source: 'stanley', text: '4 people', say: '' }) },
    })
    agent.utteranceStart()
    agent.segment('a table for four')
    agent.utteranceEnd()
    await settle()
    expect(performed).toEqual(['todo:title=4 people', 'show'])
    expect(said).toEqual([])
  })

  it('keeps listening when there is nothing to type yet and the user is mid-turn', async () => {
    const { agent, performed, statuses } = setup(plan({ next: 'act', step: 'Add a task' }), { thinker: { write: async () => ({ source: 'missing', text: '', say: '' }) } })
    agent.utteranceStart()
    agent.segment('add one called')
    await settle()
    expect(performed).toEqual([])
    expect(statuses.at(-1)).toBe('listening')
  })

  it('waits through a long pause on a field without counting it as a step', async () => {
    let typed = false
    const { agent, performed, statuses } = setup(() => ({ next: 'act', step: 'Add a task' }), {
      thinker: { write: async () => (typed ? { source: 'user', text: 'Avocado', say: '' } : { source: 'missing', text: '', say: '' }) },
    })
    agent.utteranceStart()
    for (const words of ['add one called', 'um', 'uh', 'hmm']) {
      agent.segment(words)
      await settle()
    }
    expect(statuses).not.toContain('stuck')
    typed = true
    agent.segment('avocado')
    await settle()
    expect(performed[0]).toBe('todo:title=Avocado')
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

describe('Agent and misheard words', () => {
  it('marks words speech recognition was unsure of in what the models read', async () => {
    const states: string[] = []
    const { agent } = setup((req) => (states.push(req.state), { next: 'listen' }))
    agent.utteranceStart()
    agent.segment('pay the Aconquo invoice', [
      { word: 'pay', confidence: 0.9 },
      { word: 'the', confidence: 0.9 },
      { word: 'Aconquo', confidence: 0.3 },
      { word: 'invoice', confidence: 0.95 },
    ])
    await settle()
    expect(states.at(-1)).toContain('User (still speaking): pay the Aconquo(?) invoice')
  })

  it('asks instead of typing when the words for a field look misheard', async () => {
    const { agent, performed, said } = setup(plan({ next: 'act', step: 'Add a task' }), {
      thinker: { write: async () => ({ source: 'unclear', text: '', say: 'I heard "how do you do to do". What should the to-do say?' }) },
    })
    agent.utteranceStart()
    agent.segment('add how do you do to do')
    agent.utteranceEnd()
    await settle()
    expect(performed.filter((p) => p.startsWith('todo:title'))).toEqual([])
    expect(said).toEqual(['I heard "how do you do to do". What should the to-do say?'])
  })

  it("says back the user's words once they are committed, never their marks", async () => {
    const { agent, performed, said } = setup(plan({ next: 'act', step: 'Add a task' }, { next: 'act', step: 'Add a task › press Enter' }, { next: 'done' }), {
      thinker: { write: async () => ({ source: 'user', text: 'Pay the Okonkwo(?) invoice', say: '' }) },
    })
    agent.utteranceStart()
    agent.segment('add pay the Okonkwo invoice')
    agent.utteranceEnd()
    await settle()
    expect(performed.slice(0, 2)).toEqual(['todo:title=Pay the Okonkwo invoice', 'todo:add'])
    expect(said).toEqual(['Done: "Pay the Okonkwo invoice"'])
  })

  it('reads back the words before pressing something that commits, when some were unsure', async () => {
    const { agent, performed, said, thinker } = setup(plan({ next: 'act', step: 'Add a task' }, { next: 'act', step: 'Delete' }), {
      effect: 'commits',
      thinker: { write: async () => ({ source: 'user', text: "I'm in, see you Friday", say: '' }) },
    })
    const confirm = vi.spyOn(thinker, 'confirm')
    agent.utteranceStart()
    agent.segment("reply I'm in see you fry day", [
      ...["reply", "I'm", 'in', 'see', 'you'].map((word) => ({ word, confidence: 0.95 })),
      { word: 'fry', confidence: 0.3 },
      { word: 'day', confidence: 0.4 },
    ])
    agent.utteranceEnd()
    await settle()
    expect(performed).not.toContain('todo:delete')
    expect(confirm).not.toHaveBeenCalled()
    expect(said).toEqual(['I heard: "I\'m in, see you Friday". Should I go ahead?'])
  })

  it('does not echo a value it only typed, or a single word', async () => {
    const { agent, said } = setup(plan({ next: 'act', step: 'Add a task' }, { next: 'done' }), {
      thinker: { write: async () => ({ source: 'user', text: 'Denver', say: '' }) },
    })
    agent.utteranceStart()
    agent.segment('weather in denver')
    agent.utteranceEnd()
    await settle()
    expect(said).toEqual([])
  })
})

describe('Agent buttons that commit', () => {
  it('runs a button that only changes things without asking', async () => {
    const { agent, performed, jev } = setup(plan({ next: 'act', step: 'Sort' }, { next: 'done' }), { effect: 'changes' })
    agent.utteranceStart()
    spoke(agent, 'sort')
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
    spoke(agent, 'sort twice')
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

describe('Agent turn-taking', () => {
  const quick = { ...defaultConfig, endpoint: { fastMs: 30, normalMs: 80, slowMs: 200, moreBelow: 0.25, resumeMs: 2000 } }

  it('types the user\'s words at a pause, but holds Enter until they finish the thought', async () => {
    const titles = ['Buy', 'Buy oat milk']
    let writes = 0
    const { agent, performed, jev } = setup(
      (req, i) => {
        const words = req.state.includes('oat milk')
        if (!words) return i === 0 ? { next: 'act', step: 'Add a task', heard: 0.1 } : { next: 'act', step: 'Add a task › press Enter', heard: 0.1 }
        return performed.at(-1) === 'todo:title=Buy oat milk' ? { next: 'act', step: 'Add a task › press Enter' } : { next: 'act', step: 'Add a task' }
      },
      { thinker: { write: async () => ({ source: 'user', text: titles[writes++] ?? 'Buy oat milk', say: '' }) } },
    )
    agent.utteranceStart()
    spoke(agent, 'add a task buy', 0.2)
    await settle()
    expect(performed).toEqual(['todo:title=Buy'])
    const calls = jev.calls
    agent.voice(true)
    say(agent, 'oat milk')
    spoke(agent, 'oat milk')
    await settle()
    expect(jev.calls).toBeGreaterThan(calls)
    expect(performed.slice(0, 3)).toEqual(['todo:title=Buy', 'todo:title=Buy oat milk', 'todo:add'])
  })

  it('runs a held change without asking again once the voice says the thought is finished', async () => {
    const { agent, performed, jev, debug } = setup(plan({ next: 'act', step: 'Sort' }, { next: 'done' }))
    agent.utteranceStart()
    spoke(agent, 'sort my list', 0.1)
    await settle()
    expect(performed).toEqual([])
    expect(debug.some((e) => e.type === 'gate' && e.rule === 'thought-open')).toBe(true)
    const calls = jev.calls
    agent.pause({ complete: 0.9 })
    await settle()
    expect(performed).toContain('todo:sort')
    expect(jev.calls).toBe(calls + 1) // only the decision after the step
  })

  it('decides again when the turn ends on a change held while the words sounded unfinished', async () => {
    const { agent, performed, jev } = setup((_, i) => (i === 0 ? { next: 'act', step: 'Sort', heard: 0.2 } : { next: 'listen', heard: 0.2 }))
    agent.utteranceStart()
    spoke(agent, 'sort by')
    await settle()
    agent.utteranceEnd()
    await settle()
    expect(performed).not.toContain('todo:sort')
    expect(jev.calls).toBe(2)
  })

  it('holds a press that commits until the turn ends', async () => {
    const { agent, performed } = setup(plan({ next: 'act', step: 'Delete' }, { next: 'done' }), { effect: 'commits' })
    agent.utteranceStart()
    spoke(agent, 'delete it')
    await settle()
    expect(performed).toEqual([])
    agent.utteranceEnd()
    await settle()
    expect(performed).toEqual(['todo:delete', 'show'])
  })

  it('says nothing until the user finishes, and drops it if they keep going', async () => {
    const { agent, said, debug } = setup(() => ({ next: 'think' }), { thinker: { run: async () => ({ text: 'It is sunny.' }) } })
    agent.utteranceStart()
    spoke(agent, "what's the weather")
    await settle()
    expect(said).toEqual([])
    agent.voice(true)
    say(agent, 'in Paris')
    await settle()
    expect(debug.some((e) => e.type === 'say' && e.result === 'dropped')).toBe(true)
    agent.utteranceEnd()
    await settle()
    expect(said).toEqual(['It is sunny.'])
  })

  it('ends the turn quickly when words and voice agree, and waits when the words trail off', async () => {
    const ended: number[] = []
    const run = async (heard: number) => {
      const { agent } = setup(() => ({ next: 'listen', heard }), { deps: { config: quick, events: { turnEnd: () => ended.push(Date.now() - start) } } })
      const start = Date.now()
      agent.utteranceStart()
      spoke(agent, 'hello there')
      await new Promise((r) => setTimeout(r, 400))
    }
    await run(0.9)
    await run(0.1)
    expect(ended[0]).toBeLessThan(80)
    expect(ended[1]).toBeGreaterThanOrEqual(190)
  })

  it('joins speech soon after an early end to the same utterance, so it reads as one sentence', async () => {
    const states: string[] = []
    const { agent } = setup(
      (req) => {
        states.push(req.state)
        return { next: 'listen' }
      },
      { deps: { config: quick } },
    )
    agent.utteranceStart()
    spoke(agent, 'tick off the passport one')
    await new Promise((r) => setTimeout(r, 150))
    expect(agent.turnOpen).toBe(false)
    agent.utteranceStart()
    agent.voice(true)
    say(agent, 'no wait the dentist one')
    await settle()
    expect(agent.turnOpen).toBe(true)
    expect(states.at(-1)).toContain('User (still speaking): tick off the passport one no wait the dentist one')
  })

  it('never ends the turn while the user is speaking', async () => {
    let ended = false
    const { agent } = setup(() => ({ next: 'listen' }), { deps: { config: quick, events: { turnEnd: () => (ended = true) } } })
    agent.utteranceStart()
    spoke(agent, 'so')
    agent.voice(true)
    await new Promise((r) => setTimeout(r, 300))
    expect(ended).toBe(false)
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
