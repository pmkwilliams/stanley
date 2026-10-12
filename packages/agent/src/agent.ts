import type { ActionArgs, AgentNode } from '@stanley/app-sdk'
import type { Answer, DecisionClient, MultiChoiceResult, Question } from '@stanley/jev'
import { defaultConfig, type AgentConfig } from './config'
import type { AgentDebugEvent, GateRule, RequestResult, TickReason } from './debug'
import { createEffectJudge, type EffectJudge, type EffectVerdict } from './effects'
import { markUnsure, unmarked, type HeardWord } from './heard'
import { MessageLog, type Actor, type DecisionMeta, type LogEntry, type StepTarget } from './log'
import { narrate, recentEntries, type LiveUtterance } from './narrate'
import { navigates, stepOptions, type OptionSet, type Target } from './options'
import type { Thinker, Writing } from './think'
import { fullText, hasNewWords, type TranscriptSnapshot } from './transcript'
import { knownPages, sameUrl, shortUrl, type KnownPage, type WebTools } from './web'
import type { Screen, StepResult, World } from './world'

export type TickOutcome = 'executed' | 'stale-discarded' | 'gated' | 'forced-stop' | 'error'

export interface TickReport {
  id: number
  /** Jev's answer to "what now?" and to "which step?", as decided. */
  next: { choice: string; confidence: number; probabilities: Record<string, number> } | null
  step: { choice: string; confidence: number; top: { option: string; p: number }[] } | null
  /** What took effect: `listen`, `done`, `think`, `stale`, or the step's option. */
  effective: string
  /** Jev's P(the user finished saying what the next part needs). */
  heard?: number
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
  /**
   * The agent judged the user finished, and ended the utterance before the silence backstop.
   * The host stops treating later speech as part of it (`Transcriber.endUtterance`).
   */
  turnEnd(): void
}

export interface AgentDeps {
  world: World
  jev: DecisionClient
  /** Takes the turns that need words or judgement. */
  thinker: Thinker
  /** Judges what a button does. Defaults to one cached Jev question per button (see effects.ts). */
  effects?: EffectJudge
  /** Background web search and page reading for thinking. Without it, thinking only has the screen. */
  web?: WebTools
  events?: Partial<AgentEvents>
  config?: AgentConfig
  sink?: (entry: LogEntry) => void
}

export const SYSTEM_PROMPT = `# Stanley
You are the quick part of Stanley, a voice assistant that operates apps and websites on the user's computer. Each time, you answer questions about the conversation below: what Stanley should do now, which step on the screen it would take, and whether the user has finished saying what that needs.

What to do now:
- "listen" while the user is still saying what they want and it isn't clear yet what to do.
- "act" when a step on the screen moves toward what they asked for. See a request through: if it is about something inside an app, open the app, then the item, then use it. Looking at, checking, reading or going through things means opening them, starting with the first, not stopping at the list they are in. When going through several, open the first and stop there: the user says when to move on.
- "think" when the next part needs words or judgement: typing text, answering a question, asking the user something, getting their go-ahead, or working out what they mean. The thinking part of Stanley takes over and can talk to the user.
- "done" when what they asked for is done or showing on the screen. Don't go further than they asked. A question is done only once it is answered out loud: when the screen shows the answer, choose "think" so Stanley can say it.

Stanley acts while the user is still talking, so later words can take back or change what it already did ("no wait", "actually", "not that one"). When they do, the next step undoes it first (untick what was ticked, put back what was moved, retype what was typed), then does what they meant. It is not done while something Stanley did is something the user took back.

The user's words come from speech recognition, which can mishear. A word followed by (?) is one it was unsure of; read it as what the user most likely said, given the conversation and the screen.

The screen is the app Stanley is working on, which may be in the background. Elements are written in [brackets]. A link opens something, a button does something, and a field holds text that the thinking part types.

Web pages Stanley found or read are listed in the conversation, and each can be put on screen with its "open page" step. Finding something new on the web is the thinking part's job.`

type Next = 'listen' | 'act' | 'think' | 'done'

export const NEXT: Record<Next, string> = {
  listen: "The user is still saying what they want, and it isn't clear yet what to do.",
  act: 'Take a step on the screen that moves toward what the user asked for.',
  think: 'The next part needs words or judgement: typing text, answering, looking something up, asking the user, getting their go-ahead, or working out what they mean.',
  done: 'What the user asked for is done or showing on the screen, nothing Stanley did goes against what they now want, and any question they asked has been answered out loud.',
}
export const NEXT_INSTRUCTIONS = 'What should Stanley do now?'

