import type { ActionArgs, AgentNode } from '@stanley/app-sdk'
import type { ChoiceResult, DecisionClient } from '@stanley/jev'
import { defaultConfig, type AgentConfig } from './config'
import type { AgentDebugEvent, RequestResult, TickReason } from './debug'
import { MessageLog } from './log'
import { buildOptions, GLOBALS, type GlobalOption } from './options'
import { toJevState, type NowBlock } from './serialize'
import type { TextGen } from './textgen'
import { fullText, hasNewWords, type TranscriptSnapshot } from './transcript'

/** What the agent can see and do. Implemented by the desktop shell. */
export interface World {
  /** Root node (`home`) whose children are the apps. */
  tree(): AgentNode
  currentNodeId(): string
  now(): Omit<NowBlock, 'liveUtterance' | 'utteranceFinal'>
  perform(node: AgentNode, args: ActionArgs): Promise<{ observation?: string; summary: string }>
  global(option: 'show' | 'home' | 'back'): Promise<void>
}

export type TickOutcome = 'executed' | 'stale-discarded' | 'gated' | 'forced-stop' | 'error'

export interface TickReport {
  id: number
  top: { option: string; p: number }[]
  choice: string
  confidence: number
  latencyMs: number
  outcome: TickOutcome
  detail?: string
}

export type AgentStatus = 'idle' | 'thinking' | 'acting' | 'didnt-get-that' | 'stuck'

export interface AgentEvents {
  tick(report: TickReport): void
  status(status: AgentStatus): void
  debug(event: AgentDebugEvent): void
}

export const SYSTEM_PROMPT = `# Stanley
You are the decision layer of a voice assistant that operates apps on the user's computer.
Each step you pick exactly one option: navigate, act, show the result, wait for the user, or stop.

How to decide:
- Carry the request all the way through. "Go through my inbox" means open the inbox and then open the first message. "Check X" means open X itself, not just the list it is in.
- For a question, find the answer: search, then open the most relevant result to read it. Stop once the screen shows the answer.
- Work in the background. Use "show" when the screen holds what the user asked for, not for intermediate steps.
- Choose "wait" while the user is still speaking and the request is not yet clear, or when nothing sensible can be done yet.
- Choose "stop" only when the whole request is done.`

const INSTRUCTIONS = 'Which single option best moves toward what the user wants right now?'

export class Agent {
  readonly log: MessageLog
  private transcript: TranscriptSnapshot = { finalized: [], partial: '' }
  private seen: TranscriptSnapshot | null = null
  private utteranceEnded = false
  private inFlight = false
  /** Tick requested while a call was in flight; replayed when it settles. */
  private deferred: TickReason | null = null
  private halted = true
  private taskOpen = false
  private lastEffective = ''
  private actions = 0
  private recent: string[] = []
  private tickId = 0
  private utteranceId = 0
  private abort?: AbortController
  /** Last report of the current tick; its outcome is the tick's outcome. */
  private outcome: { outcome: TickOutcome; detail?: string } | null = null

  constructor(
    private world: World,
    private jev: DecisionClient,
    private textGen: TextGen,
    private events: Partial<AgentEvents> = {},
    readonly config: AgentConfig = defaultConfig,
    sink?: ConstructorParameters<typeof MessageLog>[0],
  ) {
    this.log = new MessageLog(sink)
    this.log.push({ role: 'system', content: SYSTEM_PROMPT })
  }

  // ── Transcript input ────────────────────────────────────────────────────

  utteranceStart(): void {
    this.utteranceId++
    this.transcript = { finalized: [], partial: '' }
    this.seen = null
    this.utteranceEnded = false
    this.actions = 0
    this.recent = []
    this.openTask()
  }

  /** Speech after a `stop` (same utterance or new) starts a new task. */
  private openTask(): void {
    if (this.taskOpen) return
    this.taskOpen = true
    this.log.push({ role: 'event', kind: 'task-start' })
  }

  partial(text: string): void {
    this.transcript = { ...this.transcript, partial: text }
    this.request('words')
  }

  /** A VAD segment finalized. Logged as a user message. */
  segment(text: string): void {
    if (!text.trim()) return
    this.transcript = { finalized: [...this.transcript.finalized, text], partial: '' }
    this.log.push({ role: 'user', content: text, utteranceId: String(this.utteranceId) })
    this.request('words')
  }

  utteranceEnd(): void {
    this.utteranceEnded = true
    this.request('end')
  }

  /** The person clicked or typed in an app directly. */
  recordManual(option: string, nodeId: string, result: { observation?: string; summary: string }, args?: ActionArgs): void {
    const id = `manual-${Date.now()}`
    this.log.push({ role: 'assistant', origin: 'user', toolCall: { id, option, nodeId, args } })
    this.log.push({ role: 'tool', toolCallId: id, content: result.observation ?? result.summary, summary: result.summary })
  }

