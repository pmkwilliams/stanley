# Stanley — Design (v1 demo)

Voice-controlled desktop assistant. The user speaks, a local STT model transcribes live, and an
agent operates apps on their computer: a fast decision model (TypeSafe **Jev**) picks each next step
from what is on screen, and a language model takes over whatever needs words or judgement. v1 runs
over a few demo apps, which stand in for arbitrary apps and websites.

## Goals / non-goals

**v1 goals**
- Push-to-talk (global toggle) with live transcription.
- An agent that works from what is on screen, so it carries over to arbitrary apps and websites.
- Background work: the agent can operate on surfaces the user can't see and reveal the result.
- Toy apps: Tasks, Email, Weather, Music, Web (a live browser page; searching happens in the background).
- A debug window that explains every decision.

**Not in v1**: wake phrase, multi-window layouts, spoken responses (Stanley's replies are text on
screen for now), persistence across launches.

## The agent

Stanley has to work on any app or website, not only on the demo apps. Everything below is written
against what any screen offers (elements with a role and a visible name, plus readable content),
never against what one demo app happens to expose. The demo apps are test fixtures: they describe
their screens the way an accessibility tree would, with no hints written for the agent. The same
agent drives real web pages through `packages/browser` (see **Websites**).

### One agent, two speeds

Several models do the work, but it should read as one Stanley, in the trace and to the user.

- **Fast: Jev** (~330 ms). Decides turn-taking and takes clear, reversible steps, including while
  the user is still speaking: open an app, open an item, press play, tick a box.
- **Slow: thinking** (GPT-6.1 Sol; GPT-6 Luna for single steps). Anything that needs words or judgement: what goes in a
  field, whether to press something that sends or deletes, answering, asking, and working out a
  request the fast part can't.

There is one history (see **Context**). Thinking continues it as one long conversation: Jev's steps
are in it as Stanley's own calls, so thinking reads everything Stanley did as its own. Jev reads a
rendering of its last 50 turns. Both act through the same options. A handoff to thinking is not an
error path; it is how Stanley writes, talks and judges.

### What the agent sees: the screen

Each tick the world provides (`World` in `packages/agent/src/world.ts`):

- **The screen**: the surface Stanley is working on (which may be hidden, see **Surfaces**), as
  readable markdown, plus its interactive **elements**. An element has a role and the name a person
  would see (`link`, `button`, `field`, `checkbox`, `switch`, `tab`…), any visible state or value,
  and the container that tells it apart when its name repeats (`"Lunch Friday?" › Archive`,
  `Blue ceramic mug › Add to cart`).
- **Apps** that can be opened from anywhere, plus `back` (the previous screen, like a browser's
  back button) and `home`.
- **Known web pages**: every page a background search found, thinking read, or Stanley or the
  user opened (but not pages of the user's files, which are offered as files), while the
  conversation still shows it, as `open page: <title>` (told apart by site when titles repeat).
  Opening one is a single navigation step, like typing its address into a browser
  (`World.openUrl`). The page already on screen isn't offered.
- **The user's files** (see **Files**): `list files`, then `list folder: <path>` and
  `read file: <path>` for everything in the folder, most recently looked at first. Looking only
  reads, in the background: nothing comes on screen.
- **Skills** (see **Skills**): `use skill: <name>` for each skill the user has, described by when
  it is for, unless Jev already read it this task.

Apart from known pages, only what is on the current screen is offered. The agent can't reach into a
screen it isn't on, because on a real website it can't either: to archive an email it opens the
email, then presses Archive. When there are more elements and pages than the limit, `stepOptions`
keeps those matching the user's words first, then what is in view or was found last; the agent can
scroll for the rest.

Apps describe their screens with `nodes(state)`: `location` = link, `action` = button, `input` =
field, `group` = a container that only gives context. Labels are what the UI shows (`Send reply`,
`Add a task`), descriptions only secondary visible text. Nothing in them may coach the agent, and the
demo apps don't set the `destructive` hint, so the agent's own judgement is what gets tested.

### A tick (Jev)

One Jev call per tick, with three questions about the same state:

1. **next**: what Stanley should do now.
   - `listen`: the user hasn't finished saying what they want.
   - `act`: take the next step on screen.
   - `think`: the next part needs words or judgement.
   - `done`: what the user asked for is done, and any question has been answered out loud.
2. **step**: which element, app, `back` or `home` the step would be.
3. **heard**: has the user finished saying what the next part needs (`finished`), or are words
   still coming that it depends on (`more`)? The words half of turn-taking (see **Turn-taking**).
4. **words**: if the step types into a field, whose words go in it: the user's (dictated, or a
   value they named) or Stanley's (described as a tone or gist, or not said yet).

Splitting them keeps the step's probability from being spread across the turn-taking options, and
the turn-taking decision from being split across dozens of near-identical elements (a replay of real
decisions showed the old single question giving 50% to an option whose route held 98%). Then:

| Jev says | What happens |
| --- | --- |
| `act` on a link, app, `back`, `home` | Runs at once, even mid-word (navigation is cheap to undo) |
| `act` on a button | Runs once the user finishes the thought; if it **commits** (see **Effects**), once their turn ends and Jev is sure the user asked for it (`consent`), else thinking gets the go-ahead |
| `act` on a field | At any pause, with `words` at least 0.8 the user's, a quick model tidies their words out of the last few turns (no history or tools) and they go in at once (live dictation, retyped as they go on). Otherwise thinking writes what goes in it (one call) and words Stanley composed wait for the thought to finish. Then the fast part carries on |
| `think` with a field step ≥ 0.9 | Handled as writing that field: one call instead of a tool loop |
| Anything but `done`, with a `use skill` step ≥ 0.9 | The skill is read at once, even mid-word (it only reads); the next tick decides with it in view |
| `act`, unsure of `act` or of the step | Listens while the user speaks; after they finish, thinking takes the turn |
| `think` | Thinking takes the turn once the user finishes the thought |
| `listen` | Waits for more words; after the user finished, thinking takes the turn (usually to ask) |
| `done` | Ends the task and shows the working surface; if unsure once the user finished, thinking checks first |

### Turn-taking: acting before the user finishes, without acting on half a thought

