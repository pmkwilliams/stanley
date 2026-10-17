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

| Kept as it is | Replaced (left untouched as reference until stage 7 passes, then deleted except what the new loop still uses) |
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
2. A prompt-card mode for one ~30-minute session: the shell shows a goal ("you want the second email
   gone"), the user says it however they like, and the clip is tagged with the card (`goal`, `kind`).
   Write ~130 cards from the real sessions in the per-`kind` counts of rewrite.md's stage 0, plus
   ~15 live-condition cards and the three one-minute background recordings (played through the
   speakers, no one talking).
3. Condition mixing: the background recordings mixed into each clean clip, tagged with `condition`.
4. A labeller: `said` prefilled from local Whisper large-v3-turbo (word timestamps), and a suggested
   `deciding` word the user confirms or corrects.
5. A coverage report: counts per `kind` and `condition` against the gate, and the frozen 30% test
   split, stratified by `kind`, written once and never reshuffled.

The user records; you can't. Their mic works only when the shell runs from their terminal (below).

## How to work here

- **Run the shell** in the user's Ghostty, never as a child of your shell (the agent shell sets
  `ELECTRON_RUN_AS_NODE=1`, and the mic would be attributed to an app that can't ask for it):
  `env -u ELECTRON_RUN_AS_NODE open -na Ghostty.app --args --working-directory="$PWD" -e "$PWD/scripts/dev.command"`.
  Stop any old Electron instance first, and check `pgrep -fl electron-vite` for a duplicate after
  launching. The user may have their own instance running; ask before killing it.
- **Commit** on the current branch (`main`) after each piece passes review; no feature branches unless asked.
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

## Settled with the user (2026-10-17)

All of these are written into rewrite.md: one ~30-minute recording session with conditions by
mixing; free-use recording on by default; local Whisper turbo for reference transcripts; gates pass
on the measured value with intervals reported; no cloud recognizers; a Swift helper is acceptable;
stage 2 is built as stage 3's first question; the action contract with declared effects and undo is
confirmed; Jev alone through stage 6, thinking rebuilt in stage 7, background tasks carried over
unchanged.
