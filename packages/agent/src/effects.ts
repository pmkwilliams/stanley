import type { AgentNode } from '@stanley/app-sdk'
import type { DecisionClient } from '@stanley/jev'

/** What pressing a button does to the world, judged from its name, its context and the screen. */
export type Effect = 'looks' | 'changes' | 'commits'

export const EFFECTS: Record<Effect, string> = {
  looks: 'Only shows, opens, fetches, searches, plays or moves around, including opening a form, menu or editor to fill in. Nothing is saved or sent.',
  changes: "Changes the user's own things in a way that is easy to undo: marks, adds, moves, saves, or changes a setting.",
  commits:
    'Reaches other people or the outside world, or is hard to undo: sends, posts, pays, buys, books, shares, submits, archives or deletes.',
}

export interface EffectVerdict {
  effect: Effect
  probabilities: Record<string, number>
  /** Came from the cache, so no call was made. */
  cached: boolean
}

export interface EffectJudge {
  judge(req: { option: string; node: AgentNode; screen: string; appId: string; signal?: AbortSignal }): Promise<EffectVerdict>
}

/**
 * Asks Jev what a button does, once per app and label: a button's effect doesn't change, and the
 * conversation doesn't matter to it, so only the screen is sent. Real apps and pages don't label
 * their buttons; an app's `destructive` hint, where one exists, counts as `commits`.
 */
export function createEffectJudge(jev: DecisionClient, commits = 0.3): EffectJudge {
  const cache = new Map<string, Record<string, number>>()
  return {
    async judge({ option, node, screen, appId, signal }) {
      if (node.destructive) return { effect: 'commits', probabilities: { commits: 1 }, cached: true }
      const key = `${appId}\n${option}`
      const hit = cache.get(key)
      const probabilities =
        hit ??
        (
          await jev.choose({
            state: screen,
            instructions: `What does pressing [${option}] on this screen do?`,
            options: EFFECTS,
            signal,
          })
        ).probabilities
      if (!hit) cache.set(key, probabilities)
      // Unsure between changing and committing counts as committing: the cost of asking is a question.
      const effect: Effect = (probabilities.commits ?? 0) >= commits ? 'commits' : (probabilities.changes ?? 0) >= (probabilities.looks ?? 0) ? 'changes' : 'looks'
      return { effect, probabilities, cached: !!hit }
    },
  }
}

export function describeEffect(effect: Effect): string {
  return effect === 'commits' ? 'sends, deletes or otherwise commits something' : effect === 'changes' ? "changes the user's data" : 'only looks'
}
