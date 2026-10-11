import type { ActionArgs, AgentNode } from '@stanley/app-sdk'
import type { Answer, DecisionClient, MultiChoiceResult, Question } from '@stanley/jev'
import { defaultConfig, type AgentConfig } from './config'
import type { AgentDebugEvent, GateRule, RequestResult, TickReason } from './debug'
import { createEffectJudge, type EffectJudge, type EffectVerdict } from './effects'
import { MessageLog, type Actor, type DecisionMeta, type LogEntry, type StepTarget } from './log'
import { narrate, type LiveUtterance } from './narrate'
import { navigates, stepOptions, type OptionSet, type Target } from './options'
import type { Thinker } from './think'
import { fullText, hasNewWords, type TranscriptSnapshot } from './transcript'
import type { Screen, StepResult, World } from './world'

export type TickOutcome = 'executed' | 'stale-discarded' | 'gated' | 'forced-stop' | 'error'

export interface TickReport {
  id: number
  /** Jev's answer to "what now?" and to "which step?", as decided. */
  next: { choice: string; confidence: number; probabilities: Record<string, number> } | null
  step: { choice: string; confidence: number; top: { option: string; p: number }[] } | null
  /** What took effect: `listen`, `done`, `think`, `stale`, or the step's option. */
  effective: string
  latencyMs: number
  outcome: TickOutcome
  detail?: string
}

/**
 * What the agent is doing, for the presence indicator.
 * - `idle`: no open task.
 * - `guessing`: deciding mid-utterance before anything has been done for it.
 * - `thinking`: deciding with intent (the utterance ended, or a step was already taken), or
 *   while the thinking model works.
 * - `writing`: typing text into a field.
 * - `acting`: taking a step.
 * - `listening`: waiting for more words; the task stays open.
 * - `done`: the task finished.
 * - `didnt-get-that`: the utterance ended without anything to act on.
 * - `stuck`: a guardrail stopped the task.
 * - `error`: a Jev call or a step failed.
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
  /** Takes the turns that need words or judgement. */
  thinker: Thinker
  /** Judges what a button does. Defaults to one cached Jev question per button (see effects.ts). */
  effects?: EffectJudge
  events?: Partial<AgentEvents>
  config?: AgentConfig
  sink?: (entry: LogEntry) => void
}

export const SYSTEM_PROMPT = `# Stanley
You are the quick part of Stanley, a voice assistant that operates apps and websites on the user's computer. Each time, you answer two questions about the conversation below: what Stanley should do now, and which step on the screen it would take.

What to do now:
- "listen" while the user is still saying what they want and it isn't clear yet what to do.
- "act" when a step on the screen moves toward what they asked for. See a request through: if it is about something inside an app, open the app, then the item, then use it. Looking at, checking, reading or going through things means opening them, starting with the first, not stopping at the list they are in.
- "think" when the next part needs words or judgement: typing text, answering a question, asking the user something, getting their go-ahead, or working out what they mean. The thinking part of Stanley takes over and can talk to the user.
- "done" when what they asked for is done or showing on the screen. Don't go further than they asked. A question is done only once it is answered out loud: when the screen shows the answer, choose "think" so Stanley can say it.

The screen is the app Stanley is working on, which may be in the background. Elements are written in [brackets]. A link opens something, a button does something, and a field holds text that the thinking part types.`

type Next = 'listen' | 'act' | 'think' | 'done'

export const NEXT: Record<Next, string> = {
  listen: "The user is still saying what they want, and it isn't clear yet what to do.",
  act: 'Take a step on the screen that moves toward what the user asked for.',
  think: 'The next part needs words or judgement: typing text, answering, asking the user, getting their go-ahead, or working out what they mean.',
  done: 'What the user asked for is done or showing on the screen, and any question they asked has been answered out loud.',
}
export const NEXT_INSTRUCTIONS = 'What should Stanley do now?'
export const STEP_INSTRUCTIONS =
  'If Stanley takes a step on the screen now, which one moves toward what the user asked for? Whether to take a step at all is a separate question.'