type Heard = 'finished' | 'more'

/**
 * Whether the words so far are enough for the next part. Smart Turn hears the voice; this reads
 * the words against the conversation and the screen, which the voice can't: "called" or "saying"
 * at the end of a request needs the words that follow, however final it sounds.
 */
export const HEARD: Record<Heard, string> = {
  finished: 'The user has said what the next part needs: their words make a whole request, answer or message, even if they might add more.',
  more: 'The user is partway through: the words stop before something the request needs (what to call it, what to write, who or which one), or trail off on a word like "called", "saying", "to", "and", "that" or "um".',
}
export const HEARD_INSTRUCTIONS = 'Has the user finished saying what the next part needs, or are words still coming that it depends on?'
export const STEP_INSTRUCTIONS =
  'If Stanley takes a step on the screen now, which one moves toward what the user asked for? Whether to take a step at all is a separate question.'

/** A deferred tick keeps the strongest reason: a step must not be lost, and `end` also covers new words. */
const PRIORITY: Record<TickReason, number> = { words: 0, pause: 1, end: 2, action: 3 }

/**
 * A decision or result waiting for the user to finish: a change or thinking (`thought`), or a
 * press that commits (`turn`). It runs, without asking again, once they have; new words drop it.
 */
interface Held {
  requires: 'thought' | 'turn'
  /** Jev's P(finished saying what's needed) when it was held. */
  heard: number | null
  seen: TranscriptSnapshot
  utteranceId: number
  tickId: number
  run(): Promise<string>
}

export class Agent {
  readonly log: MessageLog
  readonly config: AgentConfig
  private transcript: TranscriptSnapshot = { finalized: [], partial: '' }
  private seen: TranscriptSnapshot | null = null
  private seenUtterance = 0
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
  /** The VAD hears the user right now. */
  private voiceOn = false
  /** The voice's current pause and Smart Turn's verdict on it; null while speaking. */
  private paused: { at: number; voice: number | null } | null = null
  /** Jev's latest P(finished saying what's needed), with the words it saw. */
  private heard: { seen: TranscriptSnapshot; p: number } | null = null
  private held: Held | null = null
  /** Something to say, waiting for the user to finish. */
  private unsaid: { text: string; seen: TranscriptSnapshot; utteranceId: number } | null = null
  private endTimer?: ReturnType<typeof setTimeout>
  /** When the agent last ended the user's turn itself; 0 once anything else ended or started one. */
  private endedByAgentAt = 0
  private world: World
  private jev: DecisionClient
  private thinker: Thinker
  private effects: EffectJudge
  private web?: WebTools
  private events: Partial<AgentEvents>

  constructor(deps: AgentDeps) {
    this.world = deps.world
    this.jev = deps.jev
    this.thinker = deps.thinker
    this.web = deps.web
    this.events = deps.events ?? {}
    this.config = deps.config ?? defaultConfig
    this.effects = deps.effects ?? createEffectJudge(deps.jev, this.config.commits)
    this.log = new MessageLog(deps.sink)
  }

  /** An utterance is open: the user is speaking, or paused without having finished. */
  get turnOpen(): boolean {
    return this.utteranceId > 0 && !this.utteranceEnded
  }

  /** The conversation and screen as the models read them right now. */
  async context(): Promise<string> {
    return narrate(this.log.entries, await this.world.screen(), this.live())
  }

  // ── Transcript input ────────────────────────────────────────────────────

  utteranceStart(): void {
    // The agent ended the turn and the user went on: they were only pausing. Same thought, same
    // utterance, so every model reads it as one sentence ("…the blue folder, sorry, the
    // red one"). Whatever was done or said for the first part stays done.
    const sinceEnd = Date.now() - this.endedByAgentAt
    if (this.utteranceEnded && this.endedByAgentAt && sinceEnd < this.config.endpoint.resumeMs) {
      this.endedByAgentAt = 0
      this.utteranceEnded = false
      this.paused = null
      this.held = null
      this.events.debug?.({ type: 'turn-resumed', afterEndMs: sinceEnd })
      this.openTask()
      return
    }
    this.endedByAgentAt = 0
    this.utteranceId++
    this.transcript = { finalized: [], partial: '' }
    this.seen = null
    this.utteranceEnded = false
    this.steps = 0
    this.recent = []
    this.paused = null
    this.heard = null
    this.held = null
    clearTimeout(this.endTimer)
    this.dropUnsaid()
    this.openTask()
  }

