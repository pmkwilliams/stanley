export interface AgentConfig {
  /** Top choice below this confidence is treated as `wait`. */
  minConfidence: number
  /** P(destructive) + P(external) at or above this makes an action consequential (see consequence.ts). */
  consequential: number
  /** A consequential action runs only when P(the user explicitly asked for it) is at least this; otherwise it escalates. */
  explicitAsk: number
  /** A navigation computed from a stale transcript still runs at or above this confidence. */
  staleNavConfidence: number
  maxActionsPerUtterance: number
  /** Force stop when the same option is chosen from the same screen `repeats` times in the last `window` steps. */
  oscillation: { repeats: number; window: number }
  maxNodes: number
  /** The escalation model handles more context, so it sees more nodes. */
  escalationNodes: number
  /** Tool steps per escalation. */
  escalationSteps: number
}

export const defaultConfig: AgentConfig = {
  minConfidence: 0.3,
  consequential: 0.35,
  explicitAsk: 0.8,
  staleNavConfidence: 0.8,
  maxActionsPerUtterance: 15,
  oscillation: { repeats: 3, window: 6 },
  maxNodes: 50,
  escalationNodes: 150,
  escalationSteps: 10,
}
