# One Stanley: one persona, one decision about the next move

Plan for making every model that takes Stanley's turns read as the same agent, and for replacing
the routing around field text (Jev's "whose words" question, thinking's single-step write) with
one decision Jev already makes: what kind of move comes next.

Status: proposed. Part of it is already in the working tree (see **Done so far**).

## The principle

Stanley is one agent with several models, each taking the turns it is good at. For every model:

1. It is addressed as Stanley, in the second person, never as a helper working for Stanley.
2. It reads Stanley's own words for who it is and how it acts (`persona.ts`), then only how it
   takes its turn: Jev answers questions, the writer writes a step's text, thinking uses tools.
3. It reads the same history: the same rendering, or a recent part of it, never a different view.
4. What it does goes into the history as Stanley's own, and no model is told which model did it.
5. Nothing tells it what another layer decided ("Next: typing into…", "Jev wasn't sure…"). It
   reads the state and does what comes next.
6. No model declares a fact the code can read for itself, such as whose words a field holds.

## Today, and what goes wrong

- Jev answers "whose words go in it?" for every field. Sure they are the user's: the quick model
  tidies them with its own prompt (`DICTATE_PROMPT`). Otherwise: a single-step thinking turn with
  a "Next: typing into […]" note and its own rules, whose `act` call comes back unrun and is
  applied or dropped (`applyCall`, `dropCall`, `runCalls`).
- Models declare `wrote: user | you`, and the read-back before sending hangs on it.
- Thinking is handed notes saying what another layer wanted: `DONE_CHECK`, `EARLY_GUESS`,
  `goAheadNote`, `unsureNote`, `TASK_DONE`.
- Jev's side questions swap its prompt for one of their own (`CONSENT_PROMPT`, `WORKING_PROMPT`,
  `OVERLAP_PROMPT`).
- The search query has a prompt of its own (`SEARCH_PROMPT`).
- Background work is "a more capable model" to thinking, and the task is told it works "for
  Stanley".

## The design

### Jev: what now, and which step

One request, as today, with three questions:

| Question | Choices |
| --- | --- |
| What now? (`next`) | `listen`, `act`, `respond`, `think`, `done` |
| Which step? (`step`) | The steps on offer, fields included; `respond` is no longer one |
| Has the user finished saying what that needs? (`heard`) | `finished`, `more` |

`next`'s choices, as Jev's prompt describes them:
- `listen`: the user is still saying what they want.
- `act`: one step on the screen moves toward what they asked: open, press, or type their own
  words into a field.
- `respond`: say something to the user that needs no working out: what the screen shows, what you
  already found, a question.
- `think`: the next move takes working out: writing words of your own for them, looking things up,
  several steps, their files, anything that needs judgement.
- `done`: what they asked for is done or showing, and any question has been answered out loud.

No separate `write` choice or write-target question: each of Stanley's options is already one
action (`[Add a task]` types, `[Add a task › press Enter]` presses), so the step says what `act`
does. Jev Ultrafast needs an operation and a target per operation because one of its elements can
be clicked or typed into; ours can't. Add the split only if the evals show Jev confusing fields
and buttons.

`think` also stays what Jev's low confidence comes to, as today (`Mode`).

### Who takes each move

| Move | Taken by | Waits for |
| --- | --- | --- |
| `act` on a button, link, app, page | Jev's step, run at once | Commits: the end of the turn and consent, as today |
| `act` on a field | The writer types it | A pause (typing can be redone) |
| `act` on search the web | The writer writes the query | The end of the thought |
| `respond`, `think` | Thinking, a whole turn | The end of the thought |

Thinking's single-step write goes, with `writeNote`, `single`, unrun calls, `runCalls`,
`applyCall` and `dropCall`.

### The writer

A small model on this computer (Gemma 4 E4B) that writes the text of a step: what goes in a field,
or what to search for. It types the user's own words; writing words of Stanley's own is `think`.

- **Instructions:** `IDENTITY` and `FIELDS` from `persona.ts`, then a short section on how it takes
  its turn: only the text; the version the user settled on; adding to what the field holds or
  replacing it; `(?)` words; `(nothing)` when they haven't said yet. Written as Stanley, agreeing
  with what Jev and thinking read. Then today's date.
- **Earlier turns:** the worked examples, as turns in the same form as the step (15 for fields, 7
  for searches, their months from today). Read once ahead of time (`warmWriter`), so a step reads
  only its own input.
- **Its input:** the last 3 user turns of the conversation as Jev reads it (`narrate`), then the
  step: "You type into [X] now, which holds "…" / is empty. What do you type?", or "You search the
  web now. What do you search for?".
- **No screen:** a full screen takes about 7 s on Gemma here (1,700 tokens at 257 tok/s), against
  about 0.5 s without it.
- **Nothing to write:** while the user speaks, listen; once they have finished, thinking takes the
  turn. This catches what the writer can't do (a list in their files, something said long ago)
  without anything deciding who writes ahead of time.
- **Reuse:** a step decided again on the same words reuses the writer's text when its whole input
  is the same (as Jev Ultrafast does); any change to the screen discards it.

### Whose words a field holds

