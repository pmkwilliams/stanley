# Stanley — Design (v1 demo)

Voice-controlled desktop assistant. The user speaks, a local STT model transcribes live, and an
agent operates apps on their computer: a fast decision model (TypeSafe **Jev**) picks each next step
from what is on screen, and a language model takes over whatever needs words or judgement. v1 runs
over a few demo apps, which stand in for arbitrary apps and websites.

## Goals / non-goals

**v1 goals**
- Push-to-talk (global toggle) with live transcription.
- Agent loop driven by Jev choosing from: navigation/action nodes + global options.
- Background work: the agent can operate on surfaces the user can't see and reveal the result.
- Toy apps: To-do, Email, Weather, Music, Web (search + webview).
- A debug window that explains every decision.

**Not in v1**: wake phrase, multi-window layouts, spoken responses (Stanley's replies are text on
screen for now), persistence across launches.

## The agent

Stanley has to work on any app or website, not only on the demo apps. Everything below is written
against what any screen offers (elements with a role and a visible name, plus readable content) and
never against what one demo app happens to expose. The demo apps are test fixtures: they present
their screens the way an accessibility tree would, with no hints written for the agent.

### One agent, two speeds

Several models do the work, but it should read as one Stanley, in the trace and to the user.

- **Fast: Jev** (~330 ms). Decides turn-taking and takes clear, reversible steps, including while
  the user is still speaking: open an app, go to an item, press play, mark done.
- **Slow: thinking** (Claude Haiku 5.5, a short tool loop, ~1–4 s). Anything that needs words or
  judgement: typing text into a field, answering or asking the user, deciding whether to send /
  delete / buy, and working out a request the fast path can't.

Both read the same conversation (see **Context**), act through the same options, and write their
steps to the same log in the same voice. A handoff to thinking is not an error path; it is how
Stanley writes, talks and judges.

### What the agent sees: the screen

Each tick the world provides:

- **The screen**: the surface Stanley is working on (which may be hidden, see **Surfaces**), as
  readable markdown, plus its interactive **elements**. An element has a role and the name a person
  would see: `link`, `button`, `field` (text input), with the containers it sits in for context
  (`"Lunch Friday?" › Archive`). This is the shape an accessibility tree gives for a web page or a
  native app.
- **Apps** that can be opened, plus `back` and `home`.

Only what is on the current screen is offered. The agent can't reach into a screen it isn't on,
because on a real website it can't either: to archive an email it opens the email, then presses
Archive.

