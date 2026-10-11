import type { ActionArgs } from '@stanley/app-sdk'
import type { MultiChoiceResult, Question } from '@stanley/jev'
import type { TickOutcome } from './agent'
import type { EffectVerdict } from './effects'
import type { Confirmation, Writing } from './think'
import type { TranscriptSnapshot } from './transcript'

/** Why a tick was asked for. */
export type TickReason = 'words' | 'action' | 'end'

/** What `request()` did with a tick request. Everything but `tick` means no Jev call. */
export type RequestResult = 'tick' | 'deferred' | 'no-new-words' | 'halted' | 'nothing-to-re-ask'

export type GateRule = 'stale' | 'act-confidence' | 'done-confidence' | 'step-confidence' | 'mid-speech' | 'listen-ended' | 'oscillation' | 'step-cap'

/**
 * Structured trace of the loop, for the debug window. Carries everything needed
 * to explain (and replay) a decision, including requests that never became a tick.
 */
export type AgentDebugEvent =
  | { type: 'request'; reason: TickReason; result: RequestResult }
  | {
      type: 'tick-start'
      tickId: number
      reason: TickReason
      utteranceId: number
      transcript: TranscriptSnapshot
      utteranceEnded: boolean
      screenId: string
      /** Exact Jev input. */
      state: string
      questions: Record<string, Question>
    }
  | { type: 'decision'; tickId: number; result: MultiChoiceResult; stale: boolean; endedDuringCall: boolean }
  | { type: 'gate'; tickId: number; rule: GateRule; detail: string }
  /** What pressing a button does, judged before it runs. */
  | ({ type: 'effect'; tickId: number; option: string; latencyMs: number } & EffectVerdict)
  /** The turn went to thinking; `context` and `options` are its exact input. */
  | { type: 'think-start'; tickId: number; reason: string; context: string; options: string }
  | { type: 'think-step'; tickId: number; option: string; text?: string; result: string }
  | { type: 'think-end'; tickId: number; text: string; steps: number; latencyMs: number; aborted: boolean }
  /** Thinking decided whether to press a button that commits; `context` is its exact input. */
  | ({ type: 'confirm'; tickId: number; option: string; context: string; latencyMs: number; aborted: boolean } & Partial<Confirmation>)
  /** Thinking decided what goes in a field the fast part chose; `context` is its exact input. */
  | ({ type: 'write'; tickId: number; option: string; context: string; latencyMs: number; aborted: boolean } & Partial<Writing>)
  | {
      type: 'act'
      tickId: number
      option: string
      nodeId?: string
      args?: ActionArgs
      summary?: string
      observation?: string
      latencyMs: number
    }
  | { type: 'tick-end'; tickId: number; outcome: TickOutcome; effective: string; detail?: string }
