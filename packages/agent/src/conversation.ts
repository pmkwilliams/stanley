import type { ModelMessage, ToolResultPart } from 'ai'
import type { FileMeta } from './files'
import type { WebResult } from './web'

export interface DecisionMeta {
  /** Jev's answers that led to the step: what to do, and which step. */
  next?: { choice: string; confidence: number }
  step?: { choice: string; confidence: number; probabilities: Record<string, number> }
  latencyMs?: number
}

/** Who chose something: Jev, thinking, the agent's own code, or the user in the app directly. Debug only. */
export type Actor = 'jev' | 'thinking' | 'agent' | 'user'

/** What a step operated, enough to describe it without the screen it was on. */
export type StepTarget =
  | { kind: 'element'; name: string; role: string; nodeKind: 'location' | 'action' | 'input' | 'group'; nodeId: string }
  | { kind: 'app'; appId: string; title: string }
  | { kind: 'back' }
  | { kind: 'home' }
  | { kind: 'lock' }
  /** A web page Stanley found or read, opened on screen by its address. */
  | { kind: 'page'; url: string; title: string }
  /** The screen laid out: what is on it then is the step's summary (`describeScreen`). */
  | { kind: 'arrange' }

/** A step that ran on screen. */
export interface StepMeta {
  id: string
  by: Actor
  target: StepTarget
  /** Text typed into a field. */
  text?: string
  /** Whose words `text` is: the user's (or follows from their request), or written by Stanley. */
  wrote?: 'user' | 'stanley'
  summary: string
  error?: boolean
  /** Fuller content the step produced, for the debug window. */
  observation?: string
  /** The utterance being heard when the step was decided, so it reads after those words. */
  utteranceId?: number
  /** How many of that utterance's words had been heard when the step was decided. */
  heardWords?: number
  decision?: DecisionMeta
}

/** A web search or a page read in the background. */
export type LookupMeta =
  | { kind: 'search'; query: string; results: WebResult[]; error?: string; utteranceId?: number }
  | { kind: 'read'; url: string; title: string; error?: string; utteranceId?: number }

/**
 * A background task (see background.ts): started by thinking's `delegate`, then ended, in a note
 * from the computer. `summary` is its result, or why it failed.
 */
export interface TaskMeta {
  id: string
  title: string
  state: 'working' | 'done' | 'failed' | 'cancelled'
  summary?: string
}

/** What one tool result did, joined to its call by `toolCallId`. */
export interface ResultMeta {
  toolCallId?: string
  step?: StepMeta
  lookup?: LookupMeta
  /** A command on the user's files. */
  file?: FileMeta
  task?: TaskMeta
}

export interface EntryMeta {
  at: number
  /**
   * - `words`: what the user said, placed (see `place`).
   * - `heard`: a finalized segment, staged until it is placed. Never committed.
   * - `call`: an assistant message of a thinking turn, or a tool call of Jev's or the agent's.
   * - `result`: tool results.
   * - `said`: what Stanley said.
   * - `note`: from the computer, in `<note>` tags.
   * - `observation`: the screen at a thinking call.
   * - `event`: task boundaries and guards.
   */
  kind: 'words' | 'heard' | 'call' | 'result' | 'said' | 'note' | 'observation' | 'event'
  utteranceId?: number
  /** Words: which of the utterance's words, `[from, to)`. */
  span?: [number, number]
  /** Words: the utterance's first part, or what the user said after a step that changed something. */
  part?: 'first' | 'went-on'
  by?: Actor
  /** Results, in the order of the tool message's parts; a user's own step as a note. */
  results?: ResultMeta[]
  toolCallId?: string
  replyId?: number
  /** Said: all of the reply as told, and as far as the user heard it if they cut in. */
  said?: { text: string; heard?: string }
  /** The thinking turn (tick) it came from. */
  turn?: number
  event?: 'task-start' | 'task-end' | 'stuck'
  /** Stuck: why, as "it kept repeating the same step". */
  detail?: string
}

export interface Entry {
  id: string
  /** What thinking reads: one message, or none (task boundaries, segments). */
  message?: ModelMessage
  meta: EntryMeta
}

