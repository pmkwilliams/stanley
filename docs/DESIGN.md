# Stanley — Design (v1 demo)

Voice-controlled desktop assistant. The user speaks, a local STT model transcribes live, and a
System One decision model (TypeSafe **Jev**) runs in a loop picking the best next option from a
list. v1 is a demo of live transcription + the basic agent loop over a few toy apps.

## Goals / non-goals

**v1 goals**
- Push-to-talk (global toggle) with live transcription.
- Agent loop driven by Jev choosing from: navigation/action nodes + global options.
- Background work: the agent can operate on surfaces the user can't see and reveal the result.
- Toy apps: To-do, Email, Weather, Music, Web (search + webview).
- A debug window that explains every decision.

**Not in v1**: wake phrase, multi-window layouts, spoken responses (Stanley's replies are text on
screen for now), persistence across launches.

## Agent loop

### Options (what Jev chooses from each tick)

One Jev `choice` question per tick. `criteria` = option id → description.

- **Globals** (always present):
  - `wait` — the request is incomplete or unclear; need more from the user.
  - `stop` — everything the user asked for is done.
  - `show` — bring the working surface into the layout (make it visible).
  - `home`, `back` — navigation.
  - `escalate` — hand the turn to the escalation model (see **Escalation**). Deliberately a low bar:
    questions, anything that needs a reply, complicated requests, or when Jev is unsure.
- **Nodes**: up to **50** nodes nearest the current node. Nearness = BFS over the node tree treated
  as undirected (parent, children, siblings, cousins…), ties broken by depth.

Option count must stay ≤ 255 (Jev limit).

### Node model

One tree, rebuilt live from app state every tick.

- **Location** nodes — choosing navigates there (apps, screens, items such as a specific email).
- **Action** nodes — choosing executes (mark done, delete email, play, send, search…). Apps may
  flag `destructive` as a hint, but never have to: the agent judges consequences itself (see
  **Consequences**), because real apps and web pages won't label their buttons.
- **Input** nodes — a text field (search box, new to-do title, reply). Choosing one implicitly
  runs **text_gen**: the small LLM types the user's words into the field. **Typing never submits**,
  just like a text box on a page: submitting (search, add, send) is a separate action node that only
  exists once the field has text. So generated text is always visible before anything is done with
  it, and "reply" and "draft a reply" both end at a draft. text_gen uses the user's own words and
  returns nothing when they haven't said the value yet. It never responds to the user.

Dynamic data (individual emails, to-dos, tracks, search results) are real nodes.

### Observations

Every action produces an observation appended to history as a `tool_result`: app content as
markdown, search results, page markdown. Jev reads observations in `state` and decides what to do
next — the agent decides what to do with information, including whether to display it.

### Responding to the user

Mostly by showing things (the weather for Denver, a web page). When showing isn't enough, the
escalation model talks: its text is shown on screen now and will be spoken later.

### Escalation

Jev is a fast System 1 that picks the most likely next option. It can't reason about
consequences, answer questions or talk, and without a way to talk, "ask the user" was never an
option, so it acted instead. Escalation hands the turn to a language model (Claude Haiku 5.5) that
works like a chatbot agent:

- **Triggers**: Jev chooses `escalate`; Jev `wait`s (or is below the confidence gate) after the user
  finished; an input has no value after the user finished ("reply" alone); or the consequence
  check blocks an action.
- **Whole turns only**: an `escalate` mid-word is held like any data change and re-asked at the pause.
  While the model works, Jev doesn't tick. If the user says more, the run is aborted (it says
  nothing; actions it already took stay done and logged) and Jev re-decides with the whole turn.
- **Same world**: one `act(option, text?)` tool over the same options Jev sees (up to 150 nodes, plus
  `show`/`home`/`back`), rebuilt after every step; each result includes the new screen. Its
  actions are logged with the same option names, so Jev can pick up afterwards. It types field
  text itself (no text_gen), and its actions go through the same consequence check.
- **Its text is speech**: anything it writes is said to the user (text on screen now, TTS later), so
  it's prompted to write only what it would say out loud, not narrate, and stay silent when
  nothing is worth saying. There is no separate `say`/`ask` tool.
- **Then back to Jev**: the turn ends (`task-end`). What it said is in the history (`Stanley said:
  "Send this to Sam?"`), so a follow-up like "yes, send it" is Jev's to handle, and Jev escalates
  again if it can't.

### Consequences

Confidence in a choice is not consent: Jev was 94% sure about "reply" when the user had said
only "reply". Before any action node runs, chosen by Jev or by the escalation model, the agent
asks Jev two narrow questions (`consequence.ts`):