  cancel(): void {
    this.abort?.abort()
  }

  // ── Scheduling ──────────────────────────────────────────────────────────

  private request(reason: TickReason): void {
    const trace = (result: RequestResult) => this.events.debug?.({ type: 'request', reason, result })
    if (this.inFlight) {
      // An action-driven tick must not be lost behind a words/end check.
      if (reason === 'action' || !this.deferred) this.deferred = reason
      return trace('deferred')
    }
    const fresh = hasNewWords(this.transcript, this.seen)
    if (reason === 'words' && !fresh) return trace('no-new-words')
    if (reason === 'action' && this.halted) return trace('halted')
    // Ending the utterance only matters if the agent was waiting on the user.
    if (reason === 'end' && !fresh && this.halted && this.lastEffective !== 'wait') return trace('nothing-to-re-ask')
    trace('tick')
    if (fresh) this.openTask()
    void this.tick(reason)
  }

  private async tick(reason: TickReason): Promise<void> {
    this.inFlight = true
    this.deferred = null
    this.halted = false
    const seen = structuredClone(this.transcript)
    const seenEnded = this.utteranceEnded
    this.seen = seen
    const id = ++this.tickId
    this.outcome = null
    this.events.status?.('thinking')

    const currentNodeId = this.world.currentNodeId()
    const options = buildOptions(this.world.tree(), currentNodeId, this.config.maxNodes)
    const state = toJevState(SYSTEM_PROMPT, this.log.entries, {
      ...this.world.now(),
      liveUtterance: this.transcript.partial,
      utteranceFinal: this.utteranceEnded,
    })
    this.events.debug?.({
      type: 'tick-start',
      tickId: id,
      reason,
      utteranceId: this.utteranceId,
      transcript: seen,
      utteranceEnded: seenEnded,
      currentNodeId,
      state,
      instructions: INSTRUCTIONS,
      options: options.criteria,
    })

    let result: ChoiceResult
    this.abort = new AbortController()
    try {
      result = await this.jev.choose({ state, instructions: INSTRUCTIONS, options: options.criteria, signal: this.abort.signal })
    } catch (err) {
      this.inFlight = false
      this.fail(id, err)
      return
    }

    // Only new words make a decision stale. The utterance ending mid-call does
    // not invalidate an action; a `wait` gets re-asked below instead.
    const stale = hasNewWords(this.transcript, seen)
    const endedDuringCall = this.utteranceEnded && !seenEnded
    const node = options.nodes.get(result.choice)
    this.events.debug?.({ type: 'decision', tickId: id, result, stale, endedDuringCall })

    let effective: string
    try {
      effective = await this.handle(id, result, node, stale)
    } catch (err) {
      // A failed fill or action must not leave the loop stuck in `acting`.
      this.fail(id, err)
      return
    } finally {
      this.inFlight = false
    }
    this.events.debug?.({ type: 'tick-end', tickId: id, effective, ...(this.outcome ?? { outcome: 'executed' }) })
    this.lastEffective = effective
    const deferred = this.deferred
    this.deferred = null
    if (stale) this.request('words')
    else if (deferred === 'action') this.request('action')
    else if (endedDuringCall && effective === 'wait') this.request('end')
  }

