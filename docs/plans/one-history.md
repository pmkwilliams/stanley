# One Stanley, one history

Plan for replacing the rebuilt third-person transcript with one persistent agent history. It
retires the principle "every model reads the same rendering" (`docs/DESIGN.md:257`, `:294`).
Instead, thinking continues the history as one long conversation of its own, and Jev reads a
rendering of the last 50 turns.

Status: implemented, all four stages (uncommitted). See **Implementation notes** at the end for
results and where the code differs from this plan.

## The shape, in one example

The history is an AI SDK `ModelMessage[]`. It is sent to thinking whole, exactly as it was sent
before, with new messages only ever appended. The right-hand column is per-entry metadata: the
debug window shows it, and no model ever sees it.

```
user       tick the blue one                              words · utterance 1
assistant  act {option: "open Tasks"}                     Jev · heard 2 of 4 words
tool       Opened Tasks.
assistant  act {option: "Blue › checkbox"}                Jev · heard 4
tool       Marked "Blue" done.
user       sorry the red one                              words · utterance 1, went on
user       <screen title="Tasks" …>…</screen><options>…</options>    observation, sent with the call
assistant  [reasoning] act {option: "Blue › checkbox"}    thinking · reasoning kept as sent
tool       Marked "Blue" not done. <screen…>…</screen><options>…</options>
assistant  [reasoning] act {option: "Red › checkbox"}     thinking
tool       Marked "Red" done. <screen…>…</screen><options>…</options>
user       who's the mayor of Denver                      words · utterance 2
user       <screen unchanged/>                            observation: same screen and options as last sent
assistant  [reasoning] search {query: "Denver mayor"}     thinking
tool       {query, results: [{title, url, excerpt} ×8]}
assistant  Mike Johnston.                                 said, as far as the user heard it
user       <note>The user pressed [Play] in the app: Playing "Drift".</note>
```

**Rules**
- **Never edit what thinking was sent.** Every thinking call commits everything before it, its
  observation included, and the turn's own messages are appended exactly as the SDK sent them
  between steps: reasoning, tool calls, and full in-run screens.
- **Stage what thinking hasn't seen yet.** Jev's steps, the user's words, notes and replies since
  the last commit are staged. They are placed by narrate's rule when they are committed (see
  **Mid-utterance order**).
- **The last turn's final output may change once.** It was never input, so changing it costs
  nothing. It is cut to what the user heard, or dropped if unsaid, until something is appended
  after it.

Jev's `state` is `SYSTEM_PROMPT`, then today's date, then `narrate()` of the last 50 turns. The
rendering is today's.

## 0. Spike results (done)

The spike ran Haiku 5.5 through the gateway, with adaptive thinking on (the default) and tools
`act` plus the real `THINKING_PROMPT`. The script is `packages/agent/spike-thinking.mts`; it is
untracked and costs fractions of a cent to rerun.

| Test | Result |
| --- | --- |
| A Jev step (an `act` call with no reasoning) as the last assistant turn, thinking on | Accepted, and the model thought |
| The same after a thinking turn whose reasoning is replayed | Accepted |
| Append-only follow-ups after a thinking turn | Cache read 2,226 of 2,616, 2,612 of 2,837, 2,522 of 2,820, 2,816 of 2,968: everything except the new messages |
| In-run steps with a marker moved forward each step (`prepareStep`) | Each step reads the previous one: 2,005 of 2,228 |
| The first message edited, reasoning replayed | Accepted: the history-editing check isn't enforced on this account today. The cache fell to the instructions alone (1,365) |
| The final reply truncated, or the last assistant message dropped, then go on | Accepted, and the cache still read everything before it |
| `providerOptions.anthropic.cacheControl` with `ttl: '1h'`, gateway pinned with `order: ['anthropic']` | Passes through. Reads and writes are reported in `usage.inputTokenDetails` |

**What this means**
- **Thinking stays on.** No fallback is needed.
- **Reasoning is replayed.** A fully append-only history is both what caches best and what keeps
  thinking blocks valid. The edit test passed only because this account predates enforcement
  (accounts created after 2026-08-31 get a 400), and it still lost the cache. So append-only is the
  rule regardless.
