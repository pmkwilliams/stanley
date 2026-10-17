# Handoff: starting the rewrite

You are picking up the rewrite of Stanley's agent loop and evals. Read
[rewrite.md](rewrite.md) first: it is the plan, and its stages and gates are agreed. This file is
what you need to start stage 0 without re-deriving anything.

## Where things stand (2026-10-17)

- Research is done: the v1 design, its git history and evals, its real session logs, and outside
  work on decision models, fast computer-use agents and real-time voice. The conclusions that
  matter are in rewrite.md's "Decisions" and "What v1 taught us".
- No rewrite code exists yet.

## What is kept and what is replaced

| Kept as it is | Replaced (left untouched as reference until stage 6 passes, then deleted) |
| --- | --- |
| `apps/desktop` (the shell), `packages/app-*`, `packages/app-sdk`, `packages/browser`, `packages/files`, `packages/tts` | `packages/agent`, `packages/jev`, `evals/` |
| `packages/stt` until stage 1 picks a recognizer | |

New evals go in `bench/`, one folder per stage. New packages are added as a stage needs them; don't
scaffold ahead of the stage you're on.

## Stage 0: what to build first

Most of the recording path already exists; extend it rather than starting over.

- **Saving clips**: Debug › Save Utterances as Eval Clips (or `STANLEY_SAVE_CLIPS=1`) writes each
  spoken utterance to `evals/speech/clips/<session>-<n>.wav` with `{recordedAt, heard}`
  (`apps/desktop/src/main/index.ts`, `writeClip`, around line 466). Clips are gitignored (the user's
  voice).
- **Labelling**: `pnpm clips:label` (`evals/label.mts`) plays each clip and asks what was said,
  prefilled from `evals/speech/prompts.txt` (44 lines, which are scripts to read verbatim and so
  don't match the plan's "describe the goal, never the words").
- **Free STT eval**: `pnpm eval:stt` (`evals/stt.mts`) already scores decoding strategies against
  labelled clips; useful as the starting point for stage 1, but stage 1's metrics (emission latency,
  stability, command-word and name accuracy) are new.
- **Real usage, text only**: `~/Library/Application Support/Stanley/sessions/*.jsonl` (966 files,
  Oct 10–17, ~157 spoken sessions, ~777 utterances). No audio. Use them to write the prompt cards and
  to see which kinds of request really happen; they can't replace recordings.

To do, in order:

1. Move clip storage to `bench/corpus/` (gitignored), and save with each clip the shell's state at
   the utterance's start (open apps, layout, each app's state) so stage 3 can rebuild the screen.
2. A prompt-card mode: the shell shows a goal ("you want the second email gone"), the user says it
   however they like, and the clip is tagged with the card. Write the cards from the real sessions,
   covering every `kind` and `condition` in rewrite.md's stage 0.
3. A labeller for the stage 0 schema (`said`, `goal`, `deciding`, `kind`, `conditions`). Word timings
   come from a reference transcription of the whole clip; the user corrects the deciding word.
4. A coverage report: counts per `kind` and `condition` against the gate, and the frozen 30% test
   split, written once and never reshuffled.

The user records; you can't. Their mic works only when the shell runs from their terminal (below).

## How to work here

- **Run the shell** in the user's Ghostty, never as a child of your shell (the agent shell sets
  `ELECTRON_RUN_AS_NODE=1`, and the mic would be attributed to an app that can't ask for it):
  `env -u ELECTRON_RUN_AS_NODE open -na Ghostty.app --args --working-directory="$PWD" -e "$PWD/scripts/dev.command"`.
  Stop any old Electron instance first, and check `pgrep -fl electron-vite` for a duplicate after
  launching. The user may have their own instance running; ask before killing it.
- **Commit** on the current branch (`main`) when the user asks; no feature branches unless asked.
- **Disk**: check `df -h /System/Volumes/Data` before any model download. It has been as low as
  ~9 GB free and swings by ~4 GB (275 GB free on 2026-10-17). One model on disk at a time in stage 1;
  delete each when its run is done.
- **Gates are agreed with the user before a stage's first run.** rewrite.md's numbers are proposals.
  Bring results with confidence intervals; don't move to the next stage, or change a gate, without
  the user agreeing.
- **One agent.** Every model is Stanley in the second person; nothing tells a model what another
  layer decided or why it is being asked; whatever one model sees, the others see in the same order.
  The user is emphatic about this.
- **No case-specific fixes.** A failing case is fixed by changing a mechanism; never add wording
  about one scenario to a prompt or an option.
- **UI**: Tailwind's default scales, semantic tokens, shadcn-svelte components first.
- **Answers**: scoped to the decision at hand; no inventories or asides.

## Open questions to settle with the user as they come up

- Stage 0: how many sessions they can record per week, and whether free-use recording stays on by
  default.
- Stage 1: whether a cloud recognizer is acceptable in the product or only as a reference; whether a
  Swift helper (for Apple SpeechAnalyzer) is acceptable in the shell.
- Stage 3: the app action contract (typed actions with declared effects) reverses v1's "no hints for
  the agent" rule for our own apps. The user has chosen our own shell and apps, but confirm the
  contract before building it.
