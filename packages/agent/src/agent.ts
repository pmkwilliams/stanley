import { DEFAULT_AGENT_NAME, FILES_URL, FULLSCREEN, type ActionArgs } from '@stanley/app-sdk'
import type { Answer, DecisionClient, MultiChoiceResult, Question } from '@stanley/jev'
import type { JSONValue } from 'ai'
import { defaultConfig, type AgentConfig, type DeciderProfile } from './config'
import type { AgentDebugEvent, GateRule, RequestResult, TickReason } from './debug'
import { Background, describe, GIST_PROMPT, TASK_EFFORT, TASK_MODEL, taskInstructions, type BackgroundTask, type TaskRecord } from './background'
import { WORKING, workingInstructions } from './barge'
import { CONSENT, consentInstructions } from './consent'
import { bashText, editText, JEV_FILES, knownFiles, listCommand, pageResized, PAGE_SIZE, pageSizeText, readCommand, topFiles, type BashResult, type FileMeta, type FileTools, type KnownFile, type PageSize } from './files'
import {
  Conversation,
  filesOf,
  note,
  recentEntries,
  saidOf,
  stepsOf,
  type Actor,
  type DecisionMeta,
  type Entry,
  type HistoryRecord,
  type LiveUtterance,
  type Ran,
  type StepMeta,
  type StepTarget,
  type TaskMeta,
} from './conversation'
import { anyUnsure, markUnsure, unmarked, type HeardWord } from './heard'
import { jevMemory, MEMORY_PATH } from './memory'
import { describeStep, named, namedOptions, narrate, stepResult } from './narrate'
import { candidatesOf, candidateTexts, navigates, stepOptions, wordMatches, type Candidate, type OptionSet, type Ranking, type Target } from './options'
import { ACTING, FIELDS, HEARING, IDENTITY, SCREEN } from './persona'
import { Relevance, type Embed } from './relevance'
import { chooseScreen, describeScreen, layoutLine, sameSides, SCREEN_PROMPT, screenQuestions, sidesKey, validSides, type ScreenAsk, type ScreenChoice, type Sides } from './screen'
import { JEV_SKILLS, NO_SKILLS, skillBody, skillChanges, type Skill, type SkillScan } from './skills'
import { createThinker, fileOutput, instructions, longDate, PartialTurn, type ActCall, type FileOutput, type PageOutput, type QuickExample, type SearchOutput, type Thinker, type ThinkResult } from './think'
import { extendsWords, fullText, hasNewWords, letters, normalize, type TranscriptSnapshot } from './transcript'
import { since, viewParts, viewText, type ViewPart } from './view'
import { knownPages, sameUrl, shortUrl, type KnownPage, type WebResult, type WebTools } from './web'
import type { PageDraft, Screen, StepResult, World } from './world'
import { ownWords, writerExamples, writerInput, writerInstructions, written, type WriteStep } from './write'

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
  /**
   * Stanley is saying something: `text` is all of reply `id` so far, `done` once it is complete.
   * Sent as thinking writes it, once the user's turn is over, so it can be spoken and shown as it comes.
   */
  speak(id: number, text: string, done: boolean): void
  /** Stop saying reply `id`: it went out of date. The host reports what was heard with `cutOff`. */
  hush(id: number): void
  /** Stanley said something: a whole reply, once complete. */
  said(text: string): void
  /** The background tasks working changed: these are working now (none, once the last one ends), with their briefs in a sentence once they have one. */
  tasks(working: { id: string; title: string; gist?: string }[]): void
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
  /** Background web search and page reading for thinking. Without it, thinking only has the screen. */
  web?: WebTools
  /** The user's files: Jev lists and reads them, thinking runs bash on them, and skills are in them. Without it, there are no files. */
  files?: FileTools
  events?: Partial<AgentEvents>
  config?: AgentConfig
  /** Added to Jev's questions (`DeciderProfile.notes`). */
  jevNotes?: DeciderProfile['notes']
  /** Receives the history as it changes; replaying it rebuilds what thinking was sent. */
  sink?: (record: HistoryRecord) => void
  /** Today, for the instructions and Jev's state. Defaults to the system clock. */
  clock?: () => Date
  /** What the user calls the assistant, read each time it is needed. Defaults to `DEFAULT_AGENT_NAME`. */
  name?: () => string
  /** The size pages Stanley writes are shown at now, read for each thinking call. Defaults to `PAGE_SIZE`. */
  pageSize?: () => PageSize
  /** Runs background tasks. Defaults to Claude Opus 5.5 at high effort (`TASK_MODEL`, `TASK_EFFORT`). */
  taskThinker?: Thinker
  /** Receives each background task's own log: its brief, then how it ended and everything it did. */
  taskSink?: (record: TaskRecord) => void
  /** Embeds text, to rank the steps on offer by what the user is asking (relevance.ts). Without it, their words alone rank them. */
  embed?: Embed
}

/** Jev's instructions: Stanley's own words (persona.ts), with how it answers the questions about each turn. */
export const SYSTEM_PROMPT = `# Stanley
${IDENTITY} Each time, you answer questions about what you do next in the conversation below: what to do now, which step you would take, and whether the user has finished saying what that needs.

What to do now:
- "listen" while the user is still saying what they want and it isn't clear yet what to do.
- "act" when one of the steps on offer moves toward what they asked for, including "respond", which says something to the user, and any press that can be undone or only looks.
- "submit" when the next step sends, posts, pays, buys, books, shares, submits, archives or deletes something: it reaches other people or can't be taken back. Only when the user asked for that (asking to reply, message, email or post with words they gave is asking to send them; asking to draft or write something is not) and has heard any words you wrote yourself. Otherwise it is "done", leaving it ready, or "respond" to ask. See a request through: open what it is about, first its app when nothing of it is on offer, then use it. Looking at, checking, reading or going through things means opening them, starting with the first, not stopping at the list they are in. When going through several, open the first and stop there: the user says when to move on.
- "think" when the next move takes working something out that no step on offer does: making or changing the user's files, finding something in them or answering from them, looking several things up, or anything else that needs careful thought.
- "done" when what they asked for is done or showing on the screen. Don't go further than they asked. A question is done only once you have answered it out loud: when the screen shows the answer, "respond" says it.

${ACTING}

${HEARING}

${SCREEN}

${FIELDS}

Web pages you found or read are listed in the conversation, and each can be put on screen with its "open page" step. The "search the web" step looks something up in the background, from what the user said, and lists what it found.

The "respond" step is the only way you talk to the user: answering what they asked, asking them something, or saying what is ready before it is sent. Answering something you don't know yet, or that changes over time, starts with finding it out.`

type Next = 'listen' | 'act' | 'submit' | 'think' | 'done'
/** What a decision comes to: Jev's choice, or thinking when it was too unsure or a check calls for it. */
type Mode = Next

export const NEXT: Record<Next, string> = {
  listen: "The user is still saying what they want, and it isn't clear yet what to do.",
  act: 'Take one of the steps on offer that moves toward what the user asked for, including saying something to them: anything that can be undone or only looks.',
  submit: "Take the step that sends, posts, pays, buys, books, shares, submits, archives or deletes what the user asked for: they asked for it to go out, and have heard any words you wrote yourself.",
  think: 'Work something out that no step on offer does: make or change files, find something in them or answer from them, look several things up, or anything else that needs careful thought.',
  done: 'What the user asked for is done or showing on the screen, nothing you did goes against what they now want, and any question they asked has been answered out loud.',
}
export const NEXT_INSTRUCTIONS = 'What do you do now?'

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
const withNote = (instructions: string, note?: string) => (note ? `${instructions} ${note}` : instructions)

export const STEP_INSTRUCTIONS =
  'If you take a step now, which one moves toward what the user asked for? A step that sends, deletes or can\'t be undone only when the user clearly asked for it. Whether to take a step at all is a separate question.'

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

/**
 * Something Stanley says. Thinking streams it in as it writes; it is said once the user's turn is
 * over (`released`), and words they add before then make it moot (`dropped`).
 */
interface Reply {
  id: number
  text: string
  done: boolean
  released: boolean
  dropped: boolean
  /** In the conversation: complete, or as far as it got before the user cut in. */
  logged: boolean
  /** A thinking turn's: what of it isn't in the history already (its final step's text). */
  final?: string
  /** The words it answers. */
  seen: TranscriptSnapshot
  utteranceId: number
}

/** Where a step goes in the history. */
type StepRecord =
  /** Jev's, or the writer's: its own call and result. */
  | { jev: true }
  /** A thinking turn's: the SDK has its call and result, so only its meta is kept. */
  | { turn: (step: StepMeta) => void }

export class Agent {
  readonly history: Conversation
  readonly config: AgentConfig
  private readonly jevNotes?: DeciderProfile['notes']
  /** The user's words as said: what all the agent's own logic reads. */
  private transcript: TranscriptSnapshot = { finalized: [], partial: '' }
  /** Speech recognition's confidence in the transcript's words: only for marking unsure ones where the models read them. */
  private confidence: { finalized: (HeardWord[] | undefined)[]; partial?: HeardWord[] } = { finalized: [] }
  /** The last segment the user said, for when nothing is being said now. */
  private lastSegment = ''
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
  /** The call asking Jev what the screen shows when a task ends another way than a `done` tick. */
  private screenAbort?: AbortController
  /**
   * This task's last word on the screen was its own (`arrange the screen`, Full screen, going
   * home): it stays as it is when the task ends.
   */
  private arranged = false
  /** What the screen shows as the history last said (`describeScreen`): a change goes into it (`layoutChange`). */
  private layoutKnown: string | null = null
  /** Set while the thinking model owns the turn; aborted when the user says more that stops it (see `whileWorking`). */
  private thinking?: AbortController
  /** What works: a whole thinking turn (`run`), or the writer writing a step's text (`write`), which hinges on exactly the user's words. */
  private thinkingMode: 'run' | 'write' = 'run'
  /** What thinking is doing right now, for judging words said while it works. */
  private doing = ''
  /** Jev judging words said while a thinking turn works; `again` when more came while it was asked. */
  private judging: { thinking: AbortController; asking: boolean; again: boolean } | null = null
  /** Web pages thinking is writing, by tool call: drawn on screen as they come (see `draw`). */
  private drafts = new Map<string, { content: string; page?: PageDraft; ready: Promise<void> }>()
  /** Last report of the current tick; its outcome is the tick's outcome. */
  private outcome: { outcome: TickOutcome; detail?: string } | null = null
  /** The VAD hears the user right now. */
  private voiceOn = false
  /** The voice's current pause and Smart Turn's verdict on it; null while speaking. */
  private paused: { at: number; voice: number | null } | null = null
  /** Jev's latest P(finished saying what's needed), with the words it saw. */
  private heard: { seen: TranscriptSnapshot; p: number } | null = null
  private held: Held | null = null
  /** When the user's words last grew. */
  private wordsAt = 0
  /** The latest thing Stanley says, from when thinking starts writing it. */
  private reply: Reply | null = null
  /** Replies handed to the host to say, most recent last, in case the user cuts in on one. */
  private told: Reply[] = []
  private replyCount = 0
  private endTimer?: ReturnType<typeof setTimeout>
  /** When the agent last ended the user's turn itself; 0 once anything else ended or started one. */
  private endedByAgentAt = 0
  /** The screens and options thinking last read, part by part, to send the parts that changed (view.ts). */
  private screensRead = new Map<string, ViewPart>()
  /** The top of the folder (`topFiles`) as thinking last saw it, to leave out when it is the same. */
  private lastFiles = ''
  /** The date thinking was last told. */
  private today: string
  /**
   * Whether speech recognition was unsure of words heard since the task started. The history places
   * words where they read best, which can be before the task's start, so this is kept here.
   */
  private taskUnsure = false
  private clock: () => Date
  private name: () => string
  private pageSize: () => PageSize
  /** The size pages were shown at when the session's instructions were first made, which they give. */
  private sessionPage?: PageSize
  /** The size pages are shown at as thinking was last told it, from its instructions on. */
  private pageKnown?: PageSize
  /** When the session started: the day its instructions give. */
  private started: Date
  /** The skills when the session started, which its instructions list, once they are read. */
  private sessionSkills?: SkillScan
  private skillsReady: Promise<void>
  /** The skills as thinking was last told about them. */
  private skillsKnown: SkillScan = NO_SKILLS
  /** The memory file's text when the session started, which thinking and Jev are given, once it is read. */
  private sessionMemory?: string
  private memoryReady: Promise<void>
  private world: World
  private jev: DecisionClient
  private thinker: Thinker
  /** Ranks the steps on offer by meaning, when there is an embedding model. */
  private relevance?: Relevance
  private web?: WebTools
  private files?: FileTools
  private events: Partial<AgentEvents>
  /** Work handed off with `delegate`, in sessions that can look things up or have files. */
  private background?: Background
  /** Stanley's voice is playing, as the host reports it (`talking`). */
  private talkingNow = false
  private deliverTimer?: ReturnType<typeof setTimeout>

