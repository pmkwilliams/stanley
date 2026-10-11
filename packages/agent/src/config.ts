export interface AgentConfig {
  /** Once the user has finished speaking, a top choice below this confidence is treated as `wait`. */
  minConfidence: number
  /** The same gate while the user is still speaking: a guess must be surer, since waiting costs only a moment. */
  speakingConfidence: number
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
  minConfidence: 0.4,
  speakingConfidence: 0.6,
  destructiveConfidence: 0.8,
  staleNavConfidence: 0.8,
  maxActionsPerUtterance: 15,
  oscillation: { repeats: 3, window: 6 },
  maxNodes: 50,
}
