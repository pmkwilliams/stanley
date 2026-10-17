import type { AgentDebugEvent, Entry } from '@stanley/agent'
import type { ModelMessage } from 'ai'
import type { AppDebugEvent, DebugEvent, LegacyLogEntry } from '../../../shared/ipc'

type Of<T extends AgentDebugEvent['type']> = Extract<AgentDebugEvent, { type: T }>

export interface TickView {
  id: number
  at: number
  task: number | null
  start: Of<'tick-start'>
  decision?: Of<'decision'>
  gates: Of<'gate'>[]
  /** What a button does, judged before pressing it. */
  /** What the screen was laid out to show, or why it was left. */
  screens: Of<'screen'>[]
  /** Steps taken, by Jev or by thinking. */
  acts: Of<'act'>[]
  /** Thinking calls: a single step on a field or button Jev chose, or a whole turn (one may follow the other). */
  thinking: ThinkView[]
  end?: Of<'tick-end'>
}

export interface ThinkView {
  start: Of<'think-start'>
  steps: Of<'think-step'>[]
  end?: Of<'think-end'>
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
  /** The history thinking reads, committed, rebuilt from its records. */
  history: Entry[]
  /** What thinking hasn't seen yet, as it was staged. */
  staged: Entry[]
  /** Older sessions recorded a message log instead. */
  legacy: LegacyLogEntry[]
}

