import type { ActionArgs } from '@stanley/app-sdk'
import type { MultiChoiceResult, Question } from '@stanley/jev'
import type { TickOutcome } from './agent'
import type { EffectVerdict } from './effects'
import type { Confirmation, Writing } from './think'
import type { TranscriptSnapshot } from './transcript'

/** Why a tick was asked for. */
export type TickReason = 'words' | 'action' | 'end' | 'pause'

/** What `request()` did with a tick request. Everything but `tick` means no Jev call. */
export type RequestResult = 'tick' | 'deferred' | 'no-new-words' | 'halted' | 'nothing-to-re-ask' | 'held' | 'released'

export type GateRule = 'stale' | 'act-confidence' | 'done-confidence' | 'step-confidence' | 'mid-speech' | 'thought-open' | 'turn-open' | 'early-guess' | 'unsure-words' | 'listen-ended' | 'oscillation' | 'step-cap'

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
  /**
   * The voice paused: Smart Turn's P(turn complete) (null without it), Jev's latest P(finished
   * saying what's needed) for these words (null if it hasn't seen them), and when the utterance
   * will end if the user stays quiet.
   */
  | { type: 'turn'; voice: number | null; heard: number | null; endInMs: number }
  /** The agent ended the utterance itself, before the silence backstop. */
  | { type: 'turn-end'; afterPauseMs: number }
  /** The user spoke again soon after the agent ended their turn: the same utterance goes on. */
  | { type: 'turn-resumed'; afterEndMs: number }
  /** Something to say was held until the user finished, then said or dropped. */
  | { type: 'say'; text: string; result: 'held' | 'said' | 'dropped' }
