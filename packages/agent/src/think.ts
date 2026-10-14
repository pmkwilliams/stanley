import { jsonSchema, parsePartialJson, stepCountIs, streamText, tool, type LanguageModel, type LanguageModelUsage, type ModelMessage, type Tool, type ToolResultPart, type ToolSet } from 'ai'
import { DEFAULT_AGENT_NAME } from '@stanley/app-sdk'
import { filesPrompt } from './files'
import { named } from './narrate'
import { skillsPrompt, type SkillScan } from './skills'
import type { WebResult } from './web'

/** One `act` call: an option, and for fields the text and whose words it is. */
export interface ActCall {
  option: string
  text?: string
  wrote?: 'user' | 'stanley'
}

export interface SearchOutput {
  query: string
  results: WebResult[]
}

export interface PageOutput {
  url: string
  title: string
  markdown: string
}

/** What writing or changing a file gives back: what happened, and for a page, a picture of it. */
export interface FileOutput {
  text: string
  image?: { data: string; mediaType: string }
}

/** A file output as the model reads it: the picture after the words. */
export function fileOutput(output: FileOutput): ToolResultPart['output'] {
  if (!output.image) return { type: 'text', value: output.text }
  return { type: 'content', value: [{ type: 'text', text: output.text }, { type: 'file', data: { type: 'data', data: output.image.data }, mediaType: output.image.mediaType }] }
}

export interface ThinkRequest {
  /** The instructions, fixed for the session so the cached prefix never changes. */
  instructions: string
  /** The whole history, its observation last. */
  messages: ModelMessage[]
  /** Index of the message the previous call's input ended on: its cache is read there. */
  cacheAt?: number
  /** A turn that decides one step: its calls come back unrun, for the agent to apply. */
  single?: { kind: 'write' | 'confirm'; option: string }
  /** Runs one option and returns what comes of it: the outcome, the screen and the new options. */
  act(call: ActCall, toolCallId: string): Promise<string>
  /** Searches the web in the background. Absent without web access. Throws when it fails. */
  search?(query: string, toolCallId: string): Promise<SearchOutput>
  /** Reads a web page in the background. Absent without web access. Throws when it fails. */
  fetch?(url: string, toolCallId: string): Promise<PageOutput>
  /** Puts a web page on screen by its address, or a file by its path, and returns what is on screen then. Absent when pages can't be opened. */
  openPage?(url: string, toolCallId: string): Promise<string>
  /** Runs a command on the user's files, in the background, and returns what it printed. Absent without them. */
  bash?(command: string, toolCallId: string): Promise<string>
  /** Writes a file in the user's folder; a web page is put on screen. Absent without them. */
  writeFile?(path: string, content: string, toolCallId: string): Promise<FileOutput>
  /** Replaces exact text in a file in the user's folder (every place it is, with `all`); a web page is put on screen. Absent without them. */
  editFile?(path: string, old: string, replacement: string, all: boolean, toolCallId: string): Promise<FileOutput>
  /** A file being written, as far as its input has come: for drawing a page as it is written. */
  onDraft?(toolCallId: string, path: string, content: string): void
  maxSteps: number
  signal: AbortSignal
  /** Each piece of text as it is written, so it can be spoken before the turn is over. Not for single-step turns. */
  onText?(delta: string): void
}

/** A tool call the turn made and didn't run. */
export interface UnrunCall {
  tool: string
  input: Record<string, unknown>
  toolCallId: string
}

export interface ThinkResult {
  /** All the turn said, across its steps: '' when there is nothing worth saying. */
  text: string
  /** The turn's messages as the SDK sent them between steps, then its final output. */
  messages: ModelMessage[]
  /** How many of `messages` were input to the turn's last step. */
  sent: number
  /** Calls the final step made that didn't run: a single-step turn's decision. */
  calls: UnrunCall[]
  /** All steps together. */
  usage?: LanguageModelUsage
  /** Input tokens of the last step: the largest the turn sent, as the history only grows. */
  lastInputTokens?: number
}

/** A turn that was aborted or failed, with the messages of the steps it finished. */
export class PartialTurn extends Error {
  constructor(
    readonly messages: ModelMessage[],
    readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'PartialTurn'
  }
}

export interface Thinker {
  /** A turn on the history: with tools, or deciding one step (`single`). */
  run(req: ThinkRequest): Promise<ThinkResult>
}

/** What thinking writes, alone, when there is nothing worth saying. It is never spoken. */
export const SILENT = '<silent/>'

