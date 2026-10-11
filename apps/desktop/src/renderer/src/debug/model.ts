import type { AgentDebugEvent, LogEntry } from '@stanley/agent'
import type { AppDebugEvent, DebugEvent } from '../../../shared/ipc'

type Of<T extends AgentDebugEvent['type']> = Extract<AgentDebugEvent, { type: T }>

export interface TickView {
  id: number
  at: number
  task: number | null
  start: Of<'tick-start'>
  decision?: Of<'decision'>
  gates: Of<'gate'>[]
  fill?: Of<'fill'>
  act?: Of<'act'>
  /** Consequence checks, by Jev's choice or the escalation model's. */
  checks: Of<'check'>[]
  escalation?: { start: Of<'escalate'>; steps: Of<'escalation-step'>[]; end?: Of<'escalation-end'> }
  end?: Of<'tick-end'>
}

export interface TaskView {
  index: number
  at: number
  endAt?: number
  /** Finalized user text, one entry per utterance. */
  utterances: string[]
  ticks: TickView[]
}

/** Optional row categories the timeline can hide. */
export type Category = 'partials' | 'vad' | 'skipped' | 'status'

export type Row =
  | { kind: 'task'; task: TaskView }
  | { kind: 'tick'; tick: TickView }
  | { kind: 'event'; event: DebugEvent; category?: Category }

export interface DebugModel {
  startAt: number
  session?: Extract<AppDebugEvent, { type: 'session-start' }>
  rows: Row[]
  ticks: TickView[]
  tasks: TaskView[]
  log: LogEntry[]
}

export function buildModel(events: DebugEvent[]): DebugModel {
  const model: DebugModel = { startAt: events[0]?.at ?? 0, rows: [], ticks: [], tasks: [], log: [] }
  const ticks = new Map<number, TickView>()
  const utterances = new Map<string, string[]>()
  let task: TaskView | null = null

  for (const e of events) {
    if (e.source === 'log') {
      const entry = e.event
      model.log.push(entry)
      if (entry.role === 'event' && entry.kind === 'task-start') {
        task = { index: model.tasks.length + 1, at: e.at, utterances: [], ticks: [] }
        utterances.clear()
        model.tasks.push(task)
        model.rows.push({ kind: 'task', task })
      } else if (entry.role === 'event' && entry.kind === 'task-end' && task) {
        task.endAt = e.at
        task = null
      } else if (entry.role === 'user' && task) {
        const parts = utterances.get(entry.utteranceId) ?? []
        if (!parts.length) utterances.set(entry.utteranceId, parts)
        parts.push(entry.content)
        task.utterances = [...utterances.values()].map((p) => p.join(' '))
      }
      continue
    }

    if (e.source === 'agent') {
      const ev = e.event
      if (ev.type === 'request') {
        // `tick` requests show up as the tick row itself.
        if (ev.result !== 'tick') model.rows.push({ kind: 'event', event: e, category: 'skipped' })
        continue
      }
      if (ev.type === 'tick-start') {
        const tick: TickView = { id: ev.tickId, at: e.at, task: task?.index ?? null, start: ev, gates: [], checks: [] }
        ticks.set(ev.tickId, tick)
        model.ticks.push(tick)
        task?.ticks.push(tick)
        model.rows.push({ kind: 'tick', tick })
        continue
      }
      const tick = ticks.get(ev.tickId)
      if (!tick) continue
      if (ev.type === 'gate') tick.gates.push(ev)
      else if (ev.type === 'decision') tick.decision = ev
      else if (ev.type === 'fill') tick.fill = ev
      else if (ev.type === 'act') tick.act = ev
      else if (ev.type === 'check') tick.checks.push(ev)
      else if (ev.type === 'escalate') tick.escalation = { start: ev, steps: [] }
      else if (ev.type === 'escalation-step') tick.escalation?.steps.push(ev)
      else if (ev.type === 'escalation-end') {
        if (tick.escalation) tick.escalation.end = ev
      } else tick.end = ev
      continue
    }

    if (e.source === 'app' && e.event.type === 'session-start') model.session = e.event
    model.rows.push({ kind: 'event', event: e, category: categorize(e) })
  }
  return model
}

function categorize(e: DebugEvent): Category | undefined {
  if (e.source === 'stt') {
    if (e.event.type === 'decode' && e.event.kind === 'partial') return 'partials'
    if (e.event.type === 'speech-start' || e.event.type === 'speech-end') return 'vad'
  }
  if (e.source === 'app' && e.event.type === 'status') return 'status'
  return undefined
}

/** `+12.34s` from session start. */
export function offset(at: number, startAt: number): string {
  return `+${((at - startAt) / 1000).toFixed(2)}s`
}

export function ms(n: number | undefined): string {
  return n === undefined ? '—' : `${Math.round(n)}ms`
}

/** How a tick ended, e.g. `Email`, `wait (gated)`. */
export function tickLabel(tick: TickView): string {
  if (!tick.end) return '…'
  const { outcome, effective } = tick.end
  if (outcome === 'error') return 'error'
  if (outcome === 'stale-discarded') return `${tick.decision?.result.choice} (stale)`
  if (outcome === 'gated') return `${effective} (gated: ${tick.decision?.result.choice})`
  if (outcome === 'forced-stop') return 'stop (forced)'
  return effective
}

/** Options ranked by Jev probability, including ones Jev gave no mass to. */
export function rankedOptions(tick: TickView): { option: string; description: string | null; p: number | null }[] {
  const probs = tick.decision?.result.probabilities ?? {}
  return Object.entries(tick.start.options)
    .map(([option, description]) => ({ option, description, p: probs[option] ?? null }))
    .sort((a, b) => (b.p ?? -1) - (a.p ?? -1))
}

/**
 * A scenario literal for `evals/scenarios.mts`. Evals start from a fresh
 * shell on the home screen, so a task that began elsewhere gets the earlier
 * utterances prepended to reproduce its context.
 */
export function evalScenario(model: DebugModel, task: TaskView): string {
  const earlier = model.tasks.filter((t) => t.index < task.index).flatMap((t) => t.utterances)
  const startNode = task.ticks[0]?.start.currentNodeId ?? 'home'
  const needsContext = startNode !== 'home' && earlier.length > 0
  const utterances = needsContext ? [...earlier, ...task.utterances] : task.utterances
  const observed = task.ticks.map(tickLabel).join(' → ') || 'no decisions'
  const name = (task.utterances[0] ?? 'scenario')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join('-')

  const lines = [
    `  // From debug session ${model.session?.session ?? 'unknown'}, task ${task.index} (started on ${startNode}).`,
    ...(needsContext ? ['  // Earlier utterances are included to recreate the starting screen.'] : []),
    ...(!needsContext && earlier.length ? [`  // Earlier in the session: ${earlier.map((u) => JSON.stringify(u)).join(', ')}`] : []),
    `  // Observed: ${observed}`,
    '  {',
    `    name: ${JSON.stringify(name)},`,
    `    utterances: [${utterances.map((u) => JSON.stringify(u)).join(', ')}],`,
    '    checks: [',
    "      // TODO: what should have happened? e.g. visible('email'), route('email', /^email\\//), actions(6)",
    '    ],',
    '  },',
  ]
  return lines.join('\n')
}
