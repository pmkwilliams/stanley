export interface AgentConfig {
  /** Top choice below this confidence is treated as `wait`. */
  minConfidence: number
  /** Destructive actions need at least this confidence. */
  destructiveConfidence: number
  /** A navigation computed from a stale transcript still runs at or above this confidence. */
  staleNavConfidence: number
  maxActionsPerUtterance: number
  /** Force stop when the same option is chosen from the same screen `repeats` times in the last `window` steps. */
  oscillation: { repeats: number; window: number }
  maxNodes: number
}

export const defaultConfig: AgentConfig = {
  minConfidence: 0.3,
  destructiveConfidence: 0.6,
  staleNavConfidence: 0.8,
  maxActionsPerUtterance: 15,
  oscillation: { repeats: 3, window: 6 },
  maxNodes: 50,
}
