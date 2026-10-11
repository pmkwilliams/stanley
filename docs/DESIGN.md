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
- Toy apps: To-do, Email, Weather, Music, Web (search + webview).
- A debug window that explains every decision.

**Not in v1**: wake phrase, multi-window layouts, spoken responses (Stanley's replies are text on
screen for now), persistence across launches, real websites inside the desktop app (the agent drives
them in the evals; see **Websites**).

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
- **Slow: thinking** (Claude Haiku 5.5). Anything that needs words or judgement: what goes in a
  field, whether to press something that sends or deletes, answering, asking, and working out a
  request the fast part can't.

Both read the same conversation (see **Context**), act through the same options, and write their
steps to the same log in the same voice. A handoff to thinking is not an error path; it is how
Stanley writes, talks and judges.

### What the agent sees: the screen

Each tick the world provides (`World` in `packages/agent/src/world.ts`):

- **The screen**: the surface Stanley is working on (which may be hidden, see **Surfaces**), as
  readable markdown, plus its interactive **elements**. An element has a role and the name a person
  would see (`link`, `button`, `field`, `checkbox`, `switch`, `tab`…), any visible state or value,
  and the container that tells it apart when its name repeats (`"Lunch Friday?" › Archive`,
  `Blue ceramic mug › Add to cart`).
- **Apps** that can be opened from anywhere, plus `back` (the previous screen, like a browser's
  back button) and `home`.

Only what is on the current screen is offered. The agent can't reach into a screen it isn't on,
because on a real website it can't either: to archive an email it opens the email, then presses
Archive. On a long page, Jev gets what is in view plus the elements that match the user's words
(`stepOptions`), and can scroll.

Apps describe their screens with `nodes(state)`: `location` = link, `action` = button, `input` =
field, `group` = a container that only gives context. Labels are what the UI shows (`Send reply`,
`Add a task`), descriptions only secondary visible text. Nothing in them may coach the agent, and the
demo apps don't set the `destructive` hint, so the agent's own judgement is what gets tested.

### A tick (Jev)

One Jev call per tick, with two questions about the same state:

1. **next**: what Stanley should do now.
   - `listen`: the user hasn't finished saying what they want.
   - `act`: take the next step on screen.
   - `think`: the next part needs words or judgement.
   - `done`: what the user asked for is done, and any question has been answered out loud.
2. **step**: which element, app, `back` or `home` the step would be.

Splitting them keeps the step's probability from being spread across the turn-taking options, and
the turn-taking decision from being split across dozens of near-identical elements (a replay of real
decisions showed the old single question giving 50% to an option whose route held 98%). Then:

| Jev says | What happens |
| --- | --- |
| `act` on a link, app, `back`, `home` | Runs at once, even mid-word (navigation is cheap to undo) |
| `act` on a button | Runs at a pause, unless it **commits** (see **Effects**): then thinking confirms |
| `act` on a field | Thinking writes what goes in it (one call), then the fast part carries on |
| `act`, unsure of `act` or of the step | Listens while the user speaks; after they finish, thinking takes the turn |
| `think` | Thinking takes the turn, at a pause |
| `listen` | Waits for more words; after the user finished, thinking takes the turn (usually to ask) |
| `done` | Ends the task and shows the working surface; if unsure once the user finished, thinking checks first |

### Thinking

One model, one prompt (`THINKING_PROMPT`), the same conversation, three ways in:

- **write** (one structured call): the fast part chose a field. Thinking returns the text, whose
  words they are (`user`: said by the user or following directly from the request, like a search
  query or a city; `stanley`: written from a description; `missing`: nothing to go on, or it depends
  on a choice the user hasn't made), and anything to say. Then the fast part continues (Enter,
  Send, done), unless thinking said something, which hands the turn to the user.
- **confirm** (one structured call): the fast part chose a button that commits. Thinking presses it
  only if the user asked for that and has heard any words Stanley wrote itself; otherwise it says
  what is ready and asks. Asking to reply or post with given words is asking to send; asking to
  draft is not.
- **run** (a short tool loop over `act(option, text?)`, the same options as Jev): for `think` turns.
  It answers, asks, or works the screen itself. Its text is speech: shown now, spoken later.