  /** Speech after `done` (same utterance or new) starts a new task. */
  private openTask(): void {
    if (this.taskOpen) return
    this.taskOpen = true
    this.log.push({ role: 'event', kind: 'task-start' })
  }

  /** `words` carry speech recognition's confidence; unsure ones are marked `(?)` for the models. */
  partial(text: string, words?: HeardWord[]): void {
    text = markUnsure(text, words, this.config.unsureWord)
    this.transcript = { ...this.transcript, previous: this.transcript.partial, partial: text }
    this.dropUnsaid()
    this.request('words')
  }

  /** A VAD segment finalized. Logged as what the user said. */
  segment(text: string, words?: HeardWord[]): void {
    if (!text.trim()) return
    text = markUnsure(text, words, this.config.unsureWord)
    this.transcript = { finalized: [...this.transcript.finalized, text], partial: '', previous: '' }
    this.log.push({ role: 'user', content: text, utteranceId: this.utteranceId })
    this.dropUnsaid()
    this.scheduleEnd()
    this.request('words')
  }

  utteranceEnd(): void {
    if (this.utteranceEnded) return
    this.utteranceEnded = true
    clearTimeout(this.endTimer)
    if (this.unsaid && !hasNewWords(this.transcript, this.unsaid.seen) && this.unsaid.utteranceId === this.utteranceId) this.sayNow(this.unsaid.text)
    this.unsaid = null
    this.request('end')
  }

  /** The VAD started or stopped hearing the user. */
  voice(on: boolean): void {
    this.voiceOn = on
    if (on) {
      this.paused = null
      clearTimeout(this.endTimer)
    }
  }

  /** The voice paused; `voice` is Smart Turn's P(they finished their turn), null without it. */
  pause(turn: { complete: number | null }): void {
    if (this.voiceOn || this.utteranceEnded || !this.utteranceId) return
    this.paused = { at: Date.now(), voice: turn.complete }
    this.scheduleEnd()
    this.request('pause')
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
    if (this.held) {
      const held = this.held
      if (held.utteranceId !== this.utteranceId || hasNewWords(this.transcript, held.seen)) {
        this.held = null
        this.gate(held.tickId, 'stale', 'new words arrived while it waited for the user to finish')
      } else if (this.utteranceEnded && held.requires === 'thought' && (held.heard ?? 0) < this.config.finished.heard) {
        // Decided while the words still sounded unfinished: now they're all in, decide again.
        this.held = null
      } else if (held.requires === 'turn' ? this.utteranceEnded : this.thoughtDone()) {
        this.held = null
        trace('released')
        void this.resume(held)
        return
      } else return trace('held')
    }
    if (reason === 'pause' && !fresh) return trace('no-new-words')
    if (reason === 'words' && !fresh) return trace('no-new-words')
    if (reason === 'action' && this.halted) return trace('halted')
    // Ending the utterance only matters if the agent was listening for more.
    if (reason === 'end' && !fresh && this.halted && this.lastEffective !== 'listen' && this.lastEffective !== 'held') return trace('nothing-to-re-ask')
    trace('tick')
    if (fresh) this.openTask()
    void this.tick(reason)
  }

  /** What the user is asking for now: the live utterance, else the last thing they said. */
  private focus(): string {
    const live = fullText(this.transcript)
    if (live.trim()) return unmarked(live)
    return unmarked(this.log.entries.findLast((e) => e.role === 'user')?.content ?? '')
  }