/** The utterance being heard right now, including words not yet finalized. */
export interface LiveUtterance {
  utteranceId: number
  text: string
  ended: boolean
}

/** What the sink receives. Replaying `commit` and `amend` rebuilds the history thinking reads. */
export type HistoryRecord =
  | { type: 'words'; utteranceId: number; text: string }
  | { type: 'staged'; entry: Entry }
  /** Appended. `placed`: what was staged, now committed. */
  | { type: 'commit'; entries: Entry[]; placed?: true }
  | { type: 'amend'; at: number; remove: number; insert: Entry[] }

/** What a thinking call is sent. */
export interface Sent {
  messages: ModelMessage[]
  /** Index in `messages` of the last message the previous call sent: its cache can be read there. */
  cacheAt?: number
  /** How many history entries it covers, observation included. The history is append-only, so this is the exact input. */
  entries: number
}

/** A tool call a thinking turn made that ran, for joining meta and for turns cut short. */
export interface Ran {
  tool: string
  input: unknown
  output: ToolResultPart['output']
  result: ResultMeta
  /** The screen it returned, if it returned one. */
  screen?: string
}

const wordsOf = (text: string) => text.trim().split(/\s+/).filter(Boolean)

/** `<note>…</note>` from the computer, as a user message. */
export function note(text: string): ModelMessage {
  return { role: 'user', content: `<note>${text}</note>` }
}

/**
 * One persistent history of the session, as AI SDK messages. Thinking reads all of it, exactly as
 * it was sent before, with new messages only ever appended. Jev reads a rendering of `view()`.
 *
 * What thinking hasn't seen yet is staged: the user's words, Jev's steps, notes and replies. A
 * thinking call (`send`) and the start of the next utterance (`begin`) commit it, in the order
 * `place` gives. Nothing that was sent is ever changed; what wasn't (a turn's final output, a
 * reply not yet sent) can be, which costs no cache.
 */
export class Conversation {
  /** Committed, in final order. */
  readonly entries: Entry[] = []
  private staged: Entry[] = []
  private segments = new Map<number, string[]>()
  /** Per utterance, how many of its words are committed. */
  private printed = new Map<number, number>()
  /** Entries before this index were sent to thinking, and never change. */
  private sentEnd = 0
  /** The entry the previous thinking call's input ended on. */
  private readPoint?: string
  private count = 0

  constructor(private sink?: (record: HistoryRecord) => void) {}

  /**
   * What the user said before any utterance, as the session's first words: committed as is, with
   * nothing run for them. Utterance 0, which no utterance ever is.
   */
  greet(text: string): void {
    this.push([this.entry({ kind: 'words', by: 'user', utteranceId: 0, span: [0, wordsOf(text).length], part: 'first' }, { role: 'user', content: text })])
  }

  /** A finalized segment of what the user said, as the models read it. */
  heard(utteranceId: number, text: string): void {
    this.segments.set(utteranceId, [...(this.segments.get(utteranceId) ?? []), text])
    this.sink?.({ type: 'words', utteranceId, text })
    this.stage({ kind: 'heard', utteranceId })
  }

  /** Something thinking hasn't seen yet. */
  stage(meta: Omit<EntryMeta, 'at'>, message?: ModelMessage): Entry {
    const entry = this.entry(meta, message)
    this.staged.push(entry)
    this.sink?.({ type: 'staged', entry })
    return entry
  }

  /** A step Jev or the agent chose: the call and its result, staged as a pair. */
  stagePair(call: { toolCallId: string; tool: string; input: unknown; by: Actor }, output: ToolResultPart['output'], result: ResultMeta): void {
    this.stage({ kind: 'call', by: call.by, toolCallId: call.toolCallId }, callMessage(call))
    this.stage({ kind: 'result', by: call.by, toolCallId: call.toolCallId, results: [result] }, resultMessage(call, output))
  }

  /** Places what is staged and commits it. */
  commit(live?: LiveUtterance): void {
    if (!this.staged.length && !(live && this.unprinted(live))) return
    const placed = place(this.staged, this.segments, this.printed, live, () => this.nextId())
    this.staged = []
    for (const e of placed) if (e.meta.kind === 'words') this.printed.set(e.meta.utteranceId!, e.meta.span![1])
    this.push(placed, true)
  }

