import { createSdkMcpServer, query, tool as mcpTool, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { asSchema, type JSONSchema7, type ModelMessage, type TextPart, type Tool, type ToolCallPart, type ToolResultPart } from 'ai'
import { z } from 'zod'
import { PartialTurn, tools, type ThinkEffort, type Thinker, type ThinkRequest, type ThinkResult } from './think'

/**
 * Background tasks on Claude Code, run headless through the Agent SDK, so they are served by the
 * Claude subscription the user is logged in to rather than billed per token. Claude Code runs the
 * loop; its own tools are all off, and the task's tools are Stanley's (`tools`), served to it in
 * this process over MCP: commands stay in the files sandbox, every change is kept to undo, and pages
 * are previewed as before. For background tasks only: it has no screen and doesn't speak as it
 * goes.
 */

/** The model background tasks run on, as Claude Code names it. */
export const CLAUDE_CODE_MODEL = 'claude-opus-5-5'

/** The MCP server Stanley's tools are served from: Claude Code calls them `mcp__stanley__bash` and so on. */
const SERVER = 'stanley'
const PREFIX = `mcp__${SERVER}__`

/** Where a task's Claude Code session is kept, so a task sent more after it ended can go on in it. */
interface SessionNote {
  claudeCode: { sessionId: string }
}

export interface ClaudeCodeOptions {
  model?: string
  effort?: ThinkEffort
  /** Claude Code's working directory, where its sessions are kept. It doesn't touch the user's files from there. */
  cwd?: string
  /**
   * Runs the task when Claude Code can't: not installed, not logged in to a subscription, over its
   * limits, or a history it didn't start. Only before the task has done anything.
   */
  fallback?: Thinker
  /** Why a task went to `fallback`. */
  onFallback?(reason: string): void
}

/** Claude Code couldn't take the task on: nothing was done, so another thinker can. */
class Unavailable extends Error {}

/** A queue of user messages to Claude Code: steers as they arrive, then the end. */
class Input implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = []
  private waiting?: () => void
  private ended = false

  push(text: string): void {
    this.queue.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null })
    this.waiting?.()
  }

  /** Messages Claude Code hasn't taken yet. */
  pending(): boolean {
    return this.queue.length > 0
  }

  end(): void {
    this.ended = true
    this.waiting?.()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (true) {
      if (this.queue.length) yield this.queue.shift()!
      else if (this.ended) return
      else await new Promise<void>((resolve) => (this.waiting = resolve))
    }
  }
}

/** A tool's JSON schema as the zod shape the Agent SDK takes. Only what Stanley's tools use. */
function shape(schema: JSONSchema7): Record<string, z.ZodType> {
  const required = new Set(schema.required ?? [])
  return Object.fromEntries(
    Object.entries(schema.properties ?? {}).map(([key, prop]) => {
      const p = prop as JSONSchema7
      let type: z.ZodType =
        p.enum ? z.enum(p.enum as [string, ...string[]])
        : p.type === 'boolean' ? z.boolean()
        : p.type === 'integer' ? z.number().int().min(p.minimum ?? -Infinity).max(p.maximum ?? Infinity)
        : p.type === 'number' ? z.number()
        : z.string()
      if (p.description) type = type.describe(p.description)
      return [key, required.has(key) ? type : type.optional()]
    }),
  )
}

type McpContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

/** A tool's output as the model reads it, as MCP content. */
function content(output: ToolResultPart['output']): McpContent[] {
  if (output.type === 'text' || output.type === 'error-text') return [{ type: 'text', text: output.value }]
  if (output.type === 'json' || output.type === 'error-json') return [{ type: 'text', text: JSON.stringify(output.value) }]
  if (output.type !== 'content') return [{ type: 'text', text: JSON.stringify(output) }]
  return output.value.flatMap((part): McpContent[] => {
    if (part.type === 'text') return [{ type: 'text', text: part.text }]
    const p = part as { type: string; mediaType?: string; data?: { type: string; data?: unknown } }
    if (p.type === 'file' && p.mediaType?.startsWith('image/') && p.data?.type === 'data' && typeof p.data.data === 'string') return [{ type: 'image', data: p.data.data, mimeType: p.mediaType }]
    return []
  })
}