Apps describe their screens with `nodes(state)`: `location` = link (navigates), `action` = button,
`input` = field. Labels are what the UI shows (`Send reply`, `Add a task`), and descriptions are
only secondary visible text (a sender and date, a field's current value). Nothing in them may coach
the agent.

### A tick (Jev)

One Jev call per tick, with two questions about the same state:

1. **next**: what Stanley should do now.
   - `listen`: the user hasn't finished saying what they want.
   - `act`: take the next step on screen.
   - `think`: the next step needs words or judgement (typing text, answering, asking, confirming,
     or working out something unclear).
   - `done`: what the user asked for is done.
2. **step**: if acting, which element, app, `back` or `home`.

Splitting the two keeps the step's probability from being spread across the turn-taking options,
and the turn-taking decision from being split across dozens of elements. Then:

- `act` on a link, app, `back` or `home` runs at once, even mid-word (navigation is cheap to undo).
- `act` on a button runs once the user pauses, unless it **commits** (below), in which case thinking
  decides.
- `act` on a field hands the turn to thinking, which writes the text.
- `act` with a step below `stepConfidence` hands the turn to thinking instead of guessing.
- `think` hands the turn to thinking, at a pause.
- `listen` after the user finished is a dead end, so thinking takes the turn (usually to ask).
- `done` ends the task and shows the working surface.

### Thinking

A language model with one tool, `act(option, text?)`, over the same options Jev sees (the screen's
elements, apps, back, home), rebuilt after every step. Its text is speech: shown on screen now,
spoken later. It is prompted as Stanley, not as a helper of another model.

- **Fields**: when the user dictated the words ("called avocado", "saying I'm in"), type their words.
  When they only described them ("something funny", "tell her no"), write them, type them, and read
  them back before anything is sent. When they gave nothing to go on, ask.
- **Commits**: press a button that sends, deletes, buys, posts or shares only when the user asked for
  that. Otherwise get it ready and ask.
- **Whole turns only**: it runs at a pause, and is dropped if the user says more (actions already
  taken stay done and logged; it says nothing). Jev then re-decides with everything they said.
- After it finishes, the task ends. What it said is in the conversation, so a follow-up ("yes, send
  it") is Jev's to handle.

### Effects: what a button does

Real apps and pages don't label their buttons, so the agent judges. The first time a button is
chosen, one Jev question classifies what pressing it does, from its name, its context and the
screen: `looks` (shows or fetches), `changes` (the user's own data, easy to undo) or `commits`
(reaches other people or the outside world, deletes, or is otherwise hard to undo). The answer is
cached per app and label, since a button's effect doesn't change. An app may hint `destructive`;
that makes it `commits` without asking.

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

### Guardrails (one tunable config)

| Guard | Default |
| --- | --- |
| `act` needs at least this P(act) while the user is speaking, else `listen` | 0.6 |
| …and after they finish, else thinking | 0.4 |
| `act` needs at least this step confidence, else thinking | 0.4 |
| Max steps per utterance → stop ("got stuck") | 15 |
| Oscillation: same step from the same screen N times in the last M steps → stop | 3 in 6 |
| Stale navigation still runs at step confidence ≥ | 0.8 |
| Elements offered per tick / to thinking | 50 / 150 |
| Thinking tool steps | 10 |

## Context

### Canonical log

One append-only message log per app launch: what the user said (per VAD segment, tagged with its
utterance), every step (option, element, text, which part of Stanley chose it, and the result),
what Stanley said, the user's own clicks and typing, and task boundaries. It also records every
decision with its probabilities, for the debug window. It is appended to
`userData/sessions/<ts>.jsonl`.

### The conversation (what every model reads)

The log is not the context. Every model reads the same rendering of it, `narrate()`, which keeps
only what a person watching would need:

```
## Conversation
User: add buy eggs to my to-do list
Stanley opened To-do.
Stanley typed "Buy eggs" into "Add a task".
Stanley pressed Enter in "Add a task": Added to-do "Buy eggs".
User clicked Home.
User: reply to Sam with something funny
Stanley opened Email.
Stanley opened "Lunch Friday?".
Stanley typed "Ramen? I was born ready." into "Reply to Sam Lee".
Stanley said: "I wrote "Ramen? I was born ready." Should I send it?"
User (still speaking): yes send

## Screen: Email, in front
…markdown of the screen…
```

- **The user's words come as turns**: all segments of an utterance on one line, placed before
  anything Stanley did for it, with the live partial on the last line while they speak.
- **Steps are outcomes**, written from the app's own result summary.
- **Not included**: `listen`/`done` decisions, discarded or gated decisions, retries, which model
  took a step. Those are the agent's mechanics, kept in the debug trace.
- **The screen appears once**, at the end. Earlier screens are not repeated.

Jev's `state` is the system prompt followed by this. Thinking gets its own prompt, the same
conversation, why it was called, and the options. One rendering keeps the models agreeing about what
has happened, and keeps the trace readable: if a person can't follow it, a model can't either.

## Surfaces and layout

- Every app instance is a **surface**: a live view that exists whether or not it's visible.
- The **layout** decides which surfaces are on screen. v1: a single slot.
- Background = acting on a surface not in the layout. `show` puts the working surface in the layout.
  Example: "weather in Denver" → agent drives a hidden weather surface (open, focus location,
  text_gen "Denver", submit, load) → `show`. The user sees one jump.
- Later: web views are `WebContentsView`s kept offscreen; layout gains options like "side by side".

## Voice

- **Push-to-talk**: global toggle `⌥Space` (Electron `globalShortcut`). The mic stays on until the
  second press. ~2 s of silence ends the utterance without turning the mic off; the next words start
  a new one. Pressing mid-task = barge-in: new utterance in the same task.
- **STT**: NVIDIA Parakeet TDT 0.6B **v2** (English) via **sherpa-onnx** (`sherpa-onnx-node`) in main.
  Parakeet is offline-only, so live = **Silero VAD** segments + re-decode the current segment every
  ~400 ms for partials; finalize at VAD pause. Accuracy over true streaming.
  Each decode includes 0.3 s of audio before the VAD's (late) speech onset, plus up to 10 s of the
  utterance's earlier speech as context; token timestamps pick out only the new words. Earlier
  segments are never revised — the agent has already acted on them.
- Mic capture in the renderer (`getUserMedia`, 16 kHz mono PCM via AudioWorklet) → IPC → main.

## Presence

The system shows itself as a glowing wave, not an avatar: across the centre with no window open,
docked to the bottom edge under one. It combines two tracks that run at once:
- **Ear** (main → snapshot): `listening`, `speaking` (VAD), `utteranceOpen`.
- **Brain** (`AgentStatus`): `guessing` (deciding mid-utterance before acting on it), `thinking`,
  `writing` (fill), `acting`, `listening` (`wait` mid-utterance), `done`, `didnt-get-that`, `stuck`, `error`.

`presence()` (renderer) picks one: work wins over the ear, so it reads as working while you talk; the
mic level is layered on every state. Shape = focus (diffuse → gathered), color = whose turn (cool = on
you, violet/spectrum = on the task, amber = trouble), motion = energy (breathing, voice-reactive,
scanning, pulsing, flowing). Guesses are held ~1.5 s through gaps between ticks; outcomes fade to armed.

## Models

All via **Vercel AI Gateway** with the AI SDK (`ai`, pinned exactly), one `AI_GATEWAY_API_KEY`.

- **Jev**: `experimental_decide({ model: 'typesafe-ai/jev', state, questions })`. Confidence at
  `providerMetadata.typesafe.confidence[questionId]`. `packages/jev` normalizes to
  `{ choice, probabilities, confidence }` and provides a mock.
- **text_gen**: Claude Haiku 5.5 via gateway, behind a `TextGen` interface.
- **Escalation**: Claude Haiku 5.5 via gateway (`generateText` with one `act` tool), behind an
  `Escalator` interface.
- **Search**: Parallel Search API (`PARALLEL_API_KEY`).
- **Weather**: Open-Meteo forecast + geocoding (no key).

## Demo apps

| App | Data | Notes |
| --- | --- | --- |
| To-do | seeded, in-memory | type a task (input) → add, mark done, delete |
| Email | seeded, in-memory | inbox list, open email, archive/delete, write a reply (input, a draft in app state) → send, which then shows Sent |
| Weather | Open-Meteo | type a city (input) → look up, current + forecast |
| Music | bundled tracks | play/pause/next/prev/volume; tracks are nodes |
| Web | Parallel search + webview | type a query (input) → search → result nodes; open result → page markdown observation |

Seeded data resets each launch. The user can also click/type in apps directly; those go through
the same action handlers.

## Debug window

The main window stays clean; **Debug → Open Debug Window** (⌘⇧D) opens a separate window for
diagnosing agent behaviour. It is driven by one structured stream (`DebugEvent`): the agent's trace
(`AgentDebugEvent`: every tick request including ones that never ran, exact Jev input, decision,
guardrail gates with thresholds, text fill, action result), STT timing (VAD, decode latency, dropped
partials, silence), app events (mic, status, typed/manual input) and the message log. Each session's
stream is written to `userData/sessions/<session>.debug.jsonl` next to the message-log JSONL.

- **Timeline** grouped by task; optional rows for partials, VAD, skipped requests, status.
- **Tick inspector**: what was heard and why the tick ran, raw vs effective choice, gating, every
  option ranked by probability, fill and observation, full Jev state.
- **Replay**: re-run a tick against Jev as recorded or with edited state/instructions/options.
- **Copy as eval** turns a task into a scenario literal for `evals/scenarios.mts`.
- **Past sessions** load from disk via the session picker.

## Development and evaluation

- **Typed utterances**: the debug window's text box (and `window.stanley.say`) injects an utterance as if spoken.
- **Headless evals**: `pnpm eval [filter…]` runs scenarios with the real Shell, apps, Jev and Haiku —
  no Electron. Utterances are fed word by word to exercise live ticking. Scenarios live in
  `evals/scenarios.mts` with state-based checks (visible surface, route, app data, decision count).
- **Unit tests**: `pnpm test` covers option building, new-word detection, and the loop (mid-utterance
  continuation, stale discard, wait/end re-ask, gating, oscillation, task boundaries) with a scripted
  decision client.
- **Audio injection**: set `localStorage['stanley.noMic']` so tests can stream audio through the real
  IPC → STT path without the microphone mixing in.
- **Push-to-talk**: `⌥Space`, falling back to `⌘⇧Space`; override with `STANLEY_PTT`. The header shows
  whichever registered.

## Status (v1 scaffold)

Working, verified end to end:
- Jev via AI Gateway (~250–400 ms per decision), Haiku slot filling, Parallel search + extract,
  Open-Meteo.
- Parakeet + Silero live transcription: partials every ~430 ms, segments at pauses, silence
  auto-end at 2 s; model loads in ~1.3 s. Verified by streaming synthesized speech through the app.
- All five apps; background work with a single reveal; debug window decision timeline.
- Evals 14/14 (including the reply, draft-then-send and escalation scenarios).

Not yet verified / known gaps:
- Real microphone capture (needs macOS mic permission for the dev Electron binary; a packaged app
  needs `NSMicrophoneUsageDescription`).
- The consequence check uses Jev; whether Haiku classifies effects better is still to be measured
  with a labelled set of real-world action labels.
- Web pages render in a `<webview>` from the app UI; page markdown comes from Parallel Extract rather
  than from the rendered page. Moving to offscreen `WebContentsView` surfaces is the next step for
  real web views and multi-window layouts.
- `back` is approximate (surface-level history, not per-route).
- Option names are full paths (`Web › web search page › …`), which are long; fine for Jev, noisy in
  the debug window.

## Architecture

Agent loop, STT, Jev client, and **app logic run headless in the Electron main process**. Each app
is a module exposing state, `getNodes(state)`, an action handler, and `toMarkdown(state)` — so hidden
surfaces need no DOM. The Svelte renderer is a thin view of the surfaces in the layout, synced over
IPC.

```
apps/desktop          Electron shell: main, preload, Svelte renderer, layout, debug window
packages/app-sdk      AppModule / Node / Surface / Action types
packages/agent        loop, tick scheduler, message log, serializers, guardrails, option builder
packages/jev          Jev client (AI SDK decide) + mock
packages/stt          sherpa-onnx + Parakeet + Silero VAD → partial/final events
packages/app-todo     ./core (headless) + ./ui (Svelte)
packages/app-email    ″
packages/app-weather  ″
packages/app-music    ″ + ./player (headless <audio>, mounted while the surface exists)
packages/app-web      ″ (Parallel search; page view = WebContentsView later)
evals                 headless scenario evals (real models)
```

pnpm workspaces. Internal packages ship TS source (compiled by Vite), no per-package build.

### Stack

Electron 44 · electron-vite 5 · Vite 7 · Svelte 5 · TypeScript 5.9 · pnpm.

### Config / secrets

`.env` (gitignored): `AI_GATEWAY_API_KEY`, `PARALLEL_API_KEY`. `pnpm models` downloads Parakeet +
Silero into `models/` (gitignored).