- **Use `result.responseMessages`, not `result.response.messages`.** In `ai` 7, the second holds
  only the final step.

## Decisions (agreed, or changed by the spike)

1. **`write` and `confirm` are one-step turns with `toolChoice: 'auto'`, not forced calls.**
   - They run in the same thread. The observation ends with a note naming the step.
   - For these turns `act` has no `execute`: the call comes back unrun and the agent applies it.
   - Forced calls can't say "don't press, ask" or "nothing to type yet". Changing `tool_choice`
     also invalidates the messages cache, and forced calls skip thinking on Haiku 5.5.
2. **A thinking turn is recorded from the SDK.** Use the messages exactly as it sent them between
   steps, captured from `prepareStep`'s `responseMessages`, plus the final step's output. If the
   turn is aborted, the steps that finished are already captured. A step that ran in the world
   when the abort landed is added as Stanley's own call and result, without reasoning.
3. **Reasoning, observations and in-run screens are kept.** Nothing that was input is ever
   compacted. *(This reverses the earlier plan, which dropped reasoning and compacted screens.)*
4. **Thinking reads the whole session. Jev reads the last 50 turns, as a sliding window.**

## 1. The history (`conversation.ts`, replacing `log.ts`)

### Entries

```ts
interface Entry {
  id: string
  /** What thinking reads: one message, or none (task boundaries). */
  message?: ModelMessage
  meta: {
    at: number
    kind: 'words' | 'step' | 'lookup' | 'said' | 'note' | 'observation' | 'reasoning-turn' | 'event'
    utteranceId?: number
    /** Words of the utterance heard when the step was decided. */
    heardWords?: number
    /** Words: the utterance's first part, or what the user said after a step (narrate's "went on"). */
    part?: 'first' | 'went-on'
    /** Who chose it. Debug only, never rendered for a model. */
    by?: 'jev' | 'thinking' | 'agent' | 'user'
    decision?: DecisionMeta
    /** For narrate and the helpers: what a tool call did, joined to it by `toolCallId`. */
    step?: { target: StepTarget; text?: string; wrote?: 'user' | 'stanley'; summary: string; error?: boolean; observation?: string }
    toolCallId?: string
    replyId?: number
    /** The thinking turn (tick) it came from. */
    turn?: number
    event?: 'task-start' | 'task-end' | 'stuck'
  }
}
```

`Conversation` provides:
- `entries`: committed, in final order, for the whole session.
- `heard(utteranceId, text)`: a finalized segment.
- `stage(entry)`.
- `commit()`: places and commits what is staged.
- `send(observation)`: commits, then appends the observation.
- `appendTurn(messages, meta)`: a thinking turn's messages.
- `amendLast(…)`: the final output's one-time change.
- `cut(replyId, spoken)`.
- `begin(utteranceId)`.
- `messages()`: everything committed, for thinking.
- `view(live?)`: committed plus staged, placed, for Jev and the helpers.
- `validate()`.

### What becomes which message