  constructor(deps: AgentDeps) {
    this.world = deps.world
    this.jev = deps.jev
    this.thinker = deps.thinker
    this.web = deps.web
    this.files = deps.files
    this.events = deps.events ?? {}
    this.config = deps.config ?? defaultConfig
    this.jevNotes = deps.jevNotes
    this.relevance = deps.embed && new Relevance(deps.embed)
    this.history = new Conversation(deps.sink)
    this.clock = deps.clock ?? (() => new Date())
    this.name = deps.name ?? (() => DEFAULT_AGENT_NAME)
    this.pageSize = deps.pageSize ?? (() => PAGE_SIZE)
    this.started = this.clock()
    this.today = longDate(this.started)
    if (deps.web || deps.files) {
      this.background = new Background({
        thinker: deps.taskThinker ?? createThinker({ model: TASK_MODEL, effort: TASK_EFFORT }),
        web: deps.web,
        files: deps.files,
        preview: deps.world.preview?.bind(deps.world),
        // The quicker model thinking types fields with puts each brief in a sentence for the status bar.
        gist: deps.thinker.quick && ((task, signal) => deps.thinker.quick!(named(GIST_PROMPT, this.name()), task, signal)),
        instructions: () => taskInstructions({ web: !!this.web, files: this.files?.root, page: this.pageSize(), today: this.started, name: this.name() }),
        max: this.config.background.max,
        steps: this.config.background.steps,
        ended: (task) => this.taskEnded(task),
        changed: () => this.events.tasks?.(this.background!.working().map(({ id, title, gist }) => ({ id, title, gist }))),
        debug: (event) => this.events.debug?.(event),
        sink: deps.taskSink,
      })
    }
    this.skillsReady = this.scanSkills().then((scan) => {
      this.sessionSkills = scan
      this.skillsKnown = scan
    })
    this.memoryReady = this.files?.read
      ? this.files.read(MEMORY_PATH).then(
          (text) => void (this.sessionMemory = text),
          () => void (this.sessionMemory = ''),
        )
      : Promise.resolve()
  }

  /** Thinking's instructions, fixed for the session unless the user renames the assistant. */
  get instructions(): string {
    const skills = this.files?.skills ? (this.sessionSkills ?? NO_SKILLS) : undefined
    // The size when the session's instructions were first made; a change comes as a note (`observe`).
    this.sessionPage ??= this.pageSize()
    this.pageKnown ??= this.sessionPage
    const memory = this.files?.read ? (this.sessionMemory ?? '') : undefined
    return instructions({ web: !!this.web, files: this.files?.root, skills, memory, today: this.started, name: this.name(), page: this.sessionPage, background: !!this.background, layout: this.laysOut() })
  }

  /** An utterance is open: the user is speaking, or paused without having finished. */
  get turnOpen(): boolean {
    return this.utteranceId > 0 && !this.utteranceEnded
  }

  /** The conversation and screen as Jev reads them right now. */
  async context(): Promise<string> {
    return narrate(this.view(), await this.world.screen(), this.live(), this.config.jevTurns, this.others())
  }

  /** The conversation alone, without the screen, and without reply `except` (the one being said). */
  conversation(except?: number): string {
    const entries = this.view().filter((e) => !(e.meta.kind === 'said' && e.meta.replyId === except))
    return narrate(entries, null, this.live(), this.config.jevTurns)
  }

  /**
   * What Jev reads when the user speaks over Stanley: the state every decision reads, without the
   * screen (which it can't wait for) and without reply `except`, the one being said.
   */
  talkingState(except?: number): string {
    const extra = [...(this.files ? [JEV_FILES] : []), ...(this.skillsKnown.skills.length ? [JEV_SKILLS] : [])]
    const preamble = jevPreamble({ name: this.name(), today: this.clock(), extra, memory: this.sessionMemory, layout: this.laysOut() })
    return `${preamble}\n\n${this.conversation(except)}`
  }

  /**
   * The user cut in while Stanley was saying reply `id`, or the host stopped it: they heard only
   * `spoken` of it. The conversation keeps what they heard, and whatever thinking is still writing
   * for it is moot.
   */
  cutOff(id: number, spoken: string): void {
    const reply = this.told.find((r) => r.id === id)
    if (!reply) return
    if (reply.done && spoken.trim() === reply.text) return
    if (!reply.logged) this.logSaid(reply)
    reply.dropped = true
    // Of a thinking turn's reply, only the final step's text is its message: the rest is in the turn.
    const heard = spoken.trim()
    const before = reply.final !== undefined && reply.text.endsWith(reply.final) ? reply.text.slice(0, reply.text.length - reply.final.length).trim() : ''
    this.history.cut(id, heard, before ? (heard.length > before.length ? heard.slice(before.length).trim() : '') : heard)
    this.events.debug?.({ type: 'cut', id, spoken: spoken.trim(), text: reply.text })
    if (this.reply === reply) this.thinking?.abort()
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
    this.history.begin()
    this.utteranceId++
    this.transcript = { finalized: [], partial: '' }
    this.confidence = { finalized: [] }
    this.seen = null
    this.utteranceEnded = false
    this.steps = 0
    this.recent = []
    this.paused = null
    this.heard = null
    this.held = null
    clearTimeout(this.endTimer)
    this.dropStale()
    this.openTask()
  }

  /** Speech after `done` (same utterance or new) starts a new task. */
  private openTask(): void {
    if (this.taskOpen) return
    this.taskOpen = true
    this.taskUnsure = false
    this.arranged = false
    this.history.stage({ kind: 'event', event: 'task-start' })
    this.noteLayout()
  }

  /** `words` carry speech recognition's confidence; unsure ones are marked `(?)` where the models read them. */
  partial(text: string, words?: HeardWord[]): void {
    this.noteWords({ ...this.transcript, partial: text })
    this.transcript = { ...this.transcript, previous: this.transcript.partial, partial: text }
    this.confidence = { ...this.confidence, partial: words }
    this.dropStale()
    this.request('words')
  }

  /** Notes when the user said more than before (the same words revised or re-punctuated aren't more). */
  private noteWords(next: TranscriptSnapshot): void {
    if (letters(fullText(next)).length > letters(fullText(this.transcript)).length) this.wordsAt = Date.now()
  }

  /** A VAD segment finalized. Logged as what the user said. */
  segment(text: string, words?: HeardWord[]): void {
    if (!text.trim()) return
    this.noteWords({ finalized: [...this.transcript.finalized, text], partial: '' })
    this.transcript = { finalized: [...this.transcript.finalized, text], partial: '', previous: '' }
    this.confidence = { finalized: [...this.confidence.finalized, words] }
    this.lastSegment = text
    this.history.heard(this.utteranceId, this.marked(text, words))
    if (anyUnsure(words, this.config.unsureWord)) this.taskUnsure = true
    this.dropStale()
    this.scheduleEnd()
    this.request('words')
  }

  utteranceEnd(): void {
    if (this.utteranceEnded) return
    this.utteranceEnded = true
    clearTimeout(this.endTimer)
    const reply = this.reply
    if (reply && !reply.released && !reply.dropped) {
      if (reply.utteranceId === this.utteranceId && !hasNewWords(this.transcript, reply.seen)) this.release(reply)
      else this.drop(reply)
    }
    this.request('end')
    this.scheduleDelivery()
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
    const step: StepMeta = { id: `user-${++this.stepCount}`, by: 'user', target, text, summary: result.summary, observation: result.observation, layout: this.layoutChange() }
    this.history.stage({ kind: 'note', by: 'user', results: [{ step }] }, note(`In the app, the user ${describeStep(step).replace(/^User /, '')}`))
  }

  cancel(): void {
    this.abort?.abort()
    this.screenAbort?.abort()
    this.thinking?.abort()
    this.background?.cancelAll()
    clearTimeout(this.deliverTimer)
  }

  /** Stanley's voice started or stopped playing. A background task's result waits until it stops. */
  talking(on: boolean): void {
    this.talkingNow = on
    if (!on) this.scheduleDelivery()
  }

  // ── Scheduling ──────────────────────────────────────────────────────────