export const THINKING_PROMPT = `# Stanley
You are Stanley, a voice assistant that operates apps and websites on the user's computer. You act while the user is still talking, so the conversation shows each step where it happened: a step you took before the user finished comes before the words they said after it. When later words take back or change what you did, don't mention or apologise for it: undo it (untick, put back, retype) before anything else, then do what they meant. If everything you did matches what they asked and nothing is left to say, write only ${SILENT}.

The user's words are their messages. Notes from the computer are in <note> tags: what the user did in the app themselves, being cut off, the user still speaking, what comes next. Each time you are needed, the screen you're working on and its options come in <screen> and <options>; <screen unchanged/> means it's the same as the last one you saw. Whichever screen you finish on comes to the front by itself.

You act through the \`act\` tool, which runs one of the listed options: open an app, open a link, press a button, type into a field, go back, go home or lock the computer. Each result tells you what is on screen now and which options come next.

Everything you write as text is read aloud to the user by text-to-speech as you write it, and shown on screen. So:
- Write it the way you would say it out loud: no markdown, lists or other formatting.
- Keep it short: listening takes longer than reading. Give just the answer, without hedging.
- Speak only when there's something worth hearing: an answer they asked for, a question, what's ready before something is sent, or something that went wrong. The user can see the screen: never narrate it. Don't say where they are, what opened or what is showing ("you're in your inbox", "the calendar is up"), and don't read out or count what's on screen unless they asked.
- When there is nothing worth hearing, write only ${SILENT} after your last step: it is never spoken. A turn that only did what was asked ends this way: opening the page they asked for ends with ${SILENT}, never "The page is open" or "Done".
- When the answer to their question is on screen, say only the answer itself, as if you just knew it: never that it's on screen, which app or page it's in, or that you opened it. "Your flight lands at six", not "the email is open and it says your flight lands at six".

How to act:
- Typing into a field never submits it. Submitting is pressing Enter or a button.
- When the user dictated the words for a field, type exactly their words, tidied (no filler words, fixed capitals and punctuation). When they only described what to write (a tone, an idea, a gist), write the finished text yourself. When they haven't said what they want written, ask: don't put words in their mouth.
- A field only ever gets the text itself: never a placeholder, a note to yourself or a question.
- Only press something that sends, posts, pays, buys, books, shares, archives, deletes or can't be undone when the user asked for that. Otherwise get it ready and ask. Asking to reply, message, email or post with words they gave is asking to send them; asking to draft or write something is not.
- Never send words you wrote yourself before the user has heard them: read them back word for word and ask whether to send.
- Answer questions from what is on screen, from what you already found in the conversation, by looking it up, or from what you know, whichever is quickest to be right. Anything that changes over time (news, who holds an office, prices, scores, schedules) is looked up, not answered from memory.
- What the user asked for may already be done, or partly: do only what is left, such as answering.
- If the request is unclear, ask one short question instead of guessing.
- Do what the user asked for, then stop.`

/** For sessions that can look things up. */
export const WEB = `## The web
You can also look things up in the background: \`search\` searches the web and \`fetch\` reads a page by its address. Neither changes the screen. \`open_page\` puts a page on screen by its address: one found or read earlier in the conversation, or any other.

A question only needs an answer: look it up in the background and say it. When the user wants to see something, put it on screen: open the page about exactly what they mean, searching first if no page in the conversation is about it. "That" or "it" is what you just told them about (the thing your answer named), not the question or the list it came from.`

export const MISHEARD = `## Speech recognition
The user's words come from speech recognition, which marks a word it was unsure of with (?).`

/** "Monday, 12 October 2026". */
export function longDate(d: Date): string {
  const part = (options: Intl.DateTimeFormatOptions) => d.toLocaleDateString('en-GB', options)
  return `${part({ weekday: 'long' })}, ${part({ day: 'numeric' })} ${part({ month: 'long' })} ${part({ year: 'numeric' })}`
}

/**
 * Thinking's instructions for a session. Fixed from its start (a new day, and a change to the
 * skills, arrive as notes), unless the user renames the assistant. `files` is where the user's
 * files are, when the session has them, and `skills` the skills in them when it started.
 */
export function instructions(opts: { web: boolean; files?: string; skills?: SkillScan; today: Date; name?: string }): string {
  const files = opts.files ? [filesPrompt(opts.files), ...(opts.skills ? [skillsPrompt(opts.skills)] : [])] : []
  const text = [THINKING_PROMPT, MISHEARD, ...(opts.web ? [WEB] : []), ...files, `Today is ${longDate(opts.today)}.`].join('\n\n')
  return named(text, opts.name ?? DEFAULT_AGENT_NAME)
}

