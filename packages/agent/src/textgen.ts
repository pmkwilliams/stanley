import { generateText } from 'ai'

export interface TextGen {
  /** Returns '' when the user has not said the value yet. */
  fill(req: { context: string; instructions: string; signal?: AbortSignal }): Promise<string>
}

/** Haiku 5.5 through Vercel AI Gateway. Only fills input slots — never talks to the user. */
export function createTextGen(opts: { model?: string } = {}): TextGen {
  const model = opts.model ?? 'anthropic/claude-haiku-5.5'
  return {
    async fill({ context, instructions, signal }) {
      const { text } = await generateText({
        model,
        abortSignal: signal,
        system:
          'You fill a single input field for a voice assistant. Reply with only the text to type into the field. No quotes, no explanation. ' +
          "Use the user's own words; only tidy them (capitalization, punctuation, dropping filler like \"um\"). Never add details, sentences or sentiments they didn't say. " +
          'If the user has not yet said what goes in the field (for example they said only "reply", or stopped at "called…" or "um"), reply with nothing. Never invent a placeholder.',
        prompt: `${context}\n\n## Field\n${instructions}`,
      })
      return text.trim()
    },
  }
}
