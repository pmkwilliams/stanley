// Throwaway bench: Haiku 5.5 vs Sonnet 5.5 as the thinking model, through the real createThinker.
// Measures what the user feels: time to first spoken word, to first action, and to the end of the turn.
// Usage: pnpm exec tsx packages/agent/bench-thinking.mts [runs=5]
import type { ModelMessage } from 'ai'
import { createThinker, instructions, type ActCall } from './src/think'

process.loadEnvFile(new URL('../../.env', import.meta.url).pathname)

const MODELS = { haiku: 'anthropic/claude-haiku-5.5', sonnet: 'anthropic/claude-sonnet-5.5' }
const runs = Number(process.argv[2] ?? 5)
const system = instructions({ web: false, today: new Date('2026-10-12') })

const tasksScreen = (tasks: string[]) =>
  `<screen title="Tasks" where="in front of the user">\n# Tasks\n${tasks.map((t) => `- [ ] ${t}`).join('\n')}\n[Add a task: empty]\n</screen>\n<options>\n- [Add a task] field, empty\n- [Add a task › press Enter] key\n${tasks.map((t) => `- [${t} › checkbox] checkbox`).join('\n')}\n- [open Email] app: mail\n- [back] Go back.\n- [home] Go home.\n</options>`
const emailScreen = `<screen title="Email" where="in front of the user">\n# Inbox\n- Sam Lee: Lunch Friday? — "Are you free at 12:30 at Rosa's?"\n- Billing: Your invoice for October\n- Priya: Slides for Thursday\n</screen>\n<options>\n- [Sam Lee: Lunch Friday?] link\n- [Billing: Your invoice for October] link\n- [Priya: Slides for Thursday] link\n- [open Tasks] app: tasks\n- [back] Go back.\n- [home] Go home.\n</options>`

const SCENARIOS: { name: string; messages: ModelMessage[] }[] = [
  { name: 'answer from screen', messages: [{ role: 'user', content: 'who wants to have lunch with me and when?' }, { role: 'user', content: emailScreen }] },
  { name: 'answer from knowledge', messages: [{ role: 'user', content: "what's the capital of Australia?" }, { role: 'user', content: tasksScreen(['Call the dentist']) }] },
  { name: 'add a task', messages: [{ role: 'user', content: 'add buy oat milk to my list' }, { role: 'user', content: tasksScreen(['Call the dentist']) }] },
  { name: 'reason then act', messages: [{ role: 'user', content: 'add one task whose title is the answer, not the question: the number of prime numbers between 50 and 100, written as a word' }, { role: 'user', content: tasksScreen(['Call the dentist']) }] },
]

interface Sample { firstWord?: number; firstAct?: number; total: number; out: number; reasoning: number; inTok: number; cacheRead: number; steps: number; text: string; acts: string[] }

async function once(model: string, messages: ModelMessage[]): Promise<Sample> {
  const t0 = performance.now()
  let firstWord: number | undefined
  let firstAct: number | undefined
  const acts: string[] = []
  const r = await createThinker({ model }).run({
    instructions: system,
    messages,
    maxSteps: 10,
    signal: new AbortController().signal,
    onText: () => void (firstWord ??= performance.now() - t0),
    act: async (call: ActCall) => {
      firstAct ??= performance.now() - t0
      acts.push(call.text ? `${call.option}="${call.text}"` : call.option)
      return `Done: ${call.option}\n\n${tasksScreen(['Call the dentist', ...(call.text ? [call.text] : [])])}`
    },
  })
  const u = r.usage
  return {
    firstWord, firstAct, total: performance.now() - t0,
    out: u?.outputTokens ?? 0, reasoning: u?.outputTokenDetails?.reasoningTokens ?? 0,
    inTok: u?.inputTokens ?? 0, cacheRead: u?.inputTokenDetails?.cacheReadTokens ?? 0,
    steps: r.messages.filter((m) => m.role === 'assistant').length, text: r.text, acts,
  }
}

const median = (xs: number[]) => {
  if (!xs.length) return undefined
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const ms = (x?: number) => (x === undefined ? '—' : `${Math.round(x)}`)

// Warm both: one call each so the instructions' cache is written before timing.
for (const model of Object.values(MODELS)) await once(model, SCENARIOS[0].messages).catch((e) => console.log(`warmup ${model} failed: ${e.message}`))

const results: Record<string, Record<string, Sample[]>> = {}
for (let i = 0; i < runs; i++) {
  for (const s of SCENARIOS) {
    // Alternate which model goes first so neither always benefits from the other's warm path.
    const order = i % 2 ? Object.entries(MODELS).reverse() : Object.entries(MODELS)
    for (const [name, model] of order) {
      try {
        const r = await once(model, s.messages)
        ;((results[s.name] ??= {})[name] ??= []).push(r)
        process.stdout.write(`${s.name} · ${name} · run ${i + 1}: ${ms(r.firstWord ?? r.firstAct)}ms first / ${ms(r.total)}ms total\n`)
      } catch (e) {
        console.log(`${s.name} · ${name} · run ${i + 1}: FAILED ${(e as Error).message}`)
      }
    }
  }
}

console.log('\nMedians (ms) · tokens are medians per turn')
console.log('scenario'.padEnd(24), 'model'.padEnd(7), 'first word'.padStart(10), 'first act'.padStart(10), 'total'.padStart(7), 'out tok'.padStart(8), 'reasoning'.padStart(10), 'tok/s'.padStart(6), 'steps'.padStart(6))
for (const s of SCENARIOS) {
  for (const name of Object.keys(MODELS)) {
    const xs = results[s.name]?.[name] ?? []
    if (!xs.length) continue
    const m = (f: (x: Sample) => number | undefined) => median(xs.map(f).filter((v): v is number => v !== undefined))
    const tps = m((x) => (x.out / x.total) * 1000)
    console.log(s.name.padEnd(24), name.padEnd(7), ms(m((x) => x.firstWord)).padStart(10), ms(m((x) => x.firstAct)).padStart(10), ms(m((x) => x.total)).padStart(7), ms(m((x) => x.out)).padStart(8), ms(m((x) => x.reasoning)).padStart(10), ms(tps).padStart(6), ms(m((x) => x.steps)).padStart(6))
  }
}
console.log('\nSample outputs (last run):')
for (const s of SCENARIOS) for (const name of Object.keys(MODELS)) {
  const x = results[s.name]?.[name]?.at(-1)
  if (x) console.log(`  ${s.name} · ${name}: acts [${x.acts.join(', ')}] said "${x.text.slice(0, 100)}"`)
}
