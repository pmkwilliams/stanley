// Throwaway spike: can Haiku 5.5 keep adaptive thinking on over one long, append-only history
// that mixes its own turns with synthetic steps (Jev's), and does that history hit the cache?
import { generateText, jsonSchema, stepCountIs, tool, type ModelMessage } from 'ai'
import { MISHEARD, THINKING_PROMPT, WEB } from './src/think'

process.loadEnvFile(new URL('../../.env', import.meta.url).pathname)

const model = 'anthropic/claude-haiku-5.5'
const ttl = { anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } } } as const
const instructions = { role: 'system' as const, content: `${THINKING_PROMPT}\n\n${MISHEARD}\n\n${WEB}\n\nToday is Monday, 12 October 2026.`, providerOptions: ttl }

let tasks: string[] = ['Call the dentist']
let field = ''
let app = 'Tasks'
const screen = () =>
  app === 'Tasks'
    ? `<screen title="Tasks" where="in front of the user">\n# Tasks\n${tasks.map((t) => `- [ ] ${t}`).join('\n')}\n[Add a task: ${field || 'empty'}]\n</screen>\n<options>\n- [Add a task] field, ${field ? `containing "${field}"` : 'empty'}\n- [Add a task › press Enter] key\n- [Call the dentist › checkbox] checkbox\n- [open Email] app: mail\n- [open Tasks] app: tasks\n- [back] Go back.\n- [home] Go home.\n</options>`
    : `<screen title="Email" where="in front of the user">\n# Inbox\n- Sam Lee: Lunch Friday?\n</screen>\n<options>\n- [Sam Lee: Lunch Friday?] link\n- [open Tasks] app: tasks\n- [back] Go back.\n- [home] Go home.\n</options>`

const act = tool({
  description: 'Run one of the listed options. Pass `text` for options that type into a field.',
  inputSchema: jsonSchema<{ option: string; text?: string }>({
    type: 'object',
    properties: { option: { type: 'string' }, text: { type: 'string' } },
    required: ['option'],
    additionalProperties: false,
  }),
  execute: async ({ option, text }) => {
    if (option === 'Add a task') field = text ?? ''
    else if (option.startsWith('Add a task › press Enter') && field) (tasks = [...tasks, field]), (field = '')
    else if (option === 'open Email') app = 'Email'
    else if (option === 'open Tasks') app = 'Tasks'
    return `Done: ${option}\n\n${screen()}`
  },
})

const observation = (): ModelMessage => ({ role: 'user', content: screen() })
const marked = (messages: ModelMessage[], ...at: number[]): ModelMessage[] =>
  messages.map((m, i) => (at.includes(i) ? ({ ...m, providerOptions: ttl } as ModelMessage) : m))

async function call(label: string, messages: ModelMessage[], readAt?: number) {
  const at = [messages.length - 1, ...(readAt !== undefined ? [readAt] : [])]
  try {
    const r = await generateText({
      model,
      instructions,
      messages: marked(messages, ...at),
      tools: { act },
      stopWhen: stepCountIs(5),
      // The growing in-run tail: each step writes the cache at its own end.
      prepareStep: ({ messages: m }) => ({ messages: marked(m.map(({ providerOptions, ...rest }) => (providerOptions === ttl ? rest : { providerOptions, ...rest })) as ModelMessage[], ...at, m.length - 1) }),
      providerOptions: { gateway: { order: ['anthropic'] } },
    })
    const sig = r.responseMessages.flatMap((m) => (m.role === 'assistant' && Array.isArray(m.content) ? m.content.filter((p) => p.type === 'reasoning').map((p) => Object.keys(p.providerOptions ?? {}).join('+') + ':' + Object.keys(Object.values(p.providerOptions ?? {})[0] ?? {}).join('+')) : []))
    if (sig.length) console.log(`   reasoning providerOptions: ${sig.join(' | ')}`)
    const reasoning = r.responseMessages.flatMap((m) => (m.role === 'assistant' && Array.isArray(m.content) ? m.content.filter((p) => p.type === 'reasoning') : []))
    const calls = r.steps.flatMap((s) => s.toolCalls.map((c) => `${(c.input as { option: string }).option}${(c.input as { text?: string }).text ? `="${(c.input as { text?: string }).text}"` : ''}`))
    const u = r.totalUsage
    console.log(`✓ ${label}\n   steps ${r.steps.length} · acts [${calls.join(', ')}] · reasoning parts ${reasoning.length} · said "${r.text.slice(0, 80)}"`)
    for (const [i, s] of r.steps.entries()) {
      const d = s.usage.inputTokenDetails
      console.log(`   step ${i + 1}: in ${s.usage.inputTokens} (cache read ${d?.cacheReadTokens ?? '?'}, write ${d?.cacheWriteTokens ?? '?'}, uncached ${d?.noCacheTokens ?? '?'}) out ${s.usage.outputTokens}`)
    }
    void u
    const all = [...messages, ...r.responseMessages]
    // The last input of the last step: everything but the final assistant output.
    return { ok: true as const, messages: all, text: r.text, lastInput: all.length - 2, reasoning: reasoning.length }
  } catch (err) {
    const e = err as { message?: string; responseBody?: string; statusCode?: number }
    console.log(`✗ ${label}\n   ${e.statusCode ?? ''} ${e.message}\n   ${e.responseBody?.slice(0, 600) ?? ''}`)
    return { ok: false as const, messages, text: '', lastInput: messages.length - 1, reasoning: 0 }
  }
}

