import type { AgentConfig, AgentDebugEvent, AgentStatus, LogEntry } from '@stanley/agent'
import type { ActionArgs, Layout } from '@stanley/app-sdk'
import type { DecideRequest, MultiChoiceResult } from '@stanley/jev'
import type { SttDebugEvent } from '@stanley/stt'

export interface Snapshot {
  layout: Layout
  /** appId → state, for every open surface. */
  surfaces: Record<string, unknown>
  /** Surface the agent is working on (may be hidden). */
  focus: string | null
  apps: { id: string; title: string; description: string }[]
  listening: boolean
  /** The VAD hears speech right now. */
  speaking: boolean
  /** An utterance is in progress: speech started and neither the toggle nor ~2 s of silence has ended it. */
  utteranceOpen: boolean
  transcript: { finalized: string[]; partial: string }
  status: AgentStatus
  /** What Stanley last said to the user (spoken later); null once the user has answered. */
  said: { text: string; at: number } | null
  stt: 'ready' | 'loading' | 'missing-models' | 'error'
  mock: boolean
  /** Registered push-to-talk accelerator, or null if none could be registered. */
  ptt: string | null
}

export type AppDebugEvent =
  | { type: 'session-start'; session: string; config: AgentConfig; systemPrompt: string; mock: boolean }
  | { type: 'listening'; on: boolean; via: 'ptt' | 'button' | 'silence' | 'typed' }
  | { type: 'status'; status: AgentStatus }
  | { type: 'typed'; text: string }
  | { type: 'manual'; option: string; summary: string }
  | { type: 'stt-state'; stt: Snapshot['stt']; error?: string }

/** One line of a session's debug JSONL, and one message to the debug window. */
export type DebugEvent = { seq: number; at: number } & (
  | { source: 'agent'; event: AgentDebugEvent }
  | { source: 'stt'; event: SttDebugEvent }
  /** The agent's message log, as the agent believes things happened. */
  | { source: 'log'; event: LogEntry }
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
  toggleListening(): void
  perform(appId: string, nodeId: string, args?: ActionArgs): void
  open(appId: string | null): void
  /** Dev fallback: send a typed utterance as if spoken. */
  say(text: string): void
  debug: DebugApi
}
