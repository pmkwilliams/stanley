import { generateText, jsonSchema, parsePartialJson, stepCountIs, streamText, tool, type LanguageModel, type LanguageModelUsage, type ModelMessage, type ToolResultPart, type ToolSet } from 'ai'
import { DEFAULT_AGENT_NAME } from '@stanley/app-sdk'
import { filesPrompt, type PageSize } from './files'
import { memoryPrompt } from './memory'
import { named } from './narrate'
import { OTHER_APPS } from './persona'
import { SCREEN_PROMPT } from './screen'
import { skillsPrompt, type SkillScan } from './skills'
import type { WebResult } from './web'
import type { PreviewOptions } from './world'

/** One `act` call: an option, and for fields the text. */
export interface ActCall {
  option: string
  text?: string
  /** For [arrange the screen]: the apps on it, by name, left side first, each side top to bottom. */
  screen?: string[][]
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
  /** Runs one option and returns what comes of it: the outcome, the screen and the new options. Absent without a screen (a background task). */
  act?(call: ActCall, toolCallId: string): Promise<string>
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
  /** Draws a web page from the user's folder out of sight, and says how it came out. Only for background tasks, which have no screen. */
  preview?(path: string, opts: PreviewOptions, toolCallId: string): Promise<FileOutput>
  /** Starts a background task with `task` as its whole brief, and returns at once. Absent without background tasks. */
  delegate?(task: string, title: string, toolCallId: string): Promise<string>
  /** What a background task is doing, or its result. */
  taskStatus?(taskId: string, toolCallId: string): Promise<string>
  /** Stops a background task. */
  taskCancel?(taskId: string, toolCallId: string): Promise<string>
  /** Sends a working background task more to go on. */
  taskSteer?(taskId: string, message: string, toolCallId: string): Promise<string>
  /** Messages sent while the turn works, read before its next step: a background task's, from thinking (`task_steer`). Each comes once. */
  inbox?(): ModelMessage[]
  maxSteps: number
  signal: AbortSignal
  /** Each piece of text as it is written, so it can be spoken before the turn is over. */
  onText?(delta: string): void
}

export interface ThinkResult {
  /** All the turn said, across its steps: '' when there is nothing worth saying. */
  text: string
  /** The turn's messages as the SDK sent them between steps, then its final output. */
  messages: ModelMessage[]
  /** How many of `messages` were input to the turn's last step. */
  sent: number
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
  /** A turn on the history, with tools. */
  run(req: ThinkRequest): Promise<ThinkResult>
  /** A short text from `text` by `instructions` (and `examples`, as earlier turns), on the quick model, with no tools: the writer's step (write.ts). */
  quick?(instructions: string, text: string, signal?: AbortSignal, examples?: QuickExample[]): Promise<string>
  /** Has the quick model read `instructions` and `examples` ahead of time, so the first `quick` with them is as fast as the rest. */
  warm?(instructions: string, examples?: QuickExample[]): Promise<void>
}

/** What thinking writes, alone, when there is nothing worth saying. It is never spoken. */
export const SILENT = '<silent/>'

/** What the screen shows once thinking finishes, without a layout and with one (`SCREEN_PROMPT`). */
const FINISHED = 'Whichever screen you finish on comes to the front by itself.'
const FINISHED_LAID_OUT = 'When you finish, the screen is laid out for what the user asked, unless you laid it out yourself.'