/** What a single-step turn on a field is told, as a note ending its observation. */
export function writeNote(field: string, files = false): string {
  return [
    `Next: typing into [${field}]. To type, call act on it once, with exactly what should appear in it: the finished words only, as they would be sent or saved. Typing sends nothing: pressing Enter or a button comes after, separately.`,
    `- When the user dictated the words ("saying …", "called …", or a value like a city or a name), type exactly their words, tidied, never reworded or added to (no greeting, sign-off or extra words), with wrote: user. While they are still speaking, only the words dictated so far; when they corrected themselves ("at five, no, six"), only the corrected version.`,
    `- When they only described what to write (a tone, an idea, a gist, "something funny"), compose it yourself and type it, with wrote: stanley. It is read back to them before anything is sent.`,
    `- When they haven't said yet what to write, or words marked (?) that matter make no sense here, don't call act: once they have finished, say what you need to ask.`,
    ...(files ? [`- When what they named isn't this field's (a list, a note or a document of theirs that isn't on screen), it may be one of their files: look there with bash before typing or asking.`] : []),
  ].join('\n')
}

/** What thinking is told when the fast part was unsure the task is done. */
export const DONE_CHECK = `This may already be done. If something is left for the user, such as an answer, do it; if not, write only ${SILENT}.`

/** What thinking is told when a button was pressed before the user finished speaking. */
export const EARLY_GUESS = `Stanley pressed something before the user finished speaking. Check each step against everything they said: undo any they took back or corrected, then do what is left. If it all matches, write only ${SILENT}.`

/** What a single-step turn on a button that may commit is told. */
export function confirmNote(option: string): string {
  return `Next: pressing [${option}]. Judging by its name it may send, delete or otherwise commit something, but that is a guess: look at the screen. Press it now (call act on it) if it only opens or prepares something, or if the user asked for what it does and has heard any words you wrote yourself: when they already asked, asking again only slows them down. Otherwise say what is ready and ask.`
}

/** How often a page being written is drawn again. */
const DRAW_MS = 100

/** A single-step turn's steps at most: commands on the user's files, then the decision. */
const SINGLE_STEPS = 3

/** Anthropic prompt caching, kept for an hour: gaps between thinking calls often pass five minutes. */
const CACHE = { anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } } } as const

function marked(messages: ModelMessage[], at: (number | undefined)[]): ModelMessage[] {
  return messages.map((m, i) => (at.includes(i) ? ({ ...m, providerOptions: { ...m.providerOptions, ...CACHE } } as ModelMessage) : m))
}

const urlInput = jsonSchema<{ url: string }>({
  type: 'object',
  properties: { url: { type: 'string', description: 'The full address, starting with https://.' } },
  required: ['url'],
  additionalProperties: false,
})

/**
 * The same tools on every call, so the cached prefix holds: `act`, and the web and file tools the
 * session has. A single-step turn's tools don't run, except `bash`: it may look at the user's files
 * first (a skill, or a list they named), and then decide.
 */
