import type { ActionArgs } from '@stanley/app-sdk'
import type { MultiChoiceResult, Question } from '@stanley/jev'
import type { TickOutcome } from './agent'
import type { TaskMeta } from './conversation'
import type { EffectVerdict } from './effects'
import type { UnrunCall } from './think'
import type { TranscriptSnapshot } from './transcript'

/** Tokens a thinking turn used, all its steps together. */
export interface ThinkUsage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  /** The last step's input: the largest the turn sent. */
  lastInputTokens?: number
}

/** Why a tick was asked for. */
export type TickReason = 'words' | 'action' | 'end' | 'pause'

/** What `request()` did with a tick request. Everything but `tick` means no Jev call. */
export type RequestResult = 'tick' | 'deferred' | 'no-new-words' | 'halted' | 'nothing-to-re-ask' | 'held' | 'released'

export type GateRule = 'stale' | 'act-confidence' | 'done-confidence' | 'step-confidence' | 'mid-speech' | 'thought-open' | 'turn-open' | 'early-guess' | 'unsure-words' | 'listen-ended' | 'oscillation' | 'step-cap' | 'ran-calls' | 'only-navigated' | 'skill' | 'consent'

/**
 * Structured trace of the loop, for the debug window. Carries everything needed
 * to explain (and replay) a decision, including requests that never became a tick.
 */
export type AgentDebugEvent =
  | { type: 'request'; reason: TickReason; result: RequestResult }
  | {
      type: 'tick-start'
      tickId: number
      /** `task`: no decision, a thinking turn telling the user what background tasks found or made. */
      reason: TickReason | 'task'
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
  /** Jev's answer to whether the user asked for what pressing a button that commits does, before it runs. */
  | { type: 'consent'; tickId: number; option: string; probabilities: Record<string, number>; latencyMs: number }
  /** What pressing a button does, judged before it runs. */
  | ({ type: 'effect'; tickId: number; option: string; latencyMs: number } & EffectVerdict)
  /**
   * The turn went to thinking. `run` is a turn with tools; `write` decides one step Jev chose
   * (`option`), as `confirm` did in older sessions. Its exact input is the first `entries` of the history (the history is
   * append-only), after the session's instructions. `handover` is why, for the debug window only.
   */
  | { type: 'think-start'; tickId: number; mode: 'run' | 'write' | 'confirm'; handover: string; option?: string; entries: number; cacheAt?: number }
  | { type: 'think-step'; tickId: number; option: string; text?: string; result: string }
  | { type: 'think-end'; tickId: number; text: string; steps: number; latencyMs: number; aborted: boolean; calls?: UnrunCall[]; usage?: ThinkUsage }
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
  /** The user cut in on reply `id`, or it was stopped: they heard only `spoken` of `text`. */
  | { type: 'cut'; id: number; spoken: string; text: string }
  /**
   * Words said while a thinking turn worked (`heard`), and what came of them: Jev judged them, and
   * the turn stopped for them or finishes first.
   */
  | {
      type: 'working'
      action: 'judged' | 'stop' | 'hold'
      heard: string
      verdict?: { choice: string; probabilities: Record<string, number>; latencyMs: number }
      reason?: string
    }
  /**
   * Speech heard while Stanley was talking (`heard`, its own echo taken out), and what came of it:
   * Stanley lowered its voice, Jev judged the words, Stanley stopped for them, or went on.
   */
  | {
      type: 'overlap'
      action: 'duck' | 'judged' | 'cut' | 'go-on'
      heard: string
      /** Words taken out as Stanley's own voice picked up by the mic. */
      echo?: string
      verdict?: { choice: string; probabilities: Record<string, number>; latencyMs: number }
      reason?: string
    }
  /**
   * A background task (see background.ts): started with its brief (`text`), a tool step it took,
   * what thinking sent it as it worked (`steer`), how it ended (`text` is its result), stopped, or its result told to the user once they and
   * Stanley were quiet (`deliver`).
   */
  | { type: 'task'; action: 'start' | 'step' | 'steer' | 'end' | 'cancel' | 'deliver'; taskId: string; title: string; text?: string; tool?: string; result?: string; state?: TaskMeta['state']; tickId?: number }