export const THINKING_PROMPT = `# Stanley
You are Stanley, a voice assistant that operates apps and websites on the user's computer. You act while the user is still talking, so the conversation shows each step where it happened: a step you took before the user finished comes before the words they said after it. When later words take back or change what you did, don't mention or apologise for it: undo it (untick, put back, retype) before anything else, then do what they meant. If everything you did matches what they asked and nothing is left to say, write only ${SILENT}.

The user's words are their messages. Notes from the computer are in <note> tags: what the user did in the app themselves, being cut off, the user still speaking, what comes next. Each time you are needed, the screen you're working on and its options come in <screen> and <options>; <screen unchanged/> means it's the same as the last one you saw. ${OTHER_APPS} ${FINISHED}

You act through the \`act\` tool, which runs one of the listed options: open an app, open a link, press a button, type into a field, go back, go to the home screen or lock the computer. Each result tells you what is on screen now and which options come next.

Everything you write as text is read aloud to the user by text-to-speech as you write it, and shown on screen. So:
- Write it the way you would say it out loud: no markdown, lists or other formatting.
- Keep it short: listening takes longer than reading. Give just the answer, without hedging.
- The user sees the screen, and nothing else you do. Speak only when there's something worth hearing that the screen doesn't show them: an answer they asked for, a question, what's ready before something is sent, what you changed out of their sight, something that went wrong, or what you're starting on when the user would otherwise wait in silence. Never narrate the screen: don't say where they are, what opened or what is showing ("you're in your inbox", "the calendar is up"), and don't read out or count what's on screen unless they asked.
- When there is nothing worth hearing, write only ${SILENT} after your last step: it is never spoken. A turn whose result is all on screen ends this way: opening the page they asked for ends with ${SILENT}, never "The page is open" or "Done".
- When what the user asked for takes several steps before they hear or see anything (several lookups, going through their files), say in a few words what you'll do before your first step, as a person would ("Sure, I'll look into that"), then get on with it, so they aren't left waiting in silence. Say it once, not before each step, and never for something quick, like opening something, pressing a button or a single lookup.
- When the answer to their question is on screen, say only the answer itself, as if you just knew it: never that it's on screen, which app or page it's in, or that you opened it. "Your flight lands at six", not "the email is open and it says your flight lands at six".

How to act:
- Typing into a field never submits it. Submitting is pressing Enter or a button.
- When the user dictated the words for a field, type exactly their words, tidied (no filler words, fixed capitals and punctuation). When they only described what to write (a tone, an idea, a gist), write the finished text yourself. When they haven't said what they want written, ask: don't put words in their mouth.
- A field only ever gets the text itself: never a placeholder, a note to yourself or a question.
- Only press something that sends, posts, pays, buys, books, shares, archives, deletes or can't be undone when the user asked for that. Otherwise get it ready and ask. Asking to reply, message, email or post with words they gave is asking to send them; asking to draft or write something is not.
- Never send words you wrote yourself before the user has heard them, nor words of theirs with a (?) in them: read them back word for word and ask whether to send.
- Answer questions from what is on screen, from what you already found in the conversation, by looking it up, or from what you know, whichever is quickest to be right. Anything that changes over time (news, who holds an office, prices, scores, schedules) is looked up, not answered from memory.
- What the user asked for may already be done, or partly: do only what is left, such as answering.
- If the request is unclear and a wrong guess would change something, ask one short question instead of guessing.
- Do what the user asked for, then stop.`

/** For sessions that can look things up. */
export const WEB = `## The web
You can also look things up in the background: \`search\` searches the web and \`fetch\` reads a page by its address. Neither changes the screen. \`open_page\` puts a page on screen by its address: one found or read earlier in the conversation, or any other. Pages opened stay open in the background: opening one again brings it back as it was left.

A question only needs an answer: look it up in the background and say it. When the user wants to see something, put it on screen: open the page about exactly what they mean, searching first if no page in the conversation is about it. "That" or "it" is what you just told them about (the thing your answer named), not the question or the list it came from.`

