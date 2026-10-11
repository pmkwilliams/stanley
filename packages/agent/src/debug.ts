import type { ActionArgs } from '@stanley/app-sdk'
import type { ChoiceResult } from '@stanley/jev'
import type { TickOutcome } from './agent'
import type { ConsequenceVerdict } from './consequence'
import type { TranscriptSnapshot } from './transcript'

/** Why a tick was asked for. */
export type TickReason = 'words' | 'action' | 'end'

/** What `request()` did with a tick request. Everything but `tick` means no Jev call. */
export type RequestResult = 'tick' | 'deferred' | 'no-new-words' | 'halted' | 'nothing-to-re-ask'

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
      currentNodeId: string
      /** Exact Jev input. */
      state: string
      instructions: string
      options: Record<string, string | null>
    }
  | { type: 'decision'; tickId: number; result: ChoiceResult; stale: boolean; endedDuringCall: boolean }
  | { type: 'gate'; tickId: number; rule: 'stale' | 'min-confidence' | 'consequence' | 'mid-speech' | 'no-value' | 'oscillation' | 'step-cap'; detail: string }
  /** The consequence check on an action, chosen by Jev or by the escalation model. */
  | ({ type: 'check'; tickId: number; option: string; latencyMs: number } & ConsequenceVerdict)
  /** Jev handed the turn to the escalation model; `context` and `options` are its exact input. */
  | { type: 'escalate'; tickId: number; reason: string; context: string; options: string }
  /** One `act` call by the escalation model. `blocked` when the consequence check refused it. */
  | { type: 'escalation-step'; tickId: number; option: string; text?: string; result: string; blocked?: boolean }
  | { type: 'escalation-end'; tickId: number; text: string; steps: number; latencyMs: number; aborted: boolean }
  | { type: 'fill'; tickId: number; option: string; instructions: string; context: string; text: string; latencyMs: number }
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