  /** A new utterance starts: what was staged for the last one is committed. */
  begin(): void {
    this.commit()
  }

  /**
   * A thinking call: commits everything before it, then the observation. Calls a single-step turn
   * left unanswered are dropped first, so every call has its result.
   */
  send(observation: string, live?: LiveUtterance): Sent {
    for (let i = this.entries.length - 1; i >= this.sentEnd; i--) if (this.unanswered(i)) this.splice(i, 1, [])
    this.commit(live)
    this.push([this.entry({ kind: 'observation' }, { role: 'user', content: observation })])
    const messages: ModelMessage[] = []
    let cacheAt: number | undefined
    for (const e of this.entries) {
      if (!e.message) continue
      messages.push(e.message)
      if (e.id === this.readPoint) cacheAt = messages.length - 1
    }
    const problem = validate(messages)
    if (problem) throw new Error(`Invalid history: ${problem}`)
    this.sentEnd = this.entries.length
    this.readPoint = this.entries.at(-1)!.id
    return { messages, cacheAt, entries: this.entries.length }
  }

  /**
   * A thinking turn's messages, as the SDK sent them between steps: the first `sent` were input to
   * its last step. The rest is the final output, which was never input: its text is taken out (it
   * goes in as what Stanley said, once said), and what is left of it is dropped if empty. `ran`
   * gives meta for the tool calls that ran; any that aren't in `messages` (a step cut short) are
   * added after them as Stanley's own call and result. Returns the final output's text.
   */
  appendTurn(messages: ModelMessage[], sent: number, ran: Map<string, Ran>, turn?: number): { final: string; toolCallIds: string[] } {
    const entries: Entry[] = []
    const toolCallIds: string[] = []
    let final = ''
    messages.forEach((m, i) => {
      let message = m
      if (i >= sent && m.role === 'assistant' && Array.isArray(m.content)) {
        final += m.content.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('')
        const content = m.content.filter((p) => p.type !== 'text')
        if (!content.some((p) => p.type === 'tool-call')) return
        message = { ...m, content }
      } else if (i >= sent && m.role === 'assistant') {
        final += m.content
        return
      }
      entries.push(this.turnEntry(message, ran, turn, toolCallIds))
    })
    for (const [toolCallId, r] of ran) {
      if (toolCallIds.includes(toolCallId)) continue
      const call = { toolCallId, tool: r.tool, input: r.input, by: 'thinking' as const }
      entries.push(this.entry({ kind: 'call', by: 'thinking', toolCallId, turn }, callMessage(call)))
      entries.push(this.entry({ kind: 'result', by: 'thinking', toolCallId, turn, results: [r.result] }, resultMessage(call, r.output)))
      toolCallIds.push(toolCallId)
    }
    const start = this.entries.length
    this.push(entries)
    // Each message before `sent` is one entry. They were input to the turn's last step, so they
    // can't change, and its cache can be read where they end.
    if (sent) {
      this.sentEnd = start + sent
      this.readPoint = this.entries[this.sentEnd - 1]!.id
    }
    return { final: final.trim(), toolCallIds }
  }

  /**
   * A single-step turn's call was applied: its result goes right after it. If the call is gone (it
   * was dropped, or sent unanswered), the step goes in as Stanley's own call and result.
   */
  applyCall(toolCallId: string, call: { tool: string; input: unknown }, output: ToolResultPart['output'], result: ResultMeta): void {
    const i = this.entries.findIndex((e) => e.meta.kind === 'call' && e.meta.toolCallId === toolCallId)
    if (i >= this.sentEnd && this.unanswered(i)) {
      const tool = { toolCallId, tool: call.tool, input: call.input, by: 'thinking' as const }
      this.splice(i + 1, 0, [this.entry({ kind: 'result', by: 'thinking', toolCallId, results: [result] }, resultMessage(tool, output))])
      return
    }
    this.stagePair({ toolCallId: `stanley_${this.count + 1}`, tool: call.tool, input: call.input, by: 'thinking' }, output, result)
  }

