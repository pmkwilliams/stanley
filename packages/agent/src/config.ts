export interface AgentConfig {
  /** While the user is speaking, `act` needs at least this confidence; below it Stanley listens. */
  speakingAct: number
  /**
   * While the user is speaking, going somewhere (a navigation, or a button that only looks) needs
   * this P(act), when the step is at least `step` and Jev's P(heard what it needs) at least `heard`.
   */
  speakingNav: { act: number; step: number; heard: number }
  /** While the user is speaking, a press that changes something undoable needs at least this P(act). */
  speakingChange: number
  /** After they finish, `act` needs at least this confidence; below it thinking takes the turn. */
  act: number
  /** After the user finishes, `done` needs at least this confidence; below it thinking checks what's left. */
  done: number
  /** The chosen step needs at least this confidence; below it Stanley listens (mid-speech) or thinks. */
  stepConfidence: number
  /** After a press made before the user finished, `done` at or above this closes the task without thinking checking it. */
  earlyGuessDone: number
  /** `think` with a field step at least this sure is handled as writing that field (one call, not a tool loop). */
  writeStep: number
  /** A skill step at least this sure is read whatever Jev says comes next, except `done`: reading only looks. */
  skillStep: number
  /** Judge each kind of button on a screen in the background when it first appears. */
  warmEffects: boolean
  /** P(commits) at or above this makes a button go to thinking: unsure counts as committing. */
  commits: number
  /** A navigation decided from a stale transcript still runs at or above this step confidence. */
  staleNavConfidence: number
  maxStepsPerUtterance: number
  /** Stop when the same step is chosen from the same screen `repeats` times in the last `window` steps. */
  oscillation: { repeats: number; window: number }
  /** Elements and known web pages offered to Jev per tick. Apps, back and home come on top. */
  maxElements: number
  /** Elements offered to thinking: it handles more context. It opens pages by address instead. */
  thinkingElements: number
  /** Tool steps per thinking turn. */
  thinkingSteps: number
  /** User turns Jev reads, the most recent ones: its input is re-read on every tick. */
  jevTurns: number
  /**
   * When the user has finished a thought (see `Agent.thoughtDone`): Jev's P(they finished saying
   * what the next part needs) must reach `heard`, and Smart Turn's P(their voice finished the
   * turn) must reach `voice`. Without Smart Turn, `heardAlone` stands in for both.
   */
  finished: { heard: number; voice: number; heardAlone: number }
  /**
   * How long after the voice pauses the utterance ends: `fastMs` when words and voice both say
   * finished, `slowMs` when either says more is coming, `normalMs` otherwise. The transcriber's
   * silence backstop ends it regardless. Speech within `resumeMs` of an end the agent chose is the
   * same thought resumed, not a new utterance.
   */
  endpoint: { fastMs: number; normalMs: number; slowMs: number; moreBelow: number; resumeMs: number }
  /** A word speech recognition gave less confidence than this is marked `(?)` for the models. */
  unsureWord: number
  /** Words said while a thinking turn works stop it at this P(stop) (see `WORKING`); below it, the turn finishes first. */
  working: { stop: number }
}

export const defaultConfig: AgentConfig = {
  speakingAct: 0.6,
  speakingChange: 0.6,
  speakingNav: { act: 0.4, step: 0.7, heard: 0.5 },
  act: 0.4,
  done: 0.5,
  earlyGuessDone: 0.8,
  stepConfidence: 0.4,
  writeStep: 0.9,
  skillStep: 0.9,
  warmEffects: true,
  commits: 0.3,
  staleNavConfidence: 0.8,
  maxStepsPerUtterance: 15,
  oscillation: { repeats: 3, window: 6 },
  maxElements: 150,
  thinkingElements: 300,
  thinkingSteps: 10,
  jevTurns: 50,
  finished: { heard: 0.6, voice: 0.5, heardAlone: 0.85 },
  endpoint: { fastMs: 250, normalMs: 1000, slowMs: 2600, moreBelow: 0.25, resumeMs: 2000 },
  unsureWord: 0.5,
  working: { stop: 0.5 },
}
