export interface AgentConfig {
  /** While the user is speaking, `act` needs at least this confidence; below it Stanley listens. */
  speakingAct: number
  /**
   * While the user is speaking, going somewhere (an app, a link, a page, back or home) needs
   * this P(act), when the step is at least `step` and Jev's P(heard what it needs) at least `heard`.
   */
  speakingNav: { act: number; step: number; heard: number }
  /** While the user is speaking, a press that changes something undoable needs at least this P(act). */
  speakingChange: number
  /** While the user is speaking, a press needs its step at least this sure, whatever the button does; below it Stanley listens. */
  speakingPress: number
  /** After they finish, `act` needs at least this confidence; below it thinking takes the turn. */
  act: number
  /** After the user finishes, `done` needs at least this confidence; below it thinking checks what's left. */
  done: number
  /** The chosen step needs at least this confidence; below it Stanley listens (mid-speech) or thinks. */
  stepConfidence: number
  /** After a press made before the user finished, `done` at or above this closes the task without thinking checking it. */
  earlyGuessDone: number
  /** Jev's P(a skill is for what the user asks) at least this, and it is read whatever comes next, except `done`: reading only looks. */
  skillRead: number
  /** A press Jev chose to `submit` runs when its P(the user asked for what it does) reaches this; below it, thinking takes the turn. */
  consent: number
  /**
   * What the screen shows (see screen.ts). Jev's likeliest arrangement is made unless its `show`
   * answer is under `show`, when the screen stays as it is: Jev's best guess beat showing the app
   * Stanley worked on alone (eval:layout). Apps already on the screen keep their sides when its
   * `left` answer is under `left`.
   */
  screen: { show: number; left: number }
  /** A navigation decided from a stale transcript still runs at or above this step confidence. */
  staleNavConfidence: number
  maxStepsPerUtterance: number
  /** Stop when the same step is chosen from the same screen `repeats` times in the last `window` steps. */
  oscillation: { repeats: number; window: number }
  /** Elements and known web pages offered to Jev per tick. Apps, back and home come on top. */
  maxElements: number
  /** Elements offered to thinking: it handles more context. It opens pages by address instead. */
  thinkingElements: number
  /**
   * How near the top of the options thinking last read of an app something that clearly matches
   * what the user asks must be for them to stand: further down, they are sent again in the new
   * order. Otherwise a new order alone sends nothing.
   */
  thinkingTop: number
  /**
   * Which elements are offered when there are more than fit, out of every open app's, and in what
   * order (see options.ts `rank`): relevance to what the user is asking, by meaning (relevance.ts)
   * and by their words, with the app Stanley works on ahead of others on the screen, and those
   * ahead of apps in the background. `order`: as the screens list them, or the most relevant first.
   * `clear`: the similarity in meaning at which an element clearly matches what the user asks
   * (see `thinkingTop`).
   */
  ranking: { order: 'screen' | 'relevance'; clear: number; weights: { meaning: number; own: number; before: number; word: number; tier: { focused: number; visible: number; background: number }; near: number } }
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
  /**
   * Background tasks (see background.ts): how many work at once, the tool steps each takes at most,
   * and how long things must be quiet before one's result is told.
   */
  background: { max: number; steps: number; quietMs: number }
  /**
   * Answering from the page with Jev alone (see answer.ts). `options`: passages per Jev call, cut
   * no finer than `minWords` (with `clauses`, a short page into clauses), with at most `chars` of them per call (more goes in parallel calls);
   * a page with more blocks is ranked coarse first, then its top
   * `regions` passages finely. Passages within `keep` × the top one (and at least `floor`) form
   * runs. It speaks when P(not here) is under `notHere`, the answer's mass reaches `speak`, and
   * what it would say is at most `maxWords`. Before speaking, Jev's P(the passage, heard alone,
   * tells the user what they asked) must reach `answers`, and P(it describes the time they asked
   * about) must reach `when`. Both sit where no wrong answer in the eval gets through: declining
   * only hands the turn to thinking, and a wrong answer is said out loud. An answer that is one
   * table row is said as the value of the cell Jev picks, at `cell` or more; less, and it declines. Up to `compare` runners-up are checked for giving the
   * same answer: always one with `agree` × the top run's mass (a rival), all when the top run is
   * short of `speak`. Those that agree add their mass; a rival that doesn't makes it decline.
   */
  answer: { options: number; chars: number; minWords: number; clauses: boolean; regions: number; keep: number; floor: number; notHere: number; speak: number; answers: number; when: number; cell: number; agree: number; compare: number; maxWords: number }
}

export const defaultConfig: AgentConfig = {
  speakingAct: 0.6,
  speakingChange: 0.6,
  speakingPress: 0.7,
  speakingNav: { act: 0.4, step: 0.7, heard: 0.5 },
  act: 0.4,
  done: 0.5,
  earlyGuessDone: 0.8,
  stepConfidence: 0.4,
  skillRead: 0.5,
  consent: 0.8,
  screen: { show: 0.3, left: 0.4 },
  staleNavConfidence: 0.8,
  maxStepsPerUtterance: 15,
  oscillation: { repeats: 3, window: 6 },
  maxElements: 150,
  thinkingElements: 300,
  thinkingTop: 20,
  // From 412 of Jev's steps in the app's sessions, scored by bge-base against what the user had
  // said (as `Relevance.score` does: closer to it than to a request for nothing; an element in an
  // item by the item's and its own, as `candidateTexts`): 1% of the steps not taken reach 0.17, so
  // a list of 300 has about three that do by chance; lower, a long list
  // would be sent again on nearly every new order. (The step taken reached it a fifth of the time:
  // meaning alone separates them weakly, so words count too.) Set again for another model.
  ranking: { order: 'relevance', clear: 0.17, weights: { meaning: 1, own: 0.25, before: 0.5, word: 0.1, tier: { focused: 0.06, visible: 0.03, background: 0 }, near: 0.02 } },
  thinkingSteps: 10,
  jevTurns: 50,
  finished: { heard: 0.6, voice: 0.5, heardAlone: 0.85 },
  endpoint: { fastMs: 250, normalMs: 1000, slowMs: 2600, moreBelow: 0.25, resumeMs: 2000 },
  unsureWord: 0.5,
  working: { stop: 0.5 },
  background: { max: 3, steps: 40, quietMs: 400 },
  answer: { options: 150, chars: 60_000, minWords: 4, clauses: true, regions: 3, keep: 0.3, floor: 0.02, notHere: 0.4, speak: 0.6, answers: 0.2, when: 0.15, cell: 0.7, agree: 0.5, compare: 3, maxWords: 45 },
}

/** How the agent is tuned for a decision model: config over `defaultConfig`, and lines added to what it is asked. */
export interface DeciderProfile {
  config: AgentConfig
  /** Added to the decision model's questions: what to do now (`next`) and which step (`step`). */
  notes?: { next?: string; step?: string }
}

/**
 * Jev's is the default, which the prompts and thresholds were fitted to. SubQ Snap spreads its
 * confidence wider (a skill it means to read is often under 0.5), and weighs a question's own
 * instructions over the shared prompt.
 */
export function deciderProfile(decider = 'jev'): DeciderProfile {
  if (decider !== 'subq') return { config: defaultConfig }
  return {
    config: { ...defaultConfig, skillRead: 0.4 },
    notes: {
      next: 'An email or message about a web page is not that page: when the user asks to go to a page or a site, it is done only once that page itself is open.',
      step: 'When the user gives the exact words to type ("saying …"), the step is the field they go in.',
    },
  }
}