export function buildModel(events: DebugEvent[]): DebugModel {
  const model: DebugModel = { startAt: events[0]?.at ?? 0, rows: [], ticks: [], tasks: [], history: [], staged: [], legacy: [] }
  const ticks = new Map<number, TickView>()
  const utterances = new Map<number, string[]>()
  let task: TaskView | null = null
  const startTask = (at: number) => {
    task = { index: model.tasks.length + 1, at, utterances: [], ticks: [] }
    utterances.clear()
    model.tasks.push(task)
    model.rows.push({ kind: 'task', task })
  }
  const endTask = (at: number) => {
    if (task) task.endAt = at
    task = null
  }
  const heard = (utteranceId: number, text: string) => {
    if (!task) return
    const parts = utterances.get(utteranceId) ?? []
    if (!parts.length) utterances.set(utteranceId, parts)
    parts.push(text)
    task.utterances = [...utterances.values()].map((p) => p.join(' '))
  }

  for (const e of events) {
    if (e.source === 'history') {
      const r = e.event
      // Staged as it happens, so that is when a task starts or ends; committed later, in order.
      if (r.type === 'staged') {
        model.staged.push(r.entry)
        if (r.entry.meta.event === 'task-start') startTask(e.at)
        else if (r.entry.meta.event === 'task-end') endTask(e.at)
      } else if (r.type === 'words') heard(r.utteranceId, r.text)
      else if (r.type === 'commit') {
        model.history.push(...r.entries)
        if (r.placed) model.staged = []
      } else if (r.type === 'amend') model.history.splice(r.at, r.remove, ...r.insert)
      continue
    }
    if (e.source === 'log') {
      const entry = e.event
      model.legacy.push(entry)
      if (entry.role === 'event' && entry.kind === 'task-start') startTask(e.at)
      else if (entry.role === 'event' && entry.kind === 'task-end') endTask(e.at)
      else if (entry.role === 'user') heard(entry.utteranceId as number, entry.content as string)
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
        const tick: TickView = { id: ev.tickId, at: e.at, task: (task as TaskView | null)?.index ?? null, start: ev, gates: [], screens: [], acts: [], thinking: [] }
        ticks.set(ev.tickId, tick)
        model.ticks.push(tick)
        ;(task as TaskView | null)?.ticks.push(tick)
        model.rows.push({ kind: 'tick', tick })
        continue
      }
      // Turn-taking isn't part of one tick: it shows as a row of its own.
      if (ev.type === 'turn' || ev.type === 'turn-end' || ev.type === 'turn-resumed' || ev.type === 'say' || ev.type === 'cut' || ev.type === 'overlap' || ev.type === 'working' || ev.type === 'task') {
        model.rows.push({ kind: 'event', event: e, category: undefined })
        continue
      }
      const tick = ticks.get(ev.tickId)
      if (!tick) continue
      if (ev.type === 'gate') tick.gates.push(ev)
      else if (ev.type === 'decision') tick.decision = ev
      else if (ev.type === 'act') tick.acts.push(ev)
      else if (ev.type === 'screen') tick.screens.push(ev)
      else if (ev.type === 'think-start') tick.thinking.push({ start: ev, steps: [] })
      else if (ev.type === 'think-step') tick.thinking.at(-1)?.steps.push(ev)
      else if (ev.type === 'think-end') {
        const t = tick.thinking.at(-1)
        if (t) t.end = ev
      } else if (ev.type === 'tick-end') tick.end = ev
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

/** What a thinking call was sent: the first `entries` of the history (it is append-only), as messages. */
export function modelInput(model: DebugModel, think: ThinkView): ModelMessage[] {
  return model.history.slice(0, think.start.entries).flatMap((e) => (e.message ? [e.message] : []))
}

/** One part of a message, as the debug window shows it. */
export interface MessagePart {
  kind: 'text' | 'reasoning' | 'call' | 'result' | 'other'
  text: string
}

export function messageParts(m: ModelMessage): MessagePart[] {
  if (typeof m.content === 'string') return [{ kind: 'text', text: m.content }]
  return m.content.map((p): MessagePart => {
    if (p.type === 'text') return { kind: 'text', text: p.text }
    if (p.type === 'reasoning') return { kind: 'reasoning', text: p.text }
    if (p.type === 'tool-call') return { kind: 'call', text: `${p.toolName} ${JSON.stringify(p.input)}  · ${p.toolCallId}` }
    if (p.type === 'tool-result') {
      const o = p.output
      const value = o.type === 'text' || o.type === 'error-text' ? o.value : o.type === 'json' || o.type === 'error-json' ? JSON.stringify(o.value, null, 2) : o.type
      return { kind: 'result', text: `${o.type.startsWith('error') ? 'error: ' : ''}${value}` }
    }
    return { kind: 'other', text: p.type }
  })
}

/** A thinking call's exact input as text: instructions, then each message. For pasting elsewhere. */
export function inputText(model: DebugModel, think: ThinkView): string {
  const messages = modelInput(model, think)
  return [`# instructions\n${model.session?.instructions ?? '(not recorded)'}`, ...messages.map((m) => `# ${m.role}\n${JSON.stringify(m.content, null, 2)}`)].join('\n\n')
}

/** `+12.34s` from session start. */
export function offset(at: number, startAt: number): string {
  return `+${((at - startAt) / 1000).toFixed(2)}s`
}

export function ms(n: number | undefined): string {
  return n === undefined ? '—' : `${Math.round(n)}ms`
}

/** What Jev answered: `act: open Email`, or just `listen` when no step was taken. */
export function decided(tick: TickView): string {
  const a = tick.decision?.result.answers
  if (!a?.next) return '—'
  return a.next.choice === 'act' ? `act: ${a.step?.choice}` : a.next.choice
}

/** How a tick ended, e.g. `open Email`, `listen (gated)`. */
export function tickLabel(tick: TickView): string {
  if (!tick.end) return '…'
  const { outcome, effective } = tick.end
  if (outcome === 'error') return 'error'
  if (outcome === 'stale-discarded') return `${decided(tick)} (stale)`
  if (outcome === 'gated') return `${effective} (gated: ${decided(tick)})`
  if (outcome === 'forced-stop') return 'stuck'
  return effective
}

/** A question's options ranked by Jev probability, including ones Jev gave no mass to. */
export function rankedOptions(tick: TickView, question = 'step'): { option: string; description: string | null; p: number | null }[] {
  const probs = tick.decision?.result.answers[question]?.probabilities ?? {}
  return Object.entries(tick.start.questions[question]?.options ?? {})
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
  const startNode = task.ticks[0]?.start.screenId ?? 'home'
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
