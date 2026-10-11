import type { ActionArgs, AgentNode } from '@stanley/app-sdk'
import type { ChoiceResult, DecisionClient } from '@stanley/jev'
import { defaultConfig, type AgentConfig } from './config'
import { createConsequenceCheck, describeEffect, type ConsequenceCheck, type ConsequenceVerdict } from './consequence'
import type { AgentDebugEvent, RequestResult, TickReason } from './debug'
import type { Escalator } from './escalate'
import { MessageLog, type LogEntry } from './log'
import { buildOptions, GLOBALS, type GlobalOption, type OptionSet } from './options'
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

/**
 * What the agent is doing, for the presence indicator.
 * - `idle`: no open task.
 * - `guessing`: deciding mid-utterance before anything has been done for it.
 * - `thinking`: deciding with intent: the utterance ended, or the agent is already acting on it;
 *   also while the escalation model works.
 * - `writing`: generating the text for an input.
 * - `acting`: performing an action.
 * - `listening`: chose `wait` while the utterance is open; the task waits for more words.
 * - `done`: the task finished (`stop`).
 * - `didnt-get-that`: chose `wait` after the utterance ended.
 * - `stuck`: a guardrail forced a stop.
 * - `error`: a Jev call, fill or action failed.
 */
export type AgentStatus =
  | 'idle'
  | 'guessing'
  | 'thinking'
  | 'writing'
  | 'acting'
  | 'listening'
  | 'done'
  | 'didnt-get-that'
  | 'stuck'
  | 'error'

export interface AgentEvents {
  tick(report: TickReport): void
  status(status: AgentStatus): void
  debug(event: AgentDebugEvent): void
  /** Stanley says something to the user: shown on screen now, spoken later. */
  said(text: string): void
}

export interface AgentDeps {
  world: World
  jev: DecisionClient
  textGen: TextGen
  /** Takes over a turn Jev can't handle: answers, explanations, questions back, harder tasks. */
  escalator: Escalator
  /** Judges each action's consequences. Defaults to two narrow Jev questions (see consequence.ts). */
  check?: ConsequenceCheck
  events?: Partial<AgentEvents>
  config?: AgentConfig
  sink?: (entry: LogEntry) => void
}

export const SYSTEM_PROMPT = `# Stanley
You are the decision layer of a voice assistant that operates apps on the user's computer.
Each step you pick exactly one option: navigate, act, show the result, wait for the user, or stop.

How to decide:
- Carry the request all the way through. "Go through my inbox" means open the inbox and then open the first message. "Check X" means open X itself, not just the list it is in.
- For a question, find the answer: search, then open the most relevant result to read it. Stop once the screen shows the answer.
- Work in the background. Use "show" when the screen holds what the user asked for, not for intermediate steps.
- Choose "wait" while the user is still speaking and the request is not yet clear, or when nothing sensible can be done yet.
- Choose "escalate" when the user asked a question, needs an answer or a reply, the request is complicated, or you are unsure what to do. A smarter assistant takes over the turn and can talk to the user.
- Typing into a field never submits it. Send, post, submit, buy or delete only when the user explicitly asked for it.
- Choose "stop" only when the whole request is done.`

const INSTRUCTIONS = 'Which single option best moves toward what the user wants right now?'