The question is never "has the user stopped talking?" but "could their next words change what
Stanley is about to do?" A person sitting at the computer opens the task list as soon as you say
"task", but doesn't add "called…" as a title. So each kind of step waits for a different amount
of certainty:

| Step | Waits for |
| --- | --- |
| Open, navigate, scroll, list or read files, press a button that only looks | Nothing: runs mid-word, with a lower bar (`speakingNav`) when Jev is sure of the place and has heard enough |
| Press a button that changes something undoable (tick, add, move, save) | Jev to be sure (`speakingChange`) and to have heard what it needs (`heard` ≥ 0.6): runs mid-word |
| Type the user's own words into a field | A pause (a field can be retyped) |
| Type words Stanley composed, hand over to thinking | The thought to finish |
| Press something that commits (send, delete, archive) | The turn to end, and Jev sure the user asked for it (`consent`) |
| Say anything | The turn to end; words the user adds first drop it |

Two signals, each reading what the other can't:
- **Voice**: at each VAD pause the transcriber runs **Smart Turn v3.2** (pipecat-ai, BSD-2,
  8 MB ONNX, ~85 ms on CPU) on the last 8 s of audio: P(the turn is complete) from intonation,
  trailing off, a filler before more words. Reported after the pause's segment, so ending the
  turn on it never loses the last words.
- **Words**: Jev's `heard` question, read against the conversation and the screen. "Make a task
  called" is unfinished however final it sounds; synthetic speech rates it 0.96 complete.

**The thought is finished** when the utterance ended, or the user is paused, the words are final
and `heard` ≥ 0.6 and voice ≥ 0.5 (without Smart Turn: `heard` ≥ 0.85). On LiveKit's end-of-turn
benchmark either signal alone calls ~20% of mid-turn pauses finished; both together, 4%.

**The utterance ends** (`Agent.scheduleEnd`) 0.25 s after the pause is reported when both say
finished, 2.6 s when either says more is coming (< 0.25), else 1 s. The transcriber's 4 s silence
is a backstop. Re-run whenever either verdict changes. Speech within 2 s of an end the agent chose
rejoins the same utterance: the user was only pausing, and every model then reads one sentence.

**Held steps**: a decision gated on the thought or the turn is held, not re-asked. It runs as soon
as the user finishes, without another Jev call; new words drop it. A held change decided while
`heard` said "more" is re-decided at the turn's end instead, since Jev then sees the whole turn.

**Corrections**: anything Stanley did can be undone the way a person would (untick, move back to
the inbox, retype). The conversation splits a turn at any change made before the user finished
("User: …", the step, "User (went on): …"), so "no wait, the other one" reads as a correction.
Before closing a task where a button was pressed early, thinking checks those guesses against
everything the user said, unless Jev's P(done) reaches `earlyGuessDone` (0.8): its `done` already
means nothing Stanley did goes against what the user now wants.

**Just going somewhere**: when the user has finished and everything Stanley did in the task was
navigation, made after their last words, a `done` or `listen` Jev is unsure of closes the task
quietly. Thinking would only say where they are, which they can see. A navigation made before
their last words was a guess, so thinking still checks it.

**What a button does** (looks, changes or commits) is judged before any of the gates, once per app
and kind of button ("› Delete" on any task), and in the background for each kind on a screen as
it first appears, so a press rarely waits for it.

### Misheard words

Speech recognition is not exact, so Stanley treats the user's words as heard, not as said:
- **Unsure words are marked.** Parakeet scores every token; a word whose least likely token is
  under 0.5 reaches the models as `word(?)`. On clean speech words stay above ~0.6; garbled
  output ("Put dark is the content" for "Book doctor's appointment") falls to 0.1–0.4.
- **Fixed from context, or asked about.** Writing and thinking turns read a marked word as what
  the user most likely said (a name on screen, a word that fits) and ask, quoting what was heard,
  when a marked word matters and can't be worked out. A write step that asks instead types nothing.
  Only marked words are in doubt: a general "ask when unsure" made a go-ahead hesitate over clear
  requests (a booking went from 4/4 to 0/4).
- **Never sent unheard.** A press that commits words the user said in a turn with unsure words
  goes to thinking instead, told to say back what it heard and ask: decided in code, not by a model.
- **Said back.** When the user's own words (two or more) were typed and committed and Stanley
  said nothing else, it says them: "Done: "Book doctor's appointment"". Hands-free, the user may
  not be looking.
- **Heard better in the first place.** Beam search (4 paths, ~7% slower than greedy) favours rare
  words on the screen and the app names (`screenVocabulary`, at most 30, only words the model
  splits into several pieces that aren't common English, any form, per SCOWL size 50). At strength
  1.5 "Okonkwo" on screen is heard instead of "Aconquo"; at 2.5 it started replacing other words.
  Favouring a common word does harm: with "Archived" on screen, "Alex" was heard as "Archived";
  with "I'm feeling lucky" on screen, favouring "I'm" turned noise before "full screen" into "I'm
  not sure I'm sure…". So contractions and possessives are judged without their ending, and a
  decode with more than 6 words a second (plus two) is redone favouring nothing.

### Thinking

One model, one set of instructions (`instructions()` in `think.ts`: `THINKING_PROMPT`, speech
recognition, the web when the session has it, and the date), fixed for the session. Every call
continues the same history: the screen goes in as an observation (`<screen>` and `<options>`, or
`<screen unchanged/>` when thinking saw the same last), the turn runs on everything before it, and
what it did is appended exactly as it was sent: reasoning, tool calls, and the screens its steps
returned. Two ways in, both with the same tools and `toolChoice: 'auto'`:

- **write** (one step): Jev chose a field, and isn't sure the words are the user's own. The observation ends with a note naming it. A call to
  `act` on it is the decision: what to type, and whose words they are (`wrote`: `user` when said
  by the user or following directly from the request, like a search query or a city; `stanley`
  when written from a gist or a tone). Text without a call asks the user; neither means nothing to
  type yet. Calls come back unrun, and typing appends the call's result. Words Stanley wrote itself
  are always read back word for word (the agent adds the quote if thinking paraphrased), which hands
  the turn to the user. Otherwise Jev continues (Enter, Send, done). Other `act` calls (tick this,
  then type that) run in order as thinking's own steps, stopping at one no longer on screen, typing
  that isn't the user's own words, or a press that commits before the turn ends or with unsure
  words; then Jev continues. A command on the user's files runs within the step (reading a skill,
  or a list the user named), and the step goes on to decide, up to three steps in all. A lookup, or
  a first call that can't run, hands over to a whole turn.