| Happened | Message(s) | Notes |
| --- | --- | --- |
| The user's words | `user` text, with `(?)` marks kept | Placed per **Mid-utterance order** |
| A step Jev chose | `assistant` `act {option}` + `tool` result (the app's summary; `error-text` on failure) | Synthetic id `jev_<stepId>`, no reasoning (accepted, §0) |
| A thinking turn | The SDK's own messages: reasoning, tool calls, results with full screens, text | Meta joined by `toolCallId` from the executors |
| A field typed | `act {option, text, wrote}` | `wrote` replaces write's `source` |
| `search` / `fetch` | call + `json` result in full | `error-text` on failure |
| The screen at a thinking call | `user` `<screen>…</screen><options>…</options>` plus notes | `<screen unchanged/>` when the screen and options match the last ones thinking saw |
| The user clicked or typed in an app | `user` `<note>The user pressed [Send reply] in the app: Reply sent.</note>` | |
| A reply from code (`Done: "…"`, `I heard: …`) | `assistant` text | Staged |
| The user cut in | The final output cut to what was heard, + `<note>The user cut in here.</note>` | Once something follows it, an appended note quoting what was heard |
| Stopped by a guard | `user` `<note>You stopped: you kept repeating the same step.</note>` | `event: 'stuck'` |
| Task start / end | none | Bookkeeping |
| The date changed | `<note>It is now Tuesday, 13 October 2026.</note>` in the next observation | The instructions are never edited |

### Mid-utterance order

Staged words and entries are committed at two points: every thinking call (`send`), and the start
of the next utterance (`begin`). At each commit they are placed by narrate's existing rule, which
moves out of `narrate.ts` into one shared `place()`. It covers the words of the current utterance
not yet committed:

1. The words up to the earliest **early change** come first. An early change is a typed field or
   a pressed button decided on fewer words than the user ended up saying. With no early change,
   all the words come first.
2. At each early change, the words up to its `heardWords` come before it, marked `went-on`.
3. Whatever is left comes last.

Navigation never splits a turn, so the history reads like today's transcript. Words are only ever
placed between entries, never between a call and its result. A thinking call freezes the order up
to that point: words the user says afterwards come after it, which is when they were said. Jev's
rendering follows the committed order too, so both models read the same sequence.

### Validity

Every tool call has exactly one result, immediately after it. Each path keeps this:

- **A Jev step.** Staged as a pair by `step()`, with a summary or an `error-text` result.
- **A thinking turn that finishes.** The SDK's messages are paired by construction.
- **A thinking turn that's aborted or fails.**
  - The steps that finished are kept as captured by `prepareStep`.
  - A world step that ran in the unfinished step is added as Stanley's own pair. The executor
    checks the abort signal only before it starts.
  - A tool call that never ran is dropped.
  - A search or fetch aborted mid-flight leaves nothing.
- **Unsaid text.**
  - In the final output: dropped.
  - Before a tool call earlier in the turn: kept, because it was input to later steps. The
    prompt's "don't narrate your steps" makes this rare.
- **A single-step write or confirm.** The call comes back without a result. Applying it appends
  the result (the typed or pressed outcome, with the model's `toolCallId`). If it isn't applied
  (held then dropped, another option, a lookup), the call is the final output and is dropped.
- **A call that changed nothing** ("no option [x]", a field without text). Inside a turn it stays
  with its result, as the model saw it.

`validate()` runs before every thinking call in dev builds, and in the tests for each path. It
checks the pairing, unique ids, that the first message is a user message, and no empty messages.

### Windows

- **Thinking: the whole session**, from its first message. Sessions last one app launch.
- **Jev: the last 50 turns**, sliding every tick (`config.jevTurns = 50`, today's `maxTurns = 20`),
  with the "(earlier conversation left out)" line. `knownPages`, and so the `open page` options,
  use the same 50-turn window.

### Persistence

The sink receives records:
- `{type: 'words'}` as segments finalize;
- `{type: 'staged'}`;
- `{type: 'commit', entries}` in final order;
- `{type: 'amend'}` for the final output's one-time change.

Replaying them rebuilds the history, including the exact messages thinking was sent. The agent
commits on `will-quit`.

## 2. Thinking (`think.ts`)

```ts
interface ThinkRequest {
  instructions: string            // THINKING_PROMPT + MISHEARD + WEB? + date at session start
  messages: ModelMessage[]        // the whole history, observation already appended by `send`
  /** Turns that decide one step: `act` comes back unrun. */
  single?: { kind: 'write' | 'confirm'; option: string }
  act(call: { option: string; text?: string; wrote?: 'user' | 'stanley'; toolCallId: string }): Promise<string>
  search?(query: string, toolCallId: string): Promise<SearchOutput>
  fetch?(url: string, toolCallId: string): Promise<PageOutput>
  openPage?(url: string, toolCallId: string): Promise<string>
  maxSteps: number
  signal: AbortSignal
  onText?(delta: string): void
}
interface ThinkResult {
  text: string
  call?: { option: string; text?: string; wrote?: 'user' | 'stanley'; toolCallId: string }
  /** Everything the turn added, as the SDK sent it between steps, plus the final output. */
  messages: ModelMessage[]
  usage?: LanguageModelUsage
}
interface Thinker { run(req: ThinkRequest): Promise<ThinkResult> }
```

**The `streamText` call**
- `instructions` as a system message with the cache marker, and `messages`.
- The same tools on every call: `act`, and `search`, `fetch`, `open_page` where the session has
  them. `toolChoice: 'auto'`.
- `stopWhen: stepCountIs(single ? 1 : maxSteps)`.
- `prepareStep` moves the tail cache marker and keeps the latest `responseMessages`.
- On abort or error, it returns what it captured, so the agent appends a valid partial turn.
- `reason` and "Why you are needed" are gone. The hand-over cause is `handover` on the debug event
  only.

**`act`** gains `wrote: 'user' | 'stanley'` for fields, with descriptions taken from write's
`source` schema (`think.ts:200`). Each in-run result keeps returning the outcome plus the screen
and options, as today.

**write**
- The observation ends with `<note>Next: typing into […].</note>`.
- An `act` on the field becomes `applyWrite({ text, wrote, say })`, unchanged.
- Text without a call means ask. Neither means nothing to type yet: listen, or hand over to a full
  turn.

**confirm**
- The note reads: "Next: pressing [Send reply]. It may send or commit something: press it if the
  user asked for this and has heard any words you wrote; otherwise say what is ready and ask."
- An `act` on the button means press. Text means ask.
- Anything else falls back to a full turn.
- Text in these turns is buffered until the step ends, so a question isn't spoken just before a
  press.

## 3. Jev's rendering (`narrate.ts`, `web.ts`, `options.ts`)

**`narrate(conversation, screen, live?, maxTurns = 50)`** renders `view(live)` with today's
wording:
- steps from `meta.step` (Jev's and thinking's alike);
- words labelled from `meta.part`, plus `(still speaking)` on the live tail;
- lookups from their JSON results, with excerpts cut to 100 characters;
- replies as heard;
- stuck lines;
- the screen once at the end.

It skips observations and reasoning. `place()` is shared with `commit`, and `knownPages(entries)`
reads the search and fetch results in the window.

**Tests and checks**
- The narrate tests are the spec. Their expected strings stay. Their inputs become a chronological
  recording applied to a `Conversation`.
- **Equivalence check.** Replay the 47 recorded sessions (old `LogEntry` JSONL) through the old
  `narrate` (a temporary copy) and the new one, committing only at utterance starts, and diff after
  every user segment. Expect an exact match.
- Separately, count how often freezing at thinking calls changes Jev's rendering (an utterance that
  goes on after a thinking call).

## 4. Agent loop (`agent.ts`)

**Writes to the history**
- `segment` → `heard`.
- `utteranceStart` with a new id → `begin`. A rejoined utterance doesn't call it.
- `openTask` / `finishTask` → events.
- `step()` stages Jev pairs, and gives thinking's executors the meta to join by `toolCallId`.
- `search` / `read` / `openPage` → meta for their calls. `search` no longer clips excerpts.
- `logSaid` → stage or amend.
- `cutOff` → `cut`.
- Stuck and `recordUserStep` → notes.

**Reads from the history** (`view()`)
- `dictatedThisTask`, `unsureDictation`, `guessedEarly`, `focus`, `pages`.
- `context()` and `conversation(except)` (barge-in).

**Thinking**
- `think()`, `write()` and `confirm()` build the observation (deduped against the last screen
  thinking saw) and call `history.send`, then `thinker.run`, then `history.appendTurn`.
- The five `reason` strings become debug-only `handover`. Their general rules go into the
  instructions.

**New dependency:** `clock?: () => Date` in `AgentDeps`.

**Unchanged:** turn-taking, gates, hold and stale handling, the effects judge, option building, and
the `unsure-words` read-back.

## 5. Prompts

**`THINKING_PROMPT`** becomes the instructions, rewritten as one Stanley. The opening:

> You are Stanley, a voice assistant that operates apps and websites on the user's computer. You act
> while the user is still talking, so the conversation shows each step where it happened: a step you
> took before the user finished comes before the words they said after it. When later words take
> back or change what you did, don't mention or apologise for it: undo it (untick, put back,
> retype) before anything else, then do what they meant. If everything you did matches what they
> asked and nothing is left to say, say nothing.
>
> The user's words are their messages. Notes from the computer are in `<note>` tags: what the user
> did in the app themselves, being cut off, the user still speaking, what comes next. Each time you
> are needed, the screen you're working on and its options come in `<screen>` and `<options>`;
> `<screen unchanged/>` means it's the same as the last one you saw.

- The "How to act" bullets stay.
- The two "parts" are gone, as are "Your part" and "Another part of you".
- `MISHEARD` and `WEB` move into the instructions.

**Today's date.** "Today is Monday, 12 October 2026." ends the instructions, fixed for the session
so the prefix never changes. A new day arrives as a note. Jev's state gets the date per tick,
between `SYSTEM_PROMPT` and `## Conversation`.

**Jev's `SYSTEM_PROMPT`.** Opens with "Stanley is a voice assistant…". Three phrases change:
- "the thinking part of Stanley takes over" → "Stanley then writes, answers or asks";
- "text that the thinking part types" → "text Stanley types";
- "the thinking part's job" → "`think`".

The questions are unchanged.

## 6. Prompt caching

**Prefix:** tools, instructions, then the whole history in send order. Three markers, all `1h`
because gaps between thinking calls often pass five minutes:

1. The instructions. This caches tools and system together.
2. The end of the previous request's input: the last in-run step of the previous turn, or the
   previous single-step call. It is an exact read point, even when many Jev steps and words
   (more than 20 positions) were appended in between.
3. The tail, moved forward each step by `prepareStep`.

**Pinned:** `toolChoice: 'auto'`, a fixed tool set, fixed instructions, and
`gateway.order: ['anthropic']`.

**The prefix never breaks.** The only change to existing messages is the final-output amendment,
which §0 showed is free. `cacheReadTokens` and `cacheWriteTokens` are logged on `think-end`, and
the evals report the read ratio.

## 7. Context size

| Content | Thinking (whole session) | Jev (last 50 turns) |
| --- | --- | --- |
| User words, notes | In full | Turn lines |
| Steps | Jev's: call + summary. Thinking's: as sent, with full screens | Step lines |
| Screens | Every observation sent; `<screen unchanged/>` when identical | The current screen, once |
| Search / fetch | In full (≤ 8 × 500 chars / ≤ 6,000 chars) | Title, address, 100-char excerpt / page title |
| Reasoning | Replayed as sent | Never |
| Replies | As heard | As heard |

**Growth** comes mostly from screens: every thinking call adds one, and every in-run step returns
one. Only the new part of each call is uncached; the cost is that time-to-first-token rises with
total size, and Haiku 5.5's input price rises 5× past 100K prompt tokens. So:
- log the input size of every thinking call;
- run the long-session check in §8;
- when sessions near 100K tokens, add server-side compaction (`compact` beta). Haiku 5.5 supports
  it, and it doesn't count as a history edit.

## 8. Desktop, debug window, offline mode, evals

**Session file and debug stream**
- They carry history records: `source: 'history'` replaces `source: 'log'`.
- `session-start` also records the instructions.
- Old debug sessions load through a display-only adapter.

**Debug events**
- `think-start` carries `mode`, `handover`, and `range` (the history indices sent, observation
  included). The history is append-only, so that range is the exact model input.
- `think-end` carries usage, including cache reads and writes.
- `write` and `confirm` fold into `think-*`.

**Tick inspector.** One Thinking section showing:
- the model input, message by message (role, reasoning marker, text, tool call with arguments,
  result), with the instructions collapsed;
- the steps, and what was said;
- tokens in / cached / out;
- "Copy model input".

**Log view.** "Message log" becomes "History". It shows `by`, Jev's confidence and heard words as
metadata, and marks staged entries.

**Offline mode** (`index.ts:69`). The offline thinker implements `run`:
- write → `{ call: { option, text: lastUserWords(messages), wrote: 'user' } }`;
- confirm and run → the current offline sentences.

`offlineJev` is unchanged: the date line sits above `## Conversation`.

**Evals**
- `harness.mts` counts by mode and reports the cache read ratio and the largest thinking input.
- `scenarios.mts` reads `agent.history`.
- New scenarios:
  - **No repeat.** A follow-up doesn't restate the earlier answer.
  - **Current office.** "Who's the mayor of Denver" searches and doesn't say "check a current
    source".
  - **Reuse.** "What did the second one say" is answered without a new search.
  - **Long session.** 30 utterances, checking the read ratio and input size.
- Re-run the correction and confirm scenarios.

**Jev at 50 turns.** Its `state` is re-read on every tick. Compare Jev's input tokens and p50
latency at 20 and 50 turns in the evals before settling on 50.

**Docs.** Update `DESIGN.md`:
- "One agent, two speeds" (`:29`);
- Thinking (`:161`);
- Context (`:247`–`:296`).

## Order of work

1. **History, behaviour-neutral.**
   - `conversation.ts`, `place()`, `narrate` / `knownPages` on the history.
   - The agent writes the history.
   - The sink, the log view and the eval helpers move over.
   - Thinking temporarily gets `narrate(view)`.

   Gate: the narrate tests, the equivalence replay, and the agent tests.
2. **Thinking on the history.**
   - `think.ts` with `send` / `appendTurn` and single-step write/confirm.
   - Prompts and date.
   - Caching markers.
   - Tick inspector input.

   Gate: the agent tests and the demo and web evals at today's pass rates, plus the cache read
   ratio.
3. **Jev at 50 turns.** A config change; gate on its latency.
4. **Docs and new scenarios.**

## Risks

- **Growth in long or web-heavy sessions.** Mitigated by screen dedupe now and compaction later.
- **Behaviour shift.** Thinking sees Jev's steps as its own, its earlier screens, and no per-call
  reasons. Watch corrections after early presses.
- **Single-step turns that ignore the note.** Each one costs a fall-back full turn. Measure how
  often.
- **The history-editing check** isn't enforced on this account today. Append-only keeps us safe
  when it is.

## Implementation notes

**Results**
- **Narrate equivalence.** 26 recorded sessions have a log in the current format (the other 21 are
  older formats). Replayed with commits at utterance starts only: 130 renderings, 0 differences.
  No recorded utterance went on after a thinking step (0 of 98). Old logs only show turns that took
  steps, so this is a lower bound.
- **Demo evals**, two runs each: 92/94 new against 85/86 baseline (HEAD). The 4 new scenarios pass.
  `show-me-the-answer` varies on both sides (baseline 6/8, new 4/6 after the last prompt change).
- **Web evals**, two runs each: 30/30 on both.
- **Cache.** 88% of thinking's input was read from the cache over the demo set, and 95% in
  `long-session`. The largest single call was about 27K tokens.
- **Jev at 50 turns.** `long-session` at `--jev-turns 20` and `50`: p50 0.3 s for both, about
  2.8–3.2K input tokens per call. 50 stays.
- **Single-step turns that ignored the note:** about 6 of ~90 handed over to a whole turn. All of
  those scenarios still passed.

**Where the code differs from the plan**
- **A thinking turn's final text** is taken out of the turn's messages and goes in as a `said` entry
  once it is said. Code replies (`Done: …`, `I heard: …`) are recorded the same way, and a cut only
  ever edits a reply that wasn't sent. If the final message is left with no tool call, it is
  dropped.
- **Any entry not yet sent can change,** not only the last one. Thinking has never seen it, so
  changing it costs no cache.
- **Single-step turns run no tools at all.** A lookup comes back unrun and hands over to a whole
  turn, the same as another option.
- **The write note carries the rule for whose words they are:** dictated words are typed as said
  (`wrote: user`); described ones are composed (`wrote: stanley`). The `act` tool's `text` and
  `wrote` descriptions repeat it. Without this, writes reworded dictation and asked instead of
  composing.
- **`unsureDictation` uses the segments heard since the task started.** Placement can put an
  utterance's words before its task's start (a rejoined utterance), so reading the task from the
  history missed `(?)` words.
- **Thinking's screens say `in the background`,** and the instructions say such a screen comes to
  the front when thinking finishes. Thinking had started telling the user the page was hidden.
- **The `WEB` instructions now say what "that" means:** "That" or "it" is what thinking last told
  the user about, not the question or the list it came from.
- **Debug:** `think-end` also reports the last step's input tokens (the largest in a turn). The
  debug recorder never evicts history records, because the window rebuilds the model input from
  them.
- **Evals:** `--jev-turns N`, per-run thinking input and cache share, `cache` limits per scenario,
  and a count of single-step turns that handed over.
- **Not done:** server-side compaction. It is still planned for when sessions near 100K tokens.
