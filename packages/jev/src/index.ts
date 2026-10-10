import { experimental_decide } from 'ai'

export interface ChoiceRequest {
  state: string
  instructions: string
  /** Option name → description. Max 255 options. */
  options: Record<string, string | null>
  signal?: AbortSignal
}

export interface ChoiceResult {
  choice: string
  probabilities: Record<string, number>
  confidence: number
  latencyMs: number
  usage?: { inputTokens?: number; outputTokens?: number }
}

export interface DecisionClient {
  choose(req: ChoiceRequest): Promise<ChoiceResult>
}

const MAX_OPTIONS = 255
const QUESTION_ID = 'next'

/** Jev through Vercel AI Gateway (`typesafe-ai/jev`). Reads AI_GATEWAY_API_KEY. */
export function createJevClient(opts: { model?: string } = {}): DecisionClient {
  const model = opts.model ?? 'typesafe-ai/jev'
  return {
    async choose({ state, instructions, options, signal }) {
      const count = Object.keys(options).length
      if (count === 0) throw new Error('Jev: no options')
      if (count > MAX_OPTIONS) throw new Error(`Jev: ${count} options exceeds limit of ${MAX_OPTIONS}`)

      const started = performance.now()
      const result = await experimental_decide({
        model,
        state,
        abortSignal: signal,
        questions: {
          [QUESTION_ID]: { type: 'choice', instructions, criteria: options },
        },
      })
      const answer = result.answers[QUESTION_ID] as { choice: string; probabilities?: Record<string, number> }
      // TypeSafe reports confidence per question in provider metadata, not on the answer.
      // Fall back to the choice's probability so missing metadata doesn't gate every action.
      const meta = result.providerMetadata as { typesafe?: { confidence?: Record<string, number> } } | undefined
      return {
        choice: answer.choice,
        probabilities: answer.probabilities ?? { [answer.choice]: 1 },
        confidence: meta?.typesafe?.confidence?.[QUESTION_ID] ?? answer.probabilities?.[answer.choice] ?? 0,
        latencyMs: performance.now() - started,
        usage: result.usage as ChoiceResult['usage'],
      }
    },
  }
}

/**
 * Offline stand-in: scores options by word overlap with the state.
 * Good enough to exercise the loop without network access.
 */
export function createMockJevClient(): DecisionClient {
  return {
    async choose({ state, options }) {
      const words = new Set(state.toLowerCase().match(/[a-z0-9]+/g) ?? [])
      const names = Object.keys(options)
      const raw = names.map((name) => {
        const text = `${name} ${options[name] ?? ''}`.toLowerCase().match(/[a-z0-9]+/g) ?? []
        return 1 + text.filter((w) => words.has(w)).length
      })
      const total = raw.reduce((a, b) => a + b, 0)
      const probabilities = Object.fromEntries(names.map((n, i) => [n, raw[i]! / total]))
      const choice = names[raw.indexOf(Math.max(...raw))]!
      return { choice, probabilities, confidence: probabilities[choice]!, latencyMs: 0 }
    },
  }
}