  /** A single-step turn's call wasn't applied: it was output, never input, so it goes. */
  dropCall(toolCallId: string): void {
    const i = this.entries.findIndex((e) => e.meta.kind === 'call' && e.meta.toolCallId === toolCallId)
    if (i >= this.sentEnd && this.unanswered(i)) this.splice(i, 1, [])
  }

  /** What Stanley said, once said. `message` is what of it thinking doesn't already have ('' for none). */
  said(replyId: number, text: string, message = text): void {
    this.stage({ kind: 'said', by: 'agent', replyId, said: { text } }, message ? { role: 'assistant', content: message } : undefined)
  }

  /**
   * The user cut in on reply `replyId`: they heard only `spoken`. Not yet sent, the reply is cut to
   * what they heard (`heardMessage` is that part of its message), followed by a note. Already sent,
   * a note says what they heard.
   */
  cut(replyId: number, spoken: string, heardMessage = spoken): void {
    const find = (list: Entry[]) => list.findIndex((e) => e.meta.kind === 'said' && e.meta.replyId === replyId)
    const staged = find(this.staged)
    const committed = staged === -1 ? find(this.entries) : -1
    const entry = staged !== -1 ? this.staged[staged] : committed !== -1 ? this.entries[committed] : undefined
    if (!entry) return
    const cutNote = (text: string) => this.entry({ kind: 'note', by: 'agent', replyId }, note(text))
    const amended: Entry = {
      ...entry,
      meta: { ...entry.meta, said: { text: entry.meta.said!.text, heard: spoken } },
      message: heardMessage ? { role: 'assistant', content: heardMessage } : undefined,
    }
    const here = cutNote(spoken ? 'The user cut in here.' : 'The user cut in before hearing any of that.')
    if (staged !== -1) {
      this.staged.splice(staged, 1, amended, here)
    } else if (committed >= this.sentEnd) {
      this.splice(committed, 1, [amended, here])
    } else {
      // Sent: the reply's message stays as it was, and a note says what reached the user.
      this.splice(committed, 1, [{ ...entry, meta: amended.meta }])
      this.stage({ kind: 'note', by: 'agent', replyId }, note(spoken ? `The user cut in while you were saying that. They heard only: "${spoken}"` : 'The user cut in before hearing any of that.'))
    }
  }

  /** Everything committed, for thinking. */
  messages(): ModelMessage[] {
    return this.entries.flatMap((e) => (e.message ? [e.message] : []))
  }

  /** Committed and staged, placed as they would be committed now: what Jev and the helpers read. */
  view(live?: LiveUtterance): Entry[] {
    if (!this.staged.length && !(live && this.unprinted(live))) return this.entries
    let n = 0
    return [...this.entries, ...place(this.staged, this.segments, this.printed, live, () => `view-${++n}`)]
  }

  private unprinted(live: LiveUtterance): boolean {
    return wordsOf(live.text).length > (this.printed.get(live.utteranceId) ?? 0)
  }

  /** A tool call at `i` whose result isn't right after it. */
  private unanswered(i: number): boolean {
    const m = this.entries[i]?.message
    return !!m && hasCalls(m) && this.entries[i + 1]?.message?.role !== 'tool'
  }

  private turnEntry(message: ModelMessage, ran: Map<string, Ran>, turn: number | undefined, toolCallIds: string[]): Entry {
    if (message.role === 'tool') {
      const results = message.content.flatMap((p) => (p.type === 'tool-result' ? [{ toolCallId: p.toolCallId, ...ran.get(p.toolCallId)?.result }] : []))
      for (const r of results) if (r.toolCallId) toolCallIds.push(r.toolCallId)
      return this.entry({ kind: 'result', by: 'thinking', turn, results }, message)
    }
    const call = message.role === 'assistant' && Array.isArray(message.content) ? message.content.find((p) => p.type === 'tool-call') : undefined
    return this.entry({ kind: 'call', by: 'thinking', turn, ...(call?.type === 'tool-call' && { toolCallId: call.toolCallId }) }, message)
  }

  private entry(meta: Omit<EntryMeta, 'at'>, message?: ModelMessage): Entry {
    return { id: this.nextId(), ...(message && { message }), meta: { at: Date.now(), ...meta } }
  }

