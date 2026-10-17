# Rewrite: the agent loop and evals, one stage at a time

Stanley v1 proved the core bet: a fast decision model can take steps from a text view of the screen
while the user is still speaking, and a language model can take whatever needs words or judgement.
It also grew a loop no one can reason about: `agent.ts` is 2,400 lines with ~39 mutable fields, ~60
hand-set thresholds fitted to Jev's raw probabilities, eight kinds of question asked of Jev, and a
dozen paths to thinking. Most eval numbers are 2–3 runs on synthetic, typed scenarios, and the last
two big changes were never measured against a baseline.

We keep the shell and rewrite the agent loop and the evals from first principles. The evals come
first, and they test one stage at a time. **We don't start a stage until the one before it passes a
gate agreed before its first run.**

## Decisions

- **Surface**: our own shell and our own apps (web pages in the shell stay supported through the
  browser extractor).
- **Decider**: Jev by default, behind an interface, so a local decision model or another hosted one
  can be compared on the same cases.
- **First milestone**: sub-second navigation, layout and basic operations while the user speaks, with
  accuracy ahead of raw speed, then handing off to thinking.
- **The decision model does almost everything.** Jev should make the vast majority of decisions and
  take almost all the steps. Stages 0–6 build and test Jev alone, taking control of every request a
  person would carry out without needing words or judgement, and push it as far as it will go
  before any work on thinking starts. Thinking is rebuilt after that, in stage 7, on the local
  model; a cloud model is considered only if stage 7's results call for it.
- **Stack**: TypeScript, Electron, Svelte. The shell (`apps/desktop`), the app cores and UIs
  (`packages/app-*`), `packages/browser`, `packages/files` and `packages/tts` are kept.
  `packages/agent`, `packages/jev` and `evals/` are replaced; they stay in the tree, untouched, as
  reference until stage 7 passes. Then they are deleted, except what the new loop still uses:
  background tasks (thinking's `delegate`, `background.ts`, `claude-code.ts`) carry over unchanged,
  and typing into fields and answering from the screen stay on v1's code until their own stages
  replace them.
- **Speech recognition is tested, not assumed.** Parakeet TDT 0.6B v2 has never been measured on the
  user's voice, and it is run as pseudo-streaming (the open segment re-decoded every ~400 ms, final
  segments never revised). Recognition runs on this computer; cloud recognizers are not candidates
  or references. A small Swift helper the shell launches is acceptable.

## Principles

1. **One agent.** Every model is Stanley, addressed in the second person. Each model reads the state
   and does what comes next. No model is told what another layer decided, which model took a step,
   or why it is being asked. Whatever one model sees, the others see in the same order, arranged so
   the shared append-only history keeps its cache.
2. **Wait by kind of step.** The question is never "has the user stopped talking?" but "could their
   next words change what Stanley is about to do?" Going somewhere runs mid-word; an undoable change
   runs once Stanley is sure; text goes in at a pause; anything that sends, pays or deletes waits for
   the end of the turn and the user's go-ahead.
3. **The policy is a table, not branches.** Which steps may run, given the turn's state and the
   step's effect, is a pure function that can be tested without a model.
4. **Thresholds are calibrated, few, and per gate.** Every decision is logged with its outcome;
   cutoffs come from calibration curves fitted on held-out data, not from tuning on dev.
5. **No case-specific patches.** A failing case is fixed by changing a mechanism. No prompt wording
   about one scenario, no prompt notes for one decider.
6. **Every stage's output is recorded,** keyed by its input, so later stages replay it for free and
   deterministically.

## The stage ladder

Each stage has a question it answers, a dev set and a frozen test set, a metric with confidence
intervals, and a gate. The gate numbers below are proposals to agree before the stage's first run;
once agreed they don't move to fit a result. If a stage can't reach its gate, we change the design of
that stage (or the gate, explicitly and in writing), not the next stage.

