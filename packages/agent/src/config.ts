export interface AgentConfig {
  /** While the user is speaking, `act` needs at least this confidence; below it Stanley listens. */
  speakingAct: number
  /** After they finish, `act` needs at least this confidence; below it thinking takes the turn. */
  act: number
  /** After the user finishes, `done` needs at least this confidence; below it thinking checks what's left. */
  done: number
  /** The chosen step needs at least this confidence; below it Stanley listens (mid-speech) or thinks. */
  stepConfidence: number
  /** `think` with a field step at least this sure is handled as writing that field (one call, not a tool loop). */
  writeStep: number
  /** P(commits) at or above this makes a button go to thinking: unsure counts as committing. */
  commits: number
  /** A navigation decided from a stale transcript still runs at or above this step confidence. */
  staleNavConfidence: number
  maxStepsPerUtterance: number
  /** Stop when the same step is chosen from the same screen `repeats` times in the last `window` steps. */
  oscillation: { repeats: number; window: number }
  /** Elements offered to Jev per tick. */
  maxElements: number
  /** Thinking handles more context, so it sees more elements. */
  thinkingElements: number
  /** Tool steps per thinking turn. */
  thinkingSteps: number
}

export const defaultConfig: AgentConfig = {
  speakingAct: 0.6,
  act: 0.4,
  done: 0.5,
  stepConfidence: 0.4,
  writeStep: 0.9,
  commits: 0.3,
  staleNavConfidence: 0.8,
  maxStepsPerUtterance: 15,
  oscillation: { repeats: 3, window: 6 },
  maxElements: 50,
  thinkingElements: 150,
  thinkingSteps: 10,
}