const words = (text: string): ModelMessage => ({ role: 'user', content: text })
const jevStep = (id: string, option: string, result: string): ModelMessage[] => [
  { role: 'assistant', content: [{ type: 'tool-call', toolCallId: id, toolName: 'act', input: { option } }] },
  { role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName: 'act', output: { type: 'text', value: result } }] },
]

const which = process.argv[2] ?? 'all'

if (which === 'all' || which === 'fresh') {
  // T1: a Jev step is the last assistant turn, with no thinking anywhere before it.
  app = 'Tasks'
  await call('T1 fresh history ending in a synthetic step (thinking on)', [words('open my email and tell me who wrote'), ...jevStep('jev_1', 'open Email', 'Opened Email'), (app = 'Email', observation())])
}

if (which === 'all' || which === 'long') {
  // T2: a real thinking turn (reasoning + tool calls), then Jev steps, then thinking again.
  app = 'Tasks'
  tasks = ['Call the dentist']
  field = ''
  let h: ModelMessage[] = [words('add buy oat milk to my list, and check off the dentist one if it is something I can do online'), observation()]
  const t2 = await call('T2 real thinking turn with tools', h)
  h = t2.messages
  const sentBefore = h.length - 1
  const n = h.length
  h = [...h, words('now open my email'), ...jevStep('jev_2', 'open Email', 'Opened Email'), (app = 'Email', observation())]
  const t3 = await call("T3 append-only: Jev step after a thinking turn (thinking on), read point at previous end", h, t2.lastInput)
  void sentBefore
  if (t3.ok) {
    h = [...t3.messages, words('who is the lunch email from?'), observation()]
    await call('T4 append-only again: cache should cover nearly everything', h, t3.messages.length - 1)
  }
  // T5: edit an early message while replaying reasoning blocks.
  if (t2.ok) {
    const edited = [words('add buy almond milk to my list'), ...t2.messages.slice(1), words('thanks'), observation()]
    await call('T5 edited first message, reasoning replayed (expect 400 if the history check is enforced)', edited)
  }
  // T6: the final reply truncated to what was heard (it was output, never input), then go on.
  if (t2.ok) {
    const last = t2.messages.at(-1)!
    const cut = last.role === 'assistant' && Array.isArray(last.content)
      ? { ...last, content: last.content.map((p) => (p.type === 'text' ? { ...p, text: p.text.split(' ').slice(0, 3).join(' ') } : p)) }
      : last
    await call('T6 last reply truncated, then the user goes on', [...t2.messages.slice(0, -1), cut as ModelMessage, words('<note>The user cut in here.</note> wait, what did you add?'), observation()])
  }
}

if (which === 'all' || which === 'reasoning') {
  // T7: a turn that has to think before acting, so its assistant messages carry reasoning.
  app = 'Tasks'
  tasks = ['Call the dentist']
  field = ''
  let r = { ok: false, messages: [] as ModelMessage[], lastInput: 0, reasoning: 0, text: '' }
  for (let i = 0; i < 3 && r.reasoning === 0; i++) {
    tasks = ['Call the dentist']
    field = ''
    r = await call(`T7 thinking turn that must reason (try ${i + 1})`, [words('add one task whose title is the answer, not the question: the number of prime numbers between 50 and 100, written as a word'), observation()])
  }
  if (r.ok && r.reasoning > 0) {
    const t8 = await call('T8 append-only after a turn with reasoning: Jev step, then thinking', [...r.messages, words('now open my email'), ...jevStep('jev_8', 'open Email', 'Opened Email'), (app = 'Email', observation())], r.lastInput)
    if (t8.ok) await call('T9 append-only again', [...t8.messages, words('who wrote it?'), observation()], t8.lastInput)
    const edited = [words('add one task: the number of prime numbers between 10 and 20, as a word'), ...r.messages.slice(1), words('thanks'), observation()]
    await call('T10 edited first message with reasoning replayed (400 if enforced)', edited)
    const dropped = [...r.messages.slice(0, -1), words('what did you add?'), observation()]
    await call('T11 last assistant message (output only) dropped, then go on', dropped, r.lastInput)
  } else console.log('No reasoning parts in 3 tries; T8-T11 skipped')
}
