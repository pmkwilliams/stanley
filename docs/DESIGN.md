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

**Not in v1**: wake phrase, real handoff to a frontier LLM (stubbed), multi-window layouts,
spoken responses, persistence across launches.

## Agent loop

### Options (what Jev chooses from each tick)

One Jev `choice` question per tick. `criteria` = option id → description.

- **Globals** (always present):
  - `wait` — the request is incomplete or unclear; need more from the user.
  - `stop` — everything the user asked for is done.
  - `show` — bring the working surface into the layout (make it visible).
  - `home`, `back` — navigation.
  - `handoff` — pass to a frontier LLM. **Stub in v1** (logs, then behaves as `stop`).
- **Nodes**: up to **50** nodes nearest the current node. Nearness = BFS over the node tree treated
  as undirected (parent, children, siblings, cousins…), ties broken by depth.

Option count must stay ≤ 255 (Jev limit).

### Node model

One tree, rebuilt live from app state every tick.

- **Location** nodes — choosing navigates there (apps, screens, items such as a specific email).
- **Action** nodes — choosing executes (mark done, delete email, play, next track…).
  May be flagged `destructive`.
- **Input** nodes — declare a text slot (search box, new to-do title). Choosing one implicitly
  runs **text_gen**: the small LLM fills the slot from the conversation, then the action runs.
  text_gen is *only* for actions just beyond Jev's capability (filling inputs). It never responds
  to the user.

Dynamic data (individual emails, to-dos, tracks, search results) are real nodes.

### Observations

Every action produces an observation appended to history as a `tool_result`: app content as
markdown, search results, page markdown. Jev reads observations in `state` and decides what to do
next — the agent decides what to do with information, including whether to display it.

### Responding to the user

v1: **UI state only**. The agent answers by showing things (e.g. the weather for Denver, a web
page). When UI state isn't enough, that will be `handoff` (later).

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
- `wait` leaves the task open. `wait` *after the utterance ended* = dead end → status shows
  "didn't get that" (later: handoff to clarify).
- P(wait)+P(stop) can be read as "idle probability".

### Guardrails (one tunable config)

| Guard | Default |
| --- | --- |
| Confidence gate: below → treat as `wait` | 0.3 |
| Max actions per utterance → force stop ("got stuck") | 15 |
| Oscillation: same option from the same screen N times in last M steps → force stop | 3 in 6 |
| Destructive actions require confidence ≥ | 0.6 |
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
- **LLM serializer** (for handoff, later) → provider messages. Same ordering keeps the prefix stable
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

- **Push-to-talk**: global toggle `⌥Space` (Electron `globalShortcut`). Second press or ~2 s
  silence ends the utterance. Pressing mid-task = barge-in: new utterance in the same task.
- **STT**: NVIDIA Parakeet TDT 0.6B **v2** (English) via **sherpa-onnx** (`sherpa-onnx-node`) in main.
  Parakeet is offline-only, so live = **Silero VAD** segments + re-decode the current segment every
  ~400 ms for partials; finalize at VAD pause. Accuracy over true streaming.
- Mic capture in the renderer (`getUserMedia`, 16 kHz mono PCM via AudioWorklet) → IPC → main.

## Models

All via **Vercel AI Gateway** with the AI SDK (`ai`, pinned exactly), one `AI_GATEWAY_API_KEY`.

- **Jev**: `experimental_decide({ model: 'typesafe-ai/jev', state, questions })`. Confidence at
  `providerMetadata.typesafe.confidence[questionId]`. `packages/jev` normalizes to
  `{ choice, probabilities, confidence }` and provides a mock.
- **text_gen**: Claude Haiku 5.5 via gateway, behind a `TextGen` interface.
- **Search**: Parallel Search API (`PARALLEL_API_KEY`).
- **Weather**: Open-Meteo forecast + geocoding (no key).

## Demo apps

| App | Data | Notes |
| --- | --- | --- |
| To-do | seeded, in-memory | add (input node), mark done, delete (destructive) |
| Email | seeded, in-memory | inbox list, open email, archive/delete, reply (input) |
| Weather | Open-Meteo | location input, current + forecast |
| Music | bundled tracks | play/pause/next/prev/volume; tracks are nodes |
| Web | Parallel search + webview | search input → result nodes; open result → page markdown observation |

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
- Evals 8/8 on repeated runs.

Not yet verified / known gaps:
- Real microphone capture (needs macOS mic permission for the dev Electron binary; a packaged app
  needs `NSMicrophoneUsageDescription`).
- `handoff` is a stub that behaves like `stop`. "Didn't get that" is only a status.
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