/** A deferred tick keeps the strongest reason: an action must not be lost, and `end` also covers new words. */
const PRIORITY: Record<TickReason, number> = { words: 0, end: 1, action: 2 }

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
  /** Set while the escalation model owns the turn; aborted when the user says more. */
  private escalation?: AbortController
  /** Last report of the current tick; its outcome is the tick's outcome. */
  private outcome: { outcome: TickOutcome; detail?: string } | null = null
  readonly config: AgentConfig
  private world: World
  private jev: DecisionClient
  private textGen: TextGen
  private escalator: Escalator
  private check: ConsequenceCheck
  private events: Partial<AgentEvents>

  constructor(deps: AgentDeps) {
    this.world = deps.world
    this.jev = deps.jev
    this.textGen = deps.textGen
    this.escalator = deps.escalator
    this.events = deps.events ?? {}
    this.config = deps.config ?? defaultConfig
    this.check = deps.check ?? createConsequenceCheck(deps.jev, this.config)
    this.log = new MessageLog(deps.sink)
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
    this.escalation?.abort()
  }

  // ── Scheduling ──────────────────────────────────────────────────────────

  private request(reason: TickReason): void {
    const trace = (result: RequestResult) => this.events.debug?.({ type: 'request', reason, result })
    if (this.inFlight) {
      // The escalation model answers whole turns: if the user says more, its run is out of date.
      // The deferred `words` tick re-decides with everything they said.
      if (this.escalation && hasNewWords(this.transcript, this.seen)) this.escalation.abort()
      if (!this.deferred || PRIORITY[reason] > PRIORITY[this.deferred]) this.deferred = reason
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
    const before = this.seen
    const seen = structuredClone(this.transcript)
    const utterance = this.utteranceId
    const seenEnded = this.utteranceEnded
    this.seen = seen
    const id = ++this.tickId
    this.outcome = null

    let result: ChoiceResult | null = null
    let effective = 'error'
    let stale = false
    try {
      // A decision is a guess until the person finishes or the agent has started acting on it.
      this.events.status?.(!seenEnded && this.actions === 0 ? 'guessing' : 'thinking')
      const current = this.world.currentNodeId()
      const now = this.world.now()
      const options = buildOptions(this.world.tree(), current, this.config.maxNodes)
      const state = toJevState(SYSTEM_PROMPT, this.log.entries, {
        ...now,
        liveUtterance: this.transcript.partial,
        utteranceFinal: this.utteranceEnded,
      })
      this.events.debug?.({
        type: 'tick-start',
        tickId: id,
        reason,
        utteranceId: utterance,
        transcript: seen,
        utteranceEnded: seenEnded,
        currentNodeId: current,
        state,
        instructions: INSTRUCTIONS,
        options: options.criteria,
      })

      this.abort = new AbortController()
      try {
        result = await this.jev.choose({ state, instructions: INSTRUCTIONS, options: options.criteria, signal: this.abort.signal })
      } catch (err) {
        // Nothing was decided, so the words stay unseen and the next trigger retries.
        if (this.seen === seen) this.seen = before
        throw err
      }

      // Only new words make a decision stale, including words of an utterance
      // that started mid-call (barge-in). The utterance ending mid-call does not
      // invalidate an action; a `wait` gets re-asked via the deferred `end`.
      const changed = () => hasNewWords(this.transcript, this.utteranceId === utterance ? seen : null)
      stale = changed()
      const endedDuringCall = this.utteranceEnded && !seenEnded
      this.events.debug?.({ type: 'decision', tickId: id, result, stale, endedDuringCall })
      const screen = JSON.stringify([current, now])
      effective = await this.handle(id, result, options, state, seenEnded, stale, screen, changed)
      this.events.debug?.({ type: 'tick-end', tickId: id, effective, ...(this.outcome ?? { outcome: 'executed' }) })
    } catch (err) {
      // A failed Jev call, fill or action must not leave the loop stuck in `thinking`/`writing`/`acting`.
      this.fail(id, result, err)
    } finally {
      this.inFlight = false
    }
    this.lastEffective = effective
    const deferred = this.deferred
    this.deferred = null
    if (stale) this.request('words')
    else if (deferred) this.request(deferred)
  }

  /**
   * Returns the choice that actually took effect (after gating).
   * `state` is the Jev input the decision was made from; `decidedEnded` whether it saw the utterance end.
   * `screen` identifies what the agent saw when deciding, for the oscillation guard.
   * `changed` reports whether new words have arrived since the decision's transcript.
   */
  private async handle(
    id: number,
    r: ChoiceResult,
    options: OptionSet,
    state: string,
    decidedEnded: boolean,
    stale: boolean,
    screen: string,
    changed: () => boolean,
  ): Promise<string> {
    const c = this.config
    const node = options.nodes.get(r.choice)
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
    } else if (((node && node.kind !== 'location') || choice === 'escalate') && this.midWord()) {
      // Navigate while the user speaks, but only change things or hand over at a pause:
      // "add a to-do called…" must not commit before the title is said, and the escalation
      // model only ever gets whole turns. The segment that finalizes at the pause re-asks.
      this.gate(id, 'mid-speech', choice === 'escalate' ? 'handing over waits until the user pauses' : `"${choice}" changes data; held until the user pauses`)
      this.log.push({ role: 'event', kind: 'gated', detail: `mid-speech ${choice}` })
      this.report(id, r, 'gated')
      choice = 'wait'
    }

    if (choice === 'wait') {
      if (r.choice === 'wait') {
        this.logDecision(id, 'wait', r)
        this.report(id, r, 'executed')
      }
      // Once the user has finished, waiting is a dead end: hand the turn over instead of going quiet.
      // A wait decided while they were still speaking is re-asked by the deferred `end` instead.
      if (decidedEnded && fullText(this.transcript).trim()) {
        const why = r.choice === 'wait' ? 'could not tell what the user wants' : `was unsure (best guess "${r.choice}" at ${r.confidence.toFixed(2)})`
        return this.escalate(id, `The decision model ${why}.`, r)
      }
      this.halt(this.utteranceEnded ? 'didnt-get-that' : 'listening')
      return 'wait'
    }

    if (choice === 'stop') {
      this.logDecision(id, choice, r)
      this.report(id, r, 'executed')
      await this.finishTask('done')
      return choice
    }

    if (choice === 'escalate') return this.escalate(id, 'The decision model handed this turn to you.', r)

    // Repeating an option only counts when it is chosen from the same screen:
    // "volume up" four times is progress, bouncing between two screens is not.
    const step = `${choice}\n${screen}`
    this.recent = [...this.recent, step].slice(-c.oscillation.window)
    const repeats = this.recent.filter((x) => x === step).length
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

    // Confidence in a choice is not consent: anything that deletes or reaches outside needs the user's say-so.
    if (node?.kind === 'action') {
      const verdict = await this.consequence(id, choice, options.criteria[choice] ?? null, node, state)
      if (changed()) {
        this.gate(id, 'stale', 'new words arrived during the consequence check')
        this.log.push({ role: 'event', kind: 'stale', detail: choice })
        this.report(id, r, 'stale-discarded')
        return 'stale'
      }
      if (!verdict.allowed) {
        const effect = describeEffect(verdict.effect)
        this.gate(id, 'consequence', `"${choice}" ${effect}; P(user asked) ${(verdict.asked ?? 0).toFixed(2)} < explicitAsk ${c.explicitAsk} → escalate`)
        this.log.push({ role: 'event', kind: 'gated', detail: `unconfirmed ${choice}` })
        this.report(id, r, 'gated')
        this.actions--
        this.recent = this.recent.slice(0, -1)
        return this.escalate(
          id,
          `The decision model wanted to choose "${choice}", which ${effect}, but the user hasn't clearly asked for that. Don't do it unless they did; otherwise show what is ready and ask whether to go ahead.`,
          r,
        )
      }
    }

    const fills = !(choice in GLOBALS) && node?.kind === 'input' && !!node.input
    this.events.status?.(fills ? 'writing' : 'acting')
    const callId = `call-${id}`
    if (choice in GLOBALS) {
      this.log.push({ role: 'assistant', origin: 'agent', toolCall: { id: callId, option: choice }, decision: meta(r) })
      const started = performance.now()
      await this.run(callId, () => this.world.global(choice as Exclude<GlobalOption, 'wait' | 'stop' | 'escalate'>))
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
        // The user kept talking while the field was filled, so the text may be missing words.
        // The deferred `words` request re-decides with them.
        if (changed()) {
          this.gate(id, 'stale', 'new words arrived during the fill; discarding the filled text')
          this.log.push({ role: 'event', kind: 'stale', detail: choice })
          this.report(id, r, 'stale-discarded')
          return 'stale'
        }
        // The user wants this but has not said the value yet ("called… um…"): wait for it.
        // Not a step, so a long pause cannot trip the oscillation guard.
        if (!args.text.trim()) {
          this.actions--
          this.recent = this.recent.slice(0, -1)
          this.gate(id, 'no-value', 'text_gen found no value in what the user said yet → wait')
          this.log.push({ role: 'event', kind: 'gated', detail: `no value for ${choice}` })
          this.report(id, r, 'gated')
          // Finished without saying it: ask for it rather than go quiet.
          if (decidedEnded) return this.escalate(id, `The user seems to want "${choice}" but hasn't said what to type.`, r)
          this.halt('idle')
          return 'wait'
        }
        this.events.status?.('acting')
      }
      this.log.push({ role: 'assistant', origin: 'agent', toolCall: { id: callId, option: choice, nodeId: node.id, args }, decision: meta(r) })
      const started = performance.now()
      const out = await this.run(callId, () => this.world.perform(node, args))
      this.events.debug?.({ type: 'act', tickId: id, option: choice, nodeId: node.id, args, ...out, latencyMs: performance.now() - started })
      this.log.push({ role: 'tool', toolCallId: callId, content: out.observation ?? out.summary, summary: out.summary })
    }
    this.report(id, r, 'executed')
    this.request('action')
    return choice
  }

  // ── Escalation ──────────────────────────────────────────────────────────

  /**
   * Hands the turn to the escalation model. It drives the same options through `act`, under the
   * same consequence check, and whatever text it writes is said to the user. Then the turn ends and
   * the next one starts with Jev again, which sees what was said in the history.
   */
  private async escalate(id: number, reason: string, r: ChoiceResult): Promise<string> {
    const context = this.escalationContext()
    const options = this.optionList(this.escalationOptions())
    this.events.debug?.({ type: 'escalate', tickId: id, reason, context, options })
    this.log.push({ role: 'assistant', origin: 'agent', toolCall: { id: `call-${id}`, option: 'escalate' }, decision: meta(r) })
    if (!this.outcome) this.report(id, r, 'executed')
    this.events.status?.('thinking')
    const controller = new AbortController()
    this.escalation = controller
    const started = performance.now()
    let steps = 0
    try {
      const { text } = await this.escalator.run({
        context,
        reason,
        options,
        maxSteps: this.config.escalationSteps,
        signal: controller.signal,
        act: (option, text) => this.escalationAct(id, ++steps, option, text, controller.signal),
      })
      const said = text.trim()
      this.events.debug?.({ type: 'escalation-end', tickId: id, text: said, steps, latencyMs: performance.now() - started, aborted: false })
      if (said) {
        this.log.push({ role: 'said', content: said })
        this.events.said?.(said)
      }
      await this.finishTask('done')
      return 'escalate'
    } catch (err) {
      if (!controller.signal.aborted) throw err
      // Out of date, so it says nothing. Actions it already took stay done, and logged.
      this.events.debug?.({ type: 'escalation-end', tickId: id, text: '', steps, latencyMs: performance.now() - started, aborted: true })
      this.gate(id, 'stale', 'new words arrived while the escalation model worked; re-deciding with the whole turn')
      this.log.push({ role: 'event', kind: 'stale', detail: 'escalate' })
      this.report(id, r, 'stale-discarded')
      return 'stale'
    } finally {
      this.escalation = undefined
    }
  }

  /** One `act` call by the escalation model. Returns what it sees next. */
  private async escalationAct(id: number, step: number, option: string, text: string | undefined, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    const done = (result: string, blocked?: boolean) => {
      this.events.debug?.({ type: 'escalation-step', tickId: id, option, text, result, blocked })
      return result
    }
    const callId = `call-${id}-${step}`
    if (option === 'show' || option === 'home' || option === 'back') {
      this.log.push({ role: 'assistant', origin: 'agent', via: 'escalation', toolCall: { id: callId, option } })
      await this.run(callId, () => this.world.global(option))
      return done(this.screen())
    }
    const options = this.escalationOptions()
    const node = options.nodes.get(option)
    if (!node) return done(`There is no option "${option}" right now.\n\n${this.screen(options)}`)
    const args: ActionArgs = {}
    if (node.kind === 'input') {
      if (!text?.trim()) return done(`"${option}" types into a field: pass the text to type.`)
      args.text = text.trim()
    }
    if (node.kind === 'action') {
      const verdict = await this.consequence(id, option, options.criteria[option] ?? null, node, this.escalationContext(), signal)
      if (!verdict.allowed) {
        return done(`Not done: "${option}" ${describeEffect(verdict.effect)}, and the user hasn't explicitly asked for it. Show them what is ready and ask first.`, true)
      }
    }
    this.events.status?.('acting')
    this.log.push({ role: 'assistant', origin: 'agent', via: 'escalation', toolCall: { id: callId, option, nodeId: node.id, args } })
    const out = await this.run(callId, () => this.world.perform(node, args))
    this.log.push({ role: 'tool', toolCallId: callId, content: out.observation ?? out.summary, summary: out.summary })
    this.events.status?.('thinking')
    return done(`${out.observation ?? out.summary}\n\n${this.screen()}`)
  }

  /** History and screen for the escalation model, and the state for its consequence checks. */
  private escalationContext(): string {
    return toJevState('# Stanley session', this.log.entries, {
      ...this.world.now(),
      liveUtterance: fullText(this.transcript),
      utteranceFinal: this.utteranceEnded,
    })
  }

  private escalationOptions(): OptionSet {
    return buildOptions(this.world.tree(), this.world.currentNodeId(), this.config.escalationNodes)
  }

  /** What the escalation model can choose: every option but the decision loop's own controls. */
  private optionList(options: OptionSet): string {
    return Object.entries(options.criteria)
      .filter(([name]) => !['wait', 'stop', 'escalate'].includes(name))
      .map(([name, description]) => `- ${name}${description ? `: ${description}` : ''}`)
      .join('\n')
  }

  private screen(options = this.escalationOptions()): string {
    const now = this.world.now()
    return `## Screen: ${now.surfaceTitle} (${now.visible ? 'visible to user' : 'hidden'})\n${now.surfaceMarkdown}\n\n## Options\n${this.optionList(options)}`
  }

  private async consequence(
    id: number,
    option: string,
    description: string | null,
    node: AgentNode,
    state: string,
    signal?: AbortSignal,
  ): Promise<ConsequenceVerdict> {
    const started = performance.now()
    const verdict = await this.check.check({ state, option, description, node, signal })
    this.events.debug?.({ type: 'check', tickId: id, option, latencyMs: performance.now() - started, ...verdict })
    return verdict
  }

  /** Runs a logged tool call. A failure is logged as its result, so the call never dangles. */
  private async run<T>(callId: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.log.push({ role: 'tool', toolCallId: callId, content: `Error: ${message}`, summary: `Failed: ${message}` })
      throw err
    }
  }

  private logDecision(id: number, option: string, r: ChoiceResult): void {
    this.log.push({ role: 'assistant', origin: 'agent', toolCall: { id: `call-${id}`, option }, decision: meta(r) })
  }

  private async finishTask(status: AgentStatus): Promise<void> {
    await this.world.global('show')
    if (this.taskOpen) this.log.push({ role: 'event', kind: 'task-end' })
    this.taskOpen = false
    this.halt(status)
  }

  /** The user is mid-sentence: words are still being decoded and no pause has finalized them. */
  private midWord(): boolean {
    return !this.utteranceEnded && this.transcript.partial.trim() !== ''
  }

  private gate(tickId: number, rule: Extract<AgentDebugEvent, { type: 'gate' }>['rule'], detail: string): void {
    this.events.debug?.({ type: 'gate', tickId, rule, detail })
  }

  private fail(id: number, result: ChoiceResult | null, err: unknown): void {
    this.report(id, result, 'error', String(err))
    this.events.debug?.({ type: 'tick-end', tickId: id, outcome: 'error', effective: 'error', detail: String(err) })
    this.halt('error')
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
