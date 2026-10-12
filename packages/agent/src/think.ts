import { jsonSchema, Output, stepCountIs, streamText, tool } from 'ai'

export interface ThinkRequest {
  /** The conversation and the screen, as every model reads it. */
  context: string
  /** Why this turn needs thinking. */
  reason: string
  /** The options available right now, one per line. */
  options: string
  /** Runs one option and returns what the model should see next: the result, the screen and the new options. */
  act(option: string, text?: string): Promise<string>
  maxSteps: number
  signal: AbortSignal
  /** Each piece of text as it is written, so it can be spoken before the turn is over. */
  onText?(delta: string): void
}

export interface WriteRequest {
  context: string
  /** The field's option name, e.g. `"Lunch Friday?" › Reply to Sam Lee`. */
  field: string
  signal: AbortSignal
  /** Each piece of `say` as it is written. */
  onSay?(delta: string): void
}

/**
 * What goes in a field. `user`: the user's words, or text that follows directly from what they
 * asked (a search query, a city, a title). `stanley`: words Stanley writes in the user's name that
 * they haven't heard (a message, a reply, a post). `missing`: nothing to go on yet. `unclear`: the
 * words for it look misheard by speech recognition, so Stanley asks instead of typing.
 */
export interface Writing {
  source: 'user' | 'stanley' | 'missing' | 'unclear'
  text: string
  /** What to say to the user: '' for nothing. */
  say: string
}

export interface ConfirmRequest {
  context: string
  /** The button's option name. */
  option: string
  signal: AbortSignal
  /** Each piece of `say` as it is written, once it is clear the button won't be pressed. */
  onSay?(delta: string): void
}

/** Whether to press a button that commits something, now. When not, what to say instead. */
export interface Confirmation {
  press: boolean
  say: string
}

export interface Thinker {
  /** A turn that needs judgement, with tools. Returns what to say to the user: '' when there is nothing worth saying. */
  run(req: ThinkRequest): Promise<{ text: string }>
  /** One field the fast part has already chosen: what to type, and anything to say. One call, no tools. */
  write(req: WriteRequest): Promise<Writing>
  /** A button the fast part chose that sends, deletes or commits: press it now, or say why not. One call, no tools. */
  confirm(req: ConfirmRequest): Promise<Confirmation>
}

export const THINKING_PROMPT = `# Stanley
You are Stanley, a voice assistant that operates apps and websites on the user's computer. Quick steps are taken by a fast part of you; you take over whatever needs words or judgement. Everything either part did is in the conversation. Steps taken while the user was still speaking were guesses that later words may have corrected: don't mention or apologise for them, fix them. When the user takes something back or changes their mind, undo or redo what was done for it (untick, put back, retype) before anything else.

You act through the \`act\` tool, which runs one of the listed options: open an app, open a link, press a button, type into a field, go back or go home. Each result tells you what is on screen now and which options come next.

Everything you write as text is read aloud to the user by text-to-speech as you write it, and shown on screen. So:
- Write it the way you would say it out loud: no markdown, lists or other formatting.
- Keep it brief when you can: listening takes longer than reading.
- Don't narrate your steps. Take them.
- Say nothing when there is nothing worth saying. Don't confirm what the screen already shows.

How to act:
- Typing into a field never submits it. Submitting is pressing Enter or a button.
- When the user dictated the words for a field, type exactly their words, tidied (no filler words, fixed capitals and punctuation). When they only described what to write (a tone, an idea, a gist), write the finished text yourself. When they haven't said what they want written, ask: don't put words in their mouth.
- A field only ever gets the text itself: never a placeholder, a note to yourself or a question.
- Only press something that sends, posts, pays, buys, books, shares, archives, deletes or can't be undone when the user asked for that. Otherwise get it ready and ask. Asking to reply, message, email or post with words they gave is asking to send them; asking to draft or write something is not.
- Never send words you wrote yourself before the user has heard them: read them back word for word and ask whether to send.
- Answer questions from what is on screen, by looking it up, or from what you know, whichever is quickest to be right. Anything that changes over time (news, who holds an office, prices, scores, schedules) is looked up, not answered from memory.
- If the request is unclear, ask one short question instead of guessing.
- Do what the user asked for, then stop.`

/**
 * For the parts that act on the user's words (writing, thinking turns). Confirming a press
 * doesn't get it: unsure words never reach a press that commits (see `Agent.confirm`), and the
 * caution made confirming hesitate over clear requests too.
 */
export const MISHEARD = `## Speech recognition
The user's words come from speech recognition, which marks a word it was unsure of with (?). Only marked words are in doubt; take the rest as said. Read a marked word as what the user most likely said, given the conversation and the screen: a name on screen that sounds the same, or a word that sounds like one that fits. If a marked word matters and you can't tell what it was, ask, saying what you heard. Never type the marks.`

