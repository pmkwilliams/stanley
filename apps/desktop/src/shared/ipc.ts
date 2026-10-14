import type { AgentConfig, AgentDebugEvent, AgentStatus, HistoryRecord } from '@stanley/agent'
import type { ActionArgs, Layout } from '@stanley/app-sdk'
import type { Theme } from '@stanley/app-settings/core'
import type { DecideRequest, MultiChoiceResult } from '@stanley/jev'
import type { SttDebugEvent } from '@stanley/stt'
import type { Piece, TtsDebugEvent } from '@stanley/tts'

/** A word as heard: `unsure` when speech recognition gave it low confidence. */
export interface CaptionWord {
  word: string
  unsure: boolean
}

export interface Snapshot {
  layout: Layout
  /** appId → state, for every open surface. */
  surfaces: Record<string, unknown>
  /** Surface the agent is working on (may be hidden). */
  focus: string | null
  apps: { id: string; title: string; description: string }[]
  /** The lock screen is up: the mic is off and can't be turned on. */
  locked: boolean
  listening: boolean
  /** The VAD hears speech right now. */
  speaking: boolean
  /** An utterance is in progress: speech started and neither the toggle nor ~2 s of silence has ended it. */
  utteranceOpen: boolean
  transcript: {
    finalized: string[]
    partial: string
    /** The words of each of `finalized` and of `partial` as heard, for showing unsure ones; absent for typed text. */
    words?: { finalized: (CaptionWord[] | undefined)[]; partial?: CaptionWord[] }
  }
  status: AgentStatus
  /** What Stanley last said to the user, as far as it has been written; null once the user has answered. */
  said: { text: string; at: number } | null
  /** Stanley is talking: from its first words until its last, pauses included. */
  talking: boolean
  /** Stanley lowered its voice: the user may be cutting in. */
  ducked: boolean
  /** Background tasks working now (see `delegate`): the status bar shows one is while any is. */
  tasks: { id: string; title: string }[]
  stt: 'ready' | 'loading' | 'missing-models' | 'error'
  /** Stanley's voice. Without it, what it says is only shown. */
  tts: 'ready' | 'loading' | 'missing-models' | 'error'
  mock: boolean
  /** Registered push-to-talk accelerator, or null if none could be registered. */
  ptt: string | null
  /** Set in the Settings app. */
  theme: Theme
  /** What the user calls the assistant, set in the Settings app. */
  name: string
}

export type AppDebugEvent =
  /** `systemPrompt` is Jev's; `instructions` thinking's, fixed for the session (absent in older sessions). */
  | { type: 'session-start'; session: string; config: AgentConfig; systemPrompt: string; instructions?: string; mock: boolean }
  | { type: 'listening'; on: boolean; via: 'ptt' | 'button' | 'silence' | 'typed' | 'lock' | 'unlock' }
  | { type: 'status'; status: AgentStatus }
  | { type: 'typed'; text: string }
  | { type: 'manual'; option: string; summary: string }
  | { type: 'stt-state'; stt: Snapshot['stt']; error?: string }
  | { type: 'tts-state'; tts: Snapshot['tts']; error?: string }

/** An entry of the message log older sessions recorded. */
export type LegacyLogEntry = { role: string; at: number; [key: string]: unknown }

/** One line of a session's debug JSONL, and one message to the debug window. */
export type DebugEvent = { seq: number; at: number } & (
  | { source: 'agent'; event: AgentDebugEvent }
  | { source: 'stt'; event: SttDebugEvent }
  | { source: 'tts'; event: TtsDebugEvent }
  /** The history thinking reads, as it changes. */
  | { source: 'history'; event: HistoryRecord }
  /** Older sessions: the agent's message log, before the history. Shown, never replayed. */
  | { source: 'log'; event: LegacyLogEntry }
  | { source: 'app'; event: AppDebugEvent }
)

export interface DebugSession {
  /** File name under userData/sessions. */
  file: string
  current: boolean
  bytes: number
  modified: number
}

export type ReplayRequest = Omit<DecideRequest, 'signal'>

export interface DebugApi {
  onEvent(cb: (e: DebugEvent) => void): () => void
  /** Events of the running session so far. */
  history(): Promise<DebugEvent[]>
  sessions(): Promise<DebugSession[]>
  load(file: string): Promise<DebugEvent[]>
  /** Re-run a decision against the live Jev client (mock when offline). */
  replay(req: ReplayRequest): Promise<MultiChoiceResult>
  copy(text: string): void
}

/**
 * Callbacks passed to `on…` cross the context bridge, which clones their return value.
 * Return nothing: an expression body like `(s) => (state = s)` returns a Svelte proxy, which can't be cloned.
 */
export interface StanleyApi {
  onSnapshot(cb: (s: Snapshot) => void): () => void
  onListening(cb: (listening: boolean) => void): () => void
  audio(chunk: Float32Array): void
  /** Stanley's voice: a piece of audio to play after the ones before it. */
  onSpeech(cb: (piece: Piece) => void): () => void
  /** Stop playing a reply now. */
  onSpeechStop(cb: (reply: number) => void): () => void
  /** Play Stanley's voice at this fraction of full volume. */
  onSpeechVolume(cb: (level: number) => void): () => void
  /** The player started or finished a piece. */
  speechStarted(reply: number, seq: number): void
  speechEnded(reply: number, seq: number): void
  toggleListening(): void
  /** Ends the session: Stanley stops, forgets the conversation, and every app starts over. The mic is off until unlocked. */
  lock(): void
  /** Goes to the home screen and turns the mic on. */
  unlock(): void
  perform(appId: string, nodeId: string, args?: ActionArgs): void
  open(appId: string | null): void
  /** Dev fallback: send a typed utterance as if spoken. */
  say(text: string): void
  /** The theme as the window opened, so its first frame has it; after that, the snapshot's. */
  initialTheme: Theme
  debug: DebugApi
}
