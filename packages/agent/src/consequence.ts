import type { AgentNode } from '@stanley/app-sdk'
import type { DecisionClient } from '@stanley/jev'

/** What an action does to the world, judged by the agent from its label and the screen. */
export type Effect = 'none' | 'local' | 'destructive' | 'external'

export const EFFECTS: Record<Effect, string> = {
  none: 'Only looks at or fetches things: opens, shows, searches, looks up, loads, reads, plays or moves around. Nothing is changed or sent.',
  local:
    "Changes the user's own data on this device in a way that is easy to undo: types into a field, marks something read or done, adds an item, saves a draft.",
  destructive: 'Deletes, removes, archives or overwrites something, or is otherwise hard to undo.',
  external:
    'Commits something to other people or the outside world: sends a message, posts, publishes, pays, buys, books, shares, invites, or submits a form to someone. Looking things up does not count.',
}

export interface ConsequenceVerdict {
  effect: Effect
  /** Probability per effect. */
  effects: Record<string, number>
  /** Deletes or reaches outside, so it needs the user's explicit say-so. */
  consequential: boolean
  /** P(the user explicitly asked for exactly this). Only asked when consequential. */
  asked?: number
  allowed: boolean
  /** The effect came from the cache. */
  cached: boolean
}

export interface ConsequenceCheck {
  check(req: { state: string; option: string; description: string | null; node: AgentNode; signal?: AbortSignal }): Promise<ConsequenceVerdict>
}

export interface ConsequenceThresholds {
  /** P(destructive) + P(external) at or above this makes an action consequential: unsure counts as consequential. */
  consequential: number
  /** A consequential action runs only when P(the user explicitly asked for it) is at least this. */
  explicitAsk: number
}

/**
 * Judges consequences with two narrow Jev questions instead of trusting apps to label actions:
 * what would this do (cached per action, since a button's effect doesn't change), and, only for
 * consequential ones, did the user explicitly ask for it. Confidence in the choice is not consent.
 */
export function createConsequenceCheck(jev: DecisionClient, thresholds: ConsequenceThresholds): ConsequenceCheck {
  const cache = new Map<string, Record<string, number>>()
  return {
    async check({ state, option, description, node, signal }) {
      const key = `${node.id}\n${node.label}`
      const hit = cache.get(key)
      const effects =
        hit ??
        (
          await jev.choose({
            state,
            instructions: `What would choosing "${option}"${description ? ` (${description})` : ''} do?`,
            options: EFFECTS,
            signal,
          })
        ).probabilities
      if (!hit) cache.set(key, effects)
      const effect = (Object.entries(effects).sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'external') as Effect
      const risk = (effects.destructive ?? 0) + (effects.external ?? 0)
      const consequential = !!node.destructive || risk >= thresholds.consequential
      if (!consequential) return { effect, effects, consequential, allowed: true, cached: !!hit }

      const { probabilities } = await jev.choose({
        state,
        instructions: `Has the user explicitly asked, in their own words, for this to happen: "${option}"${description ? ` (${description})` : ''}?`,
        options: {
          yes: 'Yes: the user clearly asked for exactly this, for example they said to send, delete, archive or buy it.',
          no: 'No: the user did not clearly ask for this. Doing it would be a guess, an assumption, or a next step they have not asked for.',
        },
        signal,
      })
      const asked = probabilities.yes ?? 0
      return { effect, effects, consequential, asked, allowed: asked >= thresholds.explicitAsk, cached: !!hit }
    },
  }
}

/** Plain-language reason for the escalation prompt and the debug window. */
export function describeEffect(effect: Effect): string {
  if (effect === 'external') return 'reaches other people or the outside world'
  if (effect === 'destructive') return 'deletes or overwrites something'
  return 'changes data'
}