/** For sessions that can start background tasks (see background.ts). */
export const BACKGROUND = `## Background tasks
\`delegate\` starts a task of yours that goes on in the background while you carry on with the user. In the background you work with more time and care than while talking: much better at coding, 3D modelling, visualisations, extended research and reasoning, and anything else that takes careful thought, and you check what you make before it comes back. Use it for anything you can't do immediately: making a page or anything else new, changing a page beyond a quick fix, looking into something across several sources, going through many of their files, or whatever they ask to have done in the background. Do at once only what is done at once: working the screen, an answer you know or can get with a single lookup, a small fix to a page on screen.
- It is your own work: say in a few words what you'll work on in the background, and that the two of you can keep going meanwhile, then stop: don't wait for it.
- The task starts from nothing but what you write in \`task\`: put in everything it needs from the conversation (names, addresses, file paths, what the user said they want) and what to give back. In the background you can search the web, read pages, and work on the user's files, including making web pages, but there is no screen and no way to ask the user anything.
- When it finishes, its result comes to you in a note. Tell the user, briefly, what it found or made, as your own answer; if it failed, say so briefly. A page it made isn't on screen: put it there with \`open_page\` when the user wanted to see it. A result starting with "Needs:" is a question for the user: ask it.
- Tasks still working are listed in a note each time you're needed. \`task_status\` says how one is going, only when the user asks; \`task_cancel\` stops one, when the user no longer wants it.
- When the user changes or adds to what a working task is doing, send it the change with \`task_steer\` rather than starting it again: it goes on from where it is. It has only its brief and what you send, so say the change in full.`

/** How thinking lays the screen out, after how it works (`SCREEN_PROMPT`). */
export const ARRANGE = 'To lay it out yourself, act on [arrange the screen] with `screen`, the apps on it.'

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
 * files are, when the session has them, `skills` the skills in them when it started, `memory` its
 * memory file's text then, and `page` the size pages are shown at then (a change arrives as a note too).
 */
export function instructions(opts: { web: boolean; files?: string; skills?: SkillScan; memory?: string; background?: boolean; today: Date; name?: string; page?: PageSize; layout?: boolean }): string {
  const files = opts.files
    ? [filesPrompt(opts.files, opts.page, opts.background), ...(opts.skills ? [skillsPrompt(opts.skills)] : []), ...(opts.memory !== undefined ? [memoryPrompt(opts.memory)] : [])]
    : []
  // Jev reads how the screen works in the same place: last, before the day (`jevPreamble`).
  const prompt = opts.layout ? THINKING_PROMPT.replace(FINISHED, FINISHED_LAID_OUT) : THINKING_PROMPT
  const screen = opts.layout ? [`${SCREEN_PROMPT}\n${ARRANGE}`] : []
  const text = [prompt, MISHEARD, ...(opts.web ? [WEB] : []), ...files, ...(opts.background ? [BACKGROUND] : []), ...screen, `Today is ${longDate(opts.today)}.`].join('\n\n')
  return named(text, opts.name ?? DEFAULT_AGENT_NAME)
}

/** A worked example for the quick model: what it read, and what it wrote. */
export interface QuickExample {
  input: string
  output: string
}

/** How often a page being written is drawn again. */
const DRAW_MS = 100

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

const taskInput = jsonSchema<{ taskId: string }>({
  type: 'object',
  properties: { taskId: { type: 'string', description: 'The task\'s id, as `delegate` gave it: task-1.' } },
  required: ['taskId'],
  additionalProperties: false,
})

/**
 * The same tools on every call, so the cached prefix holds: `act`, and the web, file and
 * background-task tools the session has (a background task has no `act`, and `preview_page` instead).
 */