function tools(req: ThinkRequest): ToolSet {
  const set: ToolSet = {
    act: tool({
      description: 'Run one of the listed options. Pass `text` for options that type into a field, and `wrote` to say whose words they are.',
      inputSchema: jsonSchema<ActCall>({
        type: 'object',
        properties: {
          option: { type: 'string', description: 'The option name: the text inside the brackets, exactly as listed.' },
          text: {
            type: 'string',
            description:
              "What to type, for fields: exactly what goes in it, nothing else. The user's own words are tidied (filler words dropped, capitals and punctuation fixed), never reworded or added to: no greeting, sign-off or extra words they didn't say.",
          },
          wrote: {
            type: 'string',
            enum: ['user', 'stanley'],
            description:
              'For fields. user: the user said these words (tidied), or the value follows directly from what they asked (a search query, a city, a number, a name, a choice from a list). stanley: you composed the wording, because the user gave only a description, a tone or a gist.',
          },
        },
        required: ['option'],
        additionalProperties: false,
      }),
      execute: (call: ActCall, { toolCallId }: { toolCallId: string }) => req.act(call, toolCallId),
    }),
    ...(req.search && {
      search: tool({
        description: "Search the web in the background. Returns the pages found, each with its title, address and an excerpt. The screen doesn't change.",
        inputSchema: jsonSchema<{ query: string }>({
          type: 'object',
          properties: { query: { type: 'string', description: 'What to search for.' } },
          required: ['query'],
          additionalProperties: false,
        }),
        execute: ({ query }: { query: string }, { toolCallId }: { toolCallId: string }) => req.search!(query, toolCallId),
      }),
    }),
    ...(req.fetch && {
      fetch: tool({
        description: "Read a web page in the background by its address. Returns the page's text. The screen doesn't change.",
        inputSchema: urlInput,
        execute: ({ url }: { url: string }, { toolCallId }: { toolCallId: string }) => req.fetch!(url, toolCallId),
      }),
    }),
    ...(req.openPage && {
      open_page: tool({
        description: "Put a web page on screen, in front of the user, by its address, or a file from the user's folder by its path. Returns what is on screen then.",
        inputSchema: jsonSchema<{ url: string }>({
          type: 'object',
          properties: { url: { type: 'string', description: "The page's full address, starting with https://, or the path of a file in the user's folder." } },
          required: ['url'],
          additionalProperties: false,
        }),
        execute: ({ url }: { url: string }, { toolCallId }: { toolCallId: string }) => req.openPage!(url, toolCallId),
      }),
    }),
    ...(req.bash && {
      bash: tool({
        description: "Run a bash command in the user's files folder, in the background. Returns what it printed. The screen doesn't change.",
        inputSchema: jsonSchema<{ command: string }>({
          type: 'object',
          properties: { command: { type: 'string', description: 'The command, run with bash in the folder.' } },
          required: ['command'],
          additionalProperties: false,
        }),
        execute: ({ command }: { command: string }, { toolCallId }: { toolCallId: string }) => req.bash!(command, toolCallId),
      }),
    }),
    ...(req.writeFile && {
      write_file: tool({
        description:
          "Write a file in the user's folder, replacing it if it is there.",
        inputSchema: jsonSchema<{ path: string; content: string }>({
          type: 'object',
          properties: {
            path: { type: 'string', description: "The file's path in the user's folder, e.g. Pages/water-cycle.html." },
            content: { type: 'string', description: 'All of the file.' },
          },
          required: ['path', 'content'],
          additionalProperties: false,
        }),
        execute: ({ path, content }: { path: string; content: string }, { toolCallId }: { toolCallId: string }) => req.writeFile!(path, content, toolCallId),
        toModelOutput: ({ output }: { output: FileOutput }) => fileOutput(output),
      }),
    }),
    ...(req.editFile && {
      edit_file: tool({
        description:
          "Change part of a file in the user's folder: `old` is replaced by `new`. `old` must be exactly as it is in the file, and appear in it once unless `all` is set.",
        inputSchema: jsonSchema<{ path: string; old: string; new: string; all?: boolean }>({
          type: 'object',
          properties: {
            path: { type: 'string', description: "The file's path in the user's folder." },
            old: { type: 'string', description: 'The text to replace, exactly as it is in the file, with enough around it to appear once.' },
            new: { type: 'string', description: 'What replaces it.' },
            all: { type: 'boolean', description: 'Replace every place `old` appears, such as a colour used all through the page.' },
          },
          required: ['path', 'old', 'new'],
          additionalProperties: false,
        }),
        execute: (input: { path: string; old: string; new: string; all?: boolean }, { toolCallId }: { toolCallId: string }) => req.editFile!(input.path, input.old, input.new, !!input.all, toolCallId),
        toModelOutput: ({ output }: { output: FileOutput }) => fileOutput(output),
      }),
    }),
  }
  if (!req.single) return set
  // Without `execute`, a call comes back unrun, and the turn ends there. What the model is sent stays the same.
  return Object.fromEntries(Object.entries(set).map(([name, t]) => [name, name === 'bash' ? t : ({ ...t, execute: undefined } as Tool)]))
}

/** Calls in `messages` that have no result. */
export function unrunCalls(messages: ModelMessage[]): UnrunCall[] {
  const answered = new Set(messages.flatMap((m) => (m.role === 'tool' ? m.content.flatMap((p) => (p.type === 'tool-result' ? [p.toolCallId] : [])) : [])))
  return messages.flatMap((m) =>
    m.role === 'assistant' && Array.isArray(m.content)
      ? m.content.flatMap((p) => (p.type === 'tool-call' && !answered.has(p.toolCallId) ? [{ tool: p.toolName, input: p.input as Record<string, unknown>, toolCallId: p.toolCallId }] : []))
      : [],
  )
}

/**
 * `text` without the silence marker (or a near miss like `<silent />`). While it is still being
 * written, a tail that may become one is held back.
 */