  /** Web pages Stanley can open: what it found or read, while the models still read about it. */
  private pages(): KnownPage[] {
    return this.world.openUrl ? knownPages(recentEntries(this.log.entries)) : []
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
    this.seenUtterance = utterance
    const id = ++this.tickId
    this.outcome = null

    let result: MultiChoiceResult | null = null
    let effective = 'error'
    let stale = false
    try {
      // A decision is a guess until the person finishes or the agent has started acting on it.
      this.events.status?.(!seenEnded && this.steps === 0 ? 'guessing' : 'thinking')
      const screen = await this.world.screen()
      const options = stepOptions(screen, this.world.appList(), this.config.maxElements, this.focus(), this.pages())
      const state = `${SYSTEM_PROMPT}\n\n${narrate(this.log.entries, screen, this.live())}`
      const questions: Record<string, Question> = {
        next: { instructions: NEXT_INSTRUCTIONS, options: NEXT },
        step: { instructions: STEP_INSTRUCTIONS, options: options.criteria },
        heard: { instructions: HEARD_INSTRUCTIONS, options: HEARD },
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
      if (!stale && this.utteranceId === utterance) {
        const heard = heardOf(result)
        if (heard !== null) this.heard = { seen, p: heard }
        this.scheduleEnd()
      }
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

  /** Runs a held decision or result once the user has finished, as a tick of its own. */
  private async resume(held: Held): Promise<void> {
    this.inFlight = true
    this.halted = false
    this.outcome = null
    this.events.status?.('thinking')
    let effective = 'error'
    try {
      effective = await held.run()
      this.events.debug?.({ type: 'tick-end', tickId: held.tickId, effective, ...(this.outcome ?? { outcome: 'executed' }) })
    } catch (err) {
      this.fail(held.tickId, null, err)
    } finally {
      this.inFlight = false
    }
    this.lastEffective = effective
    const deferred = this.deferred
    this.deferred = null
    if (deferred) this.request(deferred)
  }

  private hold(id: number, requires: Held['requires'], rule: GateRule, detail: string, run: () => Promise<string>): string {
    this.gate(id, rule, detail)
    this.held = { requires, heard: this.heardNow(), seen: structuredClone(this.transcript), utteranceId: this.utteranceId, tickId: id, run }
    this.outcome = { outcome: 'gated', detail }
    this.halt('listening')
    return 'held'
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
    const finished = this.thoughtDone()
    const unsure: Next = finished ? 'think' : 'listen'
    if (mode === 'act') {
      const [name, min] = finished ? ['act', c.act] : ['speakingAct', c.speakingAct]
      if (next.confidence < min) gate('act-confidence', `P(act) ${next.confidence.toFixed(2)} < ${name} ${min} → ${unsure}`, unsure)
      else if (step.confidence < c.stepConfidence) gate('step-confidence', `step "${option}" at ${step.confidence.toFixed(2)} < stepConfidence ${c.stepConfidence} → ${unsure}`, unsure)
    }
    // Navigate while the user speaks. Type the user's words at a pause, since a field can be
    // retyped. Change things or hand over only once they finish the thought: "add a task
    // called…" must not add before the title is said, and thinking only ever gets whole turns.
    const field = target.kind === 'element' && target.node.kind === 'input'
    if (((mode === 'act' && !navigates(target)) || mode === 'think') && !finished) {
      if (this.voiceOn || this.midWord()) {
        gate('mid-speech', mode === 'think' ? 'thinking waits until the user pauses' : `"${option}" is held until the user pauses`, 'listen')
      } else if (!(mode === 'act' && field)) {
        this.report(id, d, mode === 'think' ? 'think' : option, 'gated')
        const what = mode === 'think' ? 'thinking' : `"${option}"`
        return this.hold(id, 'thought', 'thought-open', `${what} waits until the user finishes the thought`, () => this.handle(id, d, options, screen, this.utteranceEnded, false, changed))
      }
    }

    if (mode === 'listen') {
      this.report(id, d, 'listen', gated ? 'gated' : 'executed')
      // Once the user has finished, listening is a dead end: think instead of going quiet.
      // A listen decided while they were still speaking is re-asked by the deferred `end`.
      if ((decidedEnded || finished) && fullText(this.transcript).trim()) {
        this.gate(id, 'listen-ended', 'the user has finished, so thinking takes the turn')
        return this.think(id, 'The user has finished speaking, and no clear step stands out.')
      }
      this.halt(this.utteranceEnded ? 'didnt-get-that' : 'listening')
      return 'listen'
    }

    // Unsure whether it's finished once the user has: let thinking check (it may need to answer).
    if (mode === 'done' && finished && next.confidence < c.done) {
      this.report(id, d, 'think', 'gated')
      this.gate(id, 'done-confidence', `P(done) ${next.confidence.toFixed(2)} < done ${c.done} → think`)
      return this.think(id, 'It may already be done. If something is left for the user, such as an answer, do it; if not, say nothing.')
    }

    // A button pressed before the user finished was a guess. Before closing the task, thinking
    // checks the guesses against everything they said, and undoes any they took back.
    if (mode === 'done' && this.utteranceEnded && this.guessedEarly()) {
      this.report(id, d, 'think', 'gated')
      this.gate(id, 'early-guess', 'a button was pressed before the user finished; thinking checks it against what they said')
      return this.think(id, 'Stanley pressed something before the user finished speaking. Check each step against everything they said: undo any they took back or corrected, then do what is left. If it all matches, say nothing.')
    }

    if (mode === 'done') {
      this.report(id, d, 'done', 'executed')
      // Hands-free, the user may not be looking: say back the words of theirs that went in.
      const echo = this.dictatedThisTask()
      if (echo) this.say(`Done: "${echo}"`)
      await this.finishTask('done')
      return 'done'
    }

    // Thinking about a field Jev is sure of is writing: one call instead of a tool loop. The writer
    // still decides whose words they are, and can ask or say something instead.
    const writing = target.kind === 'element' && target.node.kind === 'input' && step.confidence >= c.writeStep
    if (mode === 'think' && !gated && writing) mode = 'act'

    if (mode === 'think') {
      this.report(id, d, 'think', gated ? 'gated' : 'executed')
      // Not the unsure guess itself: thinking has the whole picture, and a weak hint only steers it wrong.
      const why = gated ? 'No step stood out clearly.' : 'This part of the turn needs words or judgement.'
      return this.think(id, why)
    }

    const decision: DecisionMeta = {
      next: { choice: next.choice, confidence: next.confidence },
      step: { choice: option, confidence: step.confidence, probabilities: step.probabilities },
      latencyMs: d.latencyMs,
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
        // Sending, deleting or paying can't be taken back, so it waits for the whole turn.
        if (!this.utteranceEnded) {
          this.report(id, d, option, 'gated')
          return this.hold(id, 'turn', 'turn-open', `"${option}" commits, so it waits until the user's turn ends`, () => this.handle(id, d, options, screen, this.utteranceEnded, false, changed))
        }
        this.report(id, d, option, 'executed')
        return this.confirm(id, option, target, decision)
      }
    }

    this.report(id, d, option, 'executed')
    this.events.status?.('acting')
    await this.attempt(id, option, target, {}, 'fast', decision)
    this.request('action')
    return option
  }

  /**
   * A step whose failure is part of the conversation, not the end of the turn: a control covered
   * by a banner or a page that didn't respond is something to work around. The failure is logged
   * ("failed (…)"), and the loop guard stops a step that keeps failing.
   */
  private async attempt(...args: Parameters<Agent['step']>): Promise<StepResult | null> {
    try {
      return await this.step(...args)
    } catch (err) {
      this.events.debug?.({ type: 'act', tickId: args[0], option: args[1], summary: `failed: ${err instanceof Error ? err.message : String(err)}`, latencyMs: 0 })
      return null
    }
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
      return await this.applyWrite(id, option, target, decision, w)
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
   * Types what thinking wrote. The user's own words go in at once, even mid-thought: a field can be
   * retyped as they go on, which is live dictation. Words Stanley composed wait until the user
   * finishes the thought, since more words would change them.
   */
  private async applyWrite(id: number, option: string, target: Target, decision: DecisionMeta, w: Writing): Promise<string> {
    const text = w.source === 'missing' || w.source === 'unclear' ? '' : unmarked(w.text).replace(/\s+/g, ' ').trim()
    // Misheard words are never typed: ask what was meant, quoting what was heard.
    if (w.source === 'unclear') {
      this.steps--
      this.recent = this.recent.slice(0, -1)
      if (!this.thoughtDone()) {
        this.halt('listening')
        return 'listen'
      }
      this.say(w.say.trim() || `Sorry, I didn't catch what to put in ${option.split(' › ').at(-1)}. Could you say it again?`)
      await this.finishTask('done')
      return 'asked'
    }
    if (text && w.source === 'stanley' && !this.thoughtDone()) {
      return this.hold(id, 'thought', 'thought-open', `words Stanley wrote for [${option}] wait until the user finishes the thought`, () => this.applyWrite(id, option, target, decision, w))
    }
    let say = w.say.trim()
    // Prose Stanley composed is read back word for word before anything can send it. A value
    // (a number, a choice from a list, a word or two) is just filling in what was asked.
    const prose = target.kind === 'element' && target.role !== 'combobox' && text.split(/\s+/).length > 3
    if (w.source === 'stanley' && prose && !say.includes(text)) say = `I wrote: "${text}" Should I go ahead?`
    // Re-deciding after more words often lands on the same text: retyping it isn't a step.
    const unchanged = !!text && target.kind === 'element' && text === (target.node.value ?? '')
    if (text && !unchanged) {
      this.events.status?.('acting')
      await this.attempt(id, option, target, { text }, 'thinking', decision, w.source === 'stanley' ? 'stanley' : 'user')
    }
    if (say) {
      this.say(say)
      await this.finishTask('done')
      return option
    }
    if (!text || (unchanged && !this.thoughtDone())) {
      // Not a step, so a long pause can't trip the loop guard.
      this.steps--
      this.recent = this.recent.slice(0, -1)
      // "Add one called… um": nothing to type yet while they're still talking.
      if (!this.thoughtDone()) {
        this.halt('listening')
        return 'listen'
      }
      return this.think(id, `The next step is typing into [${option}], but there is nothing to type yet.`)
    }
    this.request('action')
    return option
  }

  /**
   * The fast part chose a button that commits. Consent is a judgement about the conversation, so
   * thinking makes it, in one call: press now (then the fast part carries on), or say what is ready
   * and ask.
   */
  private async confirm(id: number, option: string, target: Target, decision: DecisionMeta): Promise<string> {
    // What it would send holds the user's words, and speech recognition wasn't sure of some of
    // them: nothing that can't be taken back goes out until they have heard it.
    const unsure = this.unsureDictation()
    if (unsure) {
      this.gate(id, 'unsure-words', `the user's words for it were partly unsure (?): reading them back before pressing "${option}"`)
      this.say(`I heard: "${unsure}". Should I go ahead?`)
      await this.finishTask('done')
      return 'asked'
    }
    const context = narrate(this.log.entries, await this.world.screen(), this.live())
    this.events.status?.('thinking')
    const controller = new AbortController()
    this.thinking = controller
    const started = performance.now()
    try {
      const c = await this.thinker.confirm({ context, option, signal: controller.signal })
      this.events.debug?.({ type: 'confirm', tickId: id, option, context, ...c, latencyMs: performance.now() - started, aborted: false })
      if (c.press) {
        this.events.status?.('acting')
        await this.attempt(id, option, target, {}, 'thinking', decision)
        this.request('action')
        return option
      }
      this.say(c.say.trim() || 'Should I go ahead?')
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
    // The words the decision was made on: a change made before the user finished splits their turn.
    const basis = this.seen && this.seenUtterance === this.utteranceId ? this.seen : this.transcript
    const heardWords = fullText(basis).trim().split(/\s+/).filter(Boolean).length
    const entry = { role: 'step' as const, id: `step-${++this.stepCount}`, by, target: stepTarget(option, target), text: args.text, wrote, utteranceId: this.utteranceId, heardWords, decision }
    let result: StepResult
    try {
      if (target.kind === 'app') result = await this.world.open(target.app.id)
      else if (target.kind === 'element') result = await this.world.perform(target.node, args)
      else if (target.kind === 'page') result = await this.world.openUrl!(target.url)
      else {
        await this.world.global(target.kind)
        result = { summary: target.kind === 'back' ? 'Went back' : 'Went home' }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.log.push({ ...entry, result: { summary: message, error: true } })
      throw err
    }
    // A page is logged under the title it opened with, which the address alone doesn't give.
    if (entry.target.kind === 'page' && result.title) entry.target = { ...entry.target, title: result.title }
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
    const options = stepOptions(screen, this.world.appList(), this.config.thinkingElements, this.focus())
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
        act: (option, text) => (steps++, this.thinkStep(id, option, text, controller.signal)),
        ...(this.web && {
          search: (query: string) => (steps++, this.search(id, query, controller.signal)),
          fetch: (url: string) => (steps++, this.read(id, url, controller.signal)),
        }),
        ...(this.world.openUrl && { openPage: (url: string) => (steps++, this.openPage(id, url, controller.signal)) }),
      })
      const said = text.trim()
      this.events.debug?.({ type: 'think-end', tickId: id, text: said, steps, latencyMs: performance.now() - started, aborted: false })
      if (said) this.say(said)
      // Nothing to do yet while the user is mid-turn ("add one called… um"): keep listening.
      if (!said && steps === 0 && !this.thoughtDone()) {
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
  private async thinkStep(id: number, option: string, text: string | undefined, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    const done = (result: string) => {
      this.events.debug?.({ type: 'think-step', tickId: id, option, text, result })
      return result
    }
    const options = stepOptions(await this.world.screen(), this.world.appList(), this.config.thinkingElements, this.focus())
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
    let outcome: string
    try {
      outcome = (await this.step(id, option, target, args, 'thinking')).summary
    } catch (err) {
      outcome = `That failed: ${err instanceof Error ? err.message : String(err)}`
    }
    this.events.status?.('thinking')
    return done(`${outcome}\n\n${await this.screenText()}`)
  }

  /**
   * A web search by the thinking model. What it found goes in the conversation, cut to a line each,
   * so any of it can be opened later; thinking gets the full excerpts.
   */
  private async search(id: number, query: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    const utteranceId = this.utteranceId || undefined
    const trace = (result: string) => (this.events.debug?.({ type: 'think-step', tickId: id, option: 'search', text: query, result }), result)
    try {
      const results = await this.web!.search(query, signal)
      const summary = (excerpt: string) => clip(excerpt.replace(/\s+/g, ' ').trim(), 100)
      this.log.push({ role: 'search', query, results: results.map((r) => ({ url: r.url, title: r.title, summary: summary(r.excerpt) })), utteranceId })
      if (!results.length) return trace(`Nothing found for "${query}".`)
      const list = results.map((r, i) => `${i + 1}. "${r.title}"\n   ${r.url}\n   ${r.excerpt}`).join('\n')
      return trace(`Found for "${query}":\n${list}`)
    } catch (err) {
      if (signal.aborted) throw err
      const error = err instanceof Error ? err.message : String(err)
      this.log.push({ role: 'search', query, results: [], error, utteranceId })
      return trace(`The search failed: ${error}`)
    }
  }

  /** A page read by the thinking model. The conversation keeps which page; thinking gets its text. */
  private async read(id: number, url: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    const utteranceId = this.utteranceId || undefined
    const trace = (result: string) => (this.events.debug?.({ type: 'think-step', tickId: id, option: 'fetch', text: url, result }), result)
    try {
      const page = await this.web!.fetch(url, signal)
      this.log.push({ role: 'read', url: page.url, title: page.title, utteranceId })
      return trace(`# ${page.title}\n${page.url}\n\n${page.markdown}`)
    } catch (err) {
      if (signal.aborted) throw err
      const error = err instanceof Error ? err.message : String(err)
      this.log.push({ role: 'read', url, title: url, error, utteranceId })
      return trace(`Couldn't read it: ${error}`)
    }
  }

  /** Thinking puts a page on screen by its address: any page, not only ones offered as options. */
  private async openPage(id: number, url: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    const known = knownPages(recentEntries(this.log.entries)).find((p) => sameUrl(p.url, url))
    this.events.status?.('acting')
    let outcome: string
    try {
      outcome = (await this.step(id, `open page: ${url}`, { kind: 'page', url, title: known?.title ?? shortUrl(url) }, {}, 'thinking')).summary
    } catch (err) {
      outcome = `That failed: ${err instanceof Error ? err.message : String(err)}`
    }
    this.events.status?.('thinking')
    const result = `${outcome}\n\n${await this.screenText()}`
    this.events.debug?.({ type: 'think-step', tickId: id, option: 'open_page', text: url, result })
    return result
  }

  private async screenText(options?: OptionSet): Promise<string> {
    const screen = await this.world.screen()
    const list = optionList(options ?? stepOptions(screen, this.world.appList(), this.config.thinkingElements, this.focus()))
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

  /**
   * The user's own words that this task typed and then committed (pressed Enter or a button
   * after), when Stanley hasn't said anything this task. A word or two, like a city, needs no echo.
   */
  private dictatedThisTask(): string | null {
    const start = this.log.entries.findLastIndex((e) => e.role === 'event' && e.kind === 'task-start')
    const task = this.log.entries.slice(start + 1)
    if (task.some((e) => e.role === 'said')) return null
    const typed = task.findLastIndex((e) => e.role === 'step' && e.by !== 'user' && e.wrote === 'user' && e.target.kind === 'element' && e.target.role !== 'combobox' && !!e.text && !e.result.error)
    if (typed === -1) return null
    const committed = task.slice(typed + 1).some((e) => e.role === 'step' && e.target.kind === 'element' && e.target.nodeKind === 'action' && !e.result.error)
    const text = (task[typed] as Extract<LogEntry, { role: 'step' }>).text!
    return committed && text.split(/\s+/).length >= 2 ? text : null
  }

  /** The user's words typed this task, when speech recognition was unsure of any they said this task. */
  private unsureDictation(): string | null {
    const start = this.log.entries.findLastIndex((e) => e.role === 'event' && e.kind === 'task-start')
    const task = this.log.entries.slice(start + 1)
    if (!task.some((e) => e.role === 'user' && e.content.includes('(?)'))) return null
    const typed = task.findLast((e) => e.role === 'step' && e.by !== 'user' && e.wrote === 'user' && !!e.text)
    return typed?.role === 'step' ? typed.text! : null
  }

  /** A button was pressed for this utterance on fewer words than the user ended up saying. */
  private guessedEarly(): boolean {
    const words = fullText(this.transcript).trim().split(/\s+/).filter(Boolean).length
    return this.log.entries.some(
      (e) => e.role === 'step' && e.by !== 'user' && e.utteranceId === this.utteranceId && e.target.kind === 'element' && e.target.nodeKind === 'action' && (e.heardWords ?? words) < words,
    )
  }

  /** Jev's P(finished saying what's needed), if it has seen every word so far. */
  private heardNow(): number | null {
    return this.heard && !hasNewWords(this.transcript, this.heard.seen) ? this.heard.p : null
  }

  /**
   * The user has finished the thought: the utterance ended, or they paused and both the words
   * (Jev) and the voice (Smart Turn) say they're done. Changes, composed text and thinking wait
   * for this; navigation and the user's own words don't.
   */
  private thoughtDone(): boolean {
    if (this.utteranceEnded) return true
    if (this.voiceOn || this.midWord() || !this.paused) return false
    const f = this.config.finished
    const heard = this.heardNow()
    if (heard === null || heard < f.heard) return false
    return this.paused.voice === null ? heard >= f.heardAlone : this.paused.voice >= f.voice
  }

  /**
   * While the user is quiet, ends the utterance as soon as words and voice both say they're done,
   * later when either says more is coming. Re-run whenever either verdict changes.
   */
  private scheduleEnd(): void {
    clearTimeout(this.endTimer)
    if (!this.paused || this.voiceOn || this.utteranceEnded) return
    const { finished: f, endpoint: e } = this.config
    const heard = this.heardNow()
    const voice = this.paused.voice
    const more = (heard !== null && heard < e.moreBelow) || (voice !== null && voice < e.moreBelow)
    const done = heard !== null && heard >= f.heard && (voice === null ? heard >= f.heardAlone : voice >= f.voice)
    const delay = more ? e.slowMs : done ? e.fastMs : e.normalMs
    const pausedAt = this.paused.at
    const endIn = Math.max(0, pausedAt + delay - Date.now())
    this.events.debug?.({ type: 'turn', voice, heard, endInMs: endIn })
    this.endTimer = setTimeout(() => {
      if (this.voiceOn || this.utteranceEnded || this.paused?.at !== pausedAt) return
      this.events.debug?.({ type: 'turn-end', afterPauseMs: Date.now() - pausedAt })
      this.events.turnEnd?.()
      this.utteranceEnd()
      this.endedByAgentAt = Date.now()
    }, endIn)
  }

  /** Says something once the user has finished; words they add first make it moot. */
  private say(text: string): void {
    if (this.utteranceEnded) return this.sayNow(text)
    this.unsaid = { text, seen: structuredClone(this.transcript), utteranceId: this.utteranceId }
    this.events.debug?.({ type: 'say', text, result: 'held' })
  }

  private sayNow(text: string): void {
    this.log.push({ role: 'said', content: text })
    this.events.said?.(text)
    if (this.unsaid?.text === text) this.events.debug?.({ type: 'say', text, result: 'said' })
  }

  private dropUnsaid(): void {
    if (!this.unsaid || (this.unsaid.utteranceId === this.utteranceId && !hasNewWords(this.transcript, this.unsaid.seen))) return
    this.events.debug?.({ type: 'say', text: this.unsaid.text, result: 'dropped' })
    this.unsaid = null
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
    const heard = d ? heardOf(d) : null
    this.events.tick?.({
      id,
      ...(heard !== null && { heard }),
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

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text)

/** P(finished) from Jev's `heard` answer, or null when the decision didn't include it. */
function heardOf(d: MultiChoiceResult): number | null {
  const heard = d.answers.heard
  if (!heard) return null
  return heard.probabilities.finished ?? (heard.choice === 'finished' ? heard.confidence : 1 - heard.confidence)
}

/** What a step operated, in a form that reads without the screen it was on. */
export function stepTarget(option: string, target: Target): StepTarget {
  if (target.kind === 'app') return { kind: 'app', appId: target.app.id, title: target.app.title }
  if (target.kind === 'element') return { kind: 'element', name: option, role: target.role, nodeKind: target.node.kind, nodeId: target.node.id }
  if (target.kind === 'page') return { kind: 'page', url: target.url, title: target.title }
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
