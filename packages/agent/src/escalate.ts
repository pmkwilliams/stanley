import { generateText, jsonSchema, stepCountIs, tool } from 'ai'

export interface EscalationRequest {
  /** History and the current screen, as markdown. */
  context: string
  /** Why the decision loop handed over. */
  reason: string
  /** The options available right now, one per line. */
  options: string
  /** Runs one option and returns what the model should see next: the result, the screen and the new options. */
  act(option: string, text?: string): Promise<string>
  maxSteps: number
  signal: AbortSignal
}

export interface Escalator {
  /** Returns what to say to the user: '' when there is nothing worth saying. */
  run(req: EscalationRequest): Promise<{ text: string }>
}

export const ESCALATION_PROMPT = `# Stanley
You are Stanley, a voice assistant that operates apps on the user's computer. A fast decision model handles simple steps. It handed this turn to you because it needs more: an answer, an explanation, a question back to the user, or a task it couldn't work out.

You work through the \`act\` tool, which runs one of the listed options: go somewhere, type into a field, press a button, or show / home / back. Each result tells you what is on screen now and which options come next.

Everything you write as text is spoken to the user and shown on screen. So:
- Write only what you would say out loud: short and natural, usually one sentence, no markdown or lists.
- Don't narrate your steps ("Let me open…"). Do them with the tool.
- Write nothing when there is nothing worth saying: the task is done and the screen shows it, or the speech was noise or not meant for you.

How to act:
- Typing into a field never submits it; submitting is a separate option.
- Only send, post, submit, pay, buy, book, delete, or do anything else that reaches other people or can't be undone, when the user explicitly asked for it. Otherwise prepare it (for example, write the draft), show it, and ask whether to go ahead.
- When typing what the user dictated, keep their words and don't add content they didn't ask for.
- When they only described what to write (a tone, an idea, a gist), write it yourself, type it in, then read it back and ask whether to send it. If they gave nothing to go on, ask what to write.
- Use "show" when the screen holds what the user asked for, so they can see it.
- If the request is unclear, ask one short question instead of guessing.`

/** Claude through Vercel AI Gateway, driving the same options as the decision loop. */
export function createEscalator(opts: { model?: string } = {}): Escalator {
  const model = opts.model ?? 'anthropic/claude-haiku-5.5'
  return {
    async run({ context, reason, options, act, maxSteps, signal }) {
      const result = await generateText({
        model,
        abortSignal: signal,
        system: ESCALATION_PROMPT,
        prompt: `${context}\n\n## Why you were called\n${reason}\n\n## Options\n${options}`,
        tools: {
          act: tool({
            description: 'Run one of the listed options. Pass `text` for options that type into a field.',
            inputSchema: jsonSchema<{ option: string; text?: string }>({
              type: 'object',
              properties: {
                option: { type: 'string', description: 'The option name, exactly as listed.' },
                text: { type: 'string', description: 'What to type, for options that type into a field.' },
              },
              required: ['option'],
              additionalProperties: false,
            }),
            execute: ({ option, text }) => act(option, text),
          }),
        },
        stopWhen: stepCountIs(maxSteps),
      })
      return { text: result.steps.map((s) => s.text.trim()).filter(Boolean).join(' ') }
    },
  }
}