1. **What does it do?** none (looks/fetches) / local (easy to undo) / destructive / external (sends,
   posts, pays, books…). Judged from the label, description and screen; cached per action.
2. **Did the user explicitly ask for exactly this?** Only asked when P(destructive) + P(external) ≥
   0.35 (unsure counts as consequential) or the app hinted `destructive`.

A consequential action runs only when P(asked) ≥ 0.8. Otherwise it escalates, and the model shows
what is ready and asks ("I've drafted 'Sounds good' to Sam. Should I send it?"). "Reply saying I'm
in and send it" sends in one go, because the user said so.

### Tick scheduling

Invariant: **never more than one Jev call in flight.**

Tick when:
1. new stable words arrived since the last call, or
2. a non-`wait`/`stop` action just completed (state changed → keep going), or
3. the utterance ended (toggle pressed again, or ~2 s silence).

After `wait` or `stop`, only (1) or (3) trigger a tick.

**Stale results**: if new words arrived while a call was in flight, the result is discarded and we
re-tick with the fresh transcript — unless the choice is a **navigation with confidence ≥ 0.8**
(then execute, then re-tick). `wait` results are always harmless. Only *new words* make a result
stale: the utterance ending mid-call does not invalidate an action (a `wait` is simply re-asked).

**Deferred ticks**: a tick requested while a call is in flight is remembered by reason and replayed
when the call settles. An action-driven tick always wins, so the agent keeps going mid-utterance.

**Utterance end**: re-decides only if the agent was waiting (or there are new words). After `stop`,
ending the utterance costs no call. Speech after a `stop` — even within the same utterance — opens a
new task.

**"New words"**: normalize (lowercase, strip punctuation) finalized segments + current partial
*minus its last (volatile) word*. Trigger if it differs from what the last call saw **and** the word
count grew, or a segment finalized.

### wait vs stop

Identical loop control (halt until new words / utterance end). Different meaning:
- `stop` closes the task: marks the turn complete in the log, performs a final `show`, allows
  older tool results to be collapsed.
- `wait` leaves the task open. `wait` *after the utterance ended* = dead end → escalate, so Stanley
  asks instead of going quiet. "Didn't get that" is left for an utterance that ended with no words.
- P(wait)+P(stop) can be read as "idle probability".

### Guardrails (one tunable config)

| Guard | Default |
| --- | --- |
| Confidence gate while the user is speaking: below → treat as `wait` | 0.6 |
| Confidence gate after the utterance ends: below → treat as `wait` | 0.4 |
| Max actions per utterance → force stop ("got stuck") | 15 |
| Oscillation: same option from the same screen N times in last M steps → force stop | 3 in 6 |
| An action is consequential when P(destructive) + P(external) ≥ | 0.35 |
| A consequential action runs only when P(user explicitly asked) ≥ (else escalate) | 0.8 |
| Escalation: nodes visible / tool steps | 150 / 10 |
| Stale-result execute threshold (navigation only) | 0.8 |

## Context

### Canonical log

One message log per app launch, chat-shaped so it can be handed to an LLM later:

```ts
type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; utteranceId: string; final: boolean }
  | { role: 'assistant'; toolCall: { id: string; option: string; args?: unknown }; decision?: DecisionMeta }
  | { role: 'tool'; toolCallId: string; content: string; summary: string }
```

Kept in memory and appended to `userData/sessions/<ts>.jsonl`. Manual UI actions by the user are
logged too (as user-originated tool calls) so the agent sees them.

### Serializers

- **Jev serializer** → markdown `state`, ordered stable → volatile:
  1. system prompt
  2. history (utterances, actions, results; older tool results collapsed to `summary`;
     tasks before the current one collapsed)
  3. **Now** block: current surface as markdown, layout, live partial utterance last
- **LLM serializer** (for escalation; today it gets the same markdown as Jev) → provider messages. Same ordering keeps the prefix stable
  for prompt caching.

The option list lives only in `criteria`, never in `state`. Every decision — including `wait` and
`stop` — is logged as an assistant message.

**Prompt placement (resolved)**: the system prompt and decision guidance go at the top of `state`;
`instructions` is one short question. A/B on the eval suite: guidance in `state` 16/16, in
`instructions` 15/16. Keeping it in `state` also matches the LLM serializer for prompt caching.

The system prompt's "How to decide" section was tuned against the evals; without it Jev stops early
("go through my inbox" stopped at the list; questions stopped at search results).

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