/** The task's tools, as Stanley would run them, served to Claude Code. */
async function server(req: ThinkRequest) {
  const defs = await Promise.all(
    Object.entries(tools(req)).map(async ([name, t]: [string, Tool]) => {
      const schema = await asSchema(t.inputSchema).jsonSchema
      return mcpTool(name, typeof t.description === 'string' ? t.description : name, shape(schema), async (input: Record<string, unknown>) => {
        const toolCallId = `${name}-${crypto.randomUUID()}`
        try {
          const output = await t.execute!(input, { toolCallId, messages: [], abortSignal: req.signal, context: undefined })
          const read: ToolResultPart['output'] = t.toModelOutput
            ? await t.toModelOutput({ toolCallId, input, output })
            : typeof output === 'string' ? { type: 'text', value: output } : { type: 'json', value: output }
          return { content: content(read) }
        } catch (err) {
          // As the AI SDK does: a tool that throws tells the model why, and the task goes on.
          return { content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }], isError: true }
        }
      })
    }),
  )
  return createSdkMcpServer({ name: SERVER, tools: defs })
}

/** Claude Code's environment: the app's, without what would make it bill an API key instead of the subscription. */
function environment(): Record<string, string | undefined> {
  const { ANTHROPIC_API_KEY: _key, ANTHROPIC_AUTH_TOKEN: _token, CLAUDECODE: _nested, ...env } = process.env
  return { ...env, CLAUDE_AGENT_SDK_CLIENT_APP: 'stanley' }
}

const textOf = (blocks: unknown): string =>
  typeof blocks === 'string' ? blocks : Array.isArray(blocks) ? blocks.map((b: { type?: string; text?: string }) => (b.type === 'text' ? b.text : b.type === 'image' ? '[picture]' : '')).join('\n') : ''

/** Claude Code's messages as the AI SDK's, for the task's log and its result. */
class Transcript {
  readonly messages: ModelMessage[] = []
  private names = new Map<string, string>()
  private lastId?: string

  add(message: SDKMessage): void {
    if (message.type === 'assistant' && !message.parent_tool_use_id) {
      const parts = message.message.content.flatMap((block): (TextPart | ToolCallPart)[] => {
        if (block.type === 'text') return [{ type: 'text', text: block.text }]
        if (block.type !== 'tool_use') return []
        const toolName = block.name.startsWith(PREFIX) ? block.name.slice(PREFIX.length) : block.name
        this.names.set(block.id, toolName)
        return [{ type: 'tool-call', toolCallId: block.id, toolName, input: block.input }]
      })
      if (!parts.length) return
      // Claude Code sends a response a block at a time: they make one message.
      const last = this.messages.at(-1)
      if (this.lastId === message.message.id && last?.role === 'assistant' && Array.isArray(last.content)) last.content.push(...parts)
      else this.messages.push({ role: 'assistant', content: parts })
      this.lastId = message.message.id
    }
    if (message.type === 'user' && !message.parent_tool_use_id && Array.isArray(message.message.content)) {
      const results = message.message.content.flatMap((block) =>
        block.type === 'tool_result'
          ? [{ type: 'tool-result' as const, toolCallId: block.tool_use_id, toolName: this.names.get(block.tool_use_id) ?? 'tool', output: { type: block.is_error ? ('error-text' as const) : ('text' as const), value: textOf(block.content) } }]
          : [],
      )
      if (results.length) this.messages.push({ role: 'tool', content: results })
      this.lastId = undefined
    }
  }

  steered(text: string): void {
    this.messages.push({ role: 'user', content: text })
    this.lastId = undefined
  }

  /** Notes the session on the last thing the task wrote, for going on in it. */
  close(sessionId: string | undefined): void {
    const last = this.messages.findLast((m) => m.role === 'assistant')
    if (sessionId && last) last.providerOptions = { ...last.providerOptions, ...({ claudeCode: { sessionId } } satisfies SessionNote) }
  }
}

/** The Claude Code session a history was made in, when it was. */
function sessionOf(messages: ModelMessage[]): string | undefined {
  const note = messages.findLast((m) => m.providerOptions?.claudeCode)?.providerOptions as SessionNote | undefined
  return note?.claudeCode.sessionId
}