  private nextId(): string {
    return `h${++this.count}`
  }

  private push(entries: Entry[], placed?: true): void {
    if (!entries.length) return
    this.entries.push(...entries)
    this.sink?.({ type: 'commit', entries, ...(placed && { placed }) })
  }

  private splice(at: number, remove: number, insert: Entry[]): void {
    this.entries.splice(at, remove, ...insert)
    this.sink?.({ type: 'amend', at, remove, insert })
  }
}

function hasCalls(m: ModelMessage): boolean {
  return m.role === 'assistant' && Array.isArray(m.content) && m.content.some((p) => p.type === 'tool-call')
}

function callMessage(call: { toolCallId: string; tool: string; input: unknown }): ModelMessage {
  return { role: 'assistant', content: [{ type: 'tool-call', toolCallId: call.toolCallId, toolName: call.tool, input: call.input }] }
}

function resultMessage(call: { toolCallId: string; tool: string }, output: ToolResultPart['output']): ModelMessage {
  return { role: 'tool', content: [{ type: 'tool-result', toolCallId: call.toolCallId, toolName: call.tool, output }] }
}

/** Rebuilds the committed history from what the sink received. */
export function replay(records: HistoryRecord[]): Entry[] {
  const entries: Entry[] = []
  for (const r of records) {
    if (r.type === 'commit') entries.push(...r.entries)
    else if (r.type === 'amend') entries.splice(r.at, r.remove, ...r.insert)
  }
  return entries
}

/**
 * Where the user's words go among what happened while they spoke. Of each utterance, the words not
 * yet committed:
 * 1. Up to its earliest early change come first: a field typed or a button pressed on fewer words
 *    than the user ended up saying. With no early change, all of them.
 * 2. At each early change, the words up to what it was decided on come before it ("went on").
 * 3. Whatever is left comes after the utterance's last entry, or at the end while it is live.
 * Navigation never splits a turn. Words never come between a call and its result.
 */
export function place(staged: Entry[], segments: Map<number, string[]>, printed: Map<number, number>, live: LiveUtterance | undefined, nextId: () => string): Entry[] {
  const words = (utteranceId: number) => wordsOf(live?.utteranceId === utteranceId ? live.text : (segments.get(utteranceId) ?? []).join(' '))
  // A result goes with the call before it.
  const units: Entry[][] = []
  for (const e of staged) {
    if (e.message?.role === 'tool' && units.length && units.at(-1)!.at(-1)!.meta.kind === 'call') units.at(-1)!.push(e)
    else units.push([e])
  }
  const placementOf = (unit: Entry[]) => {
    const e = unit.at(-1)!
    if (e.meta.kind === 'heard') return { utteranceId: e.meta.utteranceId, heard: true }
    const r = e.meta.results?.[0]
    if (r?.step) return { utteranceId: r.step.utteranceId, step: r.step }
    if (r?.lookup) return { utteranceId: r.lookup.utteranceId }
    if (r?.file) return { utteranceId: r.file.utteranceId }
    return {}
  }

  const splits = new Map<number, number[]>()
  const last = new Map<number, number>()
  units.forEach((unit, i) => {
    const { utteranceId: id, step } = placementOf(unit)
    if (id === undefined) return
    last.set(id, i)
    if (!step || !changes(step) || step.heardWords === undefined) return
    const n = words(id).length
    if (step.heardWords > 0 && step.heardWords < n) splits.set(id, [...(splits.get(id) ?? []), step.heardWords])
  })

  const out: Entry[] = []
  const done = new Map(printed)
  const tellUpTo = (utteranceId: number, upTo: number) => {
    const all = words(utteranceId)
    const from = done.get(utteranceId) ?? 0
    const to = Math.min(upTo, all.length)
    if (to <= from) return
    done.set(utteranceId, to)
    out.push({
      id: nextId(),
      message: { role: 'user', content: all.slice(from, to).join(' ') },
      meta: { at: Date.now(), kind: 'words', by: 'user', utteranceId, span: [from, to], part: from === 0 ? 'first' : 'went-on' },
    })
  }
  /** Before anything else of an utterance: its words up to the first early change. */
  const firstPart = (utteranceId: number) => Math.min(...(splits.get(utteranceId) ?? []), Infinity)

  units.forEach((unit, i) => {
    const { utteranceId: id, heard, step } = placementOf(unit)
    if (id !== undefined) {
      if (heard) {
        if (!done.get(id)) tellUpTo(id, firstPart(id))
      } else {
        const early = !!step && changes(step) && step.heardWords !== undefined && step.heardWords > 0
        tellUpTo(id, early ? step!.heardWords! : Math.max(done.get(id) ?? 0, firstPart(id)))
      }
    }
    if (!heard) out.push(...unit)
    // The utterance's last entry: whatever the user said after the last step follows it.
    if (id !== undefined && last.get(id) === i && id !== live?.utteranceId) tellUpTo(id, Infinity)
  })
  if (live) tellUpTo(live.utteranceId, Infinity)
  return out
}

