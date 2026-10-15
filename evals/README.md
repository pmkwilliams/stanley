# Evals

| Command | What it checks | Cost |
|---|---|---|
| `pnpm eval:stt` | Transcription accuracy on recorded clips | Free (local) |
| `pnpm eval:turn` | Turn detection on LiveKit's end-of-turn benchmark: cut-ins and how fast a turn's end is called | Free; `--jev N` adds Jev's word judgement (paid) |
| `pnpm eval:voice <filter>` | Agent behaviour when a recorded clip is the request | Paid (Jev + Sonnet) |
| `pnpm eval <filter>` | Agent behaviour on typed scenarios, demo apps | Paid (Jev + Sonnet) |
| `pnpm eval:web <filter>` | The same agent on fixture websites in headless Chromium | Paid (Jev + Sonnet) |
| `pnpm eval:web --live <filter>` | Read-only scenarios on real websites (they change, so not in the default set) | Paid (Jev + Sonnet) |
| `pnpm eval:answer <filter>` | Answering from the page with Jev alone (`answer.ts`): right answers spoken, wrong ones never, on saved real pages | 1–4 Jev calls per case |
| `pnpm eval:layout <filter>` | What the screen shows once Stanley is done: which apps, and which side each is on | 1 Jev call per case |
| `pnpm eval:dictate --model <id>` | The quick model alone writing a field from what the user said (`dictate/cases.mts`; `--holdout` for cases kept out of tuning): passes when the field holds what the user meant, by checks and GPT-6.1 Sol as judge through Codex (`--judge`); latency and cost. `local/<label>` runs a llama.cpp server, `--variant` tries other prompts (`dictate/variants.mts`); `--report` compares saved runs | 1 call per case (judge on the Codex plan) |
| `pnpm eval:working` | Whether words said while Stanley works stop it or wait for it to finish (`WORKING`) | 15 Jev calls |
| `pnpm smoke:desktop` | Builds and launches the real app, types two utterances, screenshots both windows | A few paid calls |

The paid evals run nothing without a filter or `--all`. They list what they would run instead, and
every run ends with the number of paid calls it made.

Options for `eval` and `eval:web`:

- `--runs N` runs each scenario N times and reports a pass rate. One run is a sample, not a result.
- `--concurrency N` (default 4).
- `--trace` prints the conversation and screen Jev reads at the end of each run. Read these:
  if a person can't follow a trace, the models can't either.
- `--verbose` prints every run's ticks (failed runs always print them): for each tick, what took
  effect, the top "what now" answers and the chosen step with its runners-up.
- `--jev-turns N` sets how many user turns Jev reads (default 50), to compare its input size and
  latency on long scenarios (`long-session`).
- `--set key=value` (repeatable; dotted for nested keys, e.g. `--set finished.heard=0.7`) runs with
  one config value changed, to try a threshold without editing `config.ts`.

`STANLEY_DECIDER=subq` runs any eval (and the app) with SubQ Snap instead of Jev (`SUBQ_API_KEY`),
using `deciderProfile('subq')`: the prompts and thresholds were fitted to Jev, so SubQ gets a few
of its own. Compare the two by running the same eval under each.

Every run also reports thinking's input: tokens, the share read from the prompt cache, and the
largest single call.

## Turn-taking

In a scenario utterance, `|` is a pause mid-thought (0.8 s). After the last word the agent ends the
turn itself (or the 4 s silence backstop does), so each scenario also measures when it called the
end. Every scenario fails if Stanley says anything before the user's last word; ending the turn
early (a cut-in) is counted in the summary, and the next words rejoin the turn. Typed utterances
have no voice, so their pauses carry no Smart Turn verdict and the agent judges them by the words
alone; `eval:voice --say` and recorded clips go through the real transcriber and Smart Turn.

`pnpm eval:turn` replays the agent's endpoint rule at every pause of 400 real user turns (LiveKit
EoT benchmark, CC-BY-4.0, downloaded once to `.cache/`). Mid-turn pauses that would have ended the
turn are cut-ins; for real ends it reports how long until the end is called. The fixed 2 s silence
is the baseline.

## The user's files

Every demo-app scenario runs with a fresh copy of `evals/files/` as the user's folder (macOS only,
for the sandbox), so Jev always has the file options it has in the app. Checks get the copy's path
as their third argument (`fileSays`, `fileGone`, `newFile` in `scenarios.mts`). `--no-files` runs
without them, to compare.

## Held-out utterances

`evals/leak.test.ts` (part of `pnpm test`) fails if any scenario utterance shares a run of four words
with a prompt, an option description, an app's labels or the page extractor. Fix the prompt by
describing the general rule, not by quoting the scenario; otherwise a pass only shows the prompt was
fitted to the test.

## Websites

`web/sites/*.html` are small single-page apps shaped like real sites (webmail, a shop, account
settings, a news front page), served at made-up `https://*.test/` origins. The agent sees them only
through the generic extractor in `packages/browser`; nothing describes them to it. Checks read each
site's state from its `localStorage`. `npx tsx web/peek.mts <site> [#/route]` prints what the agent
would see, and `npx tsx web/peek-live.mts <url>` does the same for a real page; neither calls a model.