export function unsilenced(text: string, ended: boolean): string {
  const clean = text.replace(/<\s*silent\s*\/?\s*>/gi, '')
  if (ended) return clean
  const i = clean.lastIndexOf('<')
  return i !== -1 && /^<\s*(s(i(l(e(n(t\s*\/?\s*)?)?)?)?)?)?$/i.test(clean.slice(i)) ? clean.slice(0, i) : clean
}

let scripted = 0

/** A turn that says `text` and makes `call` without running it: for stand-ins and tests. */
export function scriptedTurn(text: string, ...calls: ActCall[]): ThinkResult {
  const unrun = calls.map((call) => ({ tool: 'act', input: { ...call }, toolCallId: `scripted_${++scripted}` }))
  const content = [...(text ? [{ type: 'text' as const, text }] : []), ...unrun.map((c) => ({ type: 'tool-call' as const, toolCallId: c.toolCallId, toolName: 'act', input: c.input }))]
  return { text, messages: content.length ? [{ role: 'assistant', content }] : [], sent: 0, calls: unrun }
}

export type ThinkEffort = 'provider-default' | 'low' | 'medium' | 'high'

/** Claude through Vercel AI Gateway, driving the same options as Jev. */
export function createThinker(opts: { model?: LanguageModel; singleModel?: LanguageModel; effort?: ThinkEffort } = {}): Thinker {
  const model = opts.model ?? 'anthropic/claude-sonnet-5.5'
  // Deciding one step (typing a field, pressing a button that commits) may use a quicker model.
  const singleModel = opts.singleModel ?? model
  // One effort for the whole session: changing it between calls would lose the messages cache.
  const reasoning = opts.effort ?? 'provider-default'
  return {
    async run(req) {
      // The response messages of the steps that finished, as the SDK sent them to the next step.
      let captured: ModelMessage[] = []
      try {
        const result = streamText({
          model: req.single ? singleModel : model,
          abortSignal: req.signal,
          instructions: { role: 'system', content: req.instructions, providerOptions: CACHE },
          messages: req.messages,
          tools: tools(req),
          toolChoice: 'auto',
          reasoning,
          stopWhen: stepCountIs(req.single ? SINGLE_STEPS : req.maxSteps),
          providerOptions: { gateway: { order: ['anthropic'] } },
          // Read the cache where the previous call ended, and write it at the end of this step's input.
          prepareStep: ({ initialMessages, responseMessages }) => {
            captured = responseMessages
            const all = [...initialMessages, ...responseMessages]
            return { messages: marked(all, [req.cacheAt, all.length - 1]) }
          },
        })
        // Text from separate steps (before and after a tool call) reads as one reply.
        let text = ''
        let streamed = ''
        /** Files being written, by tool call: their input so far, and when it was last read for drawing. */
        const writing = new Map<string, { json: string; at: number }>()
        let stepEnded = false
        for await (const part of result.stream) {
          if (part.type === 'error') throw part.error
          if (part.type === 'finish-step') stepEnded = true
          // A file being written is drawn as it comes, a few times a second.
          if (part.type === 'tool-input-start' && part.toolName === 'write_file' && req.onDraft && !req.single) writing.set(part.id, { json: '', at: 0 })
          if (part.type === 'tool-input-delta' && writing.has(part.id)) {
            const input = writing.get(part.id)!
            input.json += part.delta
            if (performance.now() - input.at < DRAW_MS) continue
            input.at = performance.now()
            const { value } = await parsePartialJson(input.json)
            const { path, content } = (value ?? {}) as { path?: unknown; content?: unknown }
            if (typeof path === 'string' && typeof content === 'string') req.onDraft!(part.id, path, content)
          }
          if (part.type !== 'text-delta' || !part.text) continue
          let delta = part.text
          if (stepEnded && text.trim() && !/\s$/.test(text) && !/^\s/.test(delta)) delta = ` ${delta}`
          stepEnded = false
          text += delta
          // A single step's question mustn't be spoken just before it presses: it waits for the end.
          if (req.single || !req.onText) continue
          const sayable = unsilenced(text, false)
          if (sayable.length > streamed.length) req.onText(sayable.slice(streamed.length))
          streamed = sayable
        }
        req.signal.throwIfAborted()
        const messages = await result.responseMessages
        const steps = await result.steps
        const said = unsilenced(text, true).replace(/ {2,}/g, ' ').trim()
        return { text: said, messages, sent: captured.length, calls: unrunCalls(messages), usage: await result.totalUsage, lastInputTokens: steps.at(-1)?.usage.inputTokens }
      } catch (err) {
        throw new PartialTurn(captured, err)
      }
    },
  }
}