const when = (seconds?: number) => (seconds ? ` It resets at ${new Date(seconds * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : '')

export function createClaudeCodeThinker(opts: ClaudeCodeOptions = {}): Thinker {
  const fallback = async (req: ThinkRequest, reason: string): Promise<ThinkResult> => {
    if (!opts.fallback) throw new Error(reason)
    opts.onFallback?.(reason)
    return opts.fallback.run(req)
  }

  async function run(req: ThinkRequest): Promise<ThinkResult> {
    if (req.act) throw new Error('Claude Code runs background tasks only')
    // A task sent more after it ended goes on in its session. A history Claude Code didn't make
    // (one the fallback began) stays with the fallback.
    const resume = sessionOf(req.messages)
    const brief = req.messages.length === 1 && req.messages[0]!.role === 'user' ? textOf(req.messages[0]!.content) : undefined
    if (!resume && brief === undefined) return fallback(req, 'the task began on another model')

    const transcript = new Transcript()
    const input = new Input()
    const steer = () => {
      for (const m of req.inbox?.() ?? []) {
        const text = textOf(m.content)
        transcript.steered(text)
        input.push(text)
      }
    }
    if (brief !== undefined) input.push(brief)
    steer()

    const controller = new AbortController()
    const abort = () => controller.abort()
    req.signal.addEventListener('abort', abort, { once: true })
    // What arrives while it works is read before its next step: Claude Code folds it in between tool calls.
    const polling = setInterval(steer, 250)
    let sessionId = resume
    let text = ''
    let limited = ''
    try {
      const q = query({
        prompt: input,
        options: {
          model: opts.model ?? CLAUDE_CODE_MODEL,
          ...(opts.effort && opts.effort !== 'provider-default' && { effort: opts.effort }),
          systemPrompt: req.instructions,
          cwd: opts.cwd,
          ...(resume && { resume }),
          // Stanley's tools alone: none of Claude Code's, none of the user's own settings, skills or MCP servers.
          tools: [],
          mcpServers: { [SERVER]: await server(req) },
          strictMcpConfig: true,
          settingSources: [],
          allowedTools: [`${PREFIX}*`],
          permissionMode: 'dontAsk',
          permissionPrompts: 'none',
          maxTurns: req.maxSteps,
          verbatimPrompts: true,
          env: environment(),
          abortController: controller,
        },
      })
      for await (const message of q) {
        if (message.type === 'system' && message.subtype === 'init') {
          sessionId = message.session_id
          // Anything but the subscription would bill per token.
          if (message.apiKeySource !== 'none') throw new Unavailable(`Claude Code would use an API key (${message.apiKeySource}), not the subscription`)
        }
        if (message.type === 'rate_limit_event' && message.rate_limit_info.status === 'rejected') limited = `Claude's usage limit is reached.${when(message.rate_limit_info.resetsAt)}`
        if (message.type === 'assistant' && message.error && !transcript.messages.length) throw new Unavailable(`Claude Code: ${message.error}`)
        transcript.add(message)
        if (message.type !== 'result') continue
        if (message.subtype === 'success' && !message.is_error) text = message.result
        else if (message.subtype !== 'error_max_turns') {
          const why = limited || (message.subtype === 'success' ? message.result : message.errors.join('; ')) || message.subtype
          throw transcript.messages.length ? new Error(why) : new Unavailable(why)
        }
        // The turn is over: it goes on if it was sent more, and ends otherwise.
        steer()
        if (!(message.queued_turn_count ?? 0) && !input.pending()) input.end()
      }
      req.signal.throwIfAborted()
      transcript.close(sessionId)
      return { text, messages: transcript.messages, sent: 0 }
    } catch (err) {
      if (!req.signal.aborted && !transcript.messages.length) {
        const reason = err instanceof Error ? err.message : String(err)
        input.end()
        // A resumed task already did its work in Claude Code: the fallback can't go on from there.
        if (!resume) return fallback(req, reason)
      }
      transcript.close(sessionId)
      throw new PartialTurn(transcript.messages, err)
    } finally {
      clearInterval(polling)
      req.signal.removeEventListener('abort', abort)
      input.end()
    }
  }

  return { run }
}
