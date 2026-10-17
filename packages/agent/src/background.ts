import type { ModelMessage } from 'ai'
import { DEFAULT_AGENT_NAME } from '@stanley/app-sdk'
import type { TaskMeta } from './conversation'
import type { AgentDebugEvent } from './debug'
import { bashText, editText, taskFilesPrompt, type FileTools, type PageSize } from './files'
import { named } from './narrate'
import { longDate, PartialTurn, type FileOutput, type PageOutput, type SearchOutput, type ThinkEffort, type Thinker } from './think'
import type { WebTools } from './web'
import type { PagePreview, PreviewOptions, World } from './world'

/**
 * Background tasks: work thinking hands to another agent (`delegate`) so it can go on with the
 * user. A task starts from its brief alone, none of the conversation, and has no screen: it looks
 * things up, works on the user's files, and draws the pages it makes out of sight to check them.
 * It never talks to the user, but thinking can send it more as it works (`steer`). When it ends by itself, its result goes to thinking in a note
 * (`Agent.taskEnded`), which tells the user once they and Stanley are both quiet.
 */
/** How what thinking sends a working task (`task_steer`) starts. */
export const STEERED = 'From the conversation:'

export const TASK_PROMPT = `# Background task
You are Stanley, a voice assistant on the user's computer, working on a task in the background while you go on talking with the user. The task is in the message below, as you wrote it in that conversation: it is all you have of it here. No one sees or hears anything you write here until you finish: then your last message is the result, which comes back to you in the conversation, and you tell the user about it there.

- You have no screen here: you can't open apps, press anything or show the user anything. What you made is shown from the conversation, when the user wants to see it.
- More may come while you work, in a message starting "${STEERED}": what the user changed or added. Go on from where you are, taking it in, and redo only what it changes.
- Work the task through on your own. You can't ask the user anything from here. When something only they can decide stops you (a choice between things they care about, or something that would send, buy, delete or overwrite what they didn't ask for), stop there and say what you need, starting with "Needs:".
- Finish with the result, written for yourself in the conversation, not for the user: what you found, with the facts, numbers and sources an answer needs, or what you made and its path. Keep it short, but complete enough that you can answer a follow-up from it alone.
- Do the task, then stop.`

/** Background tasks always run on Claude Opus 5.5 at high effort, whatever thinking runs on. */
export const TASK_MODEL = 'anthropic/claude-opus-5.5'
export const TASK_EFFORT: ThinkEffort = 'high'

/** How a task's brief is put in a sentence for the status bar (`BackgroundTask.gist`). */
export const GIST_PROMPT = `You are Stanley, a voice assistant on the user's computer. The message is a task you are working on in the background, as you wrote it. Say in one short sentence, at most 12 words, what you are doing, for the user to read in a status bar: start with the verb, as in "Making a chart of this year's rainfall in Oslo". Write only the sentence, with no full stop.`

/** For tasks in sessions that can look things up. */
export const TASK_WEB = `## The web
\`search\` searches the web and \`fetch\` reads a page by its address. Anything that changes over time (news, prices, schedules, who holds an office) is looked up, not answered from memory.`

/** A background task's instructions, made as it starts: pages are shown at `page` then. */
export function taskInstructions(opts: { web: boolean; files?: string; page?: PageSize; today: Date; name?: string }): string {
  const text = [TASK_PROMPT, ...(opts.web ? [TASK_WEB] : []), ...(opts.files ? [taskFilesPrompt(opts.files, opts.page)] : []), `Today is ${longDate(opts.today)}.`].join('\n\n')
  return named(text, opts.name ?? DEFAULT_AGENT_NAME)
}

export interface BackgroundTask {
  /** `task-1`: what thinking calls it by. */
  id: string
  title: string
  /** The brief: all the task knows. */
  task: string
  /** The brief in a sentence, for the user, once it has been put in one (`GIST_PROMPT`). */
  gist?: string
  state: TaskMeta['state']
  /** What it is doing right now: "searching the web for …". */
  doing: string
  /** Once it ends: what it found or made, or why it failed. */
  summary?: string
  /** Files it wrote or changed, by path as it wrote them. */
  wrote: string[]
  steps: number
  startedAt: number
  endedAt?: number
  /** Its result is in the history, as a note thinking hasn't been sent yet, or has. */
  noted: boolean
  /** Thinking has its result: sent in a note, or read with `task_status`. A stopped task's never goes. */
  delivered: boolean
}