- **run** (a short tool loop over `act`, the same options as Jev): for `think` turns. It answers,
  asks, or works the screen itself. Its text is speech: streamed, shown and spoken as it is written
  (see **Speaking**). With web access it also has `search(query)` and `fetch(url)`, which look things
  up in the background without changing the screen, and `open_page(url)`. A question is answered
  from a lookup; something the user wants to see goes on screen. What a search found stays in the
  history in full, so thinking can answer a follow-up from it, and Jev can open any of it later
  ("show me that", "the Wikipedia one") without searching again. With the user's files it also
  has `bash` (see **Files**).

When the user says more while thinking works, a single step (write) is dropped at once: it
hinges on exactly their words. A whole turn is judged: one Jev question (`WORKING` in `barge.ts`,
like the barge-in judge for speech over Stanley's voice) asks whether the words stop it (`stop`,
`no, the other one`, `never mind`, saying more exactly what they meant) or can wait until it
finishes (`and make it blue`, another question), with what thinking is doing right now. The turn
goes on while Jev judges, and more words are judged again. Stopped, it says nothing, and the steps
it already took stay done and in the history (a step that ran in a step cut short goes in as
Stanley's own call and result). Either way Jev then decides with everything they said: at once when
it stopped, after it finishes when not. `pnpm eval:working` checks the judgement. After a `run`, the
task ends; what was said is in the history, so a follow-up ("yes, send it") is Jev's. Why thinking
was called is for the debug window only: the instructions say what to do in each case.

**Prompt caching.** The history only grows, so each call's input starts with the last one's. Three
markers, kept for an hour (gaps between calls often pass five minutes): the instructions, where the
previous call's input ended (an exact read point however much was appended since), and the end of
the input, moved forward each step. Nothing that was sent is ever changed. The one change allowed
is to what was never input: the final output of the last turn (its text goes in as what Stanley
said, as far as the user heard it), a single step's call that wasn't applied, a reply not yet sent.

### Background tasks

Some requests take minutes: research across many sources, going through many files, a page made
while the user gets on with something else. Thinking hands these to a **background task**
(`background.ts`) with `delegate(task, title)`, says in a few words what it set going, and the turn
ends. The design follows T3 Code's delegation:

- **A task starts from its brief alone.** It doesn't get the conversation: `task` has to carry
  every name, address, path and detail it needs, and what to give back. A fork of the history would
  read the user's turns and "your text is speech" as its own and talk to the user; a brief keeps
  it on one job, and makes what was asked inspectable. A new round is a new task whose brief carries
  what the last one found; a task is never messaged.
- **It has no screen.** Its tools are `search` and `fetch`, `bash`, `write_file` and `edit_file`,
  and `preview_page`: no `act`, `open_page` or `delegate` (no nesting). Its instructions
  (`taskInstructions`) say no one hears it until it finishes, that it can't ask the user (it stops
  with "Needs: …" instead), never to send, delete or overwrite what the task didn't ask for, and to
  finish with a result for Stanley: the facts and sources an answer needs, or what it made and where.
  It runs thinking's tool loop on Claude Opus 5.5 at high effort, whatever thinking itself runs on
  (`TASK_MODEL`, `TASK_EFFORT`), up to 40 steps, at most 3 at once (`config.background`).
- **It checks its pages out of sight.** `preview_page(path, appearance?, width?)` draws a page from
  the folder in an offscreen window of its own (`Previewer`, `apps/desktop/src/main/preview.ts`),
  as the Web app would show it: the same `stanley://files` protocol, Stanley's look, the libraries
  and no network, at the page size, dark or light (`prefers-color-scheme` emulated through the
  DevTools protocol). It gives back a picture, the height the page needs, and its whole console:
  errors with their line, warnings and logs, so a page can report its own checks with
  `console.log`. Like T3's `html_preview` and `html_render`, checking and showing are apart:
  only thinking shows anything, with `open_page`.
- **Its result is queued, not steered in.** When a task ends by itself, its result goes into the
  history as a note (`Background task task-1, "…" finished: …`), which Jev reads too. The next whole
  thinking turn has it, whatever it was called for; reading it there, or with `task_status`,
  delivers it. If no turn comes, the agent starts one to tell the user (`deliver`, with
  `TASK_DONE`) once everything is quiet for 400 ms: no utterance open, the user not speaking,
  nothing held or running, and Stanley not talking (the host reports its voice with `talking`). It
  is never spoken over the user, and never put into a turn already running.
- **Thinking knows what is working.** Each whole turn's observation lists the tasks still working.
  `task_status` says what one is doing right now, or its result; `task_cancel` stops one, keeps what
  it did, and its result is never told. A task's own words never reach the conversation.
- **A file a working task wrote is its own** until it ends: thinking's `write_file` or `edit_file` on
  it is refused, saying which task has it.
- Each task's brief, instructions and messages go to `userData/sessions/<session>.task-N.jsonl`,
  and its start, steps, end and delivery are rows in the debug timeline. Locking cancels them all.

### Effects: what a button does