/** A deferred tick keeps the strongest reason: a step must not be lost, and `end` also covers new words. */
const PRIORITY: Record<TickReason, number> = { words: 0, end: 1, action: 2 }

export class Agent {
  readonly log: MessageLog
  readonly config: AgentConfig
  private transcript: TranscriptSnapshot = { finalized: [], partial: '' }
  private seen: TranscriptSnapshot | null = null
  private utteranceEnded = false
  private inFlight = false
  /** Tick requested while a call was in flight; replayed when it settles. */
  private deferred: TickReason | null = null
  private halted = true
  private taskOpen = false
  private lastEffective = ''
  /** Steps taken for the current utterance, and the recent ones for the oscillation guard. */
  private steps = 0
  private recent: string[] = []
  private tickId = 0
  private utteranceId = 0
  private stepCount = 0
  private abort?: AbortController
  /** Set while the thinking model owns the turn; aborted when the user says more. */
  private thinking?: AbortController
  /** Last report of the current tick; its outcome is the tick's outcome. */
  private outcome: { outcome: TickOutcome; detail?: string } | null = null
  private world: World
  private jev: DecisionClient
  private thinker: Thinker
  private effects: EffectJudge
  private events: Partial<AgentEvents>

  constructor(deps: AgentDeps) {
    this.world = deps.world
    this.jev = deps.jev
    this.thinker = deps.thinker
    this.events = deps.events ?? {}
    this.config = deps.config ?? defaultConfig
    this.effects = deps.effects ?? createEffectJudge(deps.jev, this.config.commits)
    this.log = new MessageLog(deps.sink)
  }

  /** The conversation and screen as the models read them right now. */
  async context(): Promise<string> {
    return narrate(this.log.entries, await this.world.screen(), this.live())
  }

  // ── Transcript input ────────────────────────────────────────────────────

  utteranceStart(): void {
    this.utteranceId++
    this.transcript = { finalized: [], partial: '' }
    this.seen = null
    this.utteranceEnded = false
    this.steps = 0
    this.recent = []
    this.openTask()
  }

  /** Speech after `done` (same utterance or new) starts a new task. */
  private openTask(): void {
    if (this.taskOpen) return
    this.taskOpen = true
    this.log.push({ role: 'event', kind: 'task-start' })
  }

  partial(text: string): void {
    this.transcript = { ...this.transcript, previous: this.transcript.partial, partial: text }
    this.request('words')
  }

  /** A VAD segment finalized. Logged as what the user said. */
  segment(text: string): void {
    if (!text.trim()) return
    this.transcript = { finalized: [...this.transcript.finalized, text], partial: '', previous: '' }
    this.log.push({ role: 'user', content: text, utteranceId: this.utteranceId })
    this.request('words')
  }

  utteranceEnd(): void {
    this.utteranceEnded = true
    this.request('end')
  }

  /** The person clicked or typed in an app directly. */
  recordUserStep(target: StepTarget, result: StepResult, text?: string): void {
    this.log.push({ role: 'step', id: `user-${++this.stepCount}`, by: 'user', target, text, result })
  }

  cancel(): void {
    this.abort?.abort()
    this.thinking?.abort()
  }

  // ── Scheduling ──────────────────────────────────────────────────────────

  private request(reason: TickReason): void {
    const trace = (result: RequestResult) => this.events.debug?.({ type: 'request', reason, result })
    if (this.inFlight) {
      // Thinking answers whole turns: if the user says more, its run is out of date.
      // The deferred `words` tick re-decides with everything they said.
      if (this.thinking && hasNewWords(this.transcript, this.seen)) this.thinking.abort()
      if (!this.deferred || PRIORITY[reason] > PRIORITY[this.deferred]) this.deferred = reason
      return trace('deferred')
    }
    const fresh = hasNewWords(this.transcript, this.seen)
    if (reason === 'words' && !fresh) return trace('no-new-words')
    if (reason === 'action' && this.halted) return trace('halted')
    // Ending the utterance only matters if the agent was listening for more.
    if (reason === 'end' && !fresh && this.halted && this.lastEffective !== 'listen') return trace('nothing-to-re-ask')
    trace('tick')
    if (fresh) this.openTask()
    void this.tick(reason)
  }