/** What a task writes to its own log: its brief and instructions, then how it ended and all it did. */
export type TaskRecord =
  | { type: 'start'; id: string; title: string; task: string; instructions: string }
  | { type: 'end'; id: string; state: TaskMeta['state']; summary: string; messages: ModelMessage[] }

export interface BackgroundDeps {
  thinker: Thinker
  web?: WebTools
  files?: FileTools
  /** Draws a page of the user's out of sight. Without it, a task can't check the pages it makes. */
  preview?: World['preview']
  /** The tasks' instructions (`taskInstructions`). */
  instructions: () => string
  /** Puts a brief in a sentence (`GIST_PROMPT`). Without it, tasks have only their titles. */
  gist?(task: string, signal: AbortSignal): Promise<string>
  /** Tasks working at once, at most. */
  max: number
  /** Tool steps a task takes, at most. */
  steps: number
  /** A task ended by itself: finished or failed, not stopped. */
  ended(task: BackgroundTask): void
  /** A task started or stopped working, however it ended: `working()` is different now. */
  changed?(): void
  debug?(event: AgentDebugEvent): void
  sink?(record: TaskRecord): void
}

const PAGE = /\.html?$/i

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** The background tasks of a session, working and ended. */
export class Background {
  private tasks: BackgroundTask[] = []
  private controllers = new Map<string, AbortController>()
  /** What thinking sent working tasks that they haven't read yet. */
  private inboxes = new Map<string, ModelMessage[]>()
  private count = 0

  constructor(private deps: BackgroundDeps) {}

  /** Starts a task on `task`, its whole brief. Returns why not when too many are working already. */
  start(task: string, title: string): BackgroundTask | string {
    const working = this.working()
    if (working.length >= this.deps.max) return `${working.length} background tasks are working already (${list(working)}): wait for one to finish, or stop one with task_cancel.`
    const t: BackgroundTask = { id: `task-${++this.count}`, title: title.trim() || 'background task', task, state: 'working', doing: 'starting.', wrote: [], steps: 0, startedAt: Date.now(), noted: false, delivered: false }
    this.tasks.push(t)
    const controller = new AbortController()
    this.controllers.set(t.id, controller)
    void this.run(t, controller.signal)
    void this.summarize(t, controller.signal)
    this.deps.changed?.()
    return t
  }

  get(id: string): BackgroundTask | undefined {
    const want = id.trim().toLowerCase()
    return this.tasks.find((t) => t.id === want || t.id === `task-${want}`)
  }

  working(): BackgroundTask[] {
    return this.tasks.filter((t) => t.state === 'working')
  }

  /** Ended by themselves, and thinking doesn't have their results yet. */
  undelivered(): BackgroundTask[] {
    return this.tasks.filter((t) => (t.state === 'done' || t.state === 'failed') && !t.delivered)
  }

  /** Thinking was sent the whole history: the results noted in it are delivered. */
  sent(): void {
    for (const t of this.tasks) if (t.noted) t.delivered = true
  }

  /** How a task is going, or how it ended. Reading a result delivers it: it isn't told again. */
  status(id: string): string {
    const t = this.get(id)
    if (!t) return this.unknown(id)
    if (t.state === 'done' || t.state === 'failed') t.delivered = true
    return describe(t)
  }

  /** Stops a task: what it did stays done, and its result is never sent. One that has ended says how. */
  cancel(id: string): string {
    const t = this.get(id)
    if (!t) return this.unknown(id)
    if (t.state !== 'working') return this.status(id)
    t.state = 'cancelled'
    t.endedAt = Date.now()
    t.delivered = true
    this.controllers.get(t.id)?.abort()
    this.deps.debug?.({ type: 'task', action: 'cancel', taskId: t.id, title: t.title })
    this.deps.changed?.()
    return `Stopped ${t.id}, "${t.title}".${t.wrote.length ? ` What it wrote stays: ${t.wrote.join(', ')}.` : ''}`
  }

  /** Sends a working task `message`, which it reads before its next step. One that has ended says how. */
  steer(id: string, message: string): string {
    const t = this.get(id)
    if (!t) return this.unknown(id)
    if (t.state !== 'working') return `${this.status(id)}\nIt has ended, so it can't take more: start a new task for what's left.`
    const inbox = this.inboxes.get(t.id) ?? []
    inbox.push({ role: 'user', content: `${STEERED} ${message.trim()}` })
    this.inboxes.set(t.id, inbox)
    this.deps.debug?.({ type: 'task', action: 'steer', taskId: t.id, title: t.title, text: message })
    return `Sent to ${t.id}, "${t.title}": it reads it before its next step.`
  }