Real apps and pages don't label their buttons, so the agent judges. The first time a button is
chosen, one Jev question classifies what pressing it does, from its name, its context and the
screen: `looks` (shows or fetches), `changes` (the user's own data, easy to undo) or `commits`
(reaches other people or the outside world, deletes, archives, or is otherwise hard to undo). Unsure
between changing and committing counts as committing. The answer is cached per app and label, since
a button's effect doesn't change; the conversation isn't sent, so the cache is honest.

A button that commits waits for the user's turn to end. Then one more Jev question, asked only for
it (`CONSENT` in `effects.ts`, with the conversation and the screen as it is now): did the user ask
for what pressing it does? Replying with words they gave is asking to send; drafting is not, and
words Stanley wrote need the user to have heard them and said to go ahead. At P(asked) ≥ 0.8
(`consent`) it presses, as fast as any other step; below, thinking takes the turn and asks in its
own words, or presses it when the conversation shows the user asked.

Consent is its own question, not part of "what now". Folded into Jev's prompt it didn't separate:
P(act) on Send for "draft a reply" (0.62–0.70) overlapped with sends the user asked for
(0.50–0.79), and the wording made Jev wary of cookie banners' "Accept all", looping on the page
behind. Asked alone, sends the user asked for scored 0.91–1.00 and drafts 0.11–0.15.

### Tick scheduling

Invariant: **never more than one Jev call in flight.**

Tick when:
1. new stable words arrived since the last call, or
2. a step just ran (the screen changed, so keep going), or
3. the utterance ended (toggle pressed again, or the agent judged the user finished), or
4. the voice paused (a held step may now run).

After `listen` or `done`, only (1) or (3) trigger a tick.

**Stale results**: if new words arrived while a call was in flight, the result is discarded and we
re-tick with the fresh transcript, unless it is a navigation with step confidence ≥ 0.8, or a
button that doesn't commit at that confidence when the new words only add to the ones it decided
on (then run it, then re-tick). Only new words make a result stale: the utterance ending mid-call does not.

**Deferred ticks**: a tick requested while a call is in flight is remembered by reason and replayed
when the call settles. A step-driven tick wins, so the agent keeps going mid-utterance.

**"New words"**: normalize (lowercase, strip punctuation) finalized segments + current partial
*minus its last (volatile) word*. Trigger if it differs from what the last call saw **and** the word
count grew, or a segment finalized.

### Guardrails (one tunable config, `config.ts`)

| Guard | Default |
| --- | --- |
| `act` needs at least this P(act) while the user is speaking, else listen | 0.6 |
| …for a button that changes something undoable (`speakingChange`) | 0.6 |
| …for going somewhere, when the step ≥ 0.7 and `heard` ≥ 0.5 (`speakingNav`) | 0.4 |
| …and after they finish, else thinking | 0.4 |
| `done` after they finish needs at least this, else thinking checks | 0.5 |
| …and after an early press, at least this, else thinking checks the guesses (`earlyGuessDone`) | 0.8 |
| The chosen step needs at least this confidence, else listen / thinking | 0.4 |
| P(commits) at or above this makes a button commit | 0.3 |
| A press that commits needs Jev's P(the user asked for it) at least this, else thinking (`consent`) | 0.8 |
| Max steps per utterance → stop ("got stuck") | 15 |
| Oscillation: same step from the same screen N times in the last M steps → stop | 3 in 6 |
| Stale navigation, or a stale button that doesn't commit when the words only grew, still runs at step confidence ≥ | 0.8 |
| `think` with a field step at least this sure is handled as writing | 0.9 |
| P(`words` = user) at least this, and the quick model tidies the user's words into the field (`dictated`) | 0.8 |
| Elements and known pages offered per tick / to thinking | 150 / 300 |
| Thinking tool steps | 10 |
| User turns Jev reads | 50 |
| Thought finished: `heard` / voice / `heard` without Smart Turn | 0.6 / 0.5 / 0.85 |
| Utterance ends this long after a pause: both finished / mixed / either says more (< 0.25) | 0.25 / 1 / 2.6 s |
| Speech this soon after an agent-chosen end rejoins the utterance | 2 s |

A field chosen during a pause with nothing to type yet ("called… um…") isn't a step, so a long
pause can't trip the loop guard. A step that fails (a control covered by a cookie banner, a page that
didn't respond) doesn't end the turn: the failure goes into the conversation and Jev decides again;
the loop guard stops a step that keeps failing.

## Context

### The history

One persistent history per app launch (`conversation.ts`), as AI SDK messages: what the user said
(user messages), every step (an `act` call and its result, Jev's with a synthetic id), searches and
reads (their results in full), what Stanley said (assistant text, as far as the user heard it),
notes from the computer (`<note>`: the user's own clicks and typing, being cut off, a guard that
stopped Stanley, a new day), and the observation at each thinking call. Each entry also carries
metadata no model reads: who chose it, Jev's answers, how many words had been heard, the utterance.
The sink receives records (`words`, `staged`, `commit`, `amend`) appended to
`userData/sessions/<ts>.jsonl`; replaying them rebuilds exactly what thinking was sent.

Thinking reads all of it. What it hasn't seen yet (the user's words, Jev's steps, notes and replies
since its last call) is **staged**. A thinking call commits everything before it, and so does the
start of the next utterance. At each commit the staged words are placed:

1. An utterance's words up to its earliest early change come first: a field typed or a button
   pressed on fewer words than the user ended up saying. With no early change, all of them.
2. At each early change, the words up to what it was decided on come before it ("went on").
3. Whatever is left comes after the utterance's last step, or at the end while it is open.

Navigation never splits a turn, and words never come between a call and its result. A thinking call
fixes the order up to that point: words the user says afterwards come after it, which is when they
were said.

### What Jev reads

Jev's `state` is its system prompt, today's date, and `narrate()` of the history: committed, then
what is staged, placed as it would be committed now. It keeps only what a person watching would
need:

```
## Conversation
User: add a new task called um avocado
Stanley opened Tasks.
Stanley typed "Avocado" into [Add a task].
Stanley pressed Enter in [Add a task]: Added task "Avocado".
User: open the email from Sam
Stanley opened Email.
Stanley opened [Sam Lee: Lunch Friday?].
User: let's reply with something funny
Stanley wrote its own words into ["Lunch Friday?" › Reply to Sam Lee]: "Ramen? I was born ready."
Stanley said: "I wrote "Ramen? I was born ready." Should I send it?"

## Screen: Email (in front of the user)
…markdown of the screen…
```

- **The user's words come as turns**, in the order above, marked `(still speaking)` while the
  utterance is open.
- **Steps are outcomes**: links opened, text typed (and whose words), buttons pressed with the
  app's result summary. Jev's and thinking's read the same.
- **Lookups list what they found**: a search gives each page's title, address and its excerpt cut
  to a line; a read names the page.
  ```
  Stanley searched the web for "first president of the United States":
  - "George Washington - Wikipedia" (en.wikipedia.org/wiki/George_Washington): George Washington…
  Stanley read "George Washington - Wikipedia" (en.wikipedia.org/wiki/George_Washington).
  ```
- **Not included**: observations, reasoning, notes, listen/done decisions, discarded or gated
  decisions, retries, and which model took a step. Those are the agent's mechanics; the debug trace
  has them.
- **The screen appears once**, at the end.
- **Long sessions** keep the last 50 user turns (`jevTurns`), and the pages Stanley offers to open
  are the ones in them.

### Size

| Content | Thinking (whole session) | Jev (last 50 turns) |
| --- | --- | --- |
| User words, notes | In full | Turn lines |
| Steps | Jev's: call and summary. Thinking's: as sent, with the screens they returned | Step lines |
| Screens | Every observation; `<screen unchanged/>` when identical | The current screen, once |
| Search / fetch | In full (≤ 8 × 500 chars / ≤ 6,000 chars) | Title, address, 100-char excerpt / page title |
| Commands on files | In full (≤ 16,000 chars: the start and end of longer output) | A listing's names (≤ 40) / a file's first 200 chars / the command |
| Reasoning | Replayed as sent | Never |

Growth comes mostly from screens. Only the new part of each call is uncached, but time to first
token rises with the total. The debug window and the evals report each call's input size; when
sessions near 100K, the plan is server-side compaction (`docs/plans/one-history.md`).

## Websites

`packages/browser` turns any web page into a screen, with no site-specific code:

- **Extraction** (`extract.ts`) is plain JavaScript run in the page: interactive elements by role
  and accessible name (aria-label, labelledby, `<label>`, placeholder, text, descendant alt/title),
  state (checked, on/off, selected, expanded, disabled), field values, and for repeated names the
  container's label, heading or main link. Elements with no name are dropped. The markdown is the
  page's `main` content from the scroll position on, with controls inline as `[name: value]`.
- **Steps** (`driver.ts`) run through a `PageDriver`, a page's controls as a person uses them:
  real clicks, typing and Enter, `Scroll up/down` as elements, and a step reports what visibly
  changed (a generic page can't say what a click did). `livePage` turns a driver into the
  `LivePage` an app gets (`AppContext.page`).
- **`PageWorld`** is a `World` over a Playwright page, for the evals: bookmarked sites are the apps.

**In the desktop app** the Web app's page is live: a `<webview>` that main drives as Playwright
drives a browser (`WebviewPage`, `apps/desktop/src/main/page.ts`). It reads with the extractor
through `executeJavaScript` and sends input through the DevTools protocol. The Web app's screen is
the page's elements and text; a link, a form or a redirect that lands on another page is the next
page in its history; and a page the user goes to themselves goes into the conversation as their
step. The view stays in the window, out of sight, while the app is hidden, so Stanley works pages in
the background too. Each page Stanley opens or writes gets a view of its own, a tab, up to six:
opening a page a tab shows switches to it as it was left, and the rest keep running, muted. Tabs
have no bar; they are known by their pages' titles, and pages kept open are offered as `open page:`. Chromium drops input to a view out of sight, so there each step checks whether
real input arrived and otherwise does it from inside the page (`click()`, `requestSubmit()`,
`scrollBy`). See `docs/plans/live-pages.md`.

## Files

The user's files are one real folder, `~/Wren` (`STANLEY_FILES` moves it), not an app: there is
nothing to show, so nothing goes on screen. The user puts things there in Finder, and what Stanley
writes there is usable outside it.

- **Jev looks.** `list files`, `list folder: …` and `read file: …` are step options, offered for
  everything in the folder (`FileTools.paths`, read from disk each tick, hidden files left out) and
  ranked with the screen's elements by the user's words. They only read, so they run mid-word like
  navigation. Each goes into the history as the bash command it is (`ls -p -- '…'`,
  `cat -- '…'`) with its output, so thinking reads it as its own call and can answer at once.
  Jev reads a listing's names, or how the file starts.
- **Thinking does the rest** with one tool, `bash`, run in the folder: finding, answering, adding
  up, writing, moving, deleting. Jev has no search: searching needs words, which are thinking's.
  Each command reads to Jev as `Stanley ran \`…\` on the user's files.`
- **Consent** is the same rule as for buttons, in thinking's instructions: overwrite, move or
  delete only what the user asked for; making new files is fine. There is no confirm step, because
  the snapshots make every change undoable.
- **Every version is kept.** Before each command (what the user changed since) and after it (what
  the command did), the folder is committed to a git directory of its own outside it
  (`userData/files-history.git`). Commands can read it (`$STANLEY_HISTORY`), so thinking can bring
  an earlier version back with `git show`, but not change it.
- **Shown on screen** in the Web app: files the web view can show (web pages, PDFs, pictures,
  video, text) have `open file: <path>` next to `read file:`, and thinking's `open_page` takes a
  path. They load from `stanley://files/…`, which serves the folder and nothing else, with a policy
  that keeps pages off the network: a page can use files beside it and the bundled libraries
  (`stanley://lib/`: Mermaid, Three.js, D3, Chart.js, with their usual CDN addresses pointed at the
  bundle), but can't fetch, load or navigate out. A file on screen reloads when it changes, by
  Stanley, a command or the user's own editor. See `docs/plans/live-pages.md`.
- **Pages Stanley writes.** Thinking has `write_file` and `edit_file` (exact replacement, once or
  everywhere). For something to look at that isn't a website (a diagram, a chart), it writes one
  .html file in `.stanley/scratch/`: scratch, emptied each time Stanley starts and left out of the
  history, so a page shown once doesn't stay in the user's folder. A page the user wants kept goes
  in `Pages/`, written there or moved there with `mv`; when is thinking's call. The page comes to
  the front as soon as it starts and is drawn as it is written: the tool's input is read as it streams and served to the view at the file's address as
  a streaming response. Then thinking gets everything the page's console printed (errors with their
  line, warnings, logs) and a picture of it, so it can fix what didn't work. "Make it blue" is an `edit_file`, and the page reloads where it was.
  A page in `Pages/` or scratch takes Stanley's look: it is served with the shell's tokens from `theme.css`
  as CSS variables (dark, or light with the user's theme, live) and its background, text colour
  and font (Inter, served with the libraries) set from them, in a cascade layer the page's own CSS wins over
  (`apps/desktop/src/main/page-theme.ts`). The `--chart-1…6` tokens are a categorical palette
  validated for colour-blind separation on both backgrounds.
- **Sandboxed** (`packages/files`, macOS `sandbox-exec`, deny by default): writes only in the folder
  and a temporary directory; no reading the rest of the user's home (paths can be stat'ed, not
  read or listed); no network, no opening apps or URLs, no Apple Events, no signals outside the
  sandbox. `HOME` is the folder. 30 s per command, then the process group is killed; barge-in
  kills it too. `rg`, `git`, `python3`, `node`, `zip`, `sed` and `awk` work; `textutil` and
  `mdls` don't (they need system services the sandbox blocks).

## Skills

What the user taught Stanley, written down once: how they like something done ("how I write
emails"), or what to do when they say something ("when I say it's time for a break, play…"). They
are the Agent Skills format coding agents use, where coding agents keep them: a folder per skill in
`.agents/skills/` in the user's folder, which is `~/.agents/skills/` to commands, as `HOME` is the
folder. A `SKILL.md` starts with front matter (`name`, the folder's name; `description`, what it
does and when to use it), then says what to do. The user edits them in any editor; Stanley writes
and changes them with its file tools when asked. No tool or prompt is skill-specific beyond that:
models know the format.

- **Read from disk each time** (`FileTools.skills`, parsed by `parseSkill` in `skills.ts`), so a
  change shows at once. A `SKILL.md` that can't be used (no front matter or description, a name that
  isn't its folder's) is listed with why, for thinking to fix when asked.
- **Jev** has `use skill: <name>`, described by the skill's description, and the line in its
  prompt that a skill a request is for comes first, then what it says, a step at a time. Reading it
  is a look, like `read file:`: it runs mid-word, goes into the history as `cat -- '…/SKILL.md'`
  with its output, and Jev reads all of what it says (the latest read of each skill; earlier ones
  as a line). When Jev's step is sure of a skill, it is read whatever Jev says comes next: Jev
  tends to listen or hand over on a short request like "time for a break", and decides well once
  the skill is in view. So a routine runs on the fast path: open Music, then press the song.
- **Thinking** has a `## Skills` section in its instructions: where they are, the format, to read
  a skill a request is for before anything else, and to write, change or delete one only when the
  user asks. It lists the skills as they were when the session started, so the instructions never
  change. A change since then comes as a note with the next observation (`The skills changed:
  added "focus": …`), and right in the result of a command or file write that changed them, so
  thinking hears at once when a skill it wrote can't be used.
- **Kept like every file**: the snapshots include `.agents/`, and `paths()` leaves hidden folders
  out, so skills are offered once, as skills, not again as files.

## Surfaces and layout

- Every app instance is a **surface**: a live view that exists whether or not it's visible.
- The **layout** decides which surfaces are on screen. v1: a single slot.
- Background = acting on a surface not in the layout. `show` puts the working surface in the layout.
  Example: "weather in Denver" → agent drives a hidden weather surface (open Weather, thinking types
  "Denver", Enter, says the forecast) → `show`. The user sees one jump.
- A surface whose window holds something live (the Web app's page) keeps its window while hidden:
  out of sight and out of reach, still laid out, so the page keeps running and can be worked.
- Later: layout gains options like "side by side".

## Voice

- **Push-to-talk**: global toggle `⌥Space` (Electron `globalShortcut`). The mic stays on until the
  second press. The agent ends the utterance when the user has finished (see **Turn-taking**)
  without turning the mic off; the next words start a new one. Pressing mid-task = barge-in: new
  utterance in the same task.
- **STT**: NVIDIA Parakeet TDT 0.6B **v2** (English) via **sherpa-onnx** (`sherpa-onnx-node`) in main.
  Parakeet is offline-only, so live = **Silero VAD** segments + re-decode the current segment every
  ~400 ms for partials; finalize at VAD pause. Accuracy over true streaming.
  Each decode includes 0.6 s of audio before the VAD's (late) speech onset, plus up to 10 s of the
  utterance's earlier speech as context; token timestamps pick out only the new words. Earlier
  segments are never revised — the agent has already acted on them.
- Mic capture in the renderer (`getUserMedia`, 16 kHz mono PCM via AudioWorklet) → IPC → main.

### Speaking

Stanley talks back with **Kokoro 82M v1.0** (Apache-2.0, voice `af_heart`, `STANLEY_VOICE` picks
another) through sherpa-onnx in main, 6 threads: ~200 ms + ~0.23× the audio's length on an M1 Pro.
Without the model, what it says is only shown.

- **Streamed.** Thinking streams its text (`streamText`; `write` streams its `say` field). A reply waits for the user's turn to end, as before, then goes out as it is written
  (`speak` events); words the user adds first drop it.
- **Cut into pieces** (`Segmenter`). The first piece is short so speech starts quickly: a sentence
  or clause within 60 characters, else a break before a new phrase ("…built in 1889 | by Gustave
  Eiffel"). After that nothing is rushed: the next piece is cut only when the audio queued ahead is
  about to run out (its estimated synthesis time + 300 ms), as large as fits (≤ 400 characters), at
  the latest sentence end. Kokoro reads more naturally with more at once, and there are fewer seams.
- **Played in the renderer** through Web Audio, so Chromium's echo cancellation on the mic hears it.
  The player reports each piece's start and end; main knows how much is queued and how much of a
  reply has been said, to the word. Music plays at a quarter of its volume while Stanley talks or
  the user speaks: from the mic's level first rising (~100 ms, ahead of the VAD) to the end of the
  utterance.
- **Talking over music.** On speakers the canceller suppresses the user's voice along with loud
  music, and the transcriber loses it (70–98% of words wrong at full volume, measured with `say`
  over the MacBook's speakers). Music alone doesn't trouble the transcriber, but sung words reach it
  as speech. So the mic opens twice, with the canceller and without: the cancelled one's level says
  when the user is talking, and while they are and Stanley isn't, the transcriber hears the
  uncancelled one.
- **What was heard is what was said.** When a reply is stopped, the conversation keeps only the
  words played (`cut`): "Stanley started to say: "…" but the user cut in."

Measured: the first words play ~0.4–1.3 s after Haiku's first text, depending on the first piece.
Kokoro reads `&` as "and" and pauses at parentheses, but reads `/` as "slash" and `°F` as "degrees F".

### Barge-in

Assumes speakers. While Stanley talks, what the mic hears goes to `BargeIn` instead of the agent
until it is settled:

1. **Its own voice is taken out.** Runs of two or more heard words that match, in order, what
   Stanley was just saying are echo. A single word ("yes", "send") stays the user's.
2. **It ducks at once.** The VAD hearing speech lowers Stanley to 30% while the words come in.
3. **Jev judges the words**: `acknowledging` ("mm-hm", mid-sentence), `interrupting` ("wait", a
   correction, a new request), `answering` (as Stanley finishes asking), or `elsewhere` (someone
   else, noise, echo). It sees the conversation, what Stanley has said and has still to say, and the
   words, and is asked again as more come. P(interrupting + answering) ≥ 0.5 stops Stanley;
   P(acknowledging + elsewhere) ≥ 0.6 brings it back up. Four words not judged a go-on stop it
   without waiting. Unsure when the user goes quiet: whichever it leaned to.
4. **Stopping** stops playback, aborts thinking still writing the reply, logs what was heard, and
   starts a new utterance with the user's words. **Going on** forgets the words, also as decoding
   context for what comes next. Words heard as Stanley finishes are the user's next turn.

Measured with injected speech: "Wait, stop." ducked at speech onset, was judged `interrupting` (1.00)
in ~560 ms, and stopped Stanley 0.6 s after the user started.

## Presence

The system shows itself as a glowing wave, not an avatar: across the centre with no window open,
docked to the bottom edge under one. It combines Stanley's voice with two tracks that run at once:
- **Voice** (main → snapshot): `talking`, from Stanley's first words to its last.
- **Ear** (main → snapshot): `listening`, `speaking` (VAD), `utteranceOpen`.
- **Brain** (`AgentStatus`): `guessing` (deciding mid-utterance before acting on it), `thinking`,
  `writing` (typing into a field), `acting`, `listening` (waiting for more words), `done`,
  `didnt-get-that`, `stuck`, `error`.

`presence()` (renderer) picks one: Stanley talking wins (`speaking`, pulsing with its voice, softer
as it ducks), then work wins over the ear, so it reads as working while you talk; the mic level is
layered on every state. Writing is thinking's shape in warmer colors. Shape = focus (diffuse → gathered), color = whose turn (cool = on
you, violet/spectrum = on the task, amber = trouble), motion = energy (breathing, voice-reactive,
scanning, pulsing, flowing). Guesses are held ~1.5 s through gaps between ticks; outcomes fade to armed.

## Models

All via **Vercel AI Gateway** with the AI SDK (`ai`, pinned exactly), one `AI_GATEWAY_API_KEY`.

- **Jev**: `experimental_decide({ model: 'typesafe-ai/jev', state, questions })`. Confidence at
  `providerMetadata.typesafe.confidence[questionId]`. `packages/jev` normalizes each answer to
  `{ choice, probabilities, confidence }`: `decide` for several questions in one call, `choose` for
  one, plus a mock.
- **Thinking**: GPT-6.1 Sol via gateway (GPT-6 Luna for a single write step) behind a
  `Thinker` interface with one method, `run`: a tool loop with `act`, plus `search`, `fetch` and
  `open_page` when the agent has them, or one step whose calls come back unrun (write).
- **Web**: Parallel Search and Extract APIs (`PARALLEL_API_KEY`), in `@stanley/app-web/parallel`:
  the agent's background search and fetch, and the Web app's page reader where it has no live page
  (tests and evals).
- **Weather**: Open-Meteo forecast + geocoding (no key).
- **Lights**: the Hue Bridge's local API (v1, HTTP). The bridge is found by Philips' discovery service or
  `HUE_BRIDGE`; Connect gets a key in the 30 s after its link button is pressed, kept in the shell's store.

## Demo apps

| App | Data | Notes |
| --- | --- | --- |
| Tasks | seeded, in-memory | "Add a task" box (Enter adds); each task row has a checkbox and Delete |
| Email | seeded, in-memory | Inbox / Sent tabs, the inbox list, an open email with Mark unread / Archive / Delete, a reply box and Send reply |
| Weather | Open-Meteo | "Search a city" box (Enter looks up), current conditions, one button per day |
| Music | a hard-coded 12-track playlist, mostly lo-fi from a SoundCloud set, played through SoundCloud's embedded player | Previous / Play / Next buttons; Volume down, a Volume slider (a field taking a percentage) and Volume up, kept across sessions; one button per track |
| Lights | your Philips Hue Bridge | Rooms and zones, each a row with a switch, and "Turn all off"; a room has its switch, a Brightness slider (a field taking a percentage), scene buttons, color swatches and a switch per light |
| Web | a live webview | The page's own elements and text (see **Websites**). Not in the agent's app list, since it shows nothing on its own; known pages open in it, the ones it opened included |

Each app's `nodes()` lists only what its screen shows, labelled as the UI labels it.

Seeded data resets each launch. The user can also click/type in apps directly; those go through
the same action handlers.

## Debug window

The main window stays clean; **Debug → Open Debug Window** (⌘⇧D) opens a separate window for
diagnosing agent behaviour. It is driven by one structured stream (`DebugEvent`): the agent's trace
(`AgentDebugEvent`: every tick request including ones that never ran, exact Jev input, both answers,
guardrail gates with thresholds, button effects, each thinking call with why, step results), STT
timing (VAD, decode latency, dropped partials, silence), app events (mic, status, typed/manual input)
and the history's records. Each session's stream is written to
`userData/sessions/<session>.debug.jsonl` next to the history JSONL, and each background task's
own log to `<session>.task-N.jsonl`.

- **Timeline** grouped by task; optional rows for partials, VAD, skipped requests, status.
- **Tick inspector**: what was heard and why the tick ran, what Jev decided vs what took effect,
  gating, button effects, each thinking call (its exact input, message by message, rebuilt from the
  history; steps; what it said; tokens in, cached and out; Copy model input), steps, both questions'
  options ranked by probability, the full Jev state.
- **History**: every entry, who chose it, Jev's confidence and heard words; staged entries marked.
- **Replay**: re-run a tick against Jev as recorded or with an edited state or questions.
- **Copy as eval** turns a task into a scenario literal for `evals/scenarios.mts`.
- **Past sessions** load from disk via the session picker.

## Development and evaluation

- **Typed utterances**: the debug window's text box (and `window.stanley.say`) injects an utterance as if spoken.
- **Headless evals**: `pnpm eval [filter…]` runs scenarios with the real Shell, apps, Jev and Sonnet,
  no Electron; `pnpm eval:web` runs the same agent on fixture websites in headless Chromium, and
  `--live` on real ones. Utterances are fed word by word to exercise live ticking. `--runs N` reports
  pass rates, `--trace` prints what the models read at the end. See `evals/README.md`.
- **Held out**: no eval utterance may share a 4-word run with any prompt, option description or app
  label (`evals/leak.test.ts`), so a pass can't come from a prompt fitted to the test.
- **Unit tests**: `pnpm test` covers the loop (turn-taking, mid-word holds, stale discard, gating,
  writing, commits, thinking, loops, task boundaries) with scripted models, the conversation
  rendering, option building, the shell's screens and back, and page extraction in real Chromium.
- **Desktop smoke test**: `pnpm smoke:desktop` builds and launches the real app, types two utterances
  and screenshots the main and debug windows.
- **Audio injection**: set `localStorage['stanley.noMic']` so tests can stream audio through the real
  IPC → STT path without the microphone mixing in.
- **Push-to-talk**: `⌥Space`, falling back to `⌘⇧Space`; override with `STANLEY_PTT`. The header shows
  whichever registered.

## Status

Working, verified end to end:
- Jev via AI Gateway (~250–400 ms per decision), Sonnet thinking, Parallel search + extract,
  Open-Meteo.
- Parakeet + Silero live transcription: partials every ~430 ms, segments at pauses, silence
  auto-end at 2 s; model loads in ~1.3 s. Verified by streaming synthesized speech through the app.
- All five apps; background work with a single reveal; debug window decision timeline.
- Evals: demo apps 84/84 (42 scenarios × 2, including 9 turn-taking ones and 4 web lookups),
  fixture websites 28/30 (15 × 2; both misses passed 4/4 on rerun, as before the change), live websites 8/8 (4 × 2), synthetic voice through the real transcriber and Smart Turn
  10/10 on the turn-taking set.
- Files: 5 scenarios (answer from a file, add a line, add up a column, new file, delete when
  asked), 13/15 over 3 runs. The misses are `files-answer`, where Jev opens Tasks on "my packing
  list…" before the file name is said; it still answers from the file.
- Turn detection (`pnpm eval:turn`, LiveKit EoT benchmark, 100 real clips): the turn's end is called
  0.75 s after the last word (median) vs 2 s before, and 4% of mid-turn pauses cut in vs 11%.

Not yet verified / known gaps:
- Turn-taking on your own voice: Smart Turn's value is prosody, which typed and synthetic-voice
  evals don't have. Record the turn-taking clips (`evals/speech/prompts.txt`) and run
  `pnpm eval:voice`.
- Whether unsure-word marks and screen hotwords catch real mishearings in your voice: needs
  recorded clips (`pnpm eval:stt`). Confidently wrong words (no mark) still go through.
- Writing after a pause is serial (Jev picks the field, then the writer runs): starting the writer
  as soon as a segment lands on a field Jev already chose would save ~0.3 s.
- Real microphone capture (needs macOS mic permission for the dev Electron binary; a packaged app
  needs `NSMicrophoneUsageDescription`).
- Live pages in the desktop app are verified by hand against a local test site, not by an eval:
  the website evals drive Playwright, not the Electron view.
- Thinking steps make writing and sending slower than the fast path alone: typically 2–4 s to settle
  after the user stops, vs 1–2 s for pure navigation.
- Native apps would need an OS accessibility adapter producing the same `Screen`.
- Files: the snapshot before and after each command runs `git status`, which slows down on a large
  folder, and large binaries grow the history. Rich documents (PDF, Word) can't be read yet: the
  tools that extract their text don't run in the sandbox.

## Architecture

Agent loop, STT, Jev client, and **app logic run headless in the Electron main process**. Each app
is a module exposing state, `nodes(state)` (its screen's elements), an action handler, and
`toMarkdown(state)`, so hidden surfaces need no DOM. The Svelte renderer is a thin view of the surfaces in the layout, synced over
IPC.

```
apps/desktop          Electron shell: main, preload, Svelte renderer, layout, debug window
packages/app-sdk      AppModule / Node / Surface / Action types
packages/agent        loop, tick scheduler, message log, conversation, guardrails, options, thinking
packages/jev          Jev client (AI SDK decide) + mock
packages/browser      any web page as a screen: generic extractor + Playwright World
packages/files        the user's files folder: sandboxed bash, every version kept in git
packages/stt          sherpa-onnx + Parakeet + Silero VAD → partial/final events; Smart Turn on pauses
packages/tts          Kokoro via sherpa-onnx; segmenter; speaker (pacing, what was said)
packages/app-tasks     ./core (headless) + ./ui (Svelte)
packages/app-email    ″
packages/app-weather  ″
packages/app-lights   ″ (Hue Bridge client in src/hue.ts)
packages/app-music    ″ + ./player (headless <audio>, mounted while the surface exists)
packages/app-web      ″ + ./parallel (Parallel search and extract: the agent's lookups, the page reader)
evals                 scenario evals with real models: demo apps, websites (fixture and live), voice, STT
```

pnpm workspaces. Internal packages ship TS source (compiled by Vite), no per-package build.

### Stack

Electron 44 · electron-vite 5 · Vite 7 · Svelte 5 · TypeScript 5.9 · pnpm.

### Config / secrets

`.env` (gitignored): `AI_GATEWAY_API_KEY`, `PARALLEL_API_KEY`, optionally `STANLEY_FILES`. `pnpm models` downloads Parakeet,
Silero, Smart Turn and Kokoro into `models/` (gitignored).
