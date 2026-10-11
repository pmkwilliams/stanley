import { describe, expect, it } from 'vitest'
import type { DebugEvent } from '../../../shared/ipc'
import { buildModel, evalScenario, rankedOptions, tickLabel } from './model'

let seq = 0
const at = (n: number) => 1000 + n * 100
const log = (event: Extract<DebugEvent, { source: 'log' }>['event']): DebugEvent => ({ seq: ++seq, at: at(seq), source: 'log', event })
const agent = (event: Extract<DebugEvent, { source: 'agent' }>['event']): DebugEvent => ({ seq: ++seq, at: at(seq), source: 'agent', event })

const start = (tickId: number, currentNodeId = 'home') =>
  agent({
    type: 'tick-start',
    tickId,
    reason: 'words',
    utteranceId: 1,
    transcript: { finalized: [], partial: '' },
    utteranceEnded: false,
    currentNodeId,
    state: 'state',
    instructions: 'next?',
    options: { wait: 'w', stop: 's', Email: 'Go to email', 'Email › delete': 'Do: delete' },
  })
const decision = (tickId: number, choice: string, probabilities: Record<string, number>) =>
  agent({ type: 'decision', tickId, result: { choice, probabilities, confidence: probabilities[choice]!, latencyMs: 300 }, stale: false, endedDuringCall: false })

function session(): DebugEvent[] {
  seq = 0
  return [
    { seq: ++seq, at: at(seq), source: 'app', event: { type: 'session-start', session: 's1', config: {} as never, systemPrompt: '', mock: true } },
    log({ role: 'event', kind: 'task-start', at: 0 }),
    log({ role: 'user', content: 'open my email', utteranceId: '1', at: 0 }),
    agent({ type: 'request', reason: 'words', result: 'no-new-words' }),
    start(1),
    decision(1, 'Email', { Email: 0.8, wait: 0.2 }),
    agent({ type: 'tick-end', tickId: 1, outcome: 'executed', effective: 'Email' }),
    log({ role: 'event', kind: 'task-end', at: 0 }),
    log({ role: 'event', kind: 'task-start', at: 0 }),
    log({ role: 'user', content: 'delete the first one', utteranceId: '2', at: 0 }),
    start(2, 'email:inbox'),
    decision(2, 'Email › delete', { 'Email › delete': 0.4, wait: 0.6 }),
    agent({ type: 'gate', tickId: 2, rule: 'consequence', detail: 'not asked for' }),
    agent({ type: 'tick-end', tickId: 2, outcome: 'gated', effective: 'wait' }),
  ]
}

describe('buildModel', () => {
  it('groups ticks into tasks and folds tick events into one view', () => {
    const m = buildModel(session())
    expect(m.tasks.map((t) => [t.index, t.utterances, t.ticks.map((x) => x.id)])).toEqual([
      [1, ['open my email'], [1]],
      [2, ['delete the first one'], [2]],
    ])
    expect(m.ticks[1]!.gates).toHaveLength(1)
    expect(m.rows.map((r) => (r.kind === 'event' ? `${r.kind}:${r.category ?? ''}` : r.kind))).toEqual([
      'event:',
      'task',
      'event:skipped',
      'tick',
      'task',
      'tick',
    ])
  })

  it('labels outcomes and ranks every option, including ones with no probability', () => {
    const m = buildModel(session())
    expect(tickLabel(m.ticks[1]!)).toBe('wait (gated: Email › delete)')
    expect(rankedOptions(m.ticks[1]!).map((o) => [o.option, o.p])).toEqual([
      ['wait', 0.6],
      ['Email › delete', 0.4],
      ['stop', null],
      ['Email', null],
    ])
  })
})

describe('evalScenario', () => {
  it('prepends earlier utterances when the task did not start at home', () => {
    const m = buildModel(session())
    const out = evalScenario(m, m.tasks[1]!)
    expect(out).toContain(`utterances: ["open my email", "delete the first one"],`)
    expect(out).toContain('name: "delete-the-first-one"')
    expect(out).toContain('Observed: wait (gated: Email › delete)')
  })

  it('keeps a home-started task self-contained', () => {
    const m = buildModel(session())
    expect(evalScenario(m, m.tasks[0]!)).toContain(`utterances: ["open my email"],`)
  })
})