Whatever thinking does is dropped if the user says more while it works (steps already taken stay
done and logged; it says nothing). Jev then re-decides with everything they said. After a `run`, the
task ends; what was said is in the conversation, so a follow-up ("yes, send it") is Jev's.

### Effects: what a button does

Real apps and pages don't label their buttons, so the agent judges. The first time a button is
chosen, one Jev question classifies what pressing it does, from its name, its context and the
screen: `looks` (shows or fetches), `changes` (the user's own data, easy to undo) or `commits`
(reaches other people or the outside world, deletes, archives, or is otherwise hard to undo). Unsure
between changing and committing counts as committing. The answer is cached per app and label, since
a button's effect doesn't change; the conversation isn't sent, so the cache is honest.

Only `commits` goes to thinking. Confidence is not consent, but consent is a judgement about the
conversation, so the model that can reason about the conversation makes it.

### Tick scheduling

Invariant: **never more than one Jev call in flight.**

Tick when:
1. new stable words arrived since the last call, or
2. a step just ran (the screen changed, so keep going), or
3. the utterance ended (toggle pressed again, or ~2 s silence).

After `listen` or `done`, only (1) or (3) trigger a tick.

**Stale results**: if new words arrived while a call was in flight, the result is discarded and we
re-tick with the fresh transcript, unless it is a navigation with step confidence ≥ 0.8 (then run
it, then re-tick). Only new words make a result stale: the utterance ending mid-call does not.

**Deferred ticks**: a tick requested while a call is in flight is remembered by reason and replayed
when the call settles. A step-driven tick wins, so the agent keeps going mid-utterance.

**"New words"**: normalize (lowercase, strip punctuation) finalized segments + current partial
*minus its last (volatile) word*. Trigger if it differs from what the last call saw **and** the word
count grew, or a segment finalized.

### Guardrails (one tunable config, `config.ts`)

| Guard | Default |
| --- | --- |
| `act` needs at least this P(act) while the user is speaking, else listen | 0.6 |
| …and after they finish, else thinking | 0.4 |
| `done` after they finish needs at least this, else thinking checks | 0.5 |
| The chosen step needs at least this confidence, else listen / thinking | 0.4 |
| P(commits) at or above this sends a button to thinking | 0.3 |
| Max steps per utterance → stop ("got stuck") | 15 |
| Oscillation: same step from the same screen N times in the last M steps → stop | 3 in 6 |
| Stale navigation still runs at step confidence ≥ | 0.8 |
| Elements offered per tick / to thinking | 50 / 150 |
| Thinking tool steps | 10 |

A field chosen during a pause with nothing to type yet ("called… um…") isn't a step, so a long
pause can't trip the loop guard.

## Context

### Canonical log

One append-only message log per app launch (`log.ts`): what the user said (per VAD segment, tagged
with its utterance), every step (target, text and whose words, result, which part of Stanley chose
it, Jev's answers), what Stanley said, the user's own clicks and typing, and task boundaries.
Appended to `userData/sessions/<ts>.jsonl`.

### The conversation (what every model reads)

The log is not the context. Every model reads the same rendering of it, `narrate()`, which keeps
only what a person watching would need:

```
## Conversation
User: add a new to do called um avocado
Stanley opened To-do.
Stanley typed "Avocado" into [Add a task].
Stanley pressed Enter in [Add a task]: Added to-do "Avocado".
User: open the email from Sam
Stanley opened Email.
Stanley opened [Sam Lee: Lunch Friday?].
User: let's reply with something funny
Stanley wrote its own words into ["Lunch Friday?" › Reply to Sam Lee]: "Ramen? I was born ready."
Stanley said: "I wrote "Ramen? I was born ready." Should I send it?"

## Screen: Email (in front of the user)
…markdown of the screen…
```

- **The user's words come as turns**: all segments of an utterance on one line, placed before
  anything Stanley did for it, marked `(still speaking)` while the utterance is open.
- **Steps are outcomes**: links opened, text typed (and whose words), buttons pressed with the
  app's result summary.
- **Not included**: listen/done decisions, discarded or gated decisions, retries, and which model
  took a step. Those are the agent's mechanics; the debug trace has them.
- **The screen appears once**, at the end. Earlier screens are not repeated.
- **Long sessions** keep the last 20 user turns.

Jev's `state` is the system prompt followed by this; its option lists are the two questions. Thinking
gets its own prompt, the same conversation, why it was called, and the options. One rendering keeps
the models agreeing about what has happened, and keeps the trace readable: if a person can't follow
it, a model can't either.

## Websites

`packages/browser` turns any web page into a screen, with no site-specific code:

- **Extraction** (`extract.ts`) is plain JavaScript run in the page: interactive elements by role
  and accessible name (aria-label, labelledby, `<label>`, placeholder, text, descendant alt/title),
  state (checked, on/off, selected, expanded, disabled), field values, and for repeated names the
  container's label, heading or main link. Elements with no name are dropped. The markdown is the
  page's `main` content from the scroll position on, with controls inline as `[name: value]`.
- **`PageWorld`** is a `World` over a Playwright page: bookmarked sites are the apps, steps are real
  clicks, typing and Enter, `Scroll up/down` are elements, and a step reports what visibly changed
  (a generic page can't say what a click did).

It runs in the evals today. Being plain JS, the extractor can run in an Electron `WebContentsView`
next, which is how the desktop app would drive real sites.

## Surfaces and layout

- Every app instance is a **surface**: a live view that exists whether or not it's visible.
- The **layout** decides which surfaces are on screen. v1: a single slot.
- Background = acting on a surface not in the layout. `show` puts the working surface in the layout.
  Example: "weather in Denver" → agent drives a hidden weather surface (open Weather, thinking types
  "Denver", Enter, says the forecast) → `show`. The user sees one jump.
- Later: web views are `WebContentsView`s kept offscreen; layout gains options like "side by side".

## Voice

- **Push-to-talk**: global toggle `⌥Space` (Electron `globalShortcut`). The mic stays on until the
  second press. ~2 s of silence ends the utterance without turning the mic off; the next words start
  a new one. Pressing mid-task = barge-in: new utterance in the same task.
- **STT**: NVIDIA Parakeet TDT 0.6B **v2** (English) via **sherpa-onnx** (`sherpa-onnx-node`) in main.
  Parakeet is offline-only, so live = **Silero VAD** segments + re-decode the current segment every
  ~400 ms for partials; finalize at VAD pause. Accuracy over true streaming.
  Each decode includes 0.6 s of audio before the VAD's (late) speech onset, plus up to 10 s of the
  utterance's earlier speech as context; token timestamps pick out only the new words. Earlier
  segments are never revised — the agent has already acted on them.
- Mic capture in the renderer (`getUserMedia`, 16 kHz mono PCM via AudioWorklet) → IPC → main.

## Presence

The system shows itself as a glowing wave, not an avatar: across the centre with no window open,
docked to the bottom edge under one. It combines two tracks that run at once:
- **Ear** (main → snapshot): `listening`, `speaking` (VAD), `utteranceOpen`.
- **Brain** (`AgentStatus`): `guessing` (deciding mid-utterance before acting on it), `thinking`,
  `writing` (typing into a field), `acting`, `listening` (waiting for more words), `done`,
  `didnt-get-that`, `stuck`, `error`.

`presence()` (renderer) picks one: work wins over the ear, so it reads as working while you talk; the
mic level is layered on every state. Shape = focus (diffuse → gathered), color = whose turn (cool = on
you, violet/spectrum = on the task, amber = trouble), motion = energy (breathing, voice-reactive,
scanning, pulsing, flowing). Guesses are held ~1.5 s through gaps between ticks; outcomes fade to armed.

## Models

All via **Vercel AI Gateway** with the AI SDK (`ai`, pinned exactly), one `AI_GATEWAY_API_KEY`.

- **Jev**: `experimental_decide({ model: 'typesafe-ai/jev', state, questions })`. Confidence at
  `providerMetadata.typesafe.confidence[questionId]`. `packages/jev` normalizes each answer to
  `{ choice, probabilities, confidence }`: `decide` for several questions in one call, `choose` for
  one, plus a mock.
- **Thinking**: Claude Haiku 5.5 via gateway behind a `Thinker` interface: `write` and `confirm` are
  single structured calls (`generateText` with `Output.object`), `run` is a tool loop with one `act`
  tool.
- **Search**: Parallel Search API (`PARALLEL_API_KEY`).
- **Weather**: Open-Meteo forecast + geocoding (no key).

## Demo apps

| App | Data | Notes |
| --- | --- | --- |
| To-do | seeded, in-memory | "Add a task" box (Enter adds); each task row has a checkbox and Delete |
| Email | seeded, in-memory | Inbox / Sent tabs, the inbox list, an open email with Mark unread / Archive / Delete, a reply box and Send reply |
| Weather | Open-Meteo | "Search a city" box (Enter looks up), current conditions, one button per day |
| Music | bundled tracks | Previous / Play / Next / Volume buttons, one button per track |
| Web | Parallel search + webview | "Search the web" box (Enter searches), result links; an open page shows Back to results |

Each app's `nodes()` lists only what its screen shows, labelled as the UI labels it.

Seeded data resets each launch. The user can also click/type in apps directly; those go through
the same action handlers.

## Debug window

The main window stays clean; **Debug → Open Debug Window** (⌘⇧D) opens a separate window for
diagnosing agent behaviour. It is driven by one structured stream (`DebugEvent`): the agent's trace
(`AgentDebugEvent`: every tick request including ones that never ran, exact Jev input, both answers,
guardrail gates with thresholds, button effects, what thinking wrote, confirmed or did, step results), STT timing (VAD, decode latency, dropped
partials, silence), app events (mic, status, typed/manual input) and the message log. Each session's
stream is written to `userData/sessions/<session>.debug.jsonl` next to the message-log JSONL.

- **Timeline** grouped by task; optional rows for partials, VAD, skipped requests, status.
- **Tick inspector**: what was heard and why the tick ran, what Jev decided vs what took effect,
  gating, button effects, writing / go-ahead / thinking with their exact context, steps, both
  questions' options ranked by probability, the full Jev state.
- **Replay**: re-run a tick against Jev as recorded or with an edited state or questions.
- **Copy as eval** turns a task into a scenario literal for `evals/scenarios.mts`.
- **Past sessions** load from disk via the session picker.

## Development and evaluation

- **Typed utterances**: the debug window's text box (and `window.stanley.say`) injects an utterance as if spoken.
- **Headless evals**: `pnpm eval [filter…]` runs scenarios with the real Shell, apps, Jev and Haiku,
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
- Jev via AI Gateway (~250–400 ms per decision), Haiku thinking, Parallel search + extract,
  Open-Meteo.
- Parakeet + Silero live transcription: partials every ~430 ms, segments at pauses, silence
  auto-end at 2 s; model loads in ~1.3 s. Verified by streaming synthesized speech through the app.
- All five apps; background work with a single reveal; debug window decision timeline.
- Evals, 3 runs each: demo apps 75/75 (25 scenarios), fixture websites 36/36 (12), live websites 4/4.

Not yet verified / known gaps:
- Real microphone capture (needs macOS mic permission for the dev Electron binary; a packaged app
  needs `NSMicrophoneUsageDescription`).
- Real websites inside the desktop app: the Web app still reads pages through Parallel Extract.
  Next: run `packages/browser`'s extractor in offscreen `WebContentsView` surfaces.
- Thinking steps make writing and sending slower than the fast path alone: typically 2–4 s to settle
  after the user stops, vs 1–2 s for pure navigation.
- Native apps would need an OS accessibility adapter producing the same `Screen`.

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
packages/stt          sherpa-onnx + Parakeet + Silero VAD → partial/final events
packages/app-todo     ./core (headless) + ./ui (Svelte)
packages/app-email    ″
packages/app-weather  ″
packages/app-music    ″ + ./player (headless <audio>, mounted while the surface exists)
packages/app-web      ″ (Parallel search; page view = WebContentsView later)
evals                 scenario evals with real models: demo apps, websites (fixture and live), voice, STT
```

pnpm workspaces. Internal packages ship TS source (compiled by Vite), no per-package build.

### Stack

Electron 44 · electron-vite 5 · Vite 7 · Svelte 5 · TypeScript 5.9 · pnpm.

### Config / secrets

`.env` (gitignored): `AI_GATEWAY_API_KEY`, `PARALLEL_API_KEY`. `pnpm models` downloads Parakeet +
Silero into `models/` (gitignored).