export function tools(req: ThinkRequest): ToolSet {
  const set: ToolSet = {
    ...(req.act && {
      act: tool({
        description: 'Run one of the listed options. Pass `text` for options that type into a field, and `screen` for [arrange the screen].',
        inputSchema: jsonSchema<ActCall>({
          type: 'object',
          properties: {
            option: { type: 'string', description: 'The option name: the text inside the brackets, exactly as listed.' },
            text: {
              type: 'string',
              description:
                "What to type, for fields: exactly what goes in it, nothing else. The user's own words are tidied (filler words dropped, capitals and punctuation fixed), never reworded or added to: no greeting, sign-off or extra words they didn't say.",
            },
            screen: {
              type: 'array',
              items: { type: 'array', items: { type: 'string' } },
              description:
                'For [arrange the screen]: the apps on the screen afterwards, by name, as its sides left to right, each side top to bottom. [["Email"]] fills the screen with Email; [["Email"], ["Music"]] puts them side by side; [["Email", "Tasks"], ["Weather"]] stacks two on the left; [] is the home screen.',
            },
          },
          required: ['option'],
          additionalProperties: false,
        }),
        execute: (call: ActCall, { toolCallId }: { toolCallId: string }) => req.act!(call, toolCallId),
      }),
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
            path: { type: 'string', description: "The file's path in the user's folder, e.g. notes/plumber.md." },
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
    ...(req.preview && {
      preview_page: tool({
        description:
          "Draw a web page from the user's folder out of sight, as it would be shown, and see how it came out: a picture of it, the height it needs, and everything its console printed (errors, warnings and logs, with the line each came from). Nothing is shown to the user.",
        inputSchema: jsonSchema<{ path: string; appearance?: 'dark' | 'light'; width?: number }>({
          type: 'object',
          properties: {
            path: { type: 'string', description: "The page's path in the user's folder." },
            appearance: { type: 'string', enum: ['dark', 'light'], description: "Light or dark. The user's theme when left out." },
            width: { type: 'integer', minimum: 320, maximum: 2560, description: 'The window\'s width in CSS pixels. As wide as pages are shown when left out.' },
          },
          required: ['path'],
          additionalProperties: false,
        }),
        execute: ({ path, appearance, width }: { path: string; appearance?: 'dark' | 'light'; width?: number }, { toolCallId }: { toolCallId: string }) =>
          req.preview!(path, { ...(appearance && { appearance }), ...(width && { width }) }, toolCallId),
        toModelOutput: ({ output }: { output: FileOutput }) => fileOutput(output),
      }),
    }),
    ...(req.delegate && {
      delegate: tool({
        description:
          'Start a task that goes on in the background while you carry on with the user. It gets nothing but `task`: none of the conversation. Returns at once; its result comes to you in a note when it finishes.',
        inputSchema: jsonSchema<{ task: string; title: string }>({
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'The whole brief: what to do and why, every name, address, file path and detail it needs from the conversation, and what to give back (an answer, or a page and where to write it).',
            },
            title: { type: 'string', description: 'A few words naming it, as you would to the user: "rainfall chart".' },
          },
          required: ['task', 'title'],
          additionalProperties: false,
        }),
        execute: ({ task, title }: { task: string; title: string }, { toolCallId }: { toolCallId: string }) => req.delegate!(task, title, toolCallId),
      }),
    }),
    ...(req.taskStatus && {
      task_status: tool({
        description: "What a background task is doing now, or its result once it has finished. Its result comes to you by itself when it does: check only when the user asks how it's going.",
        inputSchema: taskInput,
        execute: ({ taskId }: { taskId: string }, { toolCallId }: { toolCallId: string }) => req.taskStatus!(taskId, toolCallId),
      }),
    }),
    ...(req.taskCancel && {
      task_cancel: tool({
        description: 'Stop a background task the user no longer wants. What it already did stays done.',
        inputSchema: taskInput,
        execute: ({ taskId }: { taskId: string }, { toolCallId }: { toolCallId: string }) => req.taskCancel!(taskId, toolCallId),
      }),
    }),
    ...(req.taskSteer && {
      task_steer: tool({
        description: 'Send a working background task what the user changed or added. It reads it before its next step and goes on from where it is. Returns at once.',
        inputSchema: jsonSchema<{ taskId: string; message: string }>({
          type: 'object',
          properties: {
            taskId: { type: 'string', description: "The task's id, as `delegate` gave it: task-1." },
            message: { type: 'string', description: 'What changed or is added, in full, with every detail it needs from the conversation: it has none of it.' },
          },
          required: ['taskId', 'message'],
          additionalProperties: false,
        }),
        execute: ({ taskId, message }: { taskId: string; message: string }, { toolCallId }: { toolCallId: string }) => req.taskSteer!(taskId, message, toolCallId),
      }),
    }),
  }
  return set
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

/** A turn that only says `text`: for stand-ins and tests. */
export function scriptedTurn(text: string): ThinkResult {
  return { text, messages: text ? [{ role: 'assistant', content: [{ type: 'text', text }] }] : [], sent: 0 }
}

export type ThinkEffort = 'provider-default' | 'low' | 'medium' | 'high'
/** The quick model's reasoning: tidying words needs little or none. */
export type QuickEffort = 'provider-default' | 'none' | 'minimal' | 'low'

/** The local server isn't answering: not started yet, or not installed. */
class LocalUnreachable extends Error {}

/** A reply from the llama.cpp server at `url`, at temperature 0 with thinking off. */
async function local(url: string, messages: ModelMessage[], signal?: AbortSignal, maxTokens = 1024): Promise<string> {
  let res: Response
  try {
    res = await fetch(`${url}/v1/chat/completions`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages, temperature: 0, max_tokens: maxTokens, chat_template_kwargs: { enable_thinking: false } }),
    })
  } catch (err) {
    if (signal?.aborted) throw err
    throw new LocalUnreachable(String(err))
  }
  // 503 while the model is still loading.
  if (res.status === 503) throw new LocalUnreachable(await res.text())
  if (!res.ok) throw new Error(`local quick model: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { choices: { message: { content: string } }[] }
  return body.choices[0]!.message.content.replace(/<think>[\s\S]*?<\/think>/g, '')
}


/** The quick model the app runs itself: Gemma 4 E4B on a llama.cpp server at `QUICK_URL`. */
export const LOCAL_QUICK_MODEL = 'local/gemma-4-E4B'

/** Where the local quick model is served: the app starts llama.cpp's server there. */
export const QUICK_URL = 'http://127.0.0.1:8431'

/** GPT through Vercel AI Gateway, driving the same options as Jev. The quick model is local unless `quickModel` is a gateway id. */
export function createThinker(opts: { model?: LanguageModel; quickModel?: LanguageModel; effort?: ThinkEffort; quickEffort?: QuickEffort; quickUrl?: string } = {}): Thinker {
  const model = opts.model ?? 'openai/gpt-6.1-sol'
  // The gateway serves each model from its own maker: `openai/…` from OpenAI, `anthropic/…` from Anthropic.
  const order = (m: LanguageModel) => (typeof m === 'string' ? [m.split('/')[0]!] : undefined)
  // The writer's steps are short, so they use a small model on this computer (`local/…`), or a
  // quick one through the gateway.
  const quickModel = opts.quickModel ?? LOCAL_QUICK_MODEL
  // Until the local server is up, or when it isn't installed, the gateway's quick model stands in.
  const standIn = 'openai/gpt-6-luna'
  // One effort for the whole session: changing it between calls would lose the messages cache.
  const reasoning = opts.effort ?? 'provider-default'
  const turns = (examples: QuickExample[] = []): ModelMessage[] => examples.flatMap((e) => [{ role: 'user' as const, content: e.input }, { role: 'assistant' as const, content: e.output }])
  const hosted = async (m: LanguageModel, instructions: string, text: string, signal?: AbortSignal, examples?: QuickExample[]) => {
    const result = await generateText({ model: m, abortSignal: signal, instructions, messages: [...turns(examples), { role: 'user', content: text }], reasoning: opts.quickEffort ?? 'provider-default', providerOptions: { gateway: { order: order(m) } } })
    return result.text
  }
  const isLocal = typeof quickModel === 'string' && quickModel.startsWith('local/')
  /** The instructions the local server last read ahead of time. */
  let warmed: string | undefined
  return {
    async warm(instructions, examples) {
      if (!isLocal || warmed === instructions) return
      warmed = instructions
      // The server keeps what it has read, so a dictation after this reads only its own words.
      // It may still be loading: try for as long as it takes to start.
      for (let tries = 0; tries < 180 && warmed === instructions; tries++) {
        try {
          await local(opts.quickUrl ?? QUICK_URL, [{ role: 'system', content: instructions }, ...turns(examples)], undefined, 1)
          return
        } catch (err) {
          if (!(err instanceof LocalUnreachable)) break
          await new Promise((r) => setTimeout(r, 1000))
        }
      }
      if (warmed === instructions) warmed = undefined
    },
    async quick(instructions, text, signal, examples) {
      if (!isLocal) return (await hosted(quickModel, instructions, text, signal, examples)).trim()
      try {
        return (await local(opts.quickUrl ?? QUICK_URL, [{ role: 'system', content: instructions }, ...turns(examples), { role: 'user', content: text }], signal)).trim()
      } catch (err) {
        if (signal?.aborted || !(err instanceof LocalUnreachable)) throw err
        return (await hosted(standIn, instructions, text, signal, examples)).trim()
      }
    },
    async run(req) {
      // The response messages of the steps that finished, as the SDK sent them to the next step.
      let captured: ModelMessage[] = []
      // Messages from the inbox, each after the response messages there were when it was read.
      const arrived: { at: number; message: ModelMessage }[] = []
      const withArrived = (response: ModelMessage[]) => {
        if (!arrived.length) return response
        const out: ModelMessage[] = []
        for (let i = 0; i <= response.length; i++) {
          out.push(...arrived.filter((a) => a.at === i).map((a) => a.message))
          if (i < response.length) out.push(response[i]!)
        }
        return out
      }
      try {
        const result = streamText({
          model,
          abortSignal: req.signal,
          instructions: { role: 'system', content: req.instructions, providerOptions: CACHE },
          messages: req.messages,
          tools: tools(req),
          toolChoice: 'auto',
          reasoning,
          stopWhen: stepCountIs(req.maxSteps),
          providerOptions: { gateway: { order: order(model) } },
          // Read the cache where the previous call ended, and write it at the end of this step's input.
          prepareStep: ({ initialMessages, responseMessages }) => {
            for (const message of req.inbox?.() ?? []) arrived.push({ at: responseMessages.length, message })
            captured = withArrived(responseMessages)
            const all = [...initialMessages, ...captured]
            return { messages: marked(all, [req.cacheAt, all.length - 1]) }
          },
        })
        // Text from separate steps (before and after a tool call) reads as one reply.
        let text = ''
        let streamed = ''
        /** Streams what can be said of `text` so far. */
        const speak = () => {
          if (!req.onText) return
          const sayable = unsilenced(text, false)
          if (sayable.length > streamed.length) req.onText(sayable.slice(streamed.length))
          streamed = sayable
        }
        /** Files being written, by tool call: their input so far, and when it was last read for drawing. */
        const writing = new Map<string, { json: string; at: number }>()
        for await (const part of result.stream) {
          if (part.type === 'error') throw part.error
          // Text ends where a tool call or step starts. Marked with a space, its last sentence is said
          // now, not once the call is done: a call writing a page can take half a minute.
          if ((part.type === 'tool-input-start' || part.type === 'finish-step') && /\S$/.test(unsilenced(text, false))) {
            text += ' '
            speak()
          }
          // A file being written is drawn as it comes, a few times a second.
          if (part.type === 'tool-input-start' && part.toolName === 'write_file' && req.onDraft) writing.set(part.id, { json: '', at: 0 })
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
          text += part.text
          speak()
        }
        req.signal.throwIfAborted()
        const messages = withArrived(await result.responseMessages)
        const steps = await result.steps
        const said = unsilenced(text, true).replace(/ {2,}/g, ' ').trim()
        return { text: said, messages, sent: captured.length, usage: await result.totalUsage, lastInputTokens: steps.at(-1)?.usage.inputTokens }
      } catch (err) {
        throw new PartialTurn(captured, err)
      }
    },
  }
}