  /** Stops every task still working: the session is ending. */
  cancelAll(): void {
    for (const t of this.working()) this.cancel(t.id)
  }

  /** The working task that wrote or changed `path`, if one did: it may still be working on it. */
  holding(path: string, root?: string): BackgroundTask | undefined {
    const norm = (p: string) => (root && p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p).replace(/^(\.\/)+/, '')
    return this.working().find((t) => t.wrote.some((w) => norm(w) === norm(path)))
  }

  /** Puts a working task's brief in a sentence: `working()` changes once it has one. */
  private async summarize(t: BackgroundTask, signal: AbortSignal): Promise<void> {
    if (!this.deps.gist) return
    try {
      const gist = (await this.deps.gist(t.task, signal)).trim()
      if (!gist || t.state !== 'working') return
      t.gist = gist
      this.deps.changed?.()
    } catch (err) {
      if (!signal.aborted) this.deps.debug?.({ type: 'task', action: 'step', taskId: t.id, title: t.title, tool: 'gist', text: t.task, result: `failed: ${errorText(err)}` })
    }
  }

  private unknown(id: string): string {
    return `There is no background task ${id}.${this.tasks.length ? ` There are: ${list(this.tasks)}.` : ''}`
  }

  private async run(t: BackgroundTask, signal: AbortSignal): Promise<void> {
    const instructions = this.deps.instructions()
    this.deps.sink?.({ type: 'start', id: t.id, title: t.title, task: t.task, instructions })
    this.deps.debug?.({ type: 'task', action: 'start', taskId: t.id, title: t.title, text: t.task })
    const { web, files, preview } = this.deps
    const step = <T>(doing: string, tool: string, text: string, work: () => Promise<T>, result: (out: T) => string): Promise<T> => {
      signal.throwIfAborted()
      t.doing = doing
      t.steps++
      return work().then(
        (out) => {
          this.deps.debug?.({ type: 'task', action: 'step', taskId: t.id, title: t.title, tool, text, result: result(out) })
          return out
        },
        (err: unknown) => {
          if (!signal.aborted) this.deps.debug?.({ type: 'task', action: 'step', taskId: t.id, title: t.title, tool, text, result: `failed: ${errorText(err)}` })
          throw err
        },
      )
    }
    const brief: ModelMessage = { role: 'user', content: t.task }
    const inbox = () => {
      const sent = this.inboxes.get(t.id) ?? []
      this.inboxes.delete(t.id)
      return sent
    }
    const ask = (messages: ModelMessage[]) =>
      this.deps.thinker.run({
        instructions,
        messages,
        maxSteps: this.deps.steps,
        signal,
        inbox,
        ...(web && {
          search: (query: string) =>
            step(`searching the web for "${query}".`, 'search', query, async (): Promise<SearchOutput> => ({ query, results: await web.search(query, signal) }), (o) => `${o.results.length} found`),
          fetch: (url: string) =>
            step(`reading the web page ${url}.`, 'fetch', url, async (): Promise<PageOutput> => {
              const page = await web.fetch(url, signal)
              return { url: page.url, title: page.title, markdown: page.markdown }
            }, (o) => o.title),
        }),
        ...(files && {
          bash: (command: string) =>
            step(`running \`${command}\` on the user's files.`, 'bash', command, async () => {
              try {
                return bashText(await files.bash(command, signal))
              } catch (err) {
                if (signal.aborted) throw err
                return `It couldn't run: ${errorText(err)}`
              }
            }, (o) => o),
        }),
        ...(files?.write &&
          files.read && {
            writeFile: (path: string, content: string) =>
              step(`writing the file ${path}.`, 'write_file', path, async (): Promise<FileOutput> => {
                try {
                  await files.write!(path, content)
                } catch (err) {
                  return { text: `Couldn't write it: ${errorText(err)}` }
                }
                this.wrote(t, path)
                return { text: `Wrote ${path}.${PAGE.test(path) && preview ? ' Check it with preview_page.' : ''}` }
              }, (o) => o.text),
            editFile: (path: string, old: string, replacement: string, all: boolean) =>
              step(`changing the file ${path}.`, 'edit_file', path, async (): Promise<FileOutput> => {
                let before: string
                try {
                  before = await files.read!(path)
                } catch (err) {
                  return { text: `Couldn't read it: ${errorText(err)}` }
                }
                const edit = editText(before, path, old, replacement, all)
                if ('error' in edit) return { text: edit.error }
                try {
                  await files.write!(path, edit.text)
                } catch (err) {
                  return { text: `Couldn't write it: ${errorText(err)}` }
                }
                this.wrote(t, path)
                return { text: `Changed ${path}.` }
              }, (o) => o.text),
          }),
        ...(files &&
          preview && {
            preview: (path: string, opts: PreviewOptions) =>
              step(`checking how the page ${path} came out.`, 'preview_page', path, async (): Promise<FileOutput> => {
                try {
                  return previewOutput(path, await preview(path, opts))
                } catch (err) {
                  return { text: `Couldn't draw it: ${errorText(err)}` }
                }
              }, (o) => o.text),
          }),
      })
    // All it did, after its brief.
    let messages: ModelMessage[] = []
    try {
      let result = await ask([brief])
      messages = result.messages
      // Sent more after its last step: it goes on with it.
      while (t.state === 'working' && this.inboxes.get(t.id)?.length) {
        result = await ask([brief, ...messages])
        messages = [...messages, ...result.messages]
      }
      if (t.state === 'working') this.end(t, 'done', finalText(result.messages) || result.text || `It stopped after ${t.steps} steps without saying what it found or made.`)
    } catch (err) {
      if (err instanceof PartialTurn) messages = [...messages, ...err.messages]
      if (t.state === 'working') this.end(t, 'failed', errorText(err instanceof PartialTurn ? err.cause : err))
    } finally {
      this.controllers.delete(t.id)
      this.inboxes.delete(t.id)
      this.deps.sink?.({ type: 'end', id: t.id, state: t.state, summary: t.summary ?? '', messages })
    }
  }

