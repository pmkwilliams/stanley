import { experimental_decide } from 'ai'

export interface Question {
  instructions: string
  /** Option name → description. Max 255 options. */
  options: Record<string, string | null>
}

export interface ChoiceRequest extends Question {
  state: string
  signal?: AbortSignal
}

export interface Answer {
  choice: string
  probabilities: Record<string, number>
  confidence: number
}

export interface ChoiceResult extends Answer {
  latencyMs: number
  usage?: { inputTokens?: number; outputTokens?: number }
}

export interface DecideRequest {
  state: string
  questions: Record<string, Question>
  signal?: AbortSignal
}

export interface MultiChoiceResult {
  answers: Record<string, Answer>
  latencyMs: number
  usage?: ChoiceResult['usage']
}

export interface DecisionClient {
  /** One choice question about a state. */
  choose(req: ChoiceRequest): Promise<ChoiceResult>
  /** Several choice questions about the same state, in one call. */
  decide(req: DecideRequest): Promise<MultiChoiceResult>
}

const MAX_OPTIONS = 255

/** Jev through Vercel AI Gateway (`typesafe-ai/jev`). Reads AI_GATEWAY_API_KEY. */
export function createJevClient(opts: { model?: string } = {}): DecisionClient {
  const model = opts.model ?? 'typesafe-ai/jev'
  const decide = async ({ state, questions, signal }: DecideRequest): Promise<MultiChoiceResult> => {
    for (const [id, q] of Object.entries(questions)) {
      const count = Object.keys(q.options).length
      if (count === 0) throw new Error(`Jev: no options for "${id}"`)
      if (count > MAX_OPTIONS) throw new Error(`Jev: ${count} options for "${id}" exceeds limit of ${MAX_OPTIONS}`)
    }
    const started = performance.now()
    const result = await experimental_decide({
      model,
      state,
      abortSignal: signal,
      questions: Object.fromEntries(
        Object.entries(questions).map(([id, q]) => [id, { type: 'choice' as const, instructions: q.instructions, criteria: q.options }]),
      ),
    })
    // TypeSafe reports confidence per question in provider metadata, not on the answer.
    // Fall back to the choice's probability so missing metadata doesn't gate every action.
    const meta = result.providerMetadata as { typesafe?: { confidence?: Record<string, number> } } | undefined
    const answers: Record<string, Answer> = {}
    for (const id of Object.keys(questions)) {
      const answer = result.answers[id] as { choice: string; probabilities?: Record<string, number> }
      answers[id] = {
        choice: answer.choice,
        probabilities: answer.probabilities ?? { [answer.choice]: 1 },
        confidence: meta?.typesafe?.confidence?.[id] ?? answer.probabilities?.[answer.choice] ?? 0,
      }
    }
    return { answers, latencyMs: performance.now() - started, usage: result.usage as ChoiceResult['usage'] }
  }
  return {
    decide,
    async choose({ state, instructions, options, signal }) {
      const { answers, latencyMs, usage } = await decide({ state, questions: { q: { instructions, options } }, signal })
      return { ...answers.q!, latencyMs, usage }
    },
  }
}

/** Several choice questions about one state in a single Jev call. */
export function chooseMany(req: DecideRequest & { model?: string }): Promise<MultiChoiceResult> {
  return createJevClient({ model: req.model }).decide(req)
}

/**
 * Offline stand-in: scores options by word overlap with the state.
 * Good enough to exercise the loop without network access.
 */
export function createMockJevClient(): DecisionClient {
  const choose = async ({ state, options }: ChoiceRequest): Promise<ChoiceResult> => {
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
  }
  return {
    choose,
    async decide({ state, questions }) {
      const answers: Record<string, Answer> = {}
      for (const [id, q] of Object.entries(questions)) answers[id] = await choose({ state, ...q })
      return { answers, latencyMs: 0 }
    },
  }
}