Chromium comes from `$STANLEY_CHROMIUM`, else the newest Playwright headless shell in
`~/Library/Caches/ms-playwright`, else Homebrew's `chromium`.

## Answering from the page

`pnpm eval:answer` asks questions about pages in `answer/pages/`, saved from real sites through the
same extractor the agent reads them with (`npx tsx answer/snapshot.mts <name> <url>`, no model
calls). Pages change, so the eval reads the saved copy. The few pages marked `contrived` stand in
for an edge case real pages don't reliably have (a dozen-word screen, a time corrected later on the
page, one fact said twice in different words). Each case in `answer/cases.mts` says whether it
should be spoken, declined, or either, and what the spoken answer must and must not contain. The
summary leads with wrong answers spoken: declining only hands the turn to thinking, but a wrong
answer is said out loud. `--verbose` prints each pass's top passages and the runs.

## The screen's layout

`pnpm eval:layout` asks Jev what the screen shows once Stanley has done what the user asked: up to
three apps, one alone, two side by side, or three with two stacked on one side. Each case in
`layout/cases.mts` gives what is on the screen, the conversation, and the app Stanley worked on, and
lists the arrangements that pass. Some ask for the screen in so many words ("swap them"); the rest
leave it to Jev to judge from what was asked ("add a task to pay this invoice" while reading it).
The apps hold their real data (`layout/scene.mts`): what Jev reads of an app is its own markdown.
It asks the agent's own two questions (`packages/agent/src/screen.ts`) on the state laid out as the
agent writes it, and does what the agent does when unsure (leaves the screen). 61/63 over 3 runs;
`--set screen.show=…` tries another floor. How the questions are asked and where the screen goes in
what Jev reads came from this eval (see `docs/plans/layout.md`): asking each app where it goes on its
own passed 31/38 to the set shape's 37/38.

`--image` also shows Jev a picture of the screen, drawn by the gallery with the apps' real windows
(`apps/desktop/gallery/Screen.svelte`), on jev-1.14.0, which takes pictures; `--no-line` leaves out
the words saying what is on it. `--check` asks instead whether the screen after, in words or as a
picture, is what the user wants, for the right arrangement and likely wrong ones. On 2 runs each:

| | passed |
|---|---|
| jev, in words | 37/38 |
| jev-1.14.0, in words | 32/38 |
| jev-1.14.0, in words and a picture | 31/38 |
| jev-1.14.0, a picture only | 28/38 |
| check, jev in words | right kept 32/38, wrong turned down 34/50 |
| check, jev-1.14.0 in words | 32/38, 32/50 |
| check, jev-1.14.0 as a picture | 32/38, 30/50 |

A picture costs about twice the input and 0.5 s to 0.2 s, and helps neither the choice nor a check
of it. Checking after is worse than choosing: it wants the app Stanley worked on in front (music
over the inbox it was reading), so it would undo right choices more often than it caught wrong ones.

## Recording clips

1. `pnpm dev`, then turn on **Debug › Save Utterances as Eval Clips** (or start with
   `STANLEY_SAVE_CLIPS=1`).
2. Talk to Stanley normally. Each spoken utterance is saved to `speech/clips/<id>.wav` along with
   `<id>.json`, which holds what it heard live. Read lines from `speech/prompts.txt`, use your own
   real requests, or both.
3. `pnpm clips:label` plays each new clip and asks what you actually said. It prefills the closest
   prompt, or what Stanley heard, so Enter accepts. Optionally give a scenario name from
   `scenarios.mts` to use the clip in `eval:voice`. Use `/r` to replay, `/s` to skip, `/d` to delete,
   `/q` to quit.

Clips are your voice, so `speech/clips/` is gitignored.

You can add `"wispr": "..."` to a clip's JSON to score another tool's transcript of the same
speech alongside ours.

## Transcription eval

`pnpm eval:stt [-v] [filter]` decodes every labelled clip several ways and reports word errors per
clip and the word error rate for each:

- `context`: what the app ships. Each segment is decoded with the utterance's earlier speech.
- `context-300`: as shipped, but with the old 0.3 s of lead-in instead of 0.6 s.
- `preroll`: each segment decoded alone, with 0.6 s of lead-in.
- `segment`: each segment decoded alone with no lead-in (the previous behaviour).
- `whole`: the whole clip in one pass. This is the best this model can do.
- `live`: what the app heard while recording.
- `wispr`: when the clip has it.

Scoring ignores case, punctuation and hyphens, and reads number words as digits. `-v` prints each
mistake as `[heard→expected]`, `[+extra]` or `[-missing]`.

## Voice scenario eval

Clips labelled with a scenario run against that scenario's checks. The clip is played through the
real transcriber at real speed, so partials, segments and the 2 s silence end fire the way they do
live. In multi-turn scenarios the clip replaces the last utterance and earlier turns are typed.
To cover a new real use case, add a scenario with checks to `scenarios.mts`, then label clips with
its name.
