import { describe, expect, it, vi } from 'vitest'
import type { AgentNode } from '@stanley/app-sdk'
import type { ChoiceRequest, ChoiceResult, DecideRequest, DecisionClient, MultiChoiceResult } from '@stanley/jev'
import { Agent, type AgentDeps, type AgentStatus, type TickReport } from '../src/agent'
import { defaultConfig } from '../src/config'
import { validate } from '../src/conversation'
import type { AgentDebugEvent } from '../src/debug'
import type { Effect } from '../src/effects'
import { topFiles, type FileTools } from '../src/files'
import type { SkillScan } from '../src/skills'
import { DONE_CHECK, scriptedTurn, type FileOutput, type ThinkRequest, type Thinker, type ThinkResult } from '../src/think'
import type { WebTools } from '../src/web'
import type { World } from '../src/world'

const elements: AgentNode[] = [
  { id: 'tasks:title', kind: 'input', label: 'Add a task', value: '', children: [{ id: 'tasks:add', kind: 'action', role: 'key', label: 'press Enter' }] },
  { id: 'tasks:sort', kind: 'action', label: 'Sort' },
  { id: 'tasks:item', kind: 'location', label: 'Buy milk' },
  { id: 'tasks:delete', kind: 'action', label: 'Delete' },
]

function fakeWorld(opts: { screenChanges?: boolean; failOn?: string; titles?: Record<string, string> } = {}) {
  const performed: string[] = []
  const world: World = {
    screen: async () => ({ id: 'tasks:list', title: 'Tasks', visible: true, markdown: opts.screenChanges ? `${performed.length} done` : '# Tasks', elements }),
    appList: () => [
      { id: 'tasks', title: 'Tasks', description: 'tasks' },
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
    openUrl: async (url) => {
      performed.push(`url ${url}`)
      return { summary: `Opened ${url}`, title: opts.titles?.[url] }
    },
    fileUrl: (path) => (/\.(html|pdf)$/.test(path) && !path.startsWith('missing') ? `stanley://files/${path.replace(/^~\/Wren\//, '')}` : undefined),
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

/** Jev's judgement of words said while thinking works, by the words: P(stop), P(hold), P(elsewhere). */
type Working = (heard: string) => Partial<Record<'stop' | 'hold' | 'elsewhere', number>>

function scripted(script: Script, effect: Effect = 'changes', working: Working = () => ({ stop: 1 })): DecisionClient & { calls: number; effectCalls: number; heardWhileWorking: string[] } {
  const client = {
    calls: 0,
    effectCalls: 0,
    heardWhileWorking: [] as string[],
    async decide(req: DecideRequest): Promise<MultiChoiceResult> {
      const { next, step = 'home screen', nextConfidence = 0.9, stepConfidence = 0.9, heard = 0.9 } = await script(req, client.calls++)
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
    async choose(req: ChoiceRequest): Promise<ChoiceResult> {
      if ('hold' in req.options) {
        const heard = req.state.split('## What the user said while it works\n\n')[1]!.replace(/"/g, '')
        client.heardWhileWorking.push(heard)
        const probabilities = { stop: 0, hold: 0, elsewhere: 0, ...working(heard) }
        const choice = Object.entries(probabilities).sort(([, a], [, b]) => b - a)[0]![0]
        return { choice, probabilities, confidence: probabilities[choice as 'stop'], latencyMs: 1 }
      }
      client.effectCalls++
      return { choice: effect, probabilities: { [effect]: 1 }, confidence: 1, latencyMs: 1 }
    },
  }
  return client
}

/** What a single-step turn on a field decides, as a test states it. */
interface Writing {
  source: 'user' | 'stanley' | 'missing' | 'unclear'
  text: string
  say: string
}

/** Thinking stand-ins: a full turn, and the single-step turns on a field and on a button that commits. */
interface FakeThinking {
  run?: (req: ThinkRequest) => Promise<{ text: string } | ThinkResult>
  /** Any single-step turn, as it comes back: before `write` and `confirm`. */
  single?: (req: ThinkRequest) => Promise<ThinkResult>
  write?: (req: ThinkRequest) => Promise<Writing>
  confirm?: (req: ThinkRequest) => Promise<{ press: boolean; say: string }>
}

/** Types what the user said, presses when asked, and otherwise says nothing and does nothing. Tests override parts. */
function fakeThinker(over: FakeThinking = {}): Thinker & { runs: ThinkRequest[]; writes: ThinkRequest[]; confirms: ThinkRequest[] } {
  const runs: ThinkRequest[] = []
  const writes: ThinkRequest[] = []
  const confirms: ThinkRequest[] = []
  return {
    runs,
    writes,
    confirms,
    async run(req) {
      const option = req.single?.option ?? ''
      if (req.single && over.single) return over.single(req)
      if (req.single?.kind === 'write') {
        writes.push(req)
        const w = await (over.write ?? (async () => ({ source: 'user', text: 'Buy eggs', say: '' }) as Writing))(req)
        if (w.source === 'user' || w.source === 'stanley') return scriptedTurn(w.say, { option, text: w.text, wrote: w.source })
        return scriptedTurn(w.source === 'unclear' ? w.say : '')
      }
      if (req.single?.kind === 'confirm') {
        confirms.push(req)
        const c = await (over.confirm ?? (async () => ({ press: true, say: '' })))(req)
        return c.press ? scriptedTurn('', { option }) : scriptedTurn(c.say)
      }
      runs.push(req)
      const result = await (over.run ?? (async () => ({ text: '' })))(req)
      return 'messages' in result ? result : scriptedTurn(result.text)
    },
  }
}

/** What the last thinking call was sent as its observation. */
const observation = (req: ThinkRequest) => String(req.messages.at(-1)!.content)
const handover = (debug: AgentDebugEvent[]) => debug.flatMap((e) => (e.type === 'think-start' && e.mode === 'run' ? [e.handover] : []))

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

function setup(script: Script, opts: { world?: Parameters<typeof fakeWorld>[0]; thinker?: FakeThinking; effect?: Effect; working?: Working; deps?: Partial<AgentDeps> } = {}) {
  const { world, performed } = fakeWorld(opts.world)
  const jev = scripted(script, opts.effect, opts.working)
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
    const { agent, statuses } = setup(plan({ next: 'act', step: 'open Tasks' }, { next: 'act', step: 'Add a task' }, { next: 'act', step: 'Add a task › press Enter' }, { next: 'done' }))
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
    const { agent, performed } = setup(plan({ next: 'act', step: 'open Tasks' }, { next: 'act', step: 'Buy milk' }, { next: 'done' }))
    agent.utteranceStart()
    agent.segment('open buy milk')
    await settle()
    expect(performed).toEqual(['open tasks', 'tasks:item', 'show'])
  })

  it('navigates and makes an undoable change mid-word once Jev is sure it heard enough', async () => {
    const { agent, performed, debug } = setup((_, i) => (i === 0 ? { next: 'act', step: 'open Tasks' } : i === 1 ? { next: 'act', step: 'Sort' } : { next: 'done' }))
    agent.utteranceStart()
    agent.voice(true)
    say(agent, 'open my to do and sort')
    await settle()
    expect(performed.slice(0, 2)).toEqual(['open tasks', 'tasks:sort'])
    expect(debug.some((e) => e.type === 'gate' && e.rule === 'mid-speech')).toBe(false)
  })

  it('holds an undoable change mid-word while Jev hears more coming, and decides again with the words', async () => {
    const { agent, performed, debug } = setup((req) => (req.state.includes('by date') ? { next: 'act', step: 'Sort' } : { next: 'act', step: 'Sort', heard: 0.2 }))
    agent.utteranceStart()
    agent.voice(true)
    say(agent, 'sort my list by')
    await settle()
    expect(performed).toEqual([])
    expect(debug.some((e) => e.type === 'gate' && e.rule === 'mid-speech')).toBe(true)
    say(agent, 'sort my list by date')
    await settle()
    expect(performed).toContain('tasks:sort')
  })

  it('closes a task with an early press when Jev is sure it is done, and has thinking check it when not', async () => {
    for (const [doneP, runs] of [[0.9, 0], [0.6, 1]] as const) {
      let ended = false
      const { agent, thinker, performed } = setup((_, i) => (i === 0 ? { next: 'act', step: 'Sort' } : ended ? { next: 'done', nextConfidence: doneP } : { next: 'listen' }))
      agent.utteranceStart()
      agent.voice(true)
      say(agent, 'sort my list')
      await settle()
      say(agent, 'sort my list and that is all')
      await settle()
      agent.voice(false)
      agent.segment('sort my list and that is all')
      ended = true
      agent.utteranceEnd()
      await settle()
      expect(performed).toContain('tasks:sort')
      expect(thinker.runs).toHaveLength(runs)
    }
  })

  it('holds a press that commits while the user is speaking', async () => {
    const { agent, performed, debug } = setup(() => ({ next: 'act', step: 'Delete' }), { effect: 'commits' })
    agent.utteranceStart()
    agent.voice(true)
    say(agent, 'delete it')
    await settle()
    expect(performed).toEqual([])
    expect(debug.some((e) => e.type === 'gate' && e.rule === 'mid-speech')).toBe(true)
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
        return { next: 'act', step: 'Sort', stepConfidence: 0.7 }
      }
      return { next: 'done' }
    })
    agent.utteranceStart()
    agent.segment('sort')
    await settle()
    agent.segment('actually delete it')
    release()
    await settle()
    expect(performed).not.toContain('tasks:sort')
    expect(ticks[0]!.outcome).toBe('stale-discarded')
  })

  it('still presses a sure undoable button when the new words only add to the ones it decided on', async () => {
    for (const [later, runs] of [['sort my list please', true], ['sort my lists please', false]] as const) {
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
      agent.voice(true)
      say(agent, 'sort my list')
      await settle()
      say(agent, later)
      release()
      await settle()
      expect(performed.includes('tasks:sort')).toBe(runs)
    }
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

  it('lets a done stand when new words arrive during the call, and decides on the new words', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { agent, jev, ticks, thinker } = setup(async (_, i) => {
      if (i === 0) {
        await gate
        return { next: 'done', nextConfidence: 0.3 }
      }
      return { next: 'listen' }
    })
    agent.utteranceStart()
    agent.segment('open my email')
    await settle()
    agent.segment('and play some music')
    release()
    await settle()
    expect(ticks[0]).toMatchObject({ effective: 'done', outcome: 'executed' })
    expect(jev.calls).toBe(2)
    expect(thinker.runs).toHaveLength(0)
  })

  it('does not decide again when the same words settle, finalize or come back re-punctuated', async () => {
    const { agent, jev } = setup(() => ({ next: 'listen' }))
    agent.utteranceStart()
    agent.voice(true)
    agent.partial('Play Lofi Chillout and')
    agent.partial('Play Lofi Chillout and go to my Email.')
    await settle()
    const calls = jev.calls
    expect(calls).toBe(1)
    agent.partial('Play Lofi Chillout and go to my Email.')
    agent.segment('Play Lo-Fi, chill out, and go to my email.')
    await settle()
    expect(jev.calls).toBe(calls)
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
    const { agent, performed, debug, thinker } = setup(() => ({ next: 'act', step: 'open Email', nextConfidence: 0.5, stepConfidence: 0.6 }))
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

  it('goes somewhere it is sure of mid-speech with less certainty that now is the time', async () => {
    const { agent, performed } = setup((_, i) => (i === 0 ? { next: 'act', step: 'open Email', nextConfidence: 0.45, stepConfidence: 0.8 } : { next: 'listen' }))
    agent.utteranceStart()
    agent.voice(true)
    say(agent, 'go to my email')
    await settle()
    expect(performed).toEqual(['open email'])
  })

  it('closes quietly, without thinking, when it only went somewhere and Jev is unsure it is done', async () => {
    for (const last of [{ next: 'done', nextConfidence: 0.3 }, { next: 'listen' }] as const) {
      let ended = false
      const { agent, performed, thinker, said } = setup((_, i) => (i === 0 ? { next: 'act', step: 'open Email' } : ended ? last : { next: 'listen' }))
      agent.utteranceStart()
      agent.segment('go to my email')
      await settle()
      ended = true
      agent.utteranceEnd()
      await settle()
      expect(performed).toContain('open email')
      expect(thinker.runs).toHaveLength(0)
      expect(said).toEqual([])
    }
  })

  it('still has thinking check a place it went to before the user finished', async () => {
    let ended = false
    const { agent, thinker } = setup((_, i) => (i === 0 ? { next: 'act', step: 'open Email' } : ended ? { next: 'done', nextConfidence: 0.3 } : { next: 'listen' }))
    agent.utteranceStart()
    agent.voice(true)
    say(agent, 'open the one')
    await settle()
    agent.voice(false)
    agent.segment('open the one from Priya')
    await settle()
    ended = true
    agent.utteranceEnd()
    await settle()
    expect(thinker.runs).toHaveLength(1)
  })

  it('still has thinking check when it changed something and Jev is unsure it is done', async () => {
    let ended = false
    const { agent, thinker } = setup((_, i) => (i === 0 ? { next: 'act', step: 'Sort' } : ended ? { next: 'done', nextConfidence: 0.3 } : { next: 'listen' }))
    agent.utteranceStart()
    agent.segment('sort it')
    await settle()
    ended = true
    agent.utteranceEnd()
    await settle()
    expect(thinker.runs).toHaveLength(1)
  })

  it('hands an unsure step to thinking once the user has finished', async () => {
    const { agent, performed, thinker, debug } = setup(() => ({ next: 'act', step: 'Delete', stepConfidence: 0.2 }))
    agent.utteranceStart()
    agent.segment('get rid of it')
    agent.utteranceEnd()
    await settle()
    expect(performed).not.toContain('tasks:delete')
    expect(debug.some((e) => e.type === 'gate' && e.rule === 'step-confidence')).toBe(true)
    expect(thinker.runs).toHaveLength(1)
    expect(handover(debug)).toEqual(['no step stood out clearly'])
  })

  it('tells thinking to say nothing when an unsure done-check finds nothing left', async () => {
    // A change, not just going somewhere: a task that only navigated closes without checking.
    const { agent, performed, thinker } = setup(plan({ next: 'act', step: 'Sort' }, { next: 'done', nextConfidence: 0.3 }))
    agent.utteranceStart()
    agent.segment('sort my list')
    agent.utteranceEnd()
    await settle()
    expect(performed).toContain('tasks:sort')
    expect(thinker.runs).toHaveLength(1)
    expect(observation(thinker.runs[0]!)).toContain(`<note>${DONE_CHECK}</note>`)
  })

  it('stops when it keeps choosing the same step from the same screen', async () => {
    const { agent, statuses, performed } = setup(() => ({ next: 'act', step: 'Buy milk' }))
    agent.utteranceStart()
    agent.segment('go')
    await settle()
    expect(performed.filter((p) => p === 'tasks:item')).toHaveLength(2)
    expect(statuses.at(-1)).toBe('stuck')
    expect(await agent.context()).toContain('Wren stopped: it kept repeating the same step.')
  })

  it('repeats a step that keeps changing the screen', async () => {
    const { agent, performed } = setup((_, i) => (i < 4 ? { next: 'act', step: 'Sort' } : { next: 'done' }), { world: { screenChanges: true } })
    agent.utteranceStart()
    spoke(agent, 'sort four times')
    await settle()
    expect(performed.filter((p) => p === 'tasks:sort')).toHaveLength(4)
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
    expect(performed).not.toContain('tasks:sort')
  })

  it('logs a step that fails and keeps going, so the next decision can work around it', async () => {
    const seen: string[] = []
    const { agent, performed, statuses } = setup(
      (req, i) => {
        seen.push(req.state)
        return i === 0 ? { next: 'act', step: 'Sort' } : i === 1 ? { next: 'act', step: 'Buy milk' } : { next: 'done' }
      },
      { world: { failOn: 'tasks:sort' } },
    )
    agent.utteranceStart()
    spoke(agent, 'sort')
    await settle()
    expect(seen[1]).toContain('Wren pressed [Sort]: failed (tasks:sort broke).')
    expect(performed).toEqual(['tasks:item', 'show'])
    expect(statuses.at(-1)).toBe('done')
  })

  it('stops a step that keeps failing', async () => {
    const { agent, statuses } = setup(() => ({ next: 'act', step: 'Sort' }), { world: { failOn: 'tasks:sort' } })
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
    expect(performed).toContain('tasks:sort')
  })
})

describe('Agent writing', () => {
  it("types the user's words into a field, then carries on with the fast part", async () => {
    const { agent, performed } = setup(plan({ next: 'act', step: 'Add a task' }, { next: 'act', step: 'Add a task › press Enter' }, { next: 'done' }))
    agent.utteranceStart()
    spoke(agent, 'add buy eggs')
    await settle()
    expect(performed).toEqual(['tasks:title=Buy eggs', 'tasks:add', 'show'])
    expect(await agent.context()).toContain('Wren typed "Buy eggs" into [Add a task].')
  })

  it("marks words Wren wrote itself, and ends the turn when it has something to say", async () => {
    const { agent, performed, said } = setup(plan({ next: 'act', step: 'Add a task' }), {
      thinker: { write: async () => ({ source: 'stanley', text: 'Ramen? I was born ready.', say: 'I wrote "Ramen? I was born ready." Send it?' }) },
    })
    agent.utteranceStart()
    agent.segment('reply with something funny')
    agent.utteranceEnd()
    await settle()
    expect(performed).toEqual(['tasks:title=Ramen? I was born ready.', 'show'])
    expect(said).toEqual(['I wrote "Ramen? I was born ready." Send it?'])
    expect(await agent.context()).toContain('Wren wrote its own words into [Add a task]: "Ramen? I was born ready."')
  })

  it('writes a field Jev is sure of with one call, even when it chose to think', async () => {
    const { agent, performed, thinker } = setup(plan({ next: 'think', step: 'Add a task', stepConfidence: 0.97 }, { next: 'done' }))
    agent.utteranceStart()
    agent.segment('add buy eggs')
    agent.utteranceEnd()
    await settle()
    expect(performed[0]).toBe('tasks:title=Buy eggs')
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
    // What thinking said may already be playing, so the words follow it.
    expect(said).toEqual(['I drafted something playful. I wrote: "Ramen? I was born ready." Should I go ahead?'])
  })

  it('fills in a short value without reading it back, even when thinking calls it its own', async () => {
    const { agent, performed, said } = setup(plan({ next: 'act', step: 'Add a task' }, { next: 'done' }), {
      thinker: { write: async () => ({ source: 'stanley', text: '4 people', say: '' }) },
    })
    agent.utteranceStart()
    agent.segment('a table for four')
    agent.utteranceEnd()
    await settle()
    expect(performed).toEqual(['tasks:title=4 people', 'show'])
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
    expect(performed[0]).toBe('tasks:title=Avocado')
  })

  it('asks through thinking when the user finished without saying what to type', async () => {
    const { agent, thinker, debug } = setup(plan({ next: 'act', step: 'Add a task' }), { thinker: { write: async () => ({ source: 'missing', text: '', say: '' }) } })
    agent.utteranceStart()
    agent.segment('add one')
    agent.utteranceEnd()
    await settle()
    expect(thinker.runs).toHaveLength(1)
    expect(handover(debug)[0]).toContain('nothing to type yet')
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
    expect(debug.some((e) => e.type === 'think-start' && e.mode === 'write')).toBe(true)
    expect(debug.some((e) => e.type === 'think-end' && e.aborted)).toBe(true)
  })
})

describe('Agent and misheard words', () => {
  it('marks words speech recognition was unsure of in what the models read', async () => {
    const states: string[] = []
    const { agent, debug } = setup((req) => (states.push(req.state), { next: 'listen' }))
    agent.utteranceStart()
    agent.segment('pay the Aconquo invoice', [
      { word: 'pay', confidence: 0.9 },
      { word: 'the', confidence: 0.9 },
      { word: 'Aconquo', confidence: 0.3 },
      { word: 'invoice', confidence: 0.95 },
    ])
    await settle()
    expect(states.at(-1)).toContain('User (still speaking): pay the Aconquo(?) invoice')
    // The agent's own transcript keeps the words as said.
    const ticked = debug.find((e) => e.type === 'tick-start')
    expect(ticked && 'transcript' in ticked && ticked.transcript).toEqual({ finalized: ['pay the Aconquo invoice'], partial: '', previous: '' })
  })

  it('asks instead of typing when the words for a field look misheard', async () => {
    const { agent, performed, said } = setup(plan({ next: 'act', step: 'Add a task' }), {
      thinker: { write: async () => ({ source: 'unclear', text: '', say: 'I heard "how do you do to do". What should the task say?' }) },
    })
    agent.utteranceStart()
    agent.segment('add how do you do to do')
    agent.utteranceEnd()
    await settle()
    expect(performed.filter((p) => p.startsWith('tasks:title'))).toEqual([])
    expect(said).toEqual(['I heard "how do you do to do". What should the task say?'])
  })

  it("says back the user's words once they are committed, never their marks", async () => {
    const { agent, performed, said } = setup(plan({ next: 'act', step: 'Add a task' }, { next: 'act', step: 'Add a task › press Enter' }, { next: 'done' }), {
      thinker: { write: async () => ({ source: 'user', text: 'Pay the Okonkwo(?) invoice', say: '' }) },
    })
    agent.utteranceStart()
    agent.segment('add pay the Okonkwo invoice')
    agent.utteranceEnd()
    await settle()
    expect(performed.slice(0, 2)).toEqual(['tasks:title=Pay the Okonkwo invoice', 'tasks:add'])
    expect(said).toEqual(['Done: "Pay the Okonkwo invoice"'])
  })

  it('reads back the words before pressing something that commits, when some were unsure', async () => {
    const { agent, performed, said, thinker } = setup(plan({ next: 'act', step: 'Add a task' }, { next: 'act', step: 'Delete' }), {
      effect: 'commits',
      thinker: { write: async () => ({ source: 'user', text: "I'm in, see you Friday", say: '' }) },
    })
    agent.utteranceStart()
    agent.segment("reply I'm in see you fry day", [
      ...["reply", "I'm", 'in', 'see', 'you'].map((word) => ({ word, confidence: 0.95 })),
      { word: 'fry', confidence: 0.3 },
      { word: 'day', confidence: 0.4 },
    ])
    agent.utteranceEnd()
    await settle()
    expect(performed).not.toContain('tasks:delete')
    expect(thinker.confirms).toHaveLength(0)
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
    expect(performed).toContain('tasks:sort')
    // Each kind of button on the screen (Sort, Delete, press Enter), judged in the background.
    expect(jev.effectCalls).toBe(3)
  })

  it('asks thinking before pressing a button that commits, and presses it when the user asked', async () => {
    let asked = ''
    const { agent, performed } = setup(plan({ next: 'act', step: 'Delete' }, { next: 'done' }), {
      effect: 'commits',
      thinker: {
        confirm: async (req) => {
          asked = `${req.single!.option} | ${req.messages[0]!.content}`
          return { press: true, say: '' }
        },
      },
    })
    agent.utteranceStart()
    agent.segment('delete it')
    agent.utteranceEnd()
    await settle()
    expect(asked).toBe('Delete | delete it')
    expect(performed).toEqual(['tasks:delete', 'show'])
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

  it('judges what each kind of button does once per app', async () => {
    const { agent, jev } = setup((_, i) => (i < 2 ? { next: 'act', step: 'Sort' } : { next: 'done' }), { world: { screenChanges: true } })
    agent.utteranceStart()
    spoke(agent, 'sort twice')
    await settle()
    expect(jev.effectCalls).toBe(3)
  })
})

describe('Agent thinking', () => {
  it('acts on the same options, accepts a paraphrased name, and says its text', async () => {
    const { agent, performed, said, thinker } = setup(() => ({ next: 'think' }), {
      thinker: {
        run: async (req) => {
          thinker.runs.push(req)
          const seen = await req.act({ option: 'add a task', text: 'Call mom' }, 'call_1')
          expect(seen).toContain('<screen title="Tasks"')
          return { text: 'Added it.' }
        },
      },
    })
    agent.utteranceStart()
    agent.segment('remind me to call mom')
    agent.utteranceEnd()
    await settle()
    expect(performed).toEqual(['tasks:title=Call mom', 'show'])
    expect(said).toEqual(['Added it.'])
    expect(observation(thinker.runs[0]!)).toContain('- [Add a task] field, empty')
  })

  it('only takes the turn at a pause, never mid-word', async () => {
    const { agent, thinker, debug } = setup(() => ({ next: 'think' }))
    agent.utteranceStart()
    say(agent, 'what is the')
    await settle()
    expect(thinker.runs).toHaveLength(0)
    expect(debug.some((e) => e.type === 'gate' && e.rule === 'mid-speech')).toBe(true)
  })

  it('drops its run when what the user says next stops it, and re-decides with the whole turn', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { agent, said, jev, debug } = setup((_, i) => (i === 0 ? { next: 'think' } : { next: 'listen' }), {
      thinker: {
        run: async ({ signal }) => {
          await gate
          signal.throwIfAborted()
          return { text: 'Here you go.' }
        },
      },
    })
    agent.utteranceStart()
    agent.segment("what's the weather")
    agent.utteranceEnd()
    await settle()
    agent.utteranceStart()
    agent.segment('no wait, in Paris')
    await settle()
    release()
    await settle()
    expect(said).toEqual([])
    expect(jev.calls).toBe(2)
    expect(jev.heardWhileWorking).toEqual(['no wait, in Paris'])
    expect(debug.some((e) => e.type === 'working' && e.action === 'stop')).toBe(true)
  })

  it('finishes its run when what the user says next can wait, then decides on those words', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const decided: string[] = []
    const { agent, said, jev, debug } = setup(
      (req, i) => {
        decided.push(req.state.split('## Conversation')[1] ?? '')
        return i === 0 ? { next: 'think' } : { next: 'done' }
      },
      {
        thinker: {
          run: async ({ signal }) => {
            await gate
            signal.throwIfAborted()
            return { text: 'Here is your diagram.' }
          },
        },
        working: (heard) => (heard.includes('blue') ? { hold: 0.8, stop: 0.2 } : { stop: 1 }),
      },
    )
    agent.utteranceStart()
    agent.segment('draw me the water cycle')
    agent.utteranceEnd()
    await settle()
    agent.utteranceStart()
    agent.segment('and make it blue')
    await settle()
    expect(jev.calls).toBe(1)
    release()
    await settle()
    expect(said).toEqual(['Here is your diagram.'])
    expect(jev.calls).toBe(2)
    expect(decided[1]).toContain('make it blue')
    expect(debug.find((e) => e.type === 'working' && e.action === 'hold')).toMatchObject({ heard: 'and make it blue' })
  })

  it('stops a step it decides alone at once when the user says more, without asking', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { agent, jev, debug } = setup((_, i) => (i === 0 ? { next: 'act', step: 'Add a task' } : { next: 'listen' }), {
      thinker: {
        write: async ({ signal }) => {
          await gate
          signal.throwIfAborted()
          return { source: 'user', text: 'Buy', say: '' }
        },
      },
      working: () => ({ hold: 1 }),
    })
    agent.utteranceStart()
    agent.segment('add buy')
    await settle()
    agent.segment('eggs')
    release()
    await settle()
    expect(jev.heardWhileWorking).toEqual([])
    expect(debug.some((e) => e.type === 'think-end' && e.aborted)).toBe(true)
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
    expect(agent.history.view().filter((e) => e.meta.event === 'task-start')).toHaveLength(2)
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
        return performed.at(-1) === 'tasks:title=Buy oat milk' ? { next: 'act', step: 'Add a task › press Enter' } : { next: 'act', step: 'Add a task' }
      },
      { thinker: { write: async () => ({ source: 'user', text: titles[writes++] ?? 'Buy oat milk', say: '' }) } },
    )
    agent.utteranceStart()
    spoke(agent, 'add a task buy', 0.2)
    await settle()
    expect(performed).toEqual(['tasks:title=Buy'])
    const calls = jev.calls
    agent.voice(true)
    say(agent, 'oat milk')
    spoke(agent, 'oat milk')
    await settle()
    expect(jev.calls).toBeGreaterThan(calls)
    expect(performed.slice(0, 3)).toEqual(['tasks:title=Buy', 'tasks:title=Buy oat milk', 'tasks:add'])
  })

  it('runs held thinking without asking again once the voice says the thought is finished', async () => {
    const { agent, jev, debug, thinker } = setup(plan({ next: 'think' }))
    agent.utteranceStart()
    spoke(agent, 'what should I do today', 0.1)
    await settle()
    expect(thinker.runs).toHaveLength(0)
    expect(debug.some((e) => e.type === 'gate' && e.rule === 'thought-open')).toBe(true)
    const calls = jev.calls
    agent.pause({ complete: 0.9 })
    await settle()
    expect(thinker.runs).toHaveLength(1)
    expect(jev.calls).toBe(calls)
  })

  it('decides again when the turn ends on a change held while the words sounded unfinished', async () => {
    const { agent, performed, jev } = setup((_, i) => (i === 0 ? { next: 'act', step: 'Sort', heard: 0.2 } : { next: 'listen', heard: 0.2 }))
    agent.utteranceStart()
    spoke(agent, 'sort by')
    await settle()
    agent.utteranceEnd()
    await settle()
    expect(performed).not.toContain('tasks:sort')
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
    expect(performed).toEqual(['tasks:delete', 'show'])
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
    // Thinking took the turn at the early end, which fixed the words so far in the history: the
    // rest follows as the same utterance going on.
    expect(states.at(-1)).toContain('User: tick off the passport one\nUser (went on, still speaking): no wait the dentist one')
  })

  it('reads back unsure words said after a task ended, even when they rejoin its utterance', async () => {
    const { agent, performed, said } = setup(
      (req, i) => (i === 0 ? { next: 'act', step: 'open Email' } : i === 1 ? { next: 'done' } : req.state.includes('fry') ? (performed.some((p) => p.startsWith('tasks:title')) ? { next: 'act', step: 'Delete' } : { next: 'act', step: 'Add a task' }) : { next: 'listen' }),
      { effect: 'commits', thinker: { write: async () => ({ source: 'user', text: "I'm in, see you Friday", say: '' }) }, deps: { config: quick } },
    )
    agent.utteranceStart()
    spoke(agent, 'open my email')
    await new Promise((r) => setTimeout(r, 150))
    expect(agent.turnOpen).toBe(false)
    agent.utteranceStart()
    agent.voice(false)
    agent.pause({ complete: 0.9 })
    agent.segment("reply I'm in see you fry day", [
      ...["reply", "I'm", 'in', 'see', 'you'].map((word) => ({ word, confidence: 0.95 })),
      { word: 'fry', confidence: 0.3 },
      { word: 'day', confidence: 0.4 },
    ])
    await new Promise((r) => setTimeout(r, 300))
    expect(performed).not.toContain('tasks:delete')
    expect(said).toContain('I heard: "I\'m in, see you Friday". Should I go ahead?')
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
    expect(start).toMatchObject({ screenId: 'tasks:list', questions: { next: { options: { listen: expect.any(String) } }, step: { options: { 'open Email': 'app: mail' } } } })
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

describe('Agent speaking', () => {
  /** A thinking turn that writes `pieces`, waiting for `go()` before the last one; it stops if aborted. */
  function streaming(pieces: string[]) {
    let go!: () => void
    const run: Thinker['run'] = async ({ onText, signal }) => {
      for (const p of pieces.slice(0, -1)) onText?.(p)
      await new Promise<void>((resolve, reject) => {
        go = resolve
        signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
      onText?.(pieces.at(-1)!)
      return { text: pieces.join('') }
    }
    return { run, go: () => go() }
  }

  function speaking(script: Script, run: Thinker['run']) {
    const spoken: { id: number; text: string; done: boolean }[] = []
    const hushed: number[] = []
    const said: string[] = []
    const debug: AgentDebugEvent[] = []
    const events = { speak: (id: number, text: string, done: boolean) => spoken.push({ id, text, done }), hush: (id: number) => hushed.push(id), said: (t: string) => said.push(t), debug: (e: AgentDebugEvent) => debug.push(e) }
    return { ...setup(script, { thinker: { run }, deps: { events } }), spoken, hushed, said, debug }
  }

  it('says what thinking writes as it writes it, once the user has finished', async () => {
    const t = streaming(['It is sunny', ' in Denver.', ' And warm.'])
    const { agent, spoken, said } = speaking(() => ({ next: 'think' }), t.run)
    agent.utteranceStart()
    agent.segment("what's the weather")
    agent.utteranceEnd()
    await settle()
    expect(spoken.map((s) => s.text)).toEqual(['It is sunny', 'It is sunny in Denver.'])
    t.go()
    await settle()
    expect(spoken.at(-1)).toEqual({ id: 1, text: 'It is sunny in Denver. And warm.', done: true })
    expect(said).toEqual(['It is sunny in Denver. And warm.'])
  })

  it("holds what thinking writes until the user's turn is over", async () => {
    const t = streaming(['It is sunny.', ''])
    const { agent, spoken } = speaking(() => ({ next: 'think' }), t.run)
    agent.utteranceStart()
    spoke(agent, "what's the weather")
    await settle()
    t.go()
    await settle()
    expect(spoken).toEqual([])
    agent.utteranceEnd()
    await settle()
    expect(spoken).toEqual([{ id: 1, text: 'It is sunny.', done: true }])
  })

  it('keeps only what the user heard when they cut in', async () => {
    const { agent, said } = speaking(() => ({ next: 'think' }), async () => ({ text: 'Your next meeting is at three, with Sam.' }))
    agent.utteranceStart()
    agent.segment("what's next")
    agent.utteranceEnd()
    await settle()
    expect(said).toHaveLength(1)
    agent.cutOff(1, 'Your next meeting is at three,')
    expect(agent.conversation()).toContain('Wren started to say: "Your next meeting is at three," but the user cut in.')
    expect(agent.conversation()).not.toContain('with Sam')
  })

  it('stops thinking that is still writing what the user cut in on', async () => {
    const t = streaming(['Your next meeting', ' is at three.'])
    const { agent, said, debug } = speaking(() => ({ next: 'think' }), t.run)
    agent.utteranceStart()
    agent.segment("what's next")
    agent.utteranceEnd()
    await settle()
    agent.cutOff(1, 'Your next')
    await settle()
    expect(debug.some((e) => e.type === 'think-end' && e.aborted)).toBe(true)
    expect(said).toEqual([])
    expect(agent.conversation()).toContain('Wren started to say: "Your next" but the user cut in.')
  })

  it('hushes a reply that went out of date while it was being said', async () => {
    const t = streaming(['It is sunny', ' today.'])
    const { agent, hushed } = speaking((_, i) => (i === 0 ? { next: 'think' } : { next: 'listen' }), t.run)
    agent.utteranceStart()
    agent.segment("what's the weather")
    agent.utteranceEnd()
    await settle()
    agent.utteranceStart()
    say(agent, 'in Paris')
    await settle()
    expect(hushed).toEqual([1])
  })
})

describe('Agent web lookups', () => {
  const web: WebTools = {
    search: async () => [
      { title: 'George Washington - Wikipedia', url: 'https://en.wikipedia.org/wiki/George_Washington', excerpt: 'George Washington was the first president of the United States.' },
      { title: 'George Washington | whitehouse.gov', url: 'https://www.whitehouse.gov/about-the-white-house/presidents/george-washington/', excerpt: 'The first president.' },
    ],
    fetch: async (url) => ({ url, title: 'Page', markdown: 'text' }),
  }

  it('remembers what thinking found, so a page can be opened later as one step', async () => {
    let options: string[] = []
    const { agent, performed } = setup(
      (req, i) => {
        if (i === 0) return { next: 'think' }
        options = Object.keys(req.questions.step!.options)
        return i === 1 ? { next: 'act', step: 'open page: George Washington - Wikipedia' } : { next: 'done' }
      },
      {
        thinker: {
          run: async (req) => {
            expect((await req.search!('first US president', 's1')).results[0]!.url).toBe('https://en.wikipedia.org/wiki/George_Washington')
            return { text: 'George Washington.' }
          },
        },
        deps: { web },
      },
    )
    agent.utteranceStart()
    agent.segment('who was the first one')
    agent.utteranceEnd()
    await settle()
    expect(await agent.context()).toContain('Wren searched the web for "first US president":\n- "George Washington - Wikipedia" (en.wikipedia.org/wiki/George_Washington): George Washington was the first president')

    agent.utteranceStart()
    agent.segment('let me see it')
    agent.utteranceEnd()
    await settle()
    expect(options).toContain('open page: George Washington | whitehouse.gov')
    expect(performed).toContain('url https://en.wikipedia.org/wiki/George_Washington')
    expect(await agent.context()).toContain('Wren opened the page "George Washington - Wikipedia" (en.wikipedia.org/wiki/George_Washington).')
  })

  it('lets thinking open any page by address, logged under the title it opened with', async () => {
    const { agent, performed } = setup(() => ({ next: 'think' }), {
      thinker: {
        run: async (req) => {
          await req.search!('first US president', 's1')
          expect(observation(req)).not.toContain('open page')
          await req.openPage!('https://www.loc.gov/item/gw-papers/', 'o1')
          return { text: '' }
        },
      },
      world: { titles: { 'https://www.loc.gov/item/gw-papers/': 'George Washington Papers' } },
      deps: { web },
    })
    agent.utteranceStart()
    agent.segment('show me his papers')
    agent.utteranceEnd()
    await settle()
    expect(performed).toContain('url https://www.loc.gov/item/gw-papers/')
    expect(await agent.context()).toContain('Wren opened the page "George Washington Papers" (loc.gov/item/gw-papers).')
  })

  it('offers the pages kept open, as well as those it found, but not pages of the user\'s files', async () => {
    let criteria: Record<string, string | null> = {}
    const { agent } = setup((req) => {
      criteria = req.questions.step!.options
      return { next: 'listen' }
    })
    const world = (agent as unknown as { world: World }).world
    world.openPages = () => [
      { url: 'https://shop.test/mug', title: 'Blue mug' },
      { url: 'stanley://files/Pages/rain.html', title: 'Rain' },
    ]
    agent.utteranceStart()
    agent.segment('back to the mug')
    await settle()
    expect(criteria['open page: Blue mug']).toBe('web page on shop.test, kept open')
    expect(Object.keys(criteria).filter((n) => n.includes('Rain'))).toEqual([])
  })

  it('gives thinking no web tools without web access', async () => {
    const { agent, thinker } = setup(() => ({ next: 'think' }))
    agent.utteranceStart()
    agent.segment('who won')
    agent.utteranceEnd()
    await settle()
    expect(thinker.runs[0]?.search).toBeUndefined()
  })
})

describe('Agent files', () => {
  function fakeFiles(outputs: Record<string, string>): FileTools & { ran: string[] } {
    const ran: string[] = []
    return {
      ran,
      root: '~/Wren',
      paths: async () => ['Trips/', 'Trips/packing.md', 'budget.csv', 'deep/', 'deep/notes.md'],
      async bash(command) {
        ran.push(command)
        return command in outputs ? { output: outputs[command]!, exitCode: 0 } : { output: `bash: ${command}: not found\n`, exitCode: 127 }
      },
    }
  }
  const files = () => fakeFiles({ 'ls -p': 'Trips/\nbudget.csv\n', "ls -p -- 'Trips'": 'packing.md\n', "cat -- 'Trips/packing.md'": '- Passport\n- Charger\n' })

  it('lists and reads while the user is still speaking, and thinking reads it as its own commands', async () => {
    const options: string[][] = []
    let state = ''
    const f = files()
    const { agent, thinker } = setup(
      (req, i) => {
        state = req.state
        options.push(Object.keys(req.questions.step!.options))
        return [{ next: 'act', step: 'list files' }, { next: 'act', step: 'list folder: Trips' }, { next: 'act', step: 'read file: Trips/packing.md' }][i] ?? { next: 'think' }
      },
      { deps: { files: f } },
    )
    agent.utteranceStart()
    say(agent, "what's on my packing list for the")
    await settle()
    expect(f.ran).toEqual(['ls -p', "ls -p -- 'Trips'", "cat -- 'Trips/packing.md'"])
    expect(options[0]).toEqual(expect.arrayContaining(['list files', 'list folder: deep', 'read file: deep/notes.md']))
    expect(options[1]).toEqual(expect.arrayContaining(['list folder: Trips', 'read file: budget.csv']))
    expect(options[2]).toContain('read file: Trips/packing.md')
    const context = await agent.context()
    expect(context).toContain("Wren listed the user's files: Trips/, budget.csv.")
    expect(context).toContain('Wren listed the folder "Trips": packing.md.')
    expect(context).toContain('Wren read the file "Trips/packing.md": - Passport - Charger')
    expect(state).toContain('"list files" lists it')

    agent.utteranceEnd()
    await settle()
    const req = thinker.runs[0]!
    expect(req.bash).toBeDefined()
    const calls = req.messages.flatMap((m) => (m.role === 'assistant' && Array.isArray(m.content) ? m.content.flatMap((p) => (p.type === 'tool-call' ? [p.toolName, JSON.stringify(p.input)] : [])) : []))
    expect(calls).toContain('bash')
    expect(calls).toContain(JSON.stringify({ command: "cat -- 'Trips/packing.md'" }))
    const results = req.messages.flatMap((m) => (m.role === 'tool' ? m.content.flatMap((p) => (p.type === 'tool-result' && p.output.type === 'text' ? [p.output.value] : [])) : []))
    expect(results).toContain('- Passport\n- Charger')
  })

  it('shows the folder nearest the top when there is too much of it', () => {
    const many = Array.from({ length: 250 }, (_, i) => `A/${String(i).padStart(3, '0')}.md`)
    const shown = topFiles(['A/', ...many, 'A/B/', 'A/B/deep.md', 'z.md']).split('\n')
    expect(shown).toHaveLength(203)
    expect(shown.slice(0, 2)).toEqual(['<files>', 'A/'])
    expect(shown).toContain('z.md')
    expect(shown).not.toContain('A/B/deep.md')
    expect(shown.at(-2)).toBe('… and 53 more')
    expect(topFiles([])).toBe('<files>\n(empty)\n</files>')
  })

  it('shows thinking the top two levels of the folder the first time, and again only when they change', async () => {
    let paths = ['Trips/', 'Trips/Lisbon/', 'Trips/Lisbon/hotel.pdf', 'Trips/packing.md', 'budget.csv']
    const f = { ...files(), paths: async () => paths }
    const { agent, thinker } = setup(() => ({ next: 'think' }), { deps: { files: f } })
    const ask = async (words: string) => {
      agent.utteranceStart()
      agent.segment(words)
      agent.utteranceEnd()
      await settle()
    }
    const last = () => {
      const m = thinker.runs.at(-1)!.messages.at(-1)!
      return typeof m.content === 'string' ? m.content : m.content.map((p) => (p.type === 'text' ? p.text : '')).join('')
    }
    await ask('what have I got')
    expect(last()).toContain('<files>\nTrips/\nTrips/Lisbon/\nTrips/packing.md\nbudget.csv\n</files>')
    await ask('and now')
    expect(last()).not.toContain('<files>')
    paths = [...paths, 'notes.md']
    await ask('and now')
    expect(last()).toContain('<files>\nTrips/\nTrips/Lisbon/\nTrips/packing.md\nbudget.csv\nnotes.md\n</files>')
    expect(agent.instructions).toContain('<files>')
  })

  it("gives thinking bash, and Jev a line for each command thinking ran", async () => {
    const f = files()
    const { agent } = setup(() => ({ next: 'think' }), {
      thinker: {
        run: async (req) => {
          expect(await req.bash!('ls -p', 'b1')).toBe('Trips/\nbudget.csv')
          expect(await req.bash!('rm nothing', 'b2')).toBe('bash: rm nothing: not found\n(exit code 127)')
          return { text: 'You have a Trips folder and a budget.' }
        },
      },
      deps: { files: f },
    })
    agent.utteranceStart()
    agent.segment('what do I have in there')
    agent.utteranceEnd()
    await settle()
    const context = await agent.context()
    expect(context).toContain("Wren ran `ls -p` on the user's files.")
    expect(context).toContain("Wren ran `rm nothing` on the user's files: failed (exit code 127).")
    expect(agent.instructions).toContain('~/Wren')
  })

  it('offers to open a file the screen can show, and thinking opens one by its path', async () => {
    const f = fakeFiles({})
    f.paths = async () => ['plan.html', 'notes.md']
    let options: string[] = []
    const results: string[] = []
    const { agent, performed } = setup(
      (req) => {
        options = Object.keys(req.questions.step!.options)
        return { next: 'think' }
      },
      {
        thinker: {
          run: async (req) => {
            results.push(await req.openPage!('~/Wren/plan.html', 'o1'))
            results.push(await req.openPage!('missing.html', 'o2'))
            return { text: '' }
          },
        },
        deps: { files: f },
      },
    )
    agent.utteranceStart()
    agent.segment('show me the plan')
    agent.utteranceEnd()
    await settle()
    expect(options).toEqual(expect.arrayContaining(['read file: plan.html', 'open file: plan.html', 'read file: notes.md']))
    expect(options).not.toContain('open file: notes.md')
    expect(performed).toContain('url stanley://files/plan.html')
    expect(results[1]).toBe(`There is no file "missing.html" in the user's folder that the screen can show.`)
    expect(await agent.context()).toContain('Wren opened the page "plan.html"')
  })

  /** A folder in memory that can be written, and a world that draws pages and looks at them. */
  function pages() {
    const stored = new Map<string, string>([['Pages/rain.html', '<h1 style="color: red">Rain</h1>']])
    const f = fakeFiles({})
    f.write = async (path, content) => void stored.set(path, content)
    f.read = async (path) => {
      if (!stored.has(path)) throw new Error(`no ${path}`)
      return stored.get(path)!
    }
    const drawn: string[] = []
    return { f, stored, drawn }
  }

  it('draws a page thinking writes as it comes, then shows it and gives thinking its errors and a picture', async () => {
    const { f, stored, drawn } = pages()
    let output: FileOutput | undefined
    const { agent, performed, debug } = setup(() => ({ next: 'think' }), {
      thinker: {
        run: async (req) => {
          req.onDraft!('w1', 'Pages/sea.html', '<h1>Se')
          req.onDraft!('w1', 'Pages/sea.html', '<h1>Sea</h1>')
          await settle()
          output = await req.writeFile!('Pages/sea.html', '<h1>Sea</h1><p>Waves.</p>', 'w1')
          return { text: '' }
        },
      },
      deps: { files: f },
    })
    const world = (agent as unknown as { world: World }).world
    world.draft = async (path) => ({ write: (c) => drawn.push(`write ${path}: ${c}`), end: (c) => drawn.push(`end ${path}: ${c}`), cancel: () => drawn.push(`cancel ${path}`) })
    world.look = async () => ({ errors: ['Uncaught ReferenceError: mermaid is not defined'], image: { data: 'aGk=', mediaType: 'image/jpeg' } })
    agent.utteranceStart()
    agent.segment('draw the sea')
    agent.utteranceEnd()
    await settle()
    await settle()
    // What came while the page was being put on screen is drawn at once, as far as it has got.
    expect(drawn).toEqual(['write Pages/sea.html: <h1>Sea</h1>', 'end Pages/sea.html: <h1>Sea</h1><p>Waves.</p>'])
    expect(stored.get('Pages/sea.html')).toBe('<h1>Sea</h1><p>Waves.</p>')
    expect(performed).toContain('url stanley://files/Pages/sea.html')
    expect(output!.text).toContain('Wrote Pages/sea.html. Opened stanley://files/Pages/sea.html.\nThe page reported these errors:\n- Uncaught ReferenceError: mermaid is not defined')
    expect(output!.image).toEqual({ data: 'aGk=', mediaType: 'image/jpeg' })
    expect(debug.some((e) => e.type === 'working')).toBe(false)
    expect(await agent.context()).toContain('Wren wrote the file "Pages/sea.html".')
  })

  it('changes part of a page, and says why when the text to change is not there exactly once', async () => {
    const { f, stored } = pages()
    const outputs: FileOutput[] = []
    const { agent, performed } = setup(() => ({ next: 'think' }), {
      thinker: {
        run: async (req) => {
          outputs.push(await req.editFile!('Pages/rain.html', 'color: green', 'color: blue', false, 'e1'))
          outputs.push(await req.editFile!('Pages/rain.html', 'color: red', 'color: blue', false, 'e2'))
          outputs.push(await req.editFile!('Pages/rain.html', 'Rain', 'Rain', false, 'e3'))
          stored.set('Pages/rain.html', `${stored.get('Pages/rain.html')}<p style="color: blue">Drops</p>`)
          outputs.push(await req.editFile!('Pages/rain.html', 'color: blue', 'color: navy', false, 'e4'))
          outputs.push(await req.editFile!('Pages/rain.html', 'color: blue', 'color: navy', true, 'e5'))
          return { text: '' }
        },
      },
      deps: { files: f },
    })
    agent.utteranceStart()
    agent.segment('make it blue')
    agent.utteranceEnd()
    await settle()
    expect(outputs[0]!.text).toBe("That text isn't in Pages/rain.html. Copy it exactly as it is in the file (read it with cat), or write the whole file again.")
    expect(outputs[1]!.text).toMatch(/^Changed Pages\/rain.html. Opened stanley:\/\/files\/Pages\/rain.html.\nThe page reported no errors./)
    expect(outputs[3]!.text).toBe('That text is in Pages/rain.html 2 times: include more of what is around it so it is there once, or set all to change every one.')
    expect(stored.get('Pages/rain.html')).toBe('<h1 style="color: navy">Rain</h1><p style="color: navy">Drops</p>')
    expect(performed).toContain('url stanley://files/Pages/rain.html')
    const context = await agent.context()
    expect(context).toContain('Wren changed the file "Pages/rain.html": failed (That text isn\'t in Pages/rain.html.')
    expect(context).toContain('Wren changed the file "Pages/rain.html".')
  })

  it('takes a page off the screen when its writing never finished', async () => {
    const { f, drawn } = pages()
    const { agent } = setup(() => ({ next: 'think' }), {
      thinker: {
        run: async (req) => {
          req.onDraft!('w1', 'Pages/sea.html', '<h1>Se')
          await settle()
          throw new Error('the model stopped')
        },
      },
      deps: { files: f },
    })
    const world = (agent as unknown as { world: World }).world
    world.draft = async (path) => ({ write: (c) => drawn.push(`write ${path}: ${c}`), end: () => drawn.push('end'), cancel: () => drawn.push(`cancel ${path}`) })
    agent.utteranceStart()
    agent.segment('draw the sea')
    agent.utteranceEnd()
    await settle()
    await settle()
    expect(drawn).toEqual(['write Pages/sea.html: <h1>Se', 'cancel Pages/sea.html'])
  })

  it("reports a file that couldn't be read", async () => {
    const f = fakeFiles({ 'ls -p': 'gone.md\n' })
    const { agent } = setup(plan({ next: 'act', step: 'list files' }, { next: 'act', step: 'read file: gone.md' }), { deps: { files: f } })
    agent.utteranceStart()
    spoke(agent, 'read me the gone one')
    await settle()
    expect(await agent.context()).toContain('Wren read the file "gone.md": failed (bash: cat -- \'gone.md\': not found).')
  })

  it('offers no files and no bash without them', async () => {
    let options: string[] = []
    const { agent, thinker } = setup((req) => ((options = Object.keys(req.questions.step!.options)), { next: 'think' }))
    agent.utteranceStart()
    agent.segment('what files do I have')
    agent.utteranceEnd()
    await settle()
    expect(options).not.toContain('list files')
    expect(thinker.runs[0]?.bash).toBeUndefined()
    expect(agent.instructions).not.toContain('## Files')
  })
})

describe('Agent history', () => {
  const text = (req: ThinkRequest) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : m.content.map((p) => (p.type === 'tool-call' ? `call ${p.toolCallId}` : p.type === 'tool-result' ? `result ${p.toolCallId}` : p.type === 'text' ? p.text : p.type)).join(' + ')))

  it("continues one history: each thinking call is sent all the last one was, then what happened since, with Jev's steps as calls", async () => {
    const { agent, thinker } = setup(plan({ next: 'act', step: 'open Email' }, { next: 'think' }, { next: 'think' }), {
      thinker: {
        run: async (req) => {
          if (thinker.runs.length === 1) await req.act({ option: 'Sort' }, 'call_1')
          return { text: thinker.runs.length === 1 ? 'Sorted.' : 'Sure.' }
        },
      },
    })
    agent.utteranceStart()
    agent.segment('open my email and sort it')
    agent.utteranceEnd()
    await settle()
    agent.utteranceStart()
    agent.segment('thanks')
    agent.utteranceEnd()
    await settle()
    const [first, second] = thinker.runs.map(text)
    expect(first!.slice(0, 3)).toEqual(['open my email and sort it', 'call jev_step-1', 'result jev_step-1'])
    expect(second!.slice(0, first!.length)).toEqual(first)
    expect(second!.slice(first!.length)).toEqual(['call call_1', 'result call_1', 'Sorted.', 'thanks', '<screen unchanged/>'])
    // This stand-in reports no steps of its own, so the cache is read at the first call's observation.
    expect(thinker.runs[1]!.cacheAt).toBe(first!.length - 1)
  })

  it('calls the assistant by the name the user gave it, in every prompt, and follows a rename', async () => {
    let name = 'Jarvis'
    const states: string[] = []
    const { agent, thinker } = setup((req) => (states.push(req.state, JSON.stringify(req.questions)), { next: 'think' }), {
      deps: { name: () => name },
      thinker: { run: async () => ({ text: 'Hi.' }) },
    })
    expect(agent.instructions).toContain('You are Jarvis,')
    agent.utteranceStart()
    agent.segment('tell Wren Kubrick hi')
    agent.utteranceEnd()
    await settle()
    expect(states.join('\n')).not.toMatch(/Wren(?! Kubrick)/)
    expect(states[0]).toContain('User: tell Wren Kubrick hi')
    expect(thinker.runs[0]!.instructions).not.toContain('Wren')
    expect(agent.conversation()).toContain('Jarvis said: "Hi."')
    name = 'Ada'
    expect(agent.instructions).toContain('You are Ada,')
    expect(agent.conversation()).toContain('Ada said: "Hi."')
  })

  it('locks when the world can, once the user has finished', async () => {
    const { world, performed } = fakeWorld()
    world.lock = async () => void performed.push('lock')
    const { agent } = setup(plan({ next: 'act', step: 'lock' }, { next: 'done' }), { deps: { world } })
    agent.utteranceStart()
    agent.segment('lock the screen')
    agent.utteranceEnd()
    await settle()
    expect(performed[0]).toBe('lock')
    expect(await agent.context()).toContain('Wren locked the computer.')
  })

  it("ends the instructions with today's date, gives Jev the date each tick, and tells thinking when the day changes", async () => {
    let now = new Date('2026-10-12T10:00:00')
    const states: string[] = []
    const { agent, thinker } = setup((req) => (states.push(req.state), { next: 'think' }), { deps: { clock: () => now } })
    expect(agent.instructions.endsWith('Today is Monday, 12 October 2026.')).toBe(true)
    agent.utteranceStart()
    agent.segment('what day is it')
    agent.utteranceEnd()
    await settle()
    expect(states[0]).toContain('Today is Monday, 12 October 2026.\n\n## Conversation')
    now = new Date('2026-10-13T00:05:00')
    agent.utteranceStart()
    agent.segment('and now')
    agent.utteranceEnd()
    await settle()
    expect(thinker.runs[1]!.instructions).toBe(thinker.runs[0]!.instructions)
    expect(observation(thinker.runs[1]!)).toContain('<note>It is now Tuesday, 13 October 2026.</note>')
  })

  it('types into a field as the answer to the single step, and runs a different choice as thinking\'s own step', async () => {
    let choice = 'Add a task'
    const { agent, thinker, performed } = setup(plan({ next: 'act', step: 'Add a task' }, { next: 'done' }, { next: 'act', step: 'Add a task' }), {
      thinker: { single: async () => scriptedTurn('', { option: choice, text: 'Eggs', wrote: 'user' }) },
    })
    agent.utteranceStart()
    agent.segment('add eggs')
    agent.utteranceEnd()
    await settle()
    expect(performed[0]).toBe('tasks:title=Eggs')
    const history = agent.history.messages()
    const call = history.findIndex((m) => m.role === 'assistant' && Array.isArray(m.content) && m.content.some((p) => p.type === 'tool-call' && p.toolCallId.startsWith('scripted_')))
    expect(history[call + 1]?.role).toBe('tool')
    expect(thinker.runs).toHaveLength(0)

    choice = 'Sort'
    agent.utteranceStart()
    agent.segment('add milk')
    agent.utteranceEnd()
    await settle()
    expect(thinker.runs).toHaveLength(0)
    expect(performed).toContain('tasks:sort')
    expect(validate(agent.history.messages())).toBeUndefined()
  })

  it('runs several steps thinking gave for one, without a whole turn, and stops before a commit mid-turn', async () => {
    const { agent, thinker, performed, debug } = setup(plan({ next: 'act', step: 'Add a task' }, { next: 'done' }), {
      effect: 'commits',
      thinker: { single: async () => scriptedTurn('', { option: 'Buy milk' }, { option: 'Add a task', text: 'Eggs', wrote: 'user' }, { option: 'Delete' }) },
    })
    agent.utteranceStart()
    spoke(agent, 'open milk and add eggs then delete')
    await settle()
    expect(performed.slice(0, 2)).toEqual(['tasks:item', 'tasks:title=Eggs'])
    expect(performed).not.toContain('tasks:delete')
    expect(thinker.runs).toHaveLength(0)
    expect(debug.some((e) => e.type === 'gate' && e.rule === 'ran-calls')).toBe(true)
    expect(validate(agent.history.messages())).toBeUndefined()
  })

  it('hands steps to a whole turn when the first one is not on screen', async () => {
    const { agent, thinker, performed } = setup(plan({ next: 'act', step: 'Add a task' }, { next: 'done' }), {
      thinker: { single: async () => scriptedTurn('', { option: 'Nowhere' }, { option: 'Sort' }) },
    })
    agent.utteranceStart()
    agent.segment('add something')
    agent.utteranceEnd()
    await settle()
    expect(thinker.runs).toHaveLength(1)
    expect(performed).not.toContain('tasks:sort')
  })


  it('keeps the steps of a turn cut short, so the history stays valid', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { agent, thinker } = setup((_, i) => (i === 0 ? { next: 'think' } : i === 1 ? { next: 'listen' } : { next: 'think' }), {
      thinker: {
        run: async (req) => {
          if (thinker.runs.length > 1) return { text: '' }
          await req.act({ option: 'Sort' }, 'call_1')
          await gate
          req.signal.throwIfAborted()
          return { text: 'Sorted.' }
        },
      },
    })
    agent.utteranceStart()
    spoke(agent, 'sort it')
    await settle()
    agent.voice(true)
    say(agent, 'by date')
    release()
    await settle()
    spoke(agent, 'by date')
    agent.utteranceEnd()
    await settle()
    expect(thinker.runs).toHaveLength(2)
    const last = text(thinker.runs.at(-1)!)
    expect(last).toContain('call call_1')
    expect(last.indexOf('result call_1')).toBe(last.indexOf('call call_1') + 1)
    expect(last).not.toContain('Sorted.')
  })
})

describe('Agent skills', () => {
  const windDown = '---\nname: wind-down\ndescription: When the user is winding down for the night.\n---\nOpen Tasks, then press Sort.\n'
  /** A folder with one skill, which a command can change. */
  function skillFiles() {
    let scan: SkillScan = { skills: [{ name: 'wind-down', description: 'When the user is winding down for the night.', path: '.agents/skills/wind-down/SKILL.md' }], broken: [] }
    const ran: string[] = []
    const files: FileTools & { ran: string[]; set(next: SkillScan): void } = {
      ran,
      set: (next) => void (scan = next),
      root: '~/Wren',
      paths: async () => ['notes.md'],
      skills: async () => scan,
      async bash(command) {
        ran.push(command)
        return command === "cat -- '.agents/skills/wind-down/SKILL.md'" ? { output: windDown, exitCode: 0 } : { output: '', exitCode: 0 }
      },
    }
    return files
  }

  it('reads a skill while the user speaks, then follows it with everything it says in view', async () => {
    const f = skillFiles()
    const states: string[] = []
    const options: string[][] = []
    const { agent, performed, thinker } = setup(
      (req, i) => {
        states.push(req.state)
        options.push(Object.keys(req.questions.step!.options))
        return [{ next: 'act', step: 'use skill: wind-down' }, { next: 'act', step: 'open Tasks' }, { next: 'act', step: 'Sort' }][i] ?? { next: 'done', nextConfidence: 0.99 }
      },
      { deps: { files: f } },
    )
    agent.utteranceStart()
    say(agent, "I'm winding down")
    await settle()
    expect(f.ran).toEqual(["cat -- '.agents/skills/wind-down/SKILL.md'"])
    expect(options[0]).toContain('use skill: wind-down')
    expect(states[0]).toContain('"use skill" step')
    // Read this task, it is in view: it isn't offered again.
    expect(options[1]).not.toContain('use skill: wind-down')
    expect(states[1]).toContain('Wren read its skill "wind-down":\n  Open Tasks, then press Sort.')
    agent.utteranceEnd()
    await settle()
    expect(performed).toEqual(expect.arrayContaining(['open tasks', 'tasks:sort']))
    expect(thinker.runs).toHaveLength(0)
  })

  it('reads a skill the step is sure of even while Jev would listen, but not one it is unsure of', async () => {
    const f = skillFiles()
    const { agent, debug } = setup((_, i) => [{ next: 'listen', step: 'use skill: wind-down', stepConfidence: 0.7 }, { next: 'listen', step: 'use skill: wind-down', stepConfidence: 0.95 }][i] ?? { next: 'listen' }, { deps: { files: f } })
    agent.utteranceStart()
    say(agent, "I'm winding")
    await settle()
    expect(f.ran).toEqual([])
    say(agent, "I'm winding down")
    await settle()
    expect(f.ran).toEqual(["cat -- '.agents/skills/wind-down/SKILL.md'"])
    expect(debug.some((e) => e.type === 'gate' && e.rule === 'skill')).toBe(true)
  })

  it('lists the skills in thinking’s instructions as they were at the start, and tells it when they change', async () => {
    const f = skillFiles()
    const results: string[] = []
    let turn = 0
    const { agent, thinker } = setup(() => ({ next: 'think' }), {
      thinker: {
        run: async (req) => {
          if (turn++ === 0) {
            f.set({ skills: [], broken: [{ path: '.agents/skills/wind-down/SKILL.md', error: 'it has no description: say what it does and when to use it' }] })
            results.push(await req.bash!('echo > .agents/skills/wind-down/SKILL.md', 'b1'))
          }
          return { text: '' }
        },
      },
      deps: { files: f },
    })
    agent.utteranceStart()
    agent.segment('forget how I wind down')
    agent.utteranceEnd()
    await settle()
    expect(thinker.runs[0]!.instructions).toContain('The skills:\n- wind-down: When the user is winding down for the night.')
    expect(results[0]).toBe("(no output)\n\nThe skills changed: .agents/skills/wind-down/SKILL.md can't be used: it has no description: say what it does and when to use it.")

    // Changed outside Wren: the next call's observation says so. The instructions stay as they were.
    f.set({ skills: [{ name: 'focus', description: 'When the user wants to focus.', path: '.agents/skills/focus/SKILL.md' }], broken: [] })
    agent.utteranceStart()
    agent.segment('what now')
    agent.utteranceEnd()
    await settle()
    expect(thinker.runs[1]!.instructions).toBe(thinker.runs[0]!.instructions)
    expect(observation(thinker.runs[1]!)).toContain('<note>The skills changed: added "focus": When the user wants to focus.</note>')
  })
})
