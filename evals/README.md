# Evals

| Command | What it checks | Cost |
|---|---|---|
| `pnpm eval:stt` | Transcription accuracy on recorded clips | Free (local) |
| `pnpm eval:voice <filter>` | Agent behaviour when a recorded clip is the request | Paid (Jev + Haiku) |
| `pnpm eval <filter>` | Agent behaviour on typed scenarios | Paid (Jev + Haiku) |

The paid evals run nothing without a filter or `--all`. They list what they would run instead, and
every run ends with the number of paid calls it made.

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
- `preroll`: each segment decoded alone, with 0.3 s of lead-in.
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
