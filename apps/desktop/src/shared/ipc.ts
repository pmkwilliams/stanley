import type { AgentStatus, TickReport } from '@stanley/agent'
import type { ActionArgs, Layout } from '@stanley/app-sdk'

export interface Snapshot {
  layout: Layout
  /** appId → state, for every open surface. */
  surfaces: Record<string, unknown>
  /** Surface the agent is working on (may be hidden). */
  focus: string | null
  apps: { id: string; title: string; description: string }[]
  listening: boolean
  transcript: { finalized: string[]; partial: string }
  status: AgentStatus
  stt: 'ready' | 'loading' | 'missing-models' | 'error'
  mock: boolean
  /** Registered push-to-talk accelerator, or null if none could be registered. */
  ptt: string | null
}

export interface StanleyApi {
  onSnapshot(cb: (s: Snapshot) => void): () => void
  onTick(cb: (t: TickReport) => void): () => void
  onListening(cb: (listening: boolean) => void): () => void
  audio(chunk: Float32Array): void
  toggleListening(): void
  perform(appId: string, nodeId: string, args?: ActionArgs): void
  open(appId: string | null): void
  /** Dev fallback: send a typed utterance as if spoken. */
  say(text: string): void
}
