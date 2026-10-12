import { describe, expect, it } from 'vitest'
import type { DebugEvent } from '../../../shared/ipc'
import { Conversation, type HistoryRecord } from '@stanley/agent'
import { buildModel, evalScenario, inputText, modelInput, rankedOptions, tickLabel } from './model'

let seq = 0
const at = (n: number) => 1000 + n * 100
const log = (event: Extract<DebugEvent, { source: 'log' }>['event']): DebugEvent => ({ seq: ++seq, at: at(seq), source: 'log', event })
const agent = (event: Extract<DebugEvent, { source: 'agent' }>['event']): DebugEvent => ({ seq: ++seq, at: at(seq), source: 'agent', event })

const start = (tickId: number, screenId = 'home') =>
  agent({
    type: 'tick-start',
    tickId,
    reason: 'words',
    utteranceId: 1,
    transcript: { finalized: [], partial: '' },
    utteranceEnded: false,
    screenId,
    state: 'state',
    questions: {
      next: { instructions: 'now?', options: { listen: 'l', act: 'a', think: 't', done: 'd' } },
      step: { instructions: 'which?', options: { 'open Email': 'app', Delete: 'button', back: 'b' } },
    },
  })
const answer = (probabilities: Record<string, number>) => {
  const choice = Object.entries(probabilities).sort(([, a], [, b]) => b - a)[0]![0]
  return { choice, probabilities, confidence: probabilities[choice]! }
}
const decision = (tickId: number, next: Record<string, number>, step: Record<string, number>) =>
  agent({ type: 'decision', tickId, result: { answers: { next: answer(next), step: answer(step) }, latencyMs: 300 }, stale: false, endedDuringCall: false })

function session(): DebugEvent[] {
  seq = 0
  return [
    { seq: ++seq, at: at(seq), source: 'app', event: { type: 'session-start', session: 's1', config: {} as never, systemPrompt: '', mock: true } },
    log({ role: 'event', kind: 'task-start', at: 0 }),
    log({ role: 'user', content: 'open my email', utteranceId: 1, at: 0 }),
    agent({ type: 'request', reason: 'words', result: 'no-new-words' }),
    start(1),
    decision(1, { act: 0.9, listen: 0.1 }, { 'open Email': 0.8, back: 0.2 }),
    agent({ type: 'tick-end', tickId: 1, outcome: 'executed', effective: 'open Email' }),
    log({ role: 'event', kind: 'task-end', at: 0 }),
    log({ role: 'event', kind: 'task-start', at: 0 }),
    log({ role: 'user', content: 'delete the first one', utteranceId: 2, at: 0 }),
    start(2, 'email:inbox'),
    decision(2, { act: 0.55, listen: 0.45 }, { Delete: 0.6, back: 0.4 }),
    agent({ type: 'gate', tickId: 2, rule: 'act-confidence', detail: 'P(act) 0.55 < speakingAct 0.6 → listen' }),
    agent({ type: 'tick-end', tickId: 2, outcome: 'gated', effective: 'listen' }),
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
    expect(tickLabel(m.ticks[1]!)).toBe('listen (gated: act: Delete)')
    expect(rankedOptions(m.ticks[1]!).map((o) => [o.option, o.p])).toEqual([
      ['Delete', 0.6],
      ['back', 0.4],
      ['open Email', null],
    ])
    expect(rankedOptions(m.ticks[1]!, 'next').map((o) => o.option)).toEqual(['act', 'listen', 'think', 'done'])
  })
})

describe('buildModel with a history', () => {
  it('rebuilds the history, tracks tasks from it, and slices out what each thinking call was sent', () => {
    seq = 0
    const events: DebugEvent[] = [{ seq: ++seq, at: at(seq), source: 'app', event: { type: 'session-start', session: 's2', config: {} as never, systemPrompt: '', instructions: '# Stanley', mock: true } }]
    const history = new Conversation((record: HistoryRecord) => events.push({ seq: ++seq, at: at(seq), source: 'history', event: record }))
    history.stage({ kind: 'event', event: 'task-start' })
    history.heard(1, 'what time is it')
    const sent = history.send('<screen title="Home">…</screen>', { utteranceId: 1, text: 'what time is it', ended: true })
    events.push(start(1))
    events.push(agent({ type: 'think-start', tickId: 1, mode: 'run', handover: 'Jev chose think', entries: sent.entries }))
    history.said(1, 'It is noon.')
    history.stage({ kind: 'event', event: 'task-end' })
    const m = buildModel(events)
    expect(m.tasks.map((t) => [t.utterances, t.endAt !== undefined])).toEqual([[['what time is it'], true]])
    expect(m.history.map((e) => e.meta.kind)).toEqual(['event', 'words', 'observation'])
    expect(m.staged.map((e) => e.meta.kind)).toEqual(['said', 'event'])
    const think = m.ticks[0]!.thinking[0]!
    expect(modelInput(m, think).map((x) => x.content)).toEqual(['what time is it', '<screen title="Home">…</screen>'])
    expect(inputText(m, think)).toContain('# instructions\n# Stanley')
  })
})

describe('evalScenario', () => {
  it('prepends earlier utterances when the task did not start at home', () => {
    const m = buildModel(session())
    const out = evalScenario(m, m.tasks[1]!)
    expect(out).toContain(`utterances: ["open my email", "delete the first one"],`)
    expect(out).toContain('name: "delete-the-first-one"')
    expect(out).toContain('Observed: listen (gated: act: Delete)')
  })

  it('keeps a home-started task self-contained', () => {
    const m = buildModel(session())
    expect(evalScenario(m, m.tasks[0]!)).toContain(`utterances: ["open my email"],`)
  })
})