/** Claude through Vercel AI Gateway, driving the same options as the fast path. */
export function createThinker(opts: { model?: string } = {}): Thinker {
  const model = opts.model ?? 'anthropic/claude-haiku-5.5'
  return {
    async run({ context, reason, options, act, maxSteps, signal, onText }) {
      const result = streamText({
        model,
        abortSignal: signal,
        system: THINKING_PROMPT,
        prompt: `${context}\n\n${MISHEARD}\n\n## Why you are needed\n${reason}\n\n## Options\n${options}`,
        tools: {
          act: tool({
            description: 'Run one of the listed options. Pass `text` for options that type into a field.',
            inputSchema: jsonSchema<{ option: string; text?: string }>({
              type: 'object',
              properties: {
                option: { type: 'string', description: 'The option name: the text inside the brackets, exactly as listed.' },
                text: { type: 'string', description: 'What to type, for fields.' },
              },
              required: ['option'],
              additionalProperties: false,
            }),
            execute: ({ option, text }) => act(option, text),
          }),
        },
        stopWhen: stepCountIs(maxSteps),
      })
      // Text from separate steps (before and after a tool call) reads as one reply.
      let text = ''
      let stepEnded = false
      for await (const part of result.stream) {
        if (part.type === 'error') throw part.error
        if (part.type === 'finish-step') stepEnded = true
        if (part.type !== 'text-delta' || !part.text) continue
        let delta = part.text
        if (stepEnded && text.trim() && !/\s$/.test(text) && !/^\s/.test(delta)) delta = ` ${delta}`
        stepEnded = false
        text += delta
        onText?.(delta)
      }
      signal.throwIfAborted()
      return { text: text.trim() }
    },

    async write({ context, field, signal, onSay }) {
      const result = streamText({
        model,
        abortSignal: signal,
        system: THINKING_PROMPT,
        prompt: `${context}\n\n${MISHEARD}\n\n## Your part\nThe next step is typing into [${field}]. Give exactly what should appear in it: the finished words only, as they would be sent or saved, never a description of them or a note about writing them. Another part of you presses Enter or a button afterwards. Leave \`say\` empty unless you need to ask the user something.`,
        output: Output.object({ schema: jsonSchema<Writing>({
          type: 'object',
          properties: {
            source: {
              type: 'string',
              enum: ['user', 'stanley', 'missing', 'unclear'],
              description:
                "user: the user said these words, or the value follows directly from what they asked (a search query, a city, a number, a name, a choice from a list). stanley: you composed the wording, because the user gave only a description, a tone or a gist. missing: the user hasn't said any of what they want written yet (for example only \"reply\", or \"called\" with nothing after it). unclear: words marked (?) matter for this field and context doesn't tell you what they were, or the marked words make no sense here.",
            },
            text: {
              type: 'string',
              description:
                "Exactly what goes in the field, nothing else. Empty when missing. The user's own words are tidied, not changed. While they are still speaking, the words dictated so far, never words they haven't said yet. When they corrected themselves (\"at five, no, six\"), only the corrected version.",
            },
            say: {
              type: 'string',
              description:
                'Spoken to the user. Empty unless you need to ask something: when missing and they have finished, ask what to write; when unclear, say what you heard in quotes and ask what they meant; while they are still speaking, leave it empty.',
            },
          },
          required: ['source', 'text', 'say'],
          additionalProperties: false,
        }) }),
      })
      return streamSay(result, signal, onSay)
    },

    async confirm({ context, option, signal, onSay }) {
      const result = streamText({
        model,
        abortSignal: signal,
        system: THINKING_PROMPT,
        prompt: `${context}\n\n## Your part\nThe next step is pressing [${option}]. Judging by its name it may send, delete or otherwise commit something, but that is a guess: look at the screen. Press it now if it only opens or prepares something, or if the user asked for what it does and has heard any words you wrote yourself: when they already asked, asking again only slows them down. Otherwise say what is ready and ask.`,
        output: Output.object({ schema: jsonSchema<Confirmation>({
          type: 'object',
          properties: {
            press: { type: 'boolean', description: 'Press it now.' },
            say: { type: 'string', description: 'When not pressing, what to say to the user: what is on screen and ready, and a question. Only describe what the screen shows. Otherwise empty.' },
          },
          required: ['press', 'say'],
          additionalProperties: false,
        }) }),
      })
      return streamSay(result, signal, onSay, (partial) => partial.press === false)
    },
  }
}

/**
 * The finished output of a structured call, passing each new piece of its `say` field to `onSay`
 * as it streams in, once `speaks` agrees (fields stream in schema order).
 */
async function streamSay<T extends { say: string }>(
  result: { partialOutputStream: AsyncIterable<Partial<T> | undefined>; output: PromiseLike<T> },
  signal: AbortSignal,
  onSay?: (delta: string) => void,
  speaks: (partial: Partial<T>) => boolean = () => true,
): Promise<T> {
  let said = ''
  for await (const partial of result.partialOutputStream) {
    const say = partial && speaks(partial) && typeof partial.say === 'string' ? partial.say : ''
    if (say.length <= said.length || !say.startsWith(said)) continue
    onSay?.(say.slice(said.length))
    said = say
  }
  signal.throwIfAborted()
  return await result.output
}