  private live(): LiveUtterance | undefined {
    return this.utteranceId ? { utteranceId: this.utteranceId, text: fullText(this.transcript), ended: this.utteranceEnded } : undefined
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

    let result: MultiChoiceResult | null = null
    let effective = 'error'
    let stale = false
    try {
      // A decision is a guess until the person finishes or the agent has started acting on it.
      this.events.status?.(!seenEnded && this.steps === 0 ? 'guessing' : 'thinking')
      const screen = await this.world.screen()
      const options = stepOptions(screen, this.world.appList(), this.config.maxElements)
      const state = `${SYSTEM_PROMPT}\n\n${narrate(this.log.entries, screen, this.live())}`
      const questions: Record<string, Question> = {
        next: { instructions: NEXT_INSTRUCTIONS, options: NEXT },
        step: { instructions: STEP_INSTRUCTIONS, options: options.criteria },
      }
      this.events.debug?.({
        type: 'tick-start',
        tickId: id,
        reason,
        utteranceId: utterance,
        transcript: seen,
        utteranceEnded: seenEnded,
        screenId: screen.id,
        state,
        questions,
      })

      this.abort = new AbortController()
      try {
        result = await this.jev.decide({ state, questions, signal: this.abort.signal })
      } catch (err) {
        // Nothing was decided, so the words stay unseen and the next trigger retries.
        if (this.seen === seen) this.seen = before
        throw err
      }

      // Only new words make a decision stale, including words of an utterance that started
      // mid-call (barge-in). The utterance ending mid-call does not invalidate a step; a
      // `listen` gets re-asked via the deferred `end`.
      const changed = () => hasNewWords(this.transcript, this.utteranceId === utterance ? seen : null)
      stale = changed()
      const endedDuringCall = this.utteranceEnded && !seenEnded
      this.events.debug?.({ type: 'decision', tickId: id, result, stale, endedDuringCall })
      effective = await this.handle(id, result, options, screen, seenEnded, stale, changed)
      this.events.debug?.({ type: 'tick-end', tickId: id, effective, ...(this.outcome ?? { outcome: 'executed' }) })
    } catch (err) {
      // A failed call or step must not leave the loop stuck in `thinking`/`acting`.
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
   * Returns what took effect. `decidedEnded`: whether the decision saw the utterance end.
   * `changed` reports whether new words have arrived since the decision's transcript.
   */
  private async handle(
    id: number,
    d: MultiChoiceResult,
    options: OptionSet,
    screen: Screen,
    decidedEnded: boolean,
    stale: boolean,
    changed: () => boolean,
  ): Promise<string> {
    const c = this.config
    const next = d.answers.next!
    const step = d.answers.step!
    const option = step.choice
    const target = options.targets.get(option)
    if (!target) throw new Error(`Jev chose "${option}", which is not an option`)
    let mode = next.choice as Next
    let gated = false
    const gate = (rule: GateRule, detail: string, to: Next) => {
      this.gate(id, rule, detail)
      gated = true
      mode = to
    }

    if (stale) {
      const confidentNav = mode === 'act' && navigates(target) && step.confidence >= c.staleNavConfidence
      if (mode !== 'listen' && !confidentNav) {
        this.gate(id, 'stale', `new words arrived during the call; only a navigation at ≥ ${c.staleNavConfidence} survives`)
        this.report(id, d, 'stale', 'stale-discarded')
        return 'stale'
      }
    }

    // Unsure while the user is still talking: listen for more. Unsure after they finish: think.
    const unsure: Next = this.utteranceEnded ? 'think' : 'listen'
    if (mode === 'act') {
      const [name, min] = this.utteranceEnded ? ['act', c.act] : ['speakingAct', c.speakingAct]
      if (next.confidence < min) gate('act-confidence', `P(act) ${next.confidence.toFixed(2)} < ${name} ${min} → ${unsure}`, unsure)
      else if (step.confidence < c.stepConfidence) gate('step-confidence', `step "${option}" at ${step.confidence.toFixed(2)} < stepConfidence ${c.stepConfidence} → ${unsure}`, unsure)
    }
    // Navigate while the user speaks, but change things or hand over only at a pause: "add a task
    // called…" must not commit before the title is said, and thinking only ever gets whole turns.
    if (((mode === 'act' && !navigates(target)) || mode === 'think') && this.midWord()) {
      gate('mid-speech', mode === 'think' ? 'thinking waits until the user pauses' : `"${option}" is held until the user pauses`, 'listen')
    }

    if (mode === 'listen') {
      this.report(id, d, 'listen', gated ? 'gated' : 'executed')
      // Once the user has finished, listening is a dead end: think instead of going quiet.
      // A listen decided while they were still speaking is re-asked by the deferred `end`.
      if (decidedEnded && fullText(this.transcript).trim()) {
        this.gate(id, 'listen-ended', 'the user has finished, so thinking takes the turn')
        return this.think(id, 'The user has finished speaking, and no clear step stands out.')
      }
      this.halt(this.utteranceEnded ? 'didnt-get-that' : 'listening')
      return 'listen'
    }

    // Unsure whether it's finished once the user has: let thinking check (it may need to answer).
    if (mode === 'done' && this.utteranceEnded && next.confidence < c.done) {
      this.report(id, d, 'think', 'gated')
      this.gate(id, 'done-confidence', `P(done) ${next.confidence.toFixed(2)} < done ${c.done} → think`)
      return this.think(id, 'It may already be done: check whether anything is left for the user, such as an answer.')
    }

    if (mode === 'done') {
      this.report(id, d, 'done', 'executed')
      await this.finishTask('done')
      return 'done'
    }

    if (mode === 'think') {
      this.report(id, d, 'think', gated ? 'gated' : 'executed')
      const why = gated ? `No step stood out (best guess: [${option}]).` : 'This part of the turn needs words or judgement.'
      return this.think(id, why)
    }

    const decision: DecisionMeta = {
      next: { choice: next.choice, confidence: next.confidence },
      step: { choice: option, confidence: step.confidence, probabilities: step.probabilities },
      latencyMs: d.latencyMs,
    }

    // Words are thinking's: it knows whether they are the user's or its own.
    if (target.kind === 'element' && target.node.kind === 'input') {
      this.report(id, d, option, 'executed')
      return this.write(id, option, target, decision)
    }

    // Consent is a judgement about the conversation, so a button that commits goes to thinking.
    if (target.kind === 'element' && target.node.kind === 'action') {
      const verdict = await this.judge(id, option, target.node, screen)
      if (changed()) {
        this.gate(id, 'stale', 'new words arrived while judging the button')
        this.report(id, d, 'stale', 'stale-discarded')
        return 'stale'
      }
      if (verdict.effect === 'commits') {
        this.report(id, d, option, 'executed')
        return this.confirm(id, option, target, decision)
      }
    }

    // Repeating a step only counts when it is chosen from the same screen:
    // "volume up" four times is progress, bouncing between two screens is not.
    const key = `${option}\n${screen.id}\n${screen.markdown}`
    this.recent = [...this.recent, key].slice(-c.oscillation.window)
    const repeats = this.recent.filter((x) => x === key).length
    if (++this.steps > c.maxStepsPerUtterance || repeats >= c.oscillation.repeats) {
      const looping = repeats >= c.oscillation.repeats
      if (looping) this.gate(id, 'oscillation', `"${option}" chosen ${repeats}× from the same screen in the last ${c.oscillation.window} steps`)
      else this.gate(id, 'step-cap', `more than ${c.maxStepsPerUtterance} steps this utterance`)
      this.log.push({ role: 'event', kind: 'stuck', detail: looping ? 'it kept repeating the same step' : 'it took too many steps' })
      this.report(id, d, 'stuck', 'forced-stop')
      await this.finishTask('stuck')
      return 'stuck'
    }

    this.report(id, d, option, 'executed')
    this.events.status?.('acting')
    await this.step(id, option, target, {}, 'fast', decision)
    this.request('action')
    return option
  }

  /**
   * The fast part chose a field: thinking decides what goes in it, in one call, and records whose
   * words they are. Then the fast part carries on (Enter, Send, done). If what comes next commits,
   * `confirm` sees whether the words were Stanley's own and reads them back before sending.
   */
  private async write(id: number, option: string, target: Target, decision: DecisionMeta): Promise<string> {
    const context = narrate(this.log.entries, await this.world.screen(), this.live())
    this.events.status?.('writing')
    const controller = new AbortController()
    this.thinking = controller
    const started = performance.now()
    try {
      const w = await this.thinker.write({ context, field: option, signal: controller.signal })
      this.events.debug?.({ type: 'write', tickId: id, option, context, ...w, latencyMs: performance.now() - started, aborted: false })
      const text = w.source === 'missing' ? '' : w.text.trim()
      const say = w.say.trim()
      if (text) {
        this.steps++
        this.events.status?.('acting')
        await this.step(id, option, target, { text }, 'thinking', decision, w.source === 'stanley' ? 'stanley' : 'user')
      }
      if (say) {
        this.log.push({ role: 'said', content: say })
        this.events.said?.(say)
        await this.finishTask('done')
        return option
      }
      if (!text) {
        // "Add one called… um": nothing to type yet while they're still talking.
        if (!this.utteranceEnded) {
          this.halt('listening')
          return 'listen'
        }
        return this.think(id, `The next step is typing into [${option}], but there is nothing to type yet.`)
      }
      this.request('action')
      return option
    } catch (err) {
      if (!controller.signal.aborted) throw err
      this.events.debug?.({ type: 'write', tickId: id, option, context, latencyMs: performance.now() - started, aborted: true })
      this.gate(id, 'stale', 'new words arrived while writing; re-deciding with them')
      this.outcome = { outcome: 'stale-discarded' }
      return 'stale'
    } finally {
      this.thinking = undefined
    }
  }

  /**
   * The fast part chose a button that commits. Consent is a judgement about the conversation, so
   * thinking makes it, in one call: press now (then the fast part carries on), or say what is ready
   * and ask.
   */
  private async confirm(id: number, option: string, target: Target, decision: DecisionMeta): Promise<string> {
    const context = narrate(this.log.entries, await this.world.screen(), this.live())
    this.events.status?.('thinking')
    const controller = new AbortController()
    this.thinking = controller
    const started = performance.now()
    try {
      const c = await this.thinker.confirm({ context, option, signal: controller.signal })
      this.events.debug?.({ type: 'confirm', tickId: id, option, context, ...c, latencyMs: performance.now() - started, aborted: false })
      if (c.press) {
        this.steps++
        this.events.status?.('acting')
        await this.step(id, option, target, {}, 'thinking', decision)
        this.request('action')
        return option
      }
      const say = c.say.trim() || 'Should I go ahead?'
      this.log.push({ role: 'said', content: say })
      this.events.said?.(say)
      await this.finishTask('done')
      return 'asked'
    } catch (err) {
      if (!controller.signal.aborted) throw err
      this.events.debug?.({ type: 'confirm', tickId: id, option, context, latencyMs: performance.now() - started, aborted: true })
      this.gate(id, 'stale', 'new words arrived while confirming; re-deciding with them')
      this.outcome = { outcome: 'stale-discarded' }
      return 'stale'
    } finally {
      this.thinking = undefined
    }
  }

  private async judge(id: number, option: string, node: AgentNode, screen: Screen): Promise<EffectVerdict> {
    const started = performance.now()
    const appId = screen.id.split(':')[0] ?? screen.id
    const verdict = await this.effects.judge({ option, node, appId, screen: `## Screen: ${screen.title}\n${screen.markdown}` })
    this.events.debug?.({ type: 'effect', tickId: id, option, latencyMs: performance.now() - started, ...verdict })
    return verdict
  }

  /** Runs one step and logs it. A failure is logged as its result, then rethrown. */
  private async step(tickId: number, option: string, target: Target, args: ActionArgs, by: Actor, decision?: DecisionMeta, wrote?: 'user' | 'stanley'): Promise<StepResult> {
    const started = performance.now()
    const entry = { role: 'step' as const, id: `step-${++this.stepCount}`, by, target: stepTarget(option, target), text: args.text, wrote, utteranceId: this.utteranceId, decision }
    let result: StepResult
    try {
      if (target.kind === 'app') result = await this.world.open(target.app.id)
      else if (target.kind === 'element') result = await this.world.perform(target.node, args)
      else {
        await this.world.global(target.kind)
        result = { summary: target.kind === 'back' ? 'Went back' : 'Went home' }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.log.push({ ...entry, result: { summary: message, error: true } })
      throw err
    }
    this.log.push({ ...entry, result })
    const nodeId = target.kind === 'element' ? target.node.id : undefined
    this.events.debug?.({ type: 'act', tickId, option, nodeId, args, ...result, latencyMs: performance.now() - started })
    return result
  }

  // ── Thinking ────────────────────────────────────────────────────────────

  /**
   * Hands the turn to the thinking model. It acts on the same options, and whatever it writes is
   * said to the user. Then the task ends and the next turn starts with Jev again, which sees what
   * was said in the conversation.
   */
  private async think(id: number, reason: string): Promise<string> {
    const screen = await this.world.screen()
    const options = stepOptions(screen, this.world.appList(), this.config.thinkingElements)
    const context = narrate(this.log.entries, screen, this.live())
    const list = optionList(options)
    this.events.debug?.({ type: 'think-start', tickId: id, reason, context, options: list })
    this.events.status?.('thinking')
    const controller = new AbortController()
    this.thinking = controller
    const started = performance.now()
    let steps = 0
    try {
      const { text } = await this.thinker.run({
        context,
        reason,
        options: list,
        maxSteps: this.config.thinkingSteps,
        signal: controller.signal,
        act: (option, text) => this.thinkStep(id, ++steps, option, text, controller.signal),
      })
      const said = text.trim()
      this.events.debug?.({ type: 'think-end', tickId: id, text: said, steps, latencyMs: performance.now() - started, aborted: false })
      if (said) {
        this.log.push({ role: 'said', content: said })
        this.events.said?.(said)
      }
      // Nothing to do yet while the user is mid-turn ("add one called… um"): keep listening.
      if (!said && steps === 0 && !this.utteranceEnded) {
        this.halt('listening')
        return 'listen'
      }
      await this.finishTask('done')
      return 'think'
    } catch (err) {
      if (!controller.signal.aborted) throw err
      // Out of date, so it says nothing. Steps it already took stay done, and logged.
      this.events.debug?.({ type: 'think-end', tickId: id, text: '', steps, latencyMs: performance.now() - started, aborted: true })
      this.gate(id, 'stale', 'new words arrived while thinking; re-deciding with the whole turn')
      this.outcome = { outcome: 'stale-discarded' }
      return 'stale'
    } finally {
      this.thinking = undefined
    }
  }

  /** One `act` call by the thinking model. Returns what it sees next. */
  private async thinkStep(id: number, n: number, option: string, text: string | undefined, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    const done = (result: string) => {
      this.events.debug?.({ type: 'think-step', tickId: id, option, text, result })
      return result
    }
    const options = stepOptions(await this.world.screen(), this.world.appList(), this.config.thinkingElements)
    const name = resolveOption(options, option)
    const target = name && options.targets.get(name)
    if (!name || !target) return done(`There is no option [${option}] right now. Use a name exactly as listed.\n\n${await this.screenText(options)}`)
    option = name
    const args: ActionArgs = {}
    if (target.kind === 'element' && target.node.kind === 'input') {
      if (text === undefined) return done(`"${option}" is a field: pass the text to type.`)
      args.text = text.trim()
    }
    this.events.status?.(args.text !== undefined ? 'writing' : 'acting')
    const result = await this.step(id, option, target, args, 'thinking')
    this.events.status?.('thinking')
    return done(`${result.summary}\n\n${await this.screenText()}`)
  }

  private async screenText(options?: OptionSet): Promise<string> {
    const screen = await this.world.screen()
    const list = optionList(options ?? stepOptions(screen, this.world.appList(), this.config.thinkingElements))
    return `## Screen: ${screen.title} (${screen.visible ? 'in front of the user' : 'in the background'})\n${screen.markdown}\n\n## Options\n${list}`
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

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

  private gate(tickId: number, rule: GateRule, detail: string): void {
    this.events.debug?.({ type: 'gate', tickId, rule, detail })
  }

  private fail(id: number, result: MultiChoiceResult | null, err: unknown): void {
    this.report(id, result, 'error', 'error', String(err))
    this.events.debug?.({ type: 'tick-end', tickId: id, outcome: 'error', effective: 'error', detail: String(err) })
    this.halt('error')
  }

  private halt(status: AgentStatus): void {
    this.halted = true
    this.events.status?.(status)
  }

  private report(id: number, d: MultiChoiceResult | null, effective: string, outcome: TickOutcome, detail?: string): void {
    const brief = (a: Answer | undefined) => a && { choice: a.choice, confidence: a.confidence }
    const step = d?.answers.step
    this.outcome = { outcome, detail }
    this.events.tick?.({
      id,
      next: d?.answers.next ? { ...brief(d.answers.next)!, probabilities: d.answers.next.probabilities } : null,
      step: step
        ? {
            ...brief(step)!,
            top: Object.entries(step.probabilities)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 5)
              .map(([option, p]) => ({ option, p })),
          }
        : null,
      effective,
      latencyMs: d?.latencyMs ?? 0,
      outcome,
      detail,
    })
  }
}

/** What a step operated, in a form that reads without the screen it was on. */
export function stepTarget(option: string, target: Target): StepTarget {
  if (target.kind === 'app') return { kind: 'app', appId: target.app.id, title: target.app.title }
  if (target.kind === 'element') return { kind: 'element', name: option, role: target.role, nodeKind: target.node.kind, nodeId: target.node.id }
  return { kind: target.kind }
}

/** One option per line, the name in brackets as the conversation writes elements. */
function optionList(options: OptionSet): string {
  return Object.entries(options.criteria)
    .map(([name, description]) => `- [${name}]${description ? ` ${description}` : ''}`)
    .join('\n')
}

/**
 * The option a language model meant. Exact first; then without brackets, quotes and case; then the
 * one option whose name ends with or contains what it wrote. Models paraphrase long names.
 */
export function resolveOption(options: OptionSet, written: string): string | undefined {
  if (options.targets.has(written)) return written
  const norm = (s: string) => s.toLowerCase().replace(/^\[|\]$/g, '').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim()
  const want = norm(written)
  const names = [...options.targets.keys()]
  const exact = names.filter((n) => norm(n) === want)
  if (exact.length === 1) return exact[0]
  const ending = names.filter((n) => norm(n).endsWith(want))
  if (ending.length === 1) return ending[0]
  const containing = names.filter((n) => norm(n).includes(want) || want.includes(norm(n)))
  return containing.length === 1 ? containing[0] : undefined
}