  private wrote(t: BackgroundTask, path: string): void {
    if (!t.wrote.includes(path)) t.wrote.push(path)
  }

  private end(t: BackgroundTask, state: 'done' | 'failed', summary: string): void {
    t.state = state
    t.summary = summary.trim()
    t.endedAt = Date.now()
    t.doing = ''
    this.deps.debug?.({ type: 'task', action: 'end', taskId: t.id, title: t.title, state, text: t.summary })
    this.deps.changed?.()
    this.deps.ended(t)
  }
}

/** `task-1 "rainfall chart", task-2 "…"`. */
function list(tasks: BackgroundTask[]): string {
  return tasks.map((t) => `${t.id} "${t.title}"${t.state === 'working' ? '' : ` (${t.state === 'done' ? 'finished' : t.state === 'failed' ? 'failed' : 'stopped'})`}`).join(', ')
}

/** How a task is going, or how it ended, for thinking. */
export function describe(t: BackgroundTask): string {
  const head = `${t.id}, "${t.title}"`
  if (t.state === 'working') {
    const seconds = Math.round((Date.now() - t.startedAt) / 1000)
    return `${head}, is still working: ${seconds} s and ${t.steps} ${t.steps === 1 ? 'step' : 'steps'} so far. Right now it is ${t.doing}`
  }
  if (t.state === 'cancelled') return `${head} was stopped.`
  if (t.state === 'failed') return `${head} failed: ${t.summary}`
  return `${head} finished:\n${t.summary}`
}

/** The text of the last thing a turn wrote: a task's result, without what it wrote along the way. */
function finalText(messages: ModelMessage[]): string {
  const last = messages.findLast((m) => m.role === 'assistant')
  if (!last) return ''
  if (typeof last.content === 'string') return last.content.trim()
  return last.content
    .flatMap((p) => (p.type === 'text' ? [p.text] : []))
    .join('')
    .trim()
}

/** A page drawn out of sight, as a task reads it: its size, its console, then the picture. */
export function previewOutput(path: string, p: PagePreview): FileOutput {
  const fits = p.contentHeight > p.height ? `It needs ${p.contentHeight} pixels of height, so it scrolls.` : 'It fits without scrolling.'
  const console = p.console.length ? `Its console printed:\n${p.console.map((line) => `- ${line}`).join('\n')}` : 'Its console printed nothing.'
  const text = `Drew ${path} out of sight, ${p.appearance}, in a window ${p.width} by ${p.height}. ${fits}\n${console}${p.image ? '\nA picture of it follows.' : '\nNo picture of it could be taken.'}`
  return { text, image: p.image }
}
