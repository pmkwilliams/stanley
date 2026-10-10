<img src="assets/icon.svg" width="64" height="64" alt="">

# Stanley

Voice-controlled desktop assistant driven by a System One decision model (TypeSafe Jev).
See [docs/DESIGN.md](docs/DESIGN.md).

## Setup

```sh
pnpm install
pnpm models          # Parakeet TDT 0.6B v2 + Silero VAD (~640 MB) into ./models
cp .env.example .env # AI_GATEWAY_API_KEY, PARALLEL_API_KEY
pnpm dev
```

Without `AI_GATEWAY_API_KEY` the app runs with a mock decision model.

- `⌥Space` toggles listening (also ends after ~2 s of silence).
- `⌘.` toggles the HUD. The HUD also has a text box to type utterances.

```sh
pnpm test            # unit tests (agent loop, options, transcript)
pnpm eval [filter]   # headless scenario evals against real Jev/Haiku (needs .env)
pnpm typecheck
```

## Layout

```
apps/desktop       Electron shell (main, preload, Svelte renderer)
packages/app-sdk   App / node / surface contracts
packages/agent     Decision loop, context log, serializers, guardrails
packages/jev       Jev via Vercel AI Gateway + mock
packages/stt       sherpa-onnx Parakeet + Silero VAD
packages/app-*     Demo apps: ./core (headless) + ./ui (Svelte)
evals              Headless scenario evals
```