  private request(reason: TickReason): void {
    const trace = (result: RequestResult) => this.events.debug?.({ type: 'request', reason, result })
    if (this.inFlight) {
      // Words said while thinking works may stop it (see `whileWorking`). The deferred tick then
      // decides with everything they said: at once if it stopped, once it's done if not.
      if (this.thinking && hasNewWords(this.transcript, this.seen)) this.whileWorking(this.thinking)
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

  /**
   * The user said more while thinking works. A step the writer writes (what to type, what to search
   * for) hinges on exactly their words, so it is out of date. A whole turn may not be: Jev
   * judges whether the words stop it ("no, the other one", "never mind") or wait for it to finish
   * ("and make it blue"), and it goes on meanwhile. More words are judged again.
   */
  private whileWorking(thinking: AbortController): void {
    if (this.thinkingMode !== 'run') return thinking.abort()
    if (this.judging?.thinking !== thinking) this.judging = { thinking, asking: false, again: false }
    if (this.judging.asking) this.judging.again = true
    else void this.judgeWork(this.judging)
  }

  private async judgeWork(judging: { thinking: AbortController; asking: boolean; again: boolean }): Promise<void> {
    const name = this.name()
    const heard = this.saidSince()
    const trace = (action: 'judged' | 'stop' | 'hold', extra: { verdict?: { choice: string; probabilities: Record<string, number>; latencyMs: number }; reason?: string }) =>
      this.events.debug?.({ type: 'working', action, heard, ...extra })
    judging.asking = true
    const started = performance.now()
    try {
      // The state every decision reads, and the question of the words said while it works.
      const screen = await this.world.screen()
      const state = this.jevState(screen, this.screenAsk(screen), await this.jevExtra())
      const result = await this.jev.choose({ state, instructions: named(workingInstructions(this.doing, heard), name), options: namedOptions(WORKING, name), signal: judging.thinking.signal })
      const verdict = { choice: result.choice, probabilities: result.probabilities, latencyMs: performance.now() - started }
      trace('judged', { verdict })
      // It finished while Jev judged: the deferred tick has the words.
      if (this.thinking !== judging.thinking) return
      const stop = result.probabilities.stop ?? 0
      if (stop >= this.config.working.stop) {
        trace('stop', { reason: `P(stop) ${stop.toFixed(2)}` })
        return judging.thinking.abort()
      }
      trace('hold', { reason: `P(stop) ${stop.toFixed(2)} < ${this.config.working.stop}: finishing first` })
    } catch (err) {
      if (judging.thinking.signal.aborted || this.thinking !== judging.thinking) return
      // Deciding again with everything they said is safer than finishing what they may have stopped.
      trace('stop', { reason: `Jev failed: ${err instanceof Error ? err.message : String(err)}` })
      return judging.thinking.abort()
    } finally {
      judging.asking = false
    }
    if (judging.again) {
      judging.again = false
      void this.judgeWork(judging)
    }
  }

  /** What the user said after the words the current decision was made on. */
  private saidSince(): string {
    const now = fullText(this.transcript)
    const seen = this.seen
    if (!seen || this.seenUtterance !== this.utteranceId || !extendsWords(this.transcript, seen)) return now
    return normalize(now).slice(normalize(fullText(seen)).length).join(' ')
  }

  /** What the user is asking for now: the live utterance, else the last thing they said. */
  private focus(): string {
    const live = fullText(this.transcript)
    return live.trim() ? live : this.lastSegment
  }

  /** The user's words as the models read them, unsure ones marked. */
  private marked(text: string, words: HeardWord[] | undefined): string {
    return markUnsure(text, words, this.config.unsureWord)
  }

  /**
   * The steps on offer on `screen`: up to `limit` elements, `pages` and `files`, then `skills`, the
   * apps and navigation. Thinking gets no `files`, `skills`, `search` or `respond`: it has bash, its
   * own search, and says what it writes.
   */
  private async options(screen: Screen, limit: number, pages: KnownPage[] = [], files?: KnownFile[], skills: Skill[] = [], arrange = false, search = false, respond = false): Promise<OptionSet> {
    const others = this.others()
    const ranking = await this.ranking(screen, others, limit, pages, files)
    return stepOptions(screen, this.world.appList(), limit, this.focus(), pages, !!this.world.lock, files, skills, arrange, search, respond, { others, ranking })
  }

  /** The other apps open, on the screen and in the background: their elements are on offer, and what they show is read. */
  private others(): Screen[] {
    return this.world.others?.() ?? []
  }

  /** How the elements of every open app are ranked by what the user is asking (see `rankingFor`). */
  private ranking(screen: Screen, others: Screen[], limit: number, pages: KnownPage[], files?: KnownFile[]): Promise<Ranking> {
    return rankingFor(this.relevance, this.config.ranking, this.focus(), candidatesOf(screen, others, pages, files), limit, this.saidBefore())
  }

  /** What the user said last before what they are saying now, as heard: a request may lean on it ("archive it"). */
  private saidBefore(): string {
    const words = this.history.view().filter((e) => e.meta.kind === 'words' && e.meta.utteranceId !== this.utteranceId && typeof e.message?.content === 'string')
    const last = words.at(-1)?.meta.utteranceId
    return unmarked(words.filter((e) => e.meta.utteranceId === last).map((e) => e.message!.content as string).join(' '))
  }

  /** The steps on offer to thinking on `screen`: Jev's, with up to `thinkingElements` elements, and without files or skills. */
  private thinkingOptions(screen: Screen): Promise<OptionSet> {
    return this.options(screen, this.config.thinkingElements, [], undefined, [], this.laysOut())
  }

  /** Stanley lays the screen out: Jev and thinking can arrange it, and the history says what it shows. */
  private laysOut(): boolean {
    const w = this.world
    return !!(w.arrange && w.sides && w.placeable)
  }

  /** What the screen shows when it changed since the history last said, which it now does; undefined when it didn't. */
  private layoutChange(): string | undefined {
    if (!this.laysOut()) return undefined
    const now = this.shownText(this.world.sides!())
    if (now === this.layoutKnown) return undefined
    this.layoutKnown = now
    return now
  }

  /** A change to what the screen shows that no step made (the task's end laying it out, the first look) goes into the history as a note. */
  private noteLayout(): void {
    const layout = this.layoutChange()
    if (layout) this.history.stage({ kind: 'note', by: 'agent', layout }, note(layoutLine(layout)))
  }

  /** Thinking's `screen` for [arrange the screen], as the sides it makes; or what is wrong with it. */
  private sidesOf(screen: string[][] | undefined): Sides | string {
    const apps = this.world.placeable?.() ?? []
    const names = apps.map((a) => `"${a.title}"`).join(', ')
    if (!screen) return `Pass \`screen\`, the apps on the screen, from ${names}.`
    const idOf = (name: string) => apps.find((a) => a.id === name.trim() || a.title.toLowerCase() === name.trim().toLowerCase())?.id
    const unknown = screen.flat().filter((n) => !idOf(n))
    if (unknown.length) return `There is no app ${unknown.map((n) => `"${n}"`).join(', ')} to put on the screen. The apps: ${names}.`
    const sides = screen.map((side) => side.map((n) => idOf(n)!))
    if (!validSides(sides)) return "The screen can't show that: one app alone, or two sides of one or two apps, three at most, none twice."
    return sides
  }

  /** What thinking's call runs on: an arrangement gets the sides it named. Returns what is wrong instead, when it can't run. */
  private thinkingTarget(target: Target, call: ActCall): Target | string {
    if (target.kind !== 'arrange') return target
    const sides = this.sidesOf(call.screen)
    return typeof sides === 'string' ? sides : { kind: 'arrange', sides }
  }

  /**
   * What Jev is asked about the screen once Stanley has done what the user asked (see screen.ts),
   * when the world lets it lay the screen out; null when it doesn't.
   */
  private screenAsk(screen: Screen): ScreenAsk | null {
    const w = this.world
    if (!w.arrange || !w.sides || !w.placeable) return null
    return screenQuestions(w.placeable(), w.sides(), screen.id === 'home' ? null : (screen.id.split(':')[0] ?? null))
  }

  /** What is on the screen, as Jev reads it. */
  private shownText(sides: Sides): string {
    const titles = new Map([...(this.world.placeable?.() ?? []), ...this.world.appList()].map((a) => [a.id, a.title]))
    return describeScreen(sides, (id) => titles.get(id) ?? id)
  }

  /** The skills in the user's folder, read from disk now. */
  private scanSkills(): Promise<SkillScan> {
    return this.files?.skills ? this.files.skills().catch(() => NO_SKILLS) : Promise.resolve(NO_SKILLS)
  }

  /** The skills Jev can read: those it hasn't read this task. One it has is in what it reads. */
  private unread(scan: SkillScan): Skill[] {
    const read = new Set(filesOf(this.task()).flatMap((f) => (f.kind === 'skill' && !f.error ? [f.name] : [])))
    return scan.skills.filter((s) => !read.has(s.name))
  }

  /**
   * How the skills changed since thinking was last told, now that it is told; null when they
   * didn't. They change when the user edits them, and when thinking writes one.
   */
  private async skillNews(): Promise<string | null> {
    if (!this.files?.skills) return null
    await this.skillsReady
    const now = await this.scanSkills()
    const news = skillChanges(this.skillsKnown, now)
    this.skillsKnown = now
    return news
  }

  /**
   * Web pages Stanley can open: what it found, read or opened, while Jev still reads about it, and
   * the pages kept open (a page of the user's files is offered as a file).
   */
  private pages(): KnownPage[] {
    if (!this.world.openUrl) return []
    const known = knownPages(recentEntries(this.view(), this.config.jevTurns))
    const open = (this.world.openPages?.() ?? []).filter((p) => !p.url.startsWith(FILES_URL))
    const kept = (url: string) => open.some((p) => sameUrl(p.url, url))
    return [...known.map((p) => (kept(p.url) ? { ...p, open: true } : p)), ...open.filter((p) => !known.some((k) => sameUrl(k.url, p.url))).map((p) => ({ ...p, latest: false, open: true }))]
  }

  /** Folders and files Jev can list or read: what it listed and read lately first, then everything else in the folder. */
  private async knownFiles(): Promise<KnownFile[] | undefined> {
    if (!this.files) return undefined
    const paths = await this.files.paths().catch(() => [])
    const read = new Set(filesOf(this.task()).flatMap((f) => (f.kind === 'read' && !f.error ? [f.path] : [])))
    return knownFiles(recentEntries(this.view(), this.config.jevTurns), paths).map((f) => {
      const url = f.path.endsWith('/') ? undefined : this.world.fileUrl?.(f.path)
      return { ...f, ...(url && { url }), ...(read.has(f.path) && { read: true }) }
    })
  }

  /** The history as Jev reads it: committed, and what is staged placed as it would be now. */
  private view(): Entry[] {
    return this.history.view(this.live())
  }

  private live(): LiveUtterance | undefined {
    if (!this.utteranceId) return undefined
    const { finalized, partial } = this.transcript
    const text = [...finalized.map((t, i) => this.marked(t, this.confidence.finalized[i])), this.marked(partial, this.confidence.partial)].filter(Boolean).join(' ')
    return { utteranceId: this.utteranceId, text, ended: this.utteranceEnded }
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
      const skills = await this.scanSkills()
      await this.memoryReady
      this.noteLayout()
      const ask = this.screenAsk(screen)
      const unread = this.unread(skills)
      const options = await this.options(screen, this.config.maxElements, this.pages(), await this.knownFiles(), [], !!ask, !!this.web && this.writes(), true)
      const name = this.name()
      const state = this.jevState(screen, ask, await this.jevExtra(skills), options)
      const questions: Record<string, Question> = {
        next: { instructions: named(withNote(NEXT_INSTRUCTIONS, this.jevNotes?.next), name), options: namedOptions(NEXT, name) },
        step: { instructions: named(withNote(STEP_INSTRUCTIONS, this.jevNotes?.step), name), options: options.criteria },
        heard: { instructions: named(HEARD_INSTRUCTIONS, name), options: namedOptions(HEARD, name) },
        // Whether one of the user's skills is for what they ask: a decision of its own, not one of the steps.
        ...(unread.length && { skill: { instructions: named(SKILL_INSTRUCTIONS, name), options: skillOptions(unread) } }),
        // What the screen shows when this is done: used by the tick that finishes the task, or arranges the screen.
        ...(ask && { show: { instructions: named(ask.show.instructions, name), options: ask.show.options }, left: { instructions: named(ask.left.instructions, name), options: ask.left.options } }),
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
      effective = await this.handle(id, result, options, screen, seenEnded, stale, changed, ask, unread)
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
    /** The screen questions this decision answered, if it was asked them. */
    ask: ScreenAsk | null = null,
    /** The skills the decision was asked about (`skill`). */
    skills: Skill[] = [],
  ): Promise<string> {
    const c = this.config
    const next = d.answers.next!
    const step = d.answers.step!
    const option = step.choice
    const target = options.targets.get(option)
    if (!target) throw new Error(`Jev chose "${option}", which is not an option`)
    // A press that sends or can't be undone is Jev's own call (`submit`), or the app marks it
    // destructive. Submitting anything else (a field, a place) is just taking that step.
    const press = target.kind === 'element' && target.node.kind === 'action' ? target.node : null
    const commits = !!press && (next.choice === 'submit' || !!press.destructive)
    let mode = (next.choice === 'submit' ? 'act' : next.choice) as Mode
    let gated = false
    const gate = (rule: GateRule, detail: string, to: Mode) => {
      this.gate(id, rule, detail)
      gated = true
      mode = to
    }

    // New words arrived during the call. A navigation Jev is sure of still runs; so does a button
    // it is sure of that doesn't commit, when the new words only add to the ones it decided on.
    const button = mode === 'act' ? press : null
    const added = () => this.seenUtterance === this.utteranceId && !!this.seen && extendsWords(this.transcript, this.seen)
    const sureStep = mode === 'act' && step.confidence >= c.staleNavConfidence
    if (stale && mode === 'done') {
      // Done changes nothing, so new words can't make it wrong: it stands, quietly, and the new
      // words get a decision of their own. What it would have put on the screen may not stand.
      this.report(id, d, 'done', 'executed')
      await this.finishTask('done', { tickId: id, keep: 'new words arrived during the call' })
      return 'done'
    }
    if (stale) {
      // Not laying the screen out: what to show is the very thing new words can change.
      const confidentNav = sureStep && navigates(target) && target.kind !== 'arrange'
      if (mode !== 'listen' && !confidentNav && !(sureStep && button && !commits && added())) {
        this.gate(id, 'stale', `new words arrived during the call; only a navigation or a button at ≥ ${c.staleNavConfidence} survives`)
        this.report(id, d, 'stale', 'stale-discarded')
        return 'stale'
      }
    }

    // A skill is for what the user asks: it is read first, even while they speak, since reading only
    // looks, and what comes next is decided with it in view.
    const skill = skillOf(d, skills)
    if (skill && mode !== 'done' && skill.p >= c.skillRead) {
      const option = `use skill: ${skill.skill.name}`
      this.gate(id, 'skill', `P(skill "${skill.skill.name}") ${skill.p.toFixed(2)} ≥ skillRead ${c.skillRead}: reading it before deciding what comes next`)
      this.report(id, d, option, 'executed')
      this.events.status?.('acting')
      await this.look(id, option, { kind: 'skill', skill: skill.skill })
      this.request('action')
      return option
    }

    // Unsure while the user is still talking: listen for more. Unsure after they finish: think.
    const finished = this.thoughtDone()
    const unsure: Mode = finished ? 'think' : 'listen'
    if (mode === 'act') {
      // Going somewhere Jev is sure of is cheap to get wrong, so it needs less certainty that now is the time.
      const goes = navigates(target) && step.confidence >= c.speakingNav.step && (heardOf(d) ?? 0) >= c.speakingNav.heard
      const [name, min] = finished ? ['act', c.act] : button && !commits ? ['speakingChange', c.speakingChange] : goes ? ['speakingNav', c.speakingNav.act] : ['speakingAct', c.speakingAct]
      if (next.confidence < min) gate('act-confidence', `P(act) ${next.confidence.toFixed(2)} < ${name} ${min} → ${unsure}`, unsure)
      else if (step.confidence < c.stepConfidence) gate('step-confidence', `step "${option}" at ${step.confidence.toFixed(2)} < stepConfidence ${c.stepConfidence} → ${unsure}`, unsure)
      // A press before the user finishes is a guess: only one Jev is sure of runs, whatever it does.
      else if (button && !finished && step.confidence < c.speakingPress) gate('step-confidence', `press "${option}" at ${step.confidence.toFixed(2)} < speakingPress ${c.speakingPress} while the user is speaking → listen`, 'listen')
    }
    // Going somewhere runs while the user speaks. So does a press that can be undone, as soon as
    // Jev is sure and has heard what it needs ("add one called…" hasn't): no need to wait for the
    // voice. Type the user's words at a pause, since a field can be retyped.
    // Commit, search, respond or hand over only once they finish the thought: thinking only ever gets
    // whole turns, and what to search for or say hinges on all their words.
    const field = target.kind === 'element' && target.node.kind === 'input'
    const unheard = !!button && !commits && (heardOf(d) ?? 0) < c.finished.heard
    const waits = mode === 'think' || (mode === 'act' && (field || target.kind === 'search' || target.kind === 'respond' || commits || unheard))
    if (waits && !finished) {
      if (this.voiceOn || this.midWord()) {
        gate('mid-speech', mode === 'think' ? 'thinking waits until the user pauses' : `"${option}" is held until the user pauses`, 'listen')
      } else if (!(mode === 'act' && field)) {
        this.report(id, d, mode === 'think' ? 'think' : option, 'gated')
        const what = mode === 'think' ? 'thinking' : `"${option}"`
        return this.hold(id, 'thought', 'thought-open', `${what} waits until the user finishes the thought`, () => this.handle(id, d, options, screen, this.utteranceEnded, false, changed, ask, skills))
      }
    }

    if (mode === 'listen') {
      this.report(id, d, 'listen', gated ? 'gated' : 'executed')
      // Once the user has finished, listening is a dead end: think instead of going quiet.
      // A listen decided while they were still speaking is re-asked by the deferred `end`.
      if ((decidedEnded || finished) && fullText(this.transcript).trim()) {
        // Having only gone where they asked, there's nothing to check or say.
        if (this.onlyNavigated()) {
          this.gate(id, 'only-navigated', 'the user has finished and Stanley only went somewhere: done, quietly')
          await this.finishTask('done', { tickId: id, d, ask })
          return 'done'
        }
        this.gate(id, 'listen-ended', 'the user has finished, so thinking takes the turn')
        return this.think(id, 'the user finished and Jev only listened')
      }
      this.halt(this.utteranceEnded ? 'didnt-get-that' : 'listening')
      return 'listen'
    }

    // Unsure whether it's finished once the user has: let thinking check (it may need to answer).
    if (mode === 'done' && finished && next.confidence < c.done && !this.onlyNavigated()) {
      this.report(id, d, 'think', 'gated')
      this.gate(id, 'done-confidence', `P(done) ${next.confidence.toFixed(2)} < done ${c.done} → think`)
      return this.think(id, `Jev was unsure it was done (P(done) ${next.confidence.toFixed(2)})`)
    }

    // A button pressed before the user finished was a guess. Before closing the task, thinking
    // checks the guesses against everything they said, and undoes any they took back, unless Jev
    // is sure it's done (which includes that nothing Stanley did goes against what they want).
    // A guess followed by pressing something else may have been taken back however sure Jev is.
    if (mode === 'done' && this.utteranceEnded && this.guessedEarly() && (next.confidence < c.earlyGuessDone || this.guessedThenPressed())) {
      this.report(id, d, 'think', 'gated')
      this.gate(id, 'early-guess', 'a button was pressed before the user finished; thinking checks it against what they said')
      return this.think(id, 'a button was pressed before the user finished: check it against what they said')
    }

    if (mode === 'done') {
      this.report(id, d, 'done', 'executed')
      // Hands-free, the user may not be looking: say back the words of theirs that went in.
      const echo = this.dictatedThisTask()
      if (echo) this.say(`Done: "${echo}"`)
      await this.finishTask('done', { tickId: id, d, ask })
      return 'done'
    }

    // Too unsure of the step, or of acting now, once the user has finished: thinking takes the turn.
    if (mode === 'think') {
      const chosen = next.choice === 'think' && !gated
      this.report(id, d, 'think', chosen ? 'executed' : 'gated')
      return this.think(id, chosen ? 'Jev chose think' : 'no step stood out clearly')
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
    // Jev going round in circles is Jev unsure what works here: thinking takes the turn.
    if (repeats >= c.oscillation.repeats) {
      this.gate(id, 'oscillation', `"${option}" chosen ${repeats}× from the same screen in the last ${c.oscillation.window} steps`)
      this.report(id, d, 'think', 'gated')
      return this.think(id, `Jev kept choosing "${option}" from the same screen without getting anywhere`)
    }
    if (++this.steps > c.maxStepsPerUtterance) {
      this.gate(id, 'step-cap', `more than ${c.maxStepsPerUtterance} steps this utterance`)
      const detail = 'it took too many steps'
      this.history.stage({ kind: 'event', event: 'stuck', detail }, note('You stopped: you took too many steps.'))
      this.report(id, d, 'stuck', 'forced-stop')
      await this.finishTask('stuck')
      return 'stuck'
    }

    if (target.kind === 'arrange') return this.arrangeStep(id, option, d, ask, decision, changed)
    if (target.kind === 'search') return this.searchStep(id, option, d)
    // What to say is written from the state as it is, like any turn of the larger model's.
    if (target.kind === 'respond') {
      this.report(id, d, option, 'executed')
      return this.think(id, 'Jev chose respond')
    }

    if (target.kind === 'folder' || target.kind === 'file' || target.kind === 'skill') {
      this.report(id, d, option, 'executed')
      this.events.status?.('acting')
      await this.look(id, option, target)
      this.request('action')
      return option
    }

    // What goes in a field, the writer writes.
    if (target.kind === 'element' && target.node.kind === 'input') {
      this.report(id, d, option, 'executed')
      return this.type(id, option, target, decision)
    }

    // Sending, deleting or paying can't be taken back, so it waits for the whole turn, and runs only
    // when Jev, asked just that, is sure the user asked for it. Otherwise thinking gets the go-ahead.
    if (commits) {
      if (!this.utteranceEnded) {
        this.report(id, d, option, 'gated')
        return this.hold(id, 'turn', 'turn-open', `"${option}" commits, so it waits until the user's turn ends`, () => this.handle(id, d, options, screen, this.utteranceEnded, false, changed, ask, skills))
      }
      // What it would send holds the user's words, and speech recognition wasn't sure of some of
      // them: nothing that can't be taken back goes out until they have heard them.
      const unsureWords = this.unsureDictation()
      if (unsureWords) {
        this.report(id, d, 'think', 'gated')
        this.gate(id, 'unsure-words', `the user's words for it were partly unsure (?): thinking reads them back before "${option}" is pressed`)
        return this.think(id, `[${option}] would send words that were partly unsure: "${unsureWords}"`)
      }
      const asked = await this.consent(id, option)
      if (changed()) {
        this.gate(id, 'stale', 'new words arrived while asking whether the user asked for it')
        this.report(id, d, 'stale', 'stale-discarded')
        return 'stale'
      }
      if (asked < c.consent) {
        this.report(id, d, 'think', 'gated')
        this.gate(id, 'consent', `P(the user asked for "${option}") ${asked.toFixed(2)} < consent ${c.consent} → think`)
        return this.think(id, `[${option}] can't be taken back, and Jev wasn't sure the user asked for it`)
      }
    }

    this.report(id, d, option, 'executed')
    this.events.status?.('acting')
    await this.attempt(id, option, target, {}, 'jev', { jev: true }, decision)
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
   * Jev chose to lay the screen out: its `show` and `left` answers from the same decision say how
   * (see screen.ts). Unsure, thinking takes the turn: it can lay the screen out itself, or ask.
   * The screen must be as it was when Jev decided: the user may have changed it.
   */
  private async arrangeStep(id: number, option: string, d: MultiChoiceResult, ask: ScreenAsk | null, decision: DecisionMeta, changed: () => boolean): Promise<string> {
    const c = this.config
    const choice = ask && d.answers.show && d.answers.left ? chooseScreen(ask, { show: d.answers.show, left: d.answers.left }, c.screen.left) : null
    const before = sidesKey(ask?.before ?? [])
    if (!ask || !choice || choice.confidence < c.screen.show) {
      this.events.debug?.({ type: 'screen', tickId: id, source: 'step', before, after: null, confidence: choice?.confidence, left: choice?.left, reason: 'unsure' })
      this.report(id, d, 'think', 'gated')
      this.gate(id, 'screen', `P(show) ${choice?.confidence.toFixed(2) ?? '—'} < screen.show ${c.screen.show} → think`)
      return this.think(id, 'Jev chose to arrange the screen, but was unsure how')
    }
    if (changed() || !sameSides(this.world.sides!(), ask.before)) {
      this.events.debug?.({ type: 'screen', tickId: id, source: 'step', before, after: null, confidence: choice.confidence, left: choice.left, reason: 'stale' })
      this.gate(id, 'stale', 'new words, or the screen changed, since Jev decided how to arrange it')
      this.report(id, d, 'stale', 'stale-discarded')
      // A click changes the screen without asking for a decision: Jev decides again on the screen as it is.
      this.request('action')
      return 'stale'
    }
    this.report(id, d, option, 'executed')
    this.events.status?.('acting')
    this.events.debug?.({ type: 'screen', tickId: id, source: 'step', before, after: sidesKey(choice.sides), confidence: choice.confidence, left: choice.left })
    // Still wanted once the apps it shows are open: no new words, and the screen as Jev saw it.
    const fresh = () => !changed() && sameSides(this.world.sides!(), ask.before)
    await this.attempt(id, option, { kind: 'arrange', sides: choice.sides, fresh }, {}, 'jev', { jev: true }, decision)
    this.request('action')
    return option
  }

  /** The prompt's sections for the user's files and skills, when there are any: what every decision reads. */
  private async jevExtra(skills?: SkillScan): Promise<string[]> {
    const scan = skills ?? (await this.scanSkills())
    return [...(this.files ? [JEV_FILES] : []), ...(scan.skills.length ? [JEV_SKILLS] : [])]
  }

  /**
   * What Jev reads: the prompt (with `extra` sections, and what the user asked it to remember),
   * today, the screen's layout when Stanley lays it out, and the conversation with the screen and,
   * when it chooses a step, the steps on offer: its questions are answered apart, so each reads them here.
   */
  private jevState(screen: Screen, ask: ScreenAsk | null, extra: string[] = [], options?: OptionSet): string {
    const name = this.name()
    const preamble = jevPreamble({ name, today: this.clock(), extra, memory: this.sessionMemory, layout: !!ask })
    return `${preamble}\n\n${narrate(this.view(), screen, this.live(), this.config.jevTurns, this.others(), options)}`
  }

  /** There is a writer: a quick model that writes the text of a step (write.ts). */
  private writes(): boolean {
    return !!this.thinker.quick
  }

  /** The writer's instructions and earlier turns, under the name the user calls the assistant now, and today. */
  private writer(): { instructions: string; examples: QuickExample[] } {
    const today = this.clock()
    return { instructions: writerInstructions({ name: this.name(), today }), examples: writerExamples(today) }
  }

  /** Has the writer read its instructions and earlier turns ahead of time, so its first step is as quick as the rest. */
  warmWriter(): void {
    const { instructions, examples } = this.writer()
    void this.thinker.warm?.(instructions, examples)
  }

  /**
   * The writer takes the turn: the text of the step being taken, from the end of the conversation
   * as Jev reads it. More words from the user drop it at once, since it hinges on exactly their
   * words: null then.
   */
  private async writeStep(step: WriteStep): Promise<{ text: string; input: string; latencyMs: number } | null> {
    const input = writerInput(narrate(this.view(), null, this.live(), WRITER_TURNS), step)
    const { instructions, examples } = this.writer()
    const controller = new AbortController()
    this.thinking = controller
    this.thinkingMode = 'write'
    const started = performance.now()
    try {
      const reply = await this.thinker.quick!(instructions, input, controller.signal, examples)
      return { text: written(reply), input, latencyMs: performance.now() - started }
    } catch (err) {
      if (!controller.signal.aborted) throw err
      return null
    } finally {
      if (this.thinking === controller) this.thinking = undefined
    }
  }

  /**
   * Jev chose a field: the writer writes what goes in it, the user's words or its own. Then Jev
   * carries on (Enter, Send, done). Without a writer, thinking takes the turn once the user has
   * finished.
   */
  private async type(id: number, option: string, target: Target, decision: DecisionMeta): Promise<string> {
    if (!this.writes()) {
      if (this.thoughtDone()) return this.think(id, `the next step is typing into [${option}], and there is no quick model to write it`)
      this.halt('listening')
      return 'listen'
    }
    this.events.status?.('writing')
    const reply = this.begin()
    const value = target.kind === 'element' ? (target.node.value ?? '') : ''
    const wrote = await this.writeStep({ kind: 'field', field: option, value })
    if (!wrote) return this.stale(id, reply, 'writing')
    this.events.debug?.({ type: 'dictate', tickId: id, option, input: wrote.input, text: wrote.text, latencyMs: wrote.latencyMs })
    return this.applyWrite(id, option, target, decision, wrote.text, reply)
  }

  /**
   * Types what the writer wrote. The user's own words go in at once, even mid-thought: a field can
   * be retyped as they go on, which is live dictation. Words of Stanley's own (`ownWords`) wait
   * until the user finishes the thought, since more words would change them, and prose is read back
   * before anything can send it. Nothing to type yet: listen, or thinking takes the turn once the
   * user has finished.
   */
  private async applyWrite(id: number, option: string, target: Target, decision: DecisionMeta, wrote: string, reply: Reply): Promise<string> {
    const text = unmarked(wrote).replace(/\s+/g, ' ').trim()
    const before = target.kind === 'element' ? (target.node.value ?? '') : ''
    const own = !!text && ownWords(text, this.heardThisTask(), before)
    if (own && !this.thoughtDone()) {
      return this.hold(id, 'thought', 'thought-open', `words of Stanley's own for [${option}] wait until the user finishes the thought`, () => this.applyWrite(id, option, target, decision, wrote, reply))
    }
    // A value (a number, a choice from a list, a word or two) is just filling in what was asked.
    const prose = target.kind === 'element' && target.role !== 'combobox' && text.split(/\s+/).length > 3
    const say = own && prose ? `I wrote: "${text}" Should I go ahead?` : ''
    // Re-deciding after more words often lands on the same text: retyping it isn't a step.
    const unchanged = !!text && text === before
    if (text && !unchanged) {
      this.events.status?.('acting')
      await this.attempt(id, option, target, { text }, 'writer', { jev: true }, decision, own ? 'you' : 'user')
    }
    this.finish(reply, say)
    if (say) {
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
      return this.think(id, `the next step is typing into [${option}], but there is nothing to type yet`)
    }
    this.request('action')
    return option
  }

  /** The user's words this task, as heard: what tells Stanley's own words in a field from theirs. */
  private heardThisTask(): string {
    const words = this.task().flatMap((e) => (e.meta.kind === 'words' && typeof e.message?.content === 'string' ? [e.message.content] : []))
    return [...words, fullText(this.transcript)].join(' ')
  }

  /** New words made what thinking was doing out of date: it says nothing, and Jev decides again with them. */
  private stale(id: number, reply: Reply, what: string): string {
    this.drop(reply)
    this.gate(id, 'stale', `new words arrived while ${what}; re-deciding with them`)
    this.outcome = { outcome: 'stale-discarded' }
    return 'stale'
  }

  /** Jev's P(the user asked for what pressing a button that commits does), from the conversation and the screen as it is now. */
  private async consent(id: number, option: string): Promise<number> {
    const started = performance.now()
    const name = this.name()
    const screen = await this.world.screen()
    // The state every decision reads, and the question of this press.
    const state = this.jevState(screen, this.screenAsk(screen), await this.jevExtra())
    const result = await this.jev.choose({ state, instructions: named(consentInstructions(option), name), options: namedOptions(CONSENT, name) })
    this.events.debug?.({ type: 'consent', tickId: id, option, probabilities: result.probabilities, latencyMs: performance.now() - started })
    return result.probabilities.asked ?? 0
  }

  /**
   * Jev lists a folder, reads a file or reads a skill, in the background. It goes into the history
   * as the bash command it is, so thinking reads it as its own; Jev reads what was in the folder,
   * how the file starts, or all the skill says to do, so the steps it describes can come next.
   */
  private async look(tickId: number, option: string, target: { kind: 'folder' | 'file'; path: string } | { kind: 'skill'; skill: Skill }): Promise<void> {
    const started = performance.now()
    const command = target.kind === 'folder' ? listCommand(target.path) : readCommand(target.kind === 'skill' ? target.skill.path : target.path)
    let result: BashResult
    try {
      result = await this.files!.bash(command)
    } catch (err) {
      result = { output: err instanceof Error ? err.message : String(err), exitCode: -1 }
    }
    const error = result.exitCode === 0 ? undefined : result.output.trim().split('\n').at(-1) || `exit code ${result.exitCode}`
    const utteranceId = this.utteranceId || undefined
    const file: FileMeta =
      target.kind === 'skill'
        ? { kind: 'skill', name: target.skill.name, path: target.skill.path, body: error ? '' : skillBody(result.output), ...(error && { error }), utteranceId }
        : target.kind === 'folder'
        ? { kind: 'list', path: target.path, entries: error ? [] : result.output.split('\n').filter((l) => l.trim()), ...(error && { error }), utteranceId }
        : { kind: 'read', path: target.path, excerpt: error ? '' : result.output.slice(0, 1000), ...(error && { error }), utteranceId }
    const toolCallId = `call_file-${++this.stepCount}`
    this.history.stagePair({ toolCallId, tool: 'bash', input: { command }, by: 'jev' }, { type: 'text', value: bashText(result) }, { toolCallId, file })
    this.events.debug?.({ type: 'act', tickId, option, summary: error ? `failed: ${error}` : `ran ${command}`, observation: bashText(result), latencyMs: performance.now() - started })
  }

  /**
   * Jev chose to search the web: the writer writes what to search for, and the search goes into the
   * history as Stanley's own, as thinking's do. Jev then decides with what it found: open a page, or
   * let thinking answer from it. More words from the user drop it. With nothing to search for yet,
   * thinking takes the turn.
   */
  private async searchStep(id: number, option: string, d: MultiChoiceResult): Promise<string> {
    this.report(id, d, option, 'executed')
    this.events.status?.('acting')
    const started = performance.now()
    const stale = () => {
      this.gate(id, 'stale', 'new words arrived while searching; re-deciding with them')
      this.outcome = { outcome: 'stale-discarded' }
      return 'stale'
    }
    const wrote = await this.writeStep({ kind: 'search' })
    if (!wrote) return stale()
    const query = wrote.text
    this.events.debug?.({ type: 'query', tickId: id, input: wrote.input, text: query, latencyMs: wrote.latencyMs })
    if (!query) return this.think(id, 'Jev chose to search the web, but there was nothing to search for yet')
    this.doing = `searching the web for "${query}".`
    const controller = new AbortController()
    this.thinking = controller
    this.thinkingMode = 'write'
    let results: WebResult[] = []
    let error: string | undefined
    try {
      results = await this.web!.search(query, controller.signal)
    } catch (err) {
      if (controller.signal.aborted) return stale()
      error = err instanceof Error ? err.message : String(err)
    } finally {
      if (this.thinking === controller) this.thinking = undefined
    }
    const output = error ? { type: 'error-text' as const, value: `The search failed: ${error}` } : { type: 'json' as const, value: json({ query, results } satisfies SearchOutput) }
    const toolCallId = `call_search-${++this.stepCount}`
    this.history.stagePair({ toolCallId, tool: 'search', input: { query }, by: 'jev' }, output, { toolCallId, lookup: { kind: 'search', query, results, ...(error && { error }), utteranceId: this.utteranceId || undefined } })
    const found = results.map((r, i) => `${i + 1}. "${r.title}"\n   ${r.url}\n   ${r.excerpt}`).join('\n')
    this.events.debug?.({ type: 'act', tickId: id, option, summary: error ? `failed: ${error}` : `searched the web for "${query}": ${results.length} found`, observation: found || undefined, latencyMs: performance.now() - started })
    this.request('action')
    return option
  }

  /** Runs one step and records it (see `StepRecord`). A failure is recorded as its result, then rethrown. */
  private async step(tickId: number, option: string, target: Target, args: ActionArgs, by: Actor, record: StepRecord, decision?: DecisionMeta, wrote?: 'user' | 'you'): Promise<StepResult> {
    const started = performance.now()
    // The words the decision was made on: a change made before the user finished splits their turn.
    const basis = this.seen && this.seenUtterance === this.utteranceId ? this.seen : this.transcript
    const heardWords = fullText(basis).trim().split(/\s+/).filter(Boolean).length
    const meta: StepMeta = { id: `step-${++this.stepCount}`, by, target: stepTarget(option, target), text: args.text, wrote, utteranceId: this.utteranceId, heardWords, decision, summary: '' }
    const save = (step: StepMeta) => {
      const output = step.error ? { type: 'error-text' as const, value: step.summary } : { type: 'text' as const, value: stepResult(step) }
      const input = { option, ...(args.text !== undefined && { text: args.text }) }
      if ('jev' in record) this.history.stagePair({ toolCallId: `call_${step.id}`, tool: 'act', input, by }, output, { toolCallId: `call_${step.id}`, step })
      else record.turn(step)
    }
    let result: StepResult
    try {
      if (target.kind === 'app') result = await this.world.open(target.app.id)
      else if (target.kind === 'element') result = await this.world.perform(target.node, args)
      else if (target.kind === 'page') result = await this.world.openUrl!(target.url)
      else if (target.kind === 'arrange') {
        if (!target.sides) throw new Error('No layout to arrange the screen in')
        result = await this.world.arrange!(target.sides, target.fresh)
      }
      else if (target.kind === 'folder' || target.kind === 'file' || target.kind === 'skill') throw new Error('Files are looked at in the background, not opened')
      else if (target.kind === 'search') throw new Error('Searches run in the background, not on the screen')
      else if (target.kind === 'respond') throw new Error('Responding is thinking writing what to say, not a step on the screen')
      else if (target.kind === 'lock') {
        // The session ends with it: this agent is cancelled, and what it reports from here is ignored.
        await this.world.lock!()
        result = { summary: 'Locked the computer' }
      } else {
        await this.world.global(target.kind)
        // The home screen shows no app: going there lays the screen out, as the user asked.
        if (target.kind === 'home' && this.world.arrange) {
          await this.world.arrange([])
          this.arranged = true
        }
        result = { summary: target.kind === 'back' ? 'Went back' : 'Went to the home screen' }
      }
    } catch (err) {
      save({ ...meta, summary: err instanceof Error ? err.message : String(err), error: true })
      throw err
    }
    // A page is recorded under the title it opened with, which the address alone doesn't give.
    if (meta.target.kind === 'page' && result.title) meta.target = { ...meta.target, title: result.title }
    // What the screen shows then, when the step changed it; arranging says it either way.
    const layout = this.layoutChange() ?? (target.kind === 'arrange' ? (this.layoutKnown ?? undefined) : undefined)
    save({ ...meta, summary: result.summary, observation: result.observation, layout })
    // Full screen lays the screen out as surely as arranging it: the end of the task leaves it. Going
    // somewhere after that (home, then Tasks) leaves the screen to the end of the task again.
    if (target.kind === 'arrange' || (target.kind === 'element' && target.node.id.endsWith(FULLSCREEN))) this.arranged = true
    else if (target.kind === 'app' || target.kind === 'page' || target.kind === 'back' || (target.kind === 'element' && target.node.kind === 'location')) this.arranged = false
    const nodeId = target.kind === 'element' ? target.node.id : undefined
    this.events.debug?.({ type: 'act', tickId, option, nodeId, args, ...result, latencyMs: performance.now() - started })
    return result
  }

  // ── Thinking ────────────────────────────────────────────────────────────

  /**
   * Hands the turn to thinking, which continues the history. It acts on the same options, and
   * whatever it writes is said to the user. Then the task ends and the next turn starts with Jev
   * again. `handover` is why, for the debug window only: thinking reads the state, as every turn does.
   */
  private async think(id: number, handover: string): Promise<string> {
    this.events.status?.('thinking')
    const reply = this.begin()
    const turn = await this.thinkOn(id, handover, reply)
    if (!turn) {
      // Out of date, so it says nothing more. Steps it already took stay done, and in the history.
      return this.stale(id, reply, 'thinking')
    }
    const said = turn.result.text.trim()
    this.finish(reply, said)
    // Nothing to do yet while the user is mid-turn ("add one called… um"): keep listening.
    if (!said && turn.steps === 0 && !this.thoughtDone()) {
      this.halt('listening')
      return 'listen'
    }
    await this.finishTask('done')
    return 'think'
  }

  /**
   * A thinking call: the screen goes in as the observation, the turn runs on the whole history, and
   * what it did is appended exactly as it was sent. Returns null when new words aborted it; a turn
   * cut short still leaves the steps it took.
   */
  private async thinkOn(id: number, handover: string, reply: Reply): Promise<{ result: ThinkResult; options: OptionSet; steps: number } | null> {
    const screen = await this.world.screen()
    const options = await this.thinkingOptions(screen)
    const news = await this.skillNews()
    await this.memoryReady
    const files = await this.topFiles()
    const working = this.background?.working() ?? []
    const tasks = working.length ? [`Background tasks still working: ${working.map((t) => `${t.id}, "${t.title}"`).join('; ')}.`] : []
    this.noteLayout()
    const sent = this.history.send(this.observe(screen, options, files, [...(news ? [news] : []), ...tasks]), this.live())
    // A turn has every result noted in the history: it tells the user, so none is told again.
    this.background?.sent()
    this.events.debug?.({ type: 'think-start', tickId: id, mode: 'run', handover, entries: sent.entries, cacheAt: sent.cacheAt })
    const controller = new AbortController()
    this.thinking = controller
    this.thinkingMode = 'run'
    this.doing = 'working out what to do or say.'
    const started = performance.now()
    const ran = new Map<string, Ran>()
    let steps = 0
    const signal = controller.signal
    const end = (fields: { text: string; aborted: boolean; result?: ThinkResult }) => {
      const u = fields.result?.usage
      const usage = u && { inputTokens: u.inputTokens, outputTokens: u.outputTokens, cacheReadTokens: u.inputTokenDetails?.cacheReadTokens, cacheWriteTokens: u.inputTokenDetails?.cacheWriteTokens, lastInputTokens: fields.result?.lastInputTokens }
      this.events.debug?.({ type: 'think-end', tickId: id, text: fields.text, steps, latencyMs: performance.now() - started, aborted: fields.aborted, ...(usage && { usage }) })
    }
    try {
      const result = await this.thinker.run({
        instructions: this.instructions,
        messages: sent.messages,
        cacheAt: sent.cacheAt,
        maxSteps: this.config.thinkingSteps,
        signal,
        onText: (delta) => this.stream(reply, delta),
        act: (call, toolCallId) => (steps++, this.thinkStep(id, call, toolCallId, signal, ran)),
        find: (query, app) => this.find(id, query, app, signal),
        ...(this.web && {
          search: (query: string, toolCallId: string) => (steps++, this.search(id, query, toolCallId, signal, ran)),
          fetch: (url: string, toolCallId: string) => (steps++, this.read(id, url, toolCallId, signal, ran)),
        }),
        ...(this.world.openUrl && { openPage: (url: string, toolCallId: string) => (steps++, this.openPage(id, url, toolCallId, signal, ran)) }),
        ...(this.files && { bash: (command: string, toolCallId: string) => (steps++, this.bash(id, command, toolCallId, signal, ran)) }),
        ...(this.files?.write &&
          this.files.read && {
            writeFile: (path: string, content: string, toolCallId: string) => (steps++, this.writeFile(id, path, content, toolCallId, signal, ran)),
            editFile: (path: string, old: string, replacement: string, all: boolean, toolCallId: string) => (steps++, this.editFile(id, path, old, replacement, all, toolCallId, signal, ran)),
            onDraft: (toolCallId: string, path: string, content: string) => this.draw(path, content, toolCallId),
          }),
        ...(this.background && {
          delegate: (task: string, title: string, toolCallId: string) => (steps++, this.delegate(id, task, title, toolCallId, signal, ran)),
          taskStatus: (taskId: string, toolCallId: string) => (steps++, this.taskTool(id, 'task_status', taskId, toolCallId, signal, ran)),
          taskCancel: (taskId: string, toolCallId: string) => (steps++, this.taskTool(id, 'task_cancel', taskId, toolCallId, signal, ran)),
          taskSteer: (taskId: string, message: string, toolCallId: string) => (steps++, this.taskTool(id, 'task_steer', taskId, toolCallId, signal, ran, message)),
        }),
      })
      const { final, toolCallIds } = this.history.appendTurn(result.messages, result.sent, ran, id)
      this.saw(ran, toolCallIds)
      reply.final = final
      end({ text: result.text, aborted: false, result })
      return { result, options, steps }
    } catch (err) {
      const partial = err instanceof PartialTurn ? err.messages : []
      this.saw(ran, this.history.appendTurn(partial, partial.length, ran, id).toolCallIds)
      end({ text: '', aborted: signal.aborted })
      if (!signal.aborted) throw err instanceof PartialTurn ? err.cause : err
      return null
    } finally {
      this.thinking = undefined
      this.judging = null
      // A page whose writing never finished (the turn stopped, or the call never ran) comes off the screen.
      for (const draft of this.drafts.values()) void draft.ready.then(() => draft.page?.cancel())
      this.drafts.clear()
    }
  }

  /** The top of the user's folder for thinking, or `''` when there are no files or they can't be listed. */
  private async topFiles(): Promise<string> {
    const paths = await this.files?.paths().catch(() => null)
    return paths ? topFiles(paths) : ''
  }

  /**
   * The observation for a thinking call: the screens and their options, each part that changed since
   * thinking last read it (see view.ts `since`), or `<screen unchanged/>`; the top of the folder
   * (`files`, two levels) when it changed; then notes.
   */
  private observe(screen: Screen, options: OptionSet, files: string, notes: string[]): string {
    const { text: body, seen } = since(viewParts(screen, options, this.others(), { more: true }), this.screensRead, this.config.thinkingTop)
    this.screensRead = seen
    const listing = files && files !== this.lastFiles ? [files] : []
    if (files) this.lastFiles = files
    const today = longDate(this.clock())
    const page = this.files && this.pageKnown ? this.pageSize() : undefined
    const resized = page && pageResized(this.pageKnown!, page) ? page : undefined
    const all = [...(today !== this.today ? [`It is now ${today}.`] : []), ...(resized ? [`Pages are now shown in a window ${pageSizeText(resized)}.`] : []), ...(this.utteranceId && !this.utteranceEnded ? ['The user paused, but may not have finished speaking.'] : []), ...notes]
    this.today = today
    if (resized) this.pageKnown = resized
    return [body, ...listing, ...all.map((n) => `<note>${n}</note>`)].join('\n')
  }

  /** The screens in the last of the results that went into the history are the ones thinking read last, in full. */
  private saw(ran: Map<string, Ran>, toolCallIds: string[]): void {
    for (const id of toolCallIds) {
      const view = ran.get(id)?.view
      if (view) this.screensRead = new Map(view.map((p) => [p.key, p]))
    }
  }

  /** One `act` call by thinking. Returns what it sees next. */
  private async thinkStep(id: number, call: ActCall, toolCallId: string, signal: AbortSignal, ran: Map<string, Ran>): Promise<string> {
    signal.throwIfAborted()
    const { text } = call
    let option = call.option
    const now = await this.world.screen()
    const options = await this.thinkingOptions(now)
    const done = (result: string) => {
      this.events.debug?.({ type: 'think-step', tickId: id, option, text, result })
      return result
    }
    // What is listed first; then anything on the screens, since what is listed past the limit shifts with what the user says.
    let name = resolveOption(options, option)
    let listed = name && options.targets.get(name)
    if (!listed) {
      const all = this.everyOption(now)
      name = resolveOption(all, option)
      listed = name && all.targets.get(name)
    }
    if (!name || !listed) return done(`There is no option [${option}] right now. Use a name exactly as listed.\n\n${viewText(viewParts(now, options, this.others(), { more: true }))}`)
    option = name
    const target = this.thinkingTarget(listed, call)
    if (typeof target === 'string') return done(target)
    this.doing = `a step on the screen, [${option}]${text ? `, typing "${text}"` : ''}.`
    const args: ActionArgs = {}
    const field = target.kind === 'element' && target.node.kind === 'input'
    if (field) {
      if (text === undefined) return done(`"${option}" is a field: pass the text to type.`)
      args.text = unmarked(text).replace(/\s+/g, ' ').trim()
    }
    this.events.status?.(args.text !== undefined ? 'writing' : 'acting')
    let step: StepMeta | undefined
    let outcome: string
    try {
      const before = target.kind === 'element' ? (target.node.value ?? '') : ''
      const wrote = field && args.text ? (ownWords(args.text, this.heardThisTask(), before) ? 'you' : 'user') : undefined
      await this.step(id, option, target, args, 'thinking', { turn: (s) => (step = s) }, undefined, wrote)
      outcome = stepResult(step!)
    } catch (err) {
      outcome = `That failed: ${err instanceof Error ? err.message : String(err)}`
    }
    this.events.status?.('thinking')
    const view = await this.screens()
    const result = `${outcome}\n\n${viewText(view)}`
    if (step) ran.set(toolCallId, { tool: 'act', input: { ...call }, output: { type: 'text', value: result }, result: { toolCallId, step }, view })
    return done(result)
  }

  /**
   * Thinking looks for steps the options don't list: every element of every open app (of `app`
   * alone, when given), ranked by `query` as the options are. What isn't embedded yet gets a moment
   * to be, so a search in other words can find it. The best `FIND` come back by name, for `act`.
   */
  private async find(id: number, query: string, app: string | undefined, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    this.doing = `looking on the screens for "${query}".`
    const screen = await this.world.screen()
    const others = this.others()
    const all = candidatesOf(screen, others)
    const want = app?.trim().toLowerCase()
    const inApp = (c: Candidate) => !want || ('flat' in c && (c.app ?? screen).title.toLowerCase().includes(want))
    const candidates = all.filter(inApp)
    if (this.relevance) {
      const texts = candidates.flatMap(candidateTexts)
      this.relevance.prepare(texts)
      await Promise.race([this.relevance.idle(), new Promise((r) => setTimeout(r, FIND_WAIT_MS))])
    }
    const ranking = await rankingFor(this.relevance, this.config.ranking, query, all, FIND)
    const found = stepOptions(screen, [], all.length, query, [], false, undefined, [], false, false, false, { others, ranking })
    const names = Object.keys(found.criteria).filter((n) => {
      const t = found.targets.get(n)
      return t?.kind === 'element' && (!want || (t.app ?? screen).title.toLowerCase().includes(want))
    })
    const best = names.slice(0, FIND)
    const result = best.length
      ? `The best of ${names.length} on the screens${want ? ` in ${app}` : ''} for "${query}":\n${best.map((n) => `- [${n}] ${found.criteria[n] ?? ''}`.trimEnd()).join('\n')}`
      : `Nothing on the screens${want ? ` in ${app}` : ''} for "${query}".`
    this.events.debug?.({ type: 'think-step', tickId: id, option: 'find', text: query, result })
    return result
  }

  /** A web search by thinking. It gets the full excerpts; Jev reads them cut to a line. */
  private async search(id: number, query: string, toolCallId: string, signal: AbortSignal, ran: Map<string, Ran>): Promise<SearchOutput> {
    signal.throwIfAborted()
    this.doing = `searching the web for "${query}".`
    const utteranceId = this.utteranceId || undefined
    const trace = (result: string) => this.events.debug?.({ type: 'think-step', tickId: id, option: 'search', text: query, result })
    try {
      const results = await this.web!.search(query, signal)
      const output: SearchOutput = { query, results }
      ran.set(toolCallId, { tool: 'search', input: { query }, output: { type: 'json', value: json(output) }, result: { toolCallId, lookup: { kind: 'search', query, results, utteranceId } } })
      trace(results.length ? results.map((r, i) => `${i + 1}. "${r.title}"\n   ${r.url}\n   ${r.excerpt}`).join('\n') : 'Nothing found.')
      return output
    } catch (err) {
      if (signal.aborted) throw err
      const error = err instanceof Error ? err.message : String(err)
      ran.set(toolCallId, { tool: 'search', input: { query }, output: { type: 'error-text', value: `The search failed: ${error}` }, result: { toolCallId, lookup: { kind: 'search', query, results: [], error, utteranceId } } })
      trace(`The search failed: ${error}`)
      throw new Error(`The search failed: ${error}`)
    }
  }

  /** A page read by thinking: it gets the page's text, and the history which page it was. */
  private async read(id: number, url: string, toolCallId: string, signal: AbortSignal, ran: Map<string, Ran>): Promise<PageOutput> {
    signal.throwIfAborted()
    this.doing = `reading the web page ${url}.`
    const utteranceId = this.utteranceId || undefined
    const trace = (result: string) => this.events.debug?.({ type: 'think-step', tickId: id, option: 'fetch', text: url, result })
    try {
      const page = await this.web!.fetch(url, signal)
      const output: PageOutput = { url: page.url, title: page.title, markdown: page.markdown }
      ran.set(toolCallId, { tool: 'fetch', input: { url }, output: { type: 'json', value: json(output) }, result: { toolCallId, lookup: { kind: 'read', url: page.url, title: page.title, utteranceId } } })
      trace(`# ${page.title}\n${page.url}\n\n${page.markdown}`)
      return output
    } catch (err) {
      if (signal.aborted) throw err
      const error = err instanceof Error ? err.message : String(err)
      ran.set(toolCallId, { tool: 'fetch', input: { url }, output: { type: 'error-text', value: `Couldn't read it: ${error}` }, result: { toolCallId, lookup: { kind: 'read', url, title: url, error, utteranceId } } })
      trace(`Couldn't read it: ${error}`)
      throw new Error(`Couldn't read it: ${error}`)
    }
  }

  /**
   * Thinking puts a page on screen by its address: any page, not only ones offered as options. A
   * path without an address is a file in the user's folder.
   */
  private async openPage(id: number, written: string, toolCallId: string, signal: AbortSignal, ran: Map<string, Ran>): Promise<string> {
    signal.throwIfAborted()
    const address = /^[a-z][a-z\d+.-]*:/i.test(written) ? written : this.world.fileUrl?.(written)
    if (!address) {
      const result = `There is no file "${written}" in the user's folder that the screen can show.`
      this.events.debug?.({ type: 'think-step', tickId: id, option: 'open_page', text: written, result })
      return result
    }
    const url = address
    this.doing = `opening ${written}.`
    const known = knownPages(this.view()).find((p) => sameUrl(p.url, url))
    this.events.status?.('acting')
    let step: StepMeta | undefined
    let outcome: string
    try {
      const title = known?.title ?? (address === written ? shortUrl(url) : written.split('/').at(-1)!)
      outcome = (await this.step(id, `open page: ${url}`, { kind: 'page', url, title }, {}, 'thinking', { turn: (s) => (step = s) })).summary
    } catch (err) {
      outcome = `That failed: ${err instanceof Error ? err.message : String(err)}`
    }
    this.events.status?.('thinking')
    const view = await this.screens()
    const result = `${outcome}\n\n${viewText(view)}`
    if (step) ran.set(toolCallId, { tool: 'open_page', input: { url: written }, output: { type: 'text', value: result }, result: { toolCallId, step }, view })
    this.events.debug?.({ type: 'think-step', tickId: id, option: 'open_page', text: written, result })
    return result
  }

  /** A command thinking runs on the user's files. A command that fails is an answer too: what it printed, and how it exited. */
  private async bash(id: number, command: string, toolCallId: string, signal: AbortSignal, ran: Map<string, Ran>): Promise<string> {
    signal.throwIfAborted()
    this.doing = `running \`${command}\` on the user's files.`
    const utteranceId = this.utteranceId || undefined
    let result: BashResult
    try {
      result = await this.files!.bash(command, signal)
    } catch (err) {
      if (signal.aborted) throw err
      result = { output: `It couldn't run: ${err instanceof Error ? err.message : String(err)}`, exitCode: -1 }
    }
    // A command can change the skills: thinking hears it at once, as a skill it wrote may be broken.
    const news = await this.skillNews()
    const text = news ? `${bashText(result)}\n\n${news}` : bashText(result)
    ran.set(toolCallId, { tool: 'bash', input: { command }, output: { type: 'text', value: text }, result: { toolCallId, file: { kind: 'bash', command, exitCode: result.exitCode, utteranceId } } })
    this.events.debug?.({ type: 'think-step', tickId: id, option: 'bash', text: command, result: text })
    return text
  }

  /**
   * A web page thinking is writing, as far as its input has come: on screen from its first words,
   * drawn as the rest comes, so the user watches it being made instead of waiting for it.
   */
  private draw(path: string, content: string, toolCallId: string): void {
    const draft = this.drafts.get(toolCallId)
    if (draft) {
      draft.content = content
      return draft.page?.write(content)
    }
    if (!this.world.draft || !PAGE.test(path)) return
    this.doing = `writing the page ${path}.`
    this.events.status?.('writing')
    const started: { content: string; page?: PageDraft; ready: Promise<void> } = { content, ready: Promise.resolve() }
    started.ready = this.world.draft(path).then(
      (page) => {
        started.page = page
        page?.write(started.content)
      },
      () => {},
    )
    this.drafts.set(toolCallId, started)
  }

  /** Thinking writes a file. A web page was drawn as it was written (`draw`): now it is complete, and looked at. */
  private async writeFile(id: number, path: string, content: string, toolCallId: string, signal: AbortSignal, ran: Map<string, Ran>): Promise<FileOutput> {
    signal.throwIfAborted()
    this.doing = `writing the file ${path}.`
    const draft = this.drafts.get(toolCallId)
    this.drafts.delete(toolCallId)
    await draft?.ready
    const input = { path, content }
    const held = this.heldBy(path)
    if (held) {
      draft?.page?.cancel()
      return this.fileFailed(id, 'write_file', input, path, false, held, toolCallId, ran)
    }
    try {
      await this.files!.write!(path, content)
    } catch (err) {
      draft?.page?.cancel()
      return this.fileFailed(id, 'write_file', input, path, false, `Couldn't write it: ${errorText(err)}`, toolCallId, ran)
    }
    draft?.page?.end(content)
    return this.wrote(id, 'write_file', input, path, false, await this.withNews(`Wrote ${path}.`), toolCallId, ran)
  }

  /** Thinking changes part of a file: `old`, which must be in it exactly once (or `all`, anywhere), becomes `replacement`. */
  private async editFile(id: number, path: string, old: string, replacement: string, all: boolean, toolCallId: string, signal: AbortSignal, ran: Map<string, Ran>): Promise<FileOutput> {
    signal.throwIfAborted()
    this.doing = `changing the file ${path}.`
    const input = { path, old, new: replacement, ...(all && { all: 'true' }) }
    const fail = (text: string) => this.fileFailed(id, 'edit_file', input, path, true, text, toolCallId, ran)
    const held = this.heldBy(path)
    if (held) return fail(held)
    let before: string
    try {
      before = await this.files!.read!(path)
    } catch (err) {
      return fail(`Couldn't read it: ${errorText(err)}`)
    }
    const edit = editText(before, path, old, replacement, all)
    if ('error' in edit) return fail(edit.error)
    try {
      await this.files!.write!(path, edit.text)
    } catch (err) {
      return fail(`Couldn't write it: ${errorText(err)}`)
    }
    return this.wrote(id, 'edit_file', input, path, true, await this.withNews(`Changed ${path}.`), toolCallId, ran)
  }

  /**
   * A file was written or changed. A web page comes to the front as it is now (reloaded where it
   * was scrolled to), and thinking gets what it reported going wrong and a picture of it, so it can
   * see a diagram that didn't draw and fix it.
   */
  private async wrote(id: number, tool: string, input: Record<string, string>, path: string, edit: boolean, outcome: string, toolCallId: string, ran: Map<string, Ran>): Promise<FileOutput> {
    const file: FileMeta = { kind: 'write', path, edit, utteranceId: this.utteranceId || undefined }
    const url = PAGE.test(path) ? this.world.fileUrl?.(path) : undefined
    if (!url || !this.world.openUrl) {
      ran.set(toolCallId, { tool, input, output: { type: 'text', value: outcome }, result: { toolCallId, file } })
      this.events.debug?.({ type: 'think-step', tickId: id, option: tool, text: path, result: outcome })
      return { text: outcome }
    }
    this.events.status?.('acting')
    let shown: string
    try {
      shown = (await this.world.openUrl(url, { fresh: true })).summary
      await this.world.global('show')
    } catch (err) {
      shown = `It couldn't be shown: ${errorText(err)}`
    }
    const look = await this.world.look?.().catch(() => undefined)
    this.events.status?.('thinking')
    const printed = look?.console.length ? `Its console printed:\n${look.console.map((line) => `- ${line}`).join('\n')}` : 'Its console printed nothing.'
    const view = await this.screens()
    const text = `${outcome} ${shown}.\n${printed}${look?.image ? '\nA picture of the screen follows.' : ''}\n\n${viewText(view)}`
    const output: FileOutput = { text, image: look?.image }
    ran.set(toolCallId, { tool, input, output: fileOutput(output), result: { toolCallId, file }, view })
    this.events.debug?.({ type: 'think-step', tickId: id, option: tool, text: path, result: text })
    return output
  }

  /** Why thinking can't write `path` now: a background task still working wrote it, and may write it again. */
  private heldBy(path: string): string | null {
    const task = this.background?.holding(path, this.files?.root)
    return task ? `Background task ${task.id}, "${task.title}", is working on ${path}: wait for it to finish, send it the change with task_steer, or stop it with task_cancel first.` : null
  }

  /** Thinking hands work to a background task: it starts at once, and its result comes in a note (`taskEnded`). */
  private async delegate(id: number, task: string, title: string, toolCallId: string, signal: AbortSignal, ran: Map<string, Ran>): Promise<string> {
    signal.throwIfAborted()
    const started = this.background!.start(task, title)
    const input = { task, title }
    if (typeof started === 'string') {
      ran.set(toolCallId, { tool: 'delegate', input, output: { type: 'error-text', value: started }, result: { toolCallId } })
      this.events.debug?.({ type: 'think-step', tickId: id, option: 'delegate', text: title, result: started })
      return started
    }
    const text = `Started ${started.id}, "${started.title}", in the background. Its result comes to you in a note when it finishes: go on with the user meanwhile.`
    const meta: TaskMeta = { id: started.id, title: started.title, state: 'working' }
    ran.set(toolCallId, { tool: 'delegate', input, output: { type: 'text', value: text }, result: { toolCallId, task: meta } })
    this.events.debug?.({ type: 'think-step', tickId: id, option: 'delegate', text: title, result: text })
    return text
  }

  /** `task_status`, `task_cancel`, or `task_steer` with its `message`. */
  private async taskTool(id: number, tool: 'task_status' | 'task_cancel' | 'task_steer', taskId: string, toolCallId: string, signal: AbortSignal, ran: Map<string, Ran>, message = ''): Promise<string> {
    signal.throwIfAborted()
    const text = tool === 'task_status' ? this.background!.status(taskId) : tool === 'task_cancel' ? this.background!.cancel(taskId) : this.background!.steer(taskId, message)
    ran.set(toolCallId, { tool, input: tool === 'task_steer' ? { taskId, message } : { taskId }, output: { type: 'text', value: text }, result: { toolCallId } })
    this.events.debug?.({ type: 'think-step', tickId: id, option: tool, text: taskId, result: text })
    return text
  }

  /**
   * A background task ended by itself. Its result goes into the history as a note, which the next
   * whole thinking turn reads. If none comes, one is started to tell the user once things are quiet.
   */
  private taskEnded(task: BackgroundTask): void {
    const meta: TaskMeta = { id: task.id, title: task.title, state: task.state, summary: task.summary }
    this.history.stage({ kind: 'note', by: 'agent', results: [{ task: meta }] }, note(`Background task ${describe(task)}`))
    task.noted = true
    this.scheduleDelivery()
  }

  private scheduleDelivery(): void {
    if (!this.background) return
    clearTimeout(this.deliverTimer)
    this.deliverTimer = setTimeout(() => void this.deliver(), this.config.background.quietMs)
  }

  /** Nothing is going on: the user isn't mid-turn or speaking, Stanley isn't working or talking. */
  private quiet(): boolean {
    return !this.inFlight && !this.held && !this.turnOpen && !this.voiceOn && !this.talkingNow
  }

  /**
   * Tells the user what background tasks found or made, in a thinking turn of its own, once things
   * are quiet. Results a whole turn already had (it read them, or was sent them) aren't told again.
   */
  private async deliver(): Promise<void> {
    const waiting = this.background?.undelivered() ?? []
    if (!waiting.length || !this.quiet()) return
    this.inFlight = true
    this.halted = false
    this.outcome = null
    const id = ++this.tickId
    this.openTask()
    const screen = await this.world.screen().catch(() => null)
    this.events.debug?.({ type: 'tick-start', tickId: id, reason: 'task', utteranceId: this.utteranceId, transcript: this.transcript, utteranceEnded: this.utteranceEnded, screenId: screen?.id ?? '', state: narrate(this.view(), screen, this.live(), this.config.jevTurns, this.others()), questions: {} })
    for (const task of waiting) this.events.debug?.({ type: 'task', action: 'deliver', taskId: task.id, title: task.title, tickId: id })
    let effective = 'error'
    try {
      effective = await this.think(id, `background task ${waiting.map((t) => t.id).join(', ')} ended`)
      this.events.debug?.({ type: 'tick-end', tickId: id, effective, ...(this.outcome ?? { outcome: 'executed' }) })
    } catch (err) {
      this.fail(id, null, err)
    } finally {
      this.inFlight = false
    }
    this.lastEffective = effective
    const deferred = this.deferred
    this.deferred = null
    if (deferred) this.request(deferred)
  }

  /** What a write reports, and how the skills changed with it. */
  private async withNews(outcome: string): Promise<string> {
    const news = await this.skillNews()
    return news ? `${outcome} ${news}` : outcome
  }

  private fileFailed(id: number, tool: string, input: Record<string, string>, path: string, edit: boolean, text: string, toolCallId: string, ran: Map<string, Ran>): FileOutput {
    const file: FileMeta = { kind: 'write', path, edit, error: text, utteranceId: this.utteranceId || undefined }
    ran.set(toolCallId, { tool, input, output: { type: 'error-text', value: text }, result: { toolCallId, file } })
    this.events.debug?.({ type: 'think-step', tickId: id, option: tool, text: path, result: text })
    return { text }
  }

  /** The screens and their options as they are now, as thinking reads them after a step. */
  private async screens(): Promise<ViewPart[]> {
    const screen = await this.world.screen()
    return viewParts(screen, await this.thinkingOptions(screen), this.others(), { more: true })
  }

  /** Every element on the screens, past thinking's limit, and the rest of its steps: what a step can be taken on. */
  private everyOption(screen: Screen): OptionSet {
    return stepOptions(screen, this.world.appList(), Infinity, '', [], !!this.world.lock, undefined, [], this.laysOut(), false, false, { others: this.others() })
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Ends the task, and lays the screen out for what it did. `end` carries the decision that
   * finished it, whose screen answers saw it done; without one, Jev is asked (see `settleScreen`).
   */
  private async finishTask(status: AgentStatus, end: ScreenEnd = {}): Promise<void> {
    // Closed before the screen is settled, which can wait on Jev or an app opening: words said
    // meanwhile start a task of their own.
    const arranged = this.arranged
    if (this.taskOpen) this.history.stage({ kind: 'event', event: 'task-end' })
    this.taskOpen = false
    await this.settleScreen(end, arranged)
    this.noteLayout()
    this.halt(status)
  }

  /**
   * What the screen shows once a task ends. Without a world that lays it out, the app Stanley
   * worked on, as always. A task that laid it out itself leaves it; so does a decision new words
   * made stale (`keep`). Otherwise Jev's answers say (the finishing tick's, or a call of its own),
   * when they are fresh and sure; unsure, the screen stays as it is. If Jev can't be asked, the app
   * Stanley worked on is shown, as always. The task has ended by then (`arranged`: whether it laid
   * the screen out itself), and a failed call changes nothing else.
   */
  private async settleScreen(end: ScreenEnd, arranged: boolean): Promise<void> {
    const w = this.world
    if (!w.arrange || !w.sides) return w.global('show')
    const tickId = end.tickId ?? this.tickId
    const before = w.sides()
    const source = end.d ? 'done' : 'asked'
    const leave = (reason: string, choice?: ScreenChoice) => this.events.debug?.({ type: 'screen', tickId, source, before: sidesKey(before), after: null, confidence: choice?.confidence, left: choice?.left, reason })
    if (arranged) return leave('the task laid the screen out itself')
    if (end.keep) return leave(end.keep)
    // Fresh while the user has said nothing new, not started speaking again, and not changed the
    // screen, and the agent hasn't been cancelled: checked on the answers, before falling back,
    // and by the shell once the apps it shows are open.
    const abort = new AbortController()
    this.screenAbort = abort
    const utterance = this.utteranceId
    const seen = structuredClone(this.transcript)
    const fresh = () => !abort.signal.aborted && this.utteranceId === utterance && !hasNewWords(this.transcript, seen) && sameSides(w.sides!(), before)
    const shown = async () => {
      if (fresh() && !(await w.screen()).visible) await w.global('show')
    }
    try {
      const started = performance.now()
      const asked = end.d?.answers.show && end.d.answers.left && end.ask ? { ask: end.ask, show: end.d.answers.show, left: end.d.answers.left } : await this.askScreen(abort.signal)
      if (!asked) return await shown()
      const choice = chooseScreen(asked.ask, asked, this.config.screen.left)
      const latencyMs = end.d ? undefined : performance.now() - started
      if (!fresh() || !sameSides(asked.ask.before, before)) return leave('the screen or the words changed since Jev decided', choice)
      if (choice.confidence < this.config.screen.show) return leave(`unsure: P(show) ${choice.confidence.toFixed(2)} < screen.show ${this.config.screen.show}`, choice)
      this.events.debug?.({ type: 'screen', tickId, source, before: sidesKey(before), after: sidesKey(choice.sides), confidence: choice.confidence, left: choice.left, latencyMs })
      if (!sameSides(choice.sides, before)) await w.arrange(choice.sides, fresh)
    } catch (err) {
      // Cancelled with the agent (the session ended): nothing more to show.
      if (abort.signal.aborted) return
      leave(`failed: ${err instanceof Error ? err.message : String(err)}`)
      await shown().catch(() => {})
    }
  }

  /** Jev's screen answers on their own, for a task that ended without a decision that asked them. */
  private async askScreen(signal: AbortSignal): Promise<{ ask: ScreenAsk; show: Answer; left: Answer } | null> {
    const screen = await this.world.screen()
    const ask = this.screenAsk(screen)
    if (!ask) return null
    const name = this.name()
    const { answers } = await this.jev.decide({
      state: this.jevState(screen, ask, await this.jevExtra()),
      questions: { show: { instructions: named(ask.show.instructions, name), options: ask.show.options }, left: { instructions: named(ask.left.instructions, name), options: ask.left.options } },
      signal,
    })
    return { ask, show: answers.show!, left: answers.left! }
  }

  /** The user is mid-sentence: words are still being decoded and no pause has finalized them. */
  private midWord(): boolean {
    return !this.utteranceEnded && this.transcript.partial.trim() !== ''
  }

  /**
   * This task only went somewhere: Stanley took steps, every one of them navigating (laying the
   * screen out included), and looked
   * nothing up. Then a `done` or `listen` Jev is unsure of has nothing for thinking to check.
   */
  private onlyNavigated(): boolean {
    const entries = this.task().filter((e) => e.meta.results?.length)
    const results = entries.flatMap((e) => e.meta.results!)
    const went = (t: StepTarget) => t.kind === 'app' || t.kind === 'back' || t.kind === 'home' || t.kind === 'page' || t.kind === 'arrange' || (t.kind === 'element' && t.nodeKind === 'location')
    const steps = results.flatMap((r) => (r.step && r.step.by !== 'user' ? [r.step] : []))
    if (!steps.length || !steps.every((st) => went(st.target)) || !results.every((r) => r.step || (!r.lookup && !r.file))) return false
    // A place gone to before the user's last words was a guess, which thinking checks.
    return entries.every((e) => e.meta.at >= this.wordsAt)
  }

  /** What this task has done and said so far, from its start. */
  private task(): Entry[] {
    const view = this.view()
    return view.slice(view.findLastIndex((e) => e.meta.kind === 'event' && e.meta.event === 'task-start') + 1)
  }

  /**
   * The user's own words that this task typed and then committed (pressed Enter or a button
   * after), when Stanley hasn't said anything this task. A word or two, like a city, needs no echo.
   */
  private dictatedThisTask(): string | null {
    const task = this.task()
    if (saidOf(task).length) return null
    const steps = stepsOf(task)
    const typed = steps.findLastIndex((e) => e.by !== 'user' && e.wrote === 'user' && e.target.kind === 'element' && e.target.role !== 'combobox' && !!e.text && !e.error)
    if (typed === -1) return null
    const committed = steps.slice(typed + 1).some((e) => e.target.kind === 'element' && e.target.nodeKind === 'action' && !e.error)
    const text = steps[typed]!.text!
    return committed && text.split(/\s+/).length >= 2 ? text : null
  }

  /** The user's words typed this task, when speech recognition was unsure of any they said this task. */
  private unsureDictation(): string | null {
    if (!this.taskUnsure) return null
    return stepsOf(this.task()).findLast((e) => e.by !== 'user' && e.wrote === 'user' && !!e.text)?.text ?? null
  }

  /** A button was pressed for this utterance on fewer words than the user ended up saying. */
  private guessedEarly(): boolean {
    const words = fullText(this.transcript).trim().split(/\s+/).filter(Boolean).length
    return stepsOf(this.view()).some((e) => e.by !== 'user' && e.utteranceId === this.utteranceId && e.target.kind === 'element' && e.target.nodeKind === 'action' && (e.heardWords ?? words) < words)
  }

  /** A press made before the user finished, followed by a press of something else. */
  private guessedThenPressed(): boolean {
    const words = fullText(this.transcript).trim().split(/\s+/).filter(Boolean).length
    const presses = stepsOf(this.view()).flatMap((e) => (e.by !== 'user' && e.utteranceId === this.utteranceId && e.target.kind === 'element' && e.target.nodeKind === 'action' ? [{ node: e.target.nodeId, early: (e.heardWords ?? words) < words }] : []))
    return presses.some((p, i) => p.early && presses.slice(i + 1).some((later) => later.node !== p.node))
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
    if (this.utteranceEnded || !this.utteranceId) return true
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

  /** Says something, all at once. */
  private say(text: string): void {
    this.finish(this.begin(), text)
  }

  /**
   * Starts something to say, for thinking to stream into. It is said once the user has finished
   * (at once, if they have); words they add first make it moot.
   */
  private begin(): Reply {
    if (this.reply && !this.reply.released) this.drop(this.reply)
    const reply: Reply = { id: ++this.replyCount, text: '', done: false, released: false, dropped: false, logged: false, seen: structuredClone(this.transcript), utteranceId: this.utteranceId }
    this.reply = reply
    // Nothing the user says can make it moot when they aren't mid-turn (a background task's result).
    if (!this.turnOpen) this.release(reply)
    return reply
  }

  private stream(reply: Reply, delta: string): void {
    if (reply.dropped || reply.done) return
    reply.text += delta
    if (reply.released && reply.text.trim()) this.events.speak?.(reply.id, reply.text, false)
  }

  /** All of what to say: '' for nothing. */
  private finish(reply: Reply, text: string): void {
    if (reply.dropped || reply.done) return
    reply.text = text.trim()
    reply.done = true
    if (!reply.text) return this.drop(reply, false)
    if (reply.released) this.tell(reply)
    else this.events.debug?.({ type: 'say', text: reply.text, result: 'held' })
  }

  /** The user's turn is over: say what there is so far, and the rest as it comes. */
  private release(reply: Reply): void {
    reply.released = true
    this.told = [...this.told.slice(-4), reply]
    if (reply.done) this.events.debug?.({ type: 'say', text: reply.text, result: 'said' })
    if (reply.text.trim()) this.tell(reply)
  }

  private tell(reply: Reply): void {
    this.events.speak?.(reply.id, reply.text, reply.done)
    if (reply.done && !reply.logged) this.logSaid(reply)
  }

  private logSaid(reply: Reply): void {
    reply.logged = true
    this.history.said(reply.id, reply.text, reply.final ?? reply.text)
    if (reply.done) this.events.said?.(reply.text)
  }

  /** Nothing more of it is said. If some of it may have been, the host stops it and reports what was heard. */
  private drop(reply: Reply, trace = true): void {
    if (reply.dropped || reply.logged) return
    reply.dropped = true
    if (trace && reply.text) this.events.debug?.({ type: 'say', text: reply.text, result: 'dropped' })
    if (reply.released && reply.text.trim()) this.events.hush?.(reply.id)
  }

  /** What Stanley was going to say once the user finished is moot once they say more. */
  private dropStale(): void {
    const reply = this.reply
    if (!reply || reply.released || reply.dropped) return
    if (reply.utteranceId === this.utteranceId && !hasNewWords(this.transcript, reply.seen)) return
    this.drop(reply)
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
    this.scheduleDelivery()
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

/** A web page: written, it is drawn on screen. */
const PAGE = /\.html?$/i

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** A tool output as the SDK sends it: plain JSON. */
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as JSONValue

/**
 * How `candidates` are ranked by what the user is asking (`focus`, and `before`, what they said
 * last before it; see options.ts): their meaning is scored only when it decides something, with
 * more than `limit` of them or ordered by relevance. The agent's ranking, and its evals'.
 */
export async function rankingFor(relevance: Relevance | undefined, config: AgentConfig['ranking'], focus: string, candidates: Candidate[], limit: number, before = ''): Promise<Ranking> {
  const { order, weights, clear } = config
  const decides = order === 'relevance' || candidates.length > limit
  if (!decides || !relevance) return { weights, order, clear }
  const texts = candidates.flatMap(candidateTexts)
  const deadline = relevance.deadline()
  const meaning = await relevance.score(focus, texts, wordMatches(focus, candidates).flatMap(candidateTexts), deadline)
  // A request leaning on what was asked before ("archive it") is about that: an element close to
  // it counts that much, discounted, when that is more than it has from the request itself. Only
  // closeness counts: a score below nothing's (negative) says nothing about what was meant.
  if (before.trim() && weights.before > 0 && meaning.size) {
    const earlier = await relevance.score(before, texts, [], deadline)
    for (const [t, m] of meaning) {
      const e = earlier.get(t)
      if (e !== undefined && e > 0 && weights.before * e > m) meaning.set(t, weights.before * e)
    }
  }
  return { meaning, weights, order, clear }
}

/** How many steps `find` gives thinking, and how long it waits for what isn't embedded yet. */
const FIND = 15
const FIND_WAIT_MS = 1500

/** How many of the user's turns the writer reads: enough for what goes in the step, few enough to answer at once. */
const WRITER_TURNS = 3

/**
 * What Jev reads ahead of the conversation: the prompt (with `extra` sections, and what the user
 * asked it to remember), how the screen works when Stanley lays it out (`layout`), and today, in
 * the order thinking's instructions have them. What the screen shows is in the conversation.
 */
export function jevPreamble(o: { name: string; today: Date; extra?: string[]; memory?: string; layout?: boolean }): string {
  const prompt = [SYSTEM_PROMPT, ...(o.extra ?? []), ...(o.memory?.trim() ? [jevMemory(o.memory)] : []), ...(o.layout ? [SCREEN_PROMPT] : [])].join('\n\n')
  return [named(prompt, o.name), `Today is ${longDate(o.today)}.`].join('\n\n')
}

/** How a task ended, for what the screen shows then (see `settleScreen`). */
interface ScreenEnd {
  tickId?: number
  /** The decision that finished it, and the screen questions it answered. */
  d?: MultiChoiceResult
  ask?: ScreenAsk | null
  /** Leave the screen as it is, and why. */
  keep?: string
}

/** P(finished) from Jev's `heard` answer, or null when the decision didn't include it. */
/** Whether one of the user's skills is for what they ask now. */
export const SKILL_INSTRUCTIONS = 'Is one of your skills for what the user is asking now? Which one?'

/** The `skill` question's options: each skill by when it is for, and none. */
function skillOptions(skills: Skill[]): Record<string, string> {
  return { none: 'None of your skills is for what the user is asking now.', ...Object.fromEntries(skills.map((s) => [s.name, s.description])) }
}

/** The skill Jev's `skill` answer chose and its probability, or null for none or no question. */
function skillOf(d: MultiChoiceResult, skills: Skill[]): { skill: Skill; p: number } | null {
  const answer = d.answers.skill
  const skill = answer && skills.find((s) => s.name === answer.choice)
  return skill ? { skill, p: answer.probabilities[skill.name] ?? answer.confidence } : null
}

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
  if (target.kind === 'arrange') return { kind: 'arrange' }
  if (target.kind === 'folder' || target.kind === 'file' || target.kind === 'skill') throw new Error('Files are looked at in the background, not opened')
  if (target.kind === 'search') throw new Error('Searches run in the background, not on the screen')
  if (target.kind === 'respond') throw new Error('Responding is thinking writing what to say, not a step on the screen')
  return { kind: target.kind }
}

/** One option per line, the name in brackets as the conversation writes elements. */
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
