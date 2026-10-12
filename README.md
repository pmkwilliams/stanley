<img src="assets/icon.svg" width="64" height="64" alt="">

# Stanley

Voice-controlled desktop assistant. A fast decision model (TypeSafe Jev) takes each step from what is
on screen; a language model (Claude Haiku) takes whatever needs words or judgement. It works from the
screen's elements as an accessibility tree describes them, so it carries over to any app or website.
See [docs/DESIGN.md](docs/DESIGN.md).

## Setup

```sh
pnpm install
pnpm models          # Parakeet TDT 0.6B v2, Silero VAD, Smart Turn, Kokoro (~1 GB) into ./models
cp .env.example .env # AI_GATEWAY_API_KEY, PARALLEL_API_KEY
pnpm dev
```

Without `AI_GATEWAY_API_KEY` the app runs with a mock decision model.

- `⌥Space` toggles listening. The mic stays on until you toggle it; a ~2 s pause ends the current request.
- `⌘.` toggles the HUD. The HUD also has a text box to type utterances.

```sh
pnpm test            # unit tests (agent loop, conversation, options, shell, page extraction)
pnpm eval [filter]   # demo-app scenario evals against real Jev/Haiku (needs .env, costs money)
pnpm eval:web        # the same agent on websites in headless Chromium (--live for real sites)
pnpm eval:stt        # transcription accuracy on your recorded clips (local, free)
pnpm eval:voice      # scenario evals driven by recorded clips (costs money)
pnpm smoke:desktop   # build, launch the app, type two utterances, screenshot both windows
pnpm typecheck
```

## Layout

```
apps/desktop       Electron shell (main, preload, Svelte renderer)
packages/app-sdk   App / node / surface contracts
packages/agent     Agent loop, conversation, options, thinking, guardrails
packages/jev       Jev via Vercel AI Gateway + mock
packages/browser   Any web page as a screen (generic extractor + Playwright world)
packages/stt       sherpa-onnx Parakeet + Silero VAD
packages/tts       sherpa-onnx Kokoro: Stanley's voice
packages/app-*     Demo apps: ./core (headless) + ./ui (Svelte)
evals              Headless scenario + speech evals (see evals/README.md)
```