/** A step that changed something: typing, or pressing a button. Opening things only looks. */
export function changes(step: StepMeta): boolean {
  return step.target.kind === 'element' && (step.target.nodeKind === 'action' || step.target.nodeKind === 'input')
}

/**
 * What the API would reject: every tool call has exactly one result right after it, ids are
 * unique, the first message is the user's, and none is empty. Returns the problem, or nothing.
 */
export function validate(messages: ModelMessage[]): string | undefined {
  if (messages[0] && messages[0].role !== 'user') return `the first message is ${messages[0].role}`
  const seen = new Set<string>()
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!
    if (typeof m.content === 'string' ? !m.content.trim() : !m.content.length) return `message ${i} (${m.role}) is empty`
    if (m.role === 'tool' && !(messages[i - 1]?.role === 'tool' || (messages[i - 1] && hasCalls(messages[i - 1]!)))) return `tool results at message ${i} follow no call`
    if (m.role !== 'assistant' || typeof m.content === 'string') continue
    const calls = m.content.flatMap((p) => (p.type === 'tool-call' ? [p.toolCallId] : []))
    if (!calls.length) continue
    const results: string[] = []
    for (let j = i + 1; j < messages.length && messages[j]!.role === 'tool'; j++) {
      for (const p of messages[j]!.content as ToolResultPart[]) if (p.type === 'tool-result') results.push(p.toolCallId)
    }
    for (const id of calls) {
      if (seen.has(id)) return `tool call ${id} appears twice`
      seen.add(id)
      const n = results.filter((r) => r === id).length
      if (n !== 1) return `tool call ${id} (message ${i}) has ${n} results after it`
    }
  }
  return undefined
}

/** The steps in `entries`, in order. */
export function stepsOf(entries: Entry[]): StepMeta[] {
  return entries.flatMap((e) => e.meta.results?.flatMap((r) => (r.step ? [r.step] : [])) ?? [])
}

/** The lookups in `entries`, in order. */
export function lookupsOf(entries: Entry[]): LookupMeta[] {
  return entries.flatMap((e) => e.meta.results?.flatMap((r) => (r.lookup ? [r.lookup] : [])) ?? [])
}

/** The commands on the user's files in `entries`, in order. */
export function filesOf(entries: Entry[]): FileMeta[] {
  return entries.flatMap((e) => e.meta.results?.flatMap((r) => (r.file ? [r.file] : [])) ?? [])
}

/** What Stanley said in `entries`, as far as the user heard it. */
export function saidOf(entries: Entry[]): string[] {
  return entries.flatMap((e) => (e.meta.kind === 'said' && e.meta.said ? [e.meta.said.heard ?? e.meta.said.text] : []))
}

/**
 * The entries Jev reads for a long session: from the first words of its last `maxTurns`
 * utterances on. What Jev no longer reads, Stanley no longer offers (see `knownPages`).
 */
export function recentEntries(entries: Entry[], maxTurns: number): Entry[] {
  const starts: number[] = []
  entries.forEach((e, i) => {
    if (e.meta.kind === 'words' && e.meta.part === 'first') starts.push(i)
  })
  return starts.length > maxTurns ? entries.slice(starts[starts.length - maxTurns]) : entries
}