Read from the words, not declared by a model (`ownWords`): text typed into a field is Stanley's own
when less than half of what it added to the field is words the user said this task (numbers aside,
since "three thirty" is typed "3:30"). Prose of Stanley's own is read back word for word before
anything sends it; Jev's narrative says "You wrote your own words into […]". `wrote` leaves the
`act` tool, and the history records it as meta.

### Thinking

- `THINKING_PROMPT` uses `FIELDS` for fields, the same words Jev and the writer read.
- No notes from other layers. Where one carried a rule, the rule goes into the instructions in
  general form:
  - `DONE_CHECK`, `EARLY_GUESS`, `goAheadNote`, `TASK_DONE`: already covered ("may already be
    done", "undo what they took back", "only press what sends when they asked", "tell the user
    what a task found").
  - `unsureNote`: "Before sending words the user said that have a (?) in them, say back what you
    heard and ask whether to go ahead" joins the speech recognition section.
- The reason for a turn (`handover`) stays, for the debug window only.

### Jev's side questions

Consent, words said while Stanley works, and words said over its voice read the state every
decision reads (`jevState`; over its voice, `talkingState`, without the screen), and their
specifics go in the question ("You are about to press [Send]…", "right now, searching the web for
…; the user said "…" while you work", "you have said "…"; the user said "…" over you").
`CONSENT_PROMPT`, `WORKING_PROMPT` and `OVERLAP_PROMPT` go.

The effect judge stays as it is: it judges what a kind of button does from the screen alone, once
per app, which is a fact about the app rather than a turn.

### Background tasks

- Thinking's `delegate`: a task of Stanley's own, done in the background with more time and care,
  not "a more capable model".
- The task: "You are Stanley… working on a task in the background while you go on talking with
  the user". What the user changes arrives "From the conversation:"; its result is written for
  itself, to tell the user about.
- The status bar's gist: Stanley saying what it is working on.

## Done so far (uncommitted)

- `persona.ts` (`IDENTITY`, `ACTING`, `HEARING`, `SCREEN`, `FIELDS`); `SYSTEM_PROMPT` built from it,
  without "whose words".
- `write.ts`: `writerInstructions`, `writerInput`, `writerExamples`, `written`, `ownWords`.
- In `agent.ts`: `type` and `writeStep` replace `write` and `dictate`; `searchStep` uses the
  writer; `respond` still a step; the handoff notes are gone; consent and working read `jevState`.
- `think.ts`: no `single`, unrun calls or `wrote`; `FIELDS` in thinking's prompt; the background
  section rewritten. `barge.ts`, `background.ts`, `effects.ts`, `conversation.ts`, `debug.ts`,
  `config.ts` and the desktop's `index.ts` follow.
- Not yet: `respond` and `think` in `next`; the writer's own section of instructions; reuse;
  tests; evals; docs.

## Order of work

1. **Settle the tree.** Another session's layout work is in the same files: agree with it which
   changes stay before editing again.
2. **The writer, measured alone.**
   - Write its instructions section; point the dictate eval's `prod` variant at
     `writerInstructions`, `writerExamples` and `writerInput`.
   - Run dev and holdout, judged. Gate: at least today's 98% dev and 94% holdout.
   - Add about 10 search cases with checks, run them.
3. **Jev's `next`.**
   - `respond` and `think` move into `NEXT`; `respond` leaves `stepOptions`; `handle` maps them.
   - Thresholds: start from today's; `act` versus `think` once the user has finished is the one to
     tune.
4. **Tests.** Rewrite the writing, dictation and misheard-words tests on the writer stand-in
   (`quick`); drop the single-step history tests; the done-check, early-guess and go-ahead tests
   check the turn goes to thinking, not its note; barge and working tests read the question.
5. **Evals.**
   - `pnpm eval` twice against two runs of HEAD. Gate: today's 92/94, and the correction, confirm
     and dictation scenarios all passing.
   - `pnpm eval:working`: today's pass rate with the question carrying what was said.
   - `pnpm eval:web` once.
   - Count: thinking turns per scenario (expect fewer), `think` chosen per field step, writer
     "nothing" handed to thinking, writer latency p50.
6. **Docs.** `DESIGN.md`: one agent, the writer, `next`'s choices; the harness's help text.

## Risks

- **Jev's calibration with five choices.** `respond` and `think` take probability from `act` and
  `done`; thresholds tuned for three may let too much or too little through. Watch thinking turns
  per scenario and act-confidence gates in the evals.
- **`think` too rarely on a field:** the writer gets "reply with something nice", writes nothing or
  echoes the request. The "nothing" path catches the first; the eval cases need the second.
- **`ownWords` misjudges:** a long dictation heavily reworded reads as Stanley's own and is read
  back (safe, slower); a composed text that repeats the user's words reads as theirs and isn't
  (unsafe). Test both on the dictate cases' gold answers and a set of composed replies.
- **No notes for thinking.** It may press what a note used to stop (unsure words, commits). The
  confirm and misheard-words scenarios must pass before this ships.
- **The writer without the screen** can't see what it replies to. It only types the user's words,
  so it shouldn't need to; if evals show otherwise, add the open item's text, not the screen.