  /** Returns the choice that actually took effect (after gating). */
  private async handle(id: number, r: ChoiceResult, node: AgentNode | undefined, stale: boolean): Promise<string> {
    const c = this.config
    let choice = r.choice

    if (stale) {
      const confidentNav = node?.kind === 'location' && r.confidence >= c.staleNavConfidence
      if (choice !== 'wait' && !confidentNav) {
        this.gate(id, 'stale', `new words arrived during the call; only a navigation at ≥ ${c.staleNavConfidence} survives`)
        this.log.push({ role: 'event', kind: 'stale', detail: choice })
        this.report(id, r, 'stale-discarded')
        return 'stale'
      }
    }

    if (r.confidence < c.minConfidence && choice !== 'wait' && choice !== 'stop') {
      this.gate(id, 'min-confidence', `confidence ${r.confidence.toFixed(2)} < minConfidence ${c.minConfidence} → wait`)
      this.log.push({ role: 'event', kind: 'gated', detail: `${choice} @ ${r.confidence.toFixed(2)}` })
      this.report(id, r, 'gated')
      choice = 'wait'
    } else if (node?.destructive && r.confidence < c.destructiveConfidence) {
      this.gate(id, 'destructive', `destructive action at ${r.confidence.toFixed(2)} < destructiveConfidence ${c.destructiveConfidence} → wait`)
      this.log.push({ role: 'event', kind: 'gated', detail: `destructive ${choice} @ ${r.confidence.toFixed(2)}` })
      this.report(id, r, 'gated')
      choice = 'wait'
    }

    if (choice === 'wait') {
      if (r.choice === 'wait') {
        this.logDecision(id, 'wait', r)
        this.report(id, r, 'executed')
      }
      this.halt(this.utteranceEnded ? 'didnt-get-that' : 'idle')
      return 'wait'
    }

    if (choice === 'stop' || choice === 'handoff') {
      this.logDecision(id, choice, r)
      this.report(id, r, 'executed', choice === 'handoff' ? 'handoff not implemented' : undefined)
      await this.finishTask()
      return choice
    }

    this.recent = [...this.recent, choice].slice(-c.oscillation.window)
    const repeats = this.recent.filter((x) => x === choice).length
    if (++this.actions > c.maxActionsPerUtterance || repeats >= c.oscillation.repeats) {
      if (repeats >= c.oscillation.repeats) {
        this.gate(id, 'oscillation', `"${choice}" chosen ${repeats}× in the last ${c.oscillation.window} actions`)
      } else {
        this.gate(id, 'step-cap', `more than ${c.maxActionsPerUtterance} actions this utterance`)
      }
      this.log.push({ role: 'event', kind: 'forced-stop', detail: repeats >= c.oscillation.repeats ? 'oscillation' : 'step cap' })
      this.report(id, r, 'forced-stop')
      await this.finishTask('stuck')
      return 'stop'
    }

    this.events.status?.('acting')
    const callId = `call-${id}`
    if (choice in GLOBALS) {
      this.log.push({ role: 'assistant', origin: 'agent', toolCall: { id: callId, option: choice }, decision: meta(r) })
      const started = performance.now()
      await this.world.global(choice as Exclude<GlobalOption, 'wait' | 'stop' | 'handoff'>)
      this.events.debug?.({ type: 'act', tickId: id, option: choice, latencyMs: performance.now() - started })
    } else if (node) {
      const args: ActionArgs = {}
      if (node.kind === 'input' && node.input) {
        const context = toJevState(SYSTEM_PROMPT, this.log.entries, {
          ...this.world.now(),
          liveUtterance: fullText(this.transcript),
          utteranceFinal: this.utteranceEnded,
        })
        const { instructions } = node.input
        const started = performance.now()
        args.text = await this.textGen.fill({ context, instructions })
        this.events.debug?.({ type: 'fill', tickId: id, option: choice, instructions, context, text: args.text, latencyMs: performance.now() - started })
      }
      this.log.push({ role: 'assistant', origin: 'agent', toolCall: { id: callId, option: choice, nodeId: node.id, args }, decision: meta(r) })
      const started = performance.now()
      const out = await this.world.perform(node, args)
      this.events.debug?.({ type: 'act', tickId: id, option: choice, nodeId: node.id, args, ...out, latencyMs: performance.now() - started })
      this.log.push({ role: 'tool', toolCallId: callId, content: out.observation ?? out.summary, summary: out.summary })
    }
    this.report(id, r, 'executed')
    this.request('action')
    return choice
  }

  private logDecision(id: number, option: string, r: ChoiceResult): void {
    this.log.push({ role: 'assistant', origin: 'agent', toolCall: { id: `call-${id}`, option }, decision: meta(r) })
  }

  private async finishTask(status: AgentStatus = 'idle'): Promise<void> {
    await this.world.global('show')
    if (this.taskOpen) this.log.push({ role: 'event', kind: 'task-end' })
    this.taskOpen = false
    this.halt(status)
  }

  private gate(tickId: number, rule: Extract<AgentDebugEvent, { type: 'gate' }>['rule'], detail: string): void {
    this.events.debug?.({ type: 'gate', tickId, rule, detail })
  }

  private fail(id: number, err: unknown): void {
    this.report(id, null, 'error', String(err))
    this.events.debug?.({ type: 'tick-end', tickId: id, outcome: 'error', effective: 'error', detail: String(err) })
    this.halt('idle')
  }

  private halt(status: AgentStatus): void {
    this.halted = true
    this.events.status?.(status)
  }

  private report(id: number, r: ChoiceResult | null, outcome: TickOutcome, detail?: string): void {
    const top = r
      ? Object.entries(r.probabilities)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([option, p]) => ({ option, p }))
      : []
    this.outcome = { outcome, detail }
    this.events.tick?.({
      id,
      top,
      choice: r?.choice ?? '',
      confidence: r?.confidence ?? 0,
      latencyMs: r?.latencyMs ?? 0,
      outcome,
      detail,
    })
  }
}

function meta(r: ChoiceResult) {
  return { confidence: r.confidence, probabilities: r.probabilities, latencyMs: r.latencyMs }
}