A gate passes on the measured value, with its confidence interval always reported beside it (the
corpus is small, and a gate on the interval's lower bound could never clear ~98%). One candidate
beats another only when their intervals don't overlap.

### Stage 0: corpus

*Is there enough real speech, labelled, to test every later stage?*

- Recordings of the user's voice in the shell: 16 kHz mono WAV per utterance, with the shell's state
  when the utterance started (open apps, layout, each app's state) and the session timeline.
- Two ways of collecting: **prompted** (a card describes a goal, never the words to say, e.g. "you
  want the second email gone"), and **free use** of the shell.
- Labels per utterance:
  - `said`: what was actually said, verbatim, fillers included.
  - `goal`: what the user wanted, in plain words, plus the expected end state of the apps where it
    can be checked.
  - `deciding`: the word after which a person at the computer would know what to do. Its time comes
    from the reference transcript's word timings, corrected by hand.
  - `kind`: command, short command, naming something on screen, self-correction, backchannel,
    not for Stanley, dictation, question, compound.
  - `conditions`: quiet, music on speakers, Stanley speaking, other voices.
- Action labels (which option, which app action) are added in stage 3, once the action space exists.
- **One recording session of about 30 minutes.** Each recording should be of something only the
  user's voice can give:
  - **Conditions by mixing.** The user records in quiet. In the same session the shell plays each
    background (music, Stanley speaking, other voices) through the speakers for a minute with no
    one talking, and the mic records the room. Those recordings are mixed into every clean clip, so
    each clip yields all four conditions. About 15 cards are recorded live with a background playing
    to check that mixed clips score like live ones (people talk louder over noise).
  - **Labels mostly prefilled.** A prompted card already gives `goal` and `kind`, and the mix gives
    `condition`. The user checks `said` (prefilled from Whisper large-v3-turbo, run locally) and
    confirms a suggested `deciding` word.
  - **Text from real sessions.** Stages that need no audio (2–3) add dev cases from the transcripts
    in real session logs, which are rich in feedback about the app (talk not for Stanley).
  - **Free use.** Recording stays on by default; free-use clips go to dev only.
- **Gate**: about 130 labelled prompted utterances, weighted to what needs the voice: command 20,
  short command 20, naming something on screen 20, self-correction 15, compound 15, dictation 10,
  question 10, backchannel 10, not for Stanley 10 (every `kind` at least 10). Every `condition`
  covered by mixing, checked against the ~15 live clips, and the three background recordings. A
  frozen 30% test split, stratified by `kind`, written once before any later stage looks at it.

### Stage 1: hearing

*Does speech recognition give the later stages words they can act on, soon enough?*

- Input: stage 0 audio, played in real time. Output: a stream of partial and final words with times
  and confidences.
- Candidates, one on disk at a time:

  | Model | Why |
  | --- | --- |
  | Parakeet TDT 0.6B v2, as shipped | Baseline |
  | Parakeet TDT 0.6B v3 | Newer version of the same model |
  | NVIDIA Nemotron streaming (cache-aware FastConformer) | Real streaming: processes only new audio |
  | Moonshine v2 streaming | Built for low time to first word on small devices |
  | Apple SpeechAnalyzer (macOS 26) | Native, streaming, custom vocabulary; needs a small Swift helper |
  | Kyutai STT | Streaming, with built-in semantic end-of-speech detection |
  | Whisper large-v3-turbo | Reference for the ceiling, not a candidate |

- Every candidate is first screened on dev for word error rate and emission latency; only the best
  two or three get the full metrics.

- Metrics:
  - Word error rate overall and per `kind` and `condition`.
  - **Command-word accuracy**: the words a step depends on (verbs, app names, item names).
  - **Name accuracy**: names shown on screen, with and without the model's vocabulary biasing.
  - **Emission latency**: from a word's end in the audio to its first appearance in a partial, p50
    and p90.
  - **Stability**: how often an emitted word is later changed, and how late.
  - **Hallucination**: words produced from silence, noise and music.
  - **Confidence usefulness**: how well a word's confidence predicts that it is wrong (AUROC).
  - Memory, CPU, disk.
- **Gate (proposed)**: command words ≥98% right, on-screen names ≥95%, emission p50 ≤300 ms and p90
  ≤600 ms, no invented words on silence or music, and a confidence that predicts errors (AUROC ≥0.8)
  or a decision that the later stages won't use it.

### Stage 2: addressing

*Is what was said meant for Stanley?*

- Input: stage 1's words (and audio, if a candidate needs it). Output: for Stanley, a backchannel
  ("mm-hmm", "okay"), or not for Stanley (talking to someone else, thinking out loud, feedback about
  the app itself).
- It is built as the first question of stage 3's decision, since it can't be designed apart from
  how stage 3 renders the state. It keeps its own cases and gate, checked as part of stage 3's gate.
- **Gate (proposed)**: under 1% of backchannels and talk not for Stanley lead to a step; under 2% of
  requests for Stanley are ignored.

### Stage 3: deciding on a finished request

*Given the whole request and the screen, does Stanley pick the right next step?*

- No timing yet: the final transcript (both the true one and stage 1's) and the state at the
  utterance's start.
- **Jev alone.** Every case is labelled `alone` (a person would carry it out without needing words
  or judgement) or `needs thinking`. Handing off to thinking is one of the steps Jev can choose, but
  in stages 3–6 it ends the case: thinking isn't run. On `alone` cases a handoff counts as wrong; on
  `needs thinking` cases Jev should hand off rather than act.
- **What counts as right.** Each case has the set of acceptable next steps and, where it can be
  checked, the expected end state, written by the agent and spot-checked by the user, so more than
  one valid path passes.
- This stage starts from first principles, with no v1 code carried over:
  1. **The action space.** What a step is: our apps' typed actions with an effect (`navigate`,
     `view`, `undoable`, `commit`, `destructive`) and typed arguments, alongside the generic
     element actions for web pages. Effects are declared by the apps, not inferred, except on web
     pages. Every `navigate`, `view` and `undoable` action comes with its undo in the contract, since
     stage 5 undoes steps taken before the turn ended. This reverses v1's "no hints for the agent"
     rule for our own apps.
  2. **The state.** How the screen, history and request are rendered for a decision model.
  3. **The questions.** As few as possible, always the same ones. v1's evidence: separate questions
     for what to do now, which step, and whether the user has finished beat one combined question;
     consent was cleanest as its own question.
  4. **Then the model.** Jev, a local decision model on llama.cpp's Jev-compatible endpoint (e.g.
     Laya, Kev-4B), SubQ Snap, on the same cases.
- Metrics: accuracy at the operating point; `alone` cases handed off; calibration (reliability
  curve, expected calibration error) per question; the margin between the top two options; latency
  p50/p90; input tokens.
- **Gate (proposed)**: ≥95% right on the clear cases at a calibrated cutoff, ≥90% on stage 1's
  transcripts, under 3% of `alone` cases handed off, and wrong steps that would change something
  under 1%.

### Stage 4: deciding while the user speaks

*Fed word by word, does Stanley act soon after the deciding word, and never before it?*

- Stage 3's cases, replayed with stage 1's timings, and stage 3's recorded model answers replayed
  instead of new calls wherever the input is unchanged.
- This is where the turn state machine and the policy table are built and tested.
- Metrics: time from the deciding word to the right step, p50/p90; steps taken before the deciding
  word; wrong steps; steps taken and then undone.
- **Gate (proposed)**: navigation and layout within 500 ms of the deciding word at p50 (1 s at p90),
  no commit before the turn ends, acting too early under 2%.

### Stage 5: steps and undoing

*Do multi-step requests finish, and are self-corrections undone?*

- Headless app cores, checked by their end state.
- Every step taken before the turn ended can be undone; a step the final words contradict ("Mail,
  no, Calendar") is undone.
- Metrics: end state right; no steps repeated back and forth; self-corrections undone; steps per
  request.
- **Gate (proposed)**: end state right on ≥95% of single-step and ≥85% of compound requests; every
  self-correction in the corpus undone.

### Stage 6: voice end to end, Jev alone

*From audio to app state, with every stage together.*

- Stage 0 audio through stages 1–5 in the shell's real pipeline, headless. A handoff to thinking
  still ends the case.
- Metrics: end state right; share of `alone` requests finished by Jev; latency at each stage's
  boundary.
- **Gate**: within a few points of the product of the stages' own results (if it is much worse, a
  boundary between stages is wrong).

### Stage 7: thinking

*When Jev hands off, does thinking finish the request, and does Jev still take almost every step?*

- Thinking is rebuilt small: it reads the same shared history as Jev, in the same order, with v1's
  tools. Background tasks (`delegate`) carry over unchanged.
- Thinking runs on the local model the shell already serves (Gemma 4 E4B on llama.cpp). Whether to
  upgrade to a cloud model is decided from this stage's results, not before.
- Cases: the `needs thinking` cases and the handoffs recorded in stages 3–6.
- Metrics: end state or answer right; time from the handoff to thinking's first step or words;
  steps thinking took that Jev could have; share of all steps taken by Jev in end-to-end runs.
- **Gate (proposed)**: `needs thinking` requests right ≥85%; latency no worse than v1's (4.5 s p50,
  13 s p90); ≥90% of all steps taken by Jev; stage 6 rerun with thinking within a few points of its
  own result. Passing it ends milestone one, and v1's agent and evals are deleted, except the parts
  the new loop still uses.

### After milestone one

Each of these is a stage of its own, defined when we reach it: typing what the user says into fields
(v1's local Gemma writer is the baseline: 94% held-out, 0.5 s p50) and answering from what is on
screen. Until then both stay on v1's code.

## How the evals are built

- New evals live in `bench/`, one folder per stage. Each stage's runner writes its outputs keyed by a
  hash of its inputs, so the next stage replays them.
- Every number is reported with a confidence interval. Anything involving a model runs at least 5
  times; a difference inside the intervals is not a result.
- Splits: dev and a frozen test set per stage. The test set is run only to check a gate.
- Carried over from v1's culture: paid runs list what they'll run and the number of paid calls before
  starting; a test that no eval utterance's wording appears in any prompt or option text; traces show
  every decision with its runner-up probabilities; "copy as eval" from a real session.
- Local runs first. Paid calls only where a stage needs a hosted model.

## What v1 taught us (the numbers behind the decisions)

- Jev in real use: 313 ms p50, 471 ms p90 over 3,371 decisions. Navigation while speaking was the
  most reliable path.
- Separate questions beat one combined question (it spread 50% over an option whose route held 98%).
- Consent as its own question: asked-for sends 0.91–1.00, drafts 0.11–0.15; folded into "what now"
  they overlapped.
- Turn-taking from Smart Turn and Jev together: the end called 0.75 s after the last word, 4% cut-ins,
  against ~20% with either alone.
- Real speech: 30% of utterances had at least one unsure word; short commands misheard ("Go to" →
  "Got it", "Close" → "Clause"); "mm-hmm" heard as "Next" skipped songs.
- Acting on half a thought: a save pressed halfway through the sentence that named the item; 223
  stale decisions thrown away in real use; 15 loop-guard trips.
- Much real speech was feedback about the app, not requests for Stanley.
- Prompt wording tipped Jev's close calls again and again; thresholds were refitted to the same flaky
  scenarios.
- Thinking with tools: 4.5 s p50, 13 s p90.
- Jev independently: one evaluation found calibration error from 0.011 to 0.108 depending on the task,
  and its separate confidence number added nothing beyond the probabilities. Calibrate it on our own
  decisions.
