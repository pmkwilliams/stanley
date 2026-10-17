// Throwaway spike: do mid-conversation system messages (and Anthropic's turn-scoped `clear_at`) get
// through the Vercel AI Gateway, in place, keeping the cache?
// Usage: pnpm exec tsx packages/agent/spike-system.mts
import { generateText, type ModelMessage } from 'ai'

process.loadEnvFile(new URL('../../.env', import.meta.url).pathname)

const MODELS = ['openai/gpt-6.1-sol', 'anthropic/claude-opus-5.5']
const CACHE = { anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } } } as const
const instructions = 'You are a terse assistant. Answer in a few words.'
// A big, fixed history so cache reads are easy to tell from the instructions alone.
const filler: ModelMessage[] = Array.from({ length: 12 }, (_, i) => [
  { role: 'user' as const, content: `Note ${i}: ${'The quick brown fox jumps over the lazy dog near the riverbank at dawn. '.repeat(12)}` },
  { role: 'assistant' as const, content: `Noted ${i}.` },
]).flat()
const marked = (ms: ModelMessage[], at: number[]) => ms.map((m, i) => (at.includes(i) ? ({ ...m, providerOptions: { ...m.providerOptions, ...CACHE } } as ModelMessage) : m))

async function call(model: string, messages: ModelMessage[], cacheAt: number[], extra: Record<string, unknown> = {}) {
  try {
    const r = await generateText({
      model,
      instructions: { role: 'system', content: instructions, providerOptions: CACHE },
      messages: marked(messages, cacheAt),
      allowSystemInMessages: true,
      providerOptions: { gateway: { order: [model.split('/')[0]!] } },
      ...extra,
    })
    const u = r.usage
    return { ok: true, text: r.text.trim().slice(0, 80), in: u.inputTokens, cacheRead: u.inputTokenDetails?.cacheReadTokens, cacheWrite: u.inputTokenDetails?.cacheWriteTokens }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : String(err) }
  }
}

const sys = (content: string, providerOptions?: Record<string, unknown>): ModelMessage => ({ role: 'system', content, ...(providerOptions && { providerOptions }) }) as ModelMessage
const tag = Math.random().toString(36).slice(2, 7)

for (const model of MODELS) {
  console.log(`\n=== ${model}`)
  // 1. Accepted, and read: a system message after the user's question, last in the thread.
  const ask: ModelMessage[] = [...filler, { role: 'user', content: `(${tag}) What is the code word? Reply with just the word.` }, sys('The code word is PLUM.')]
  console.log('1 accepted+read', await call(model, ask, [filler.length - 1]))

  // 2. In place, keeping the cache: the same thread continued with another system message.
  //    Lifted to the top, the history after the instructions would no longer match.
  const first: ModelMessage[] = [...filler, { role: 'user', content: `(${tag}b) Say hi.` }, sys('Options now: [Sort] button, [Delete] button.')]
  const r1 = await call(model, first, [filler.length - 1, first.length - 1])
  console.log('2a first', r1)
  const second: ModelMessage[] = [...first, { role: 'assistant', content: 'Hi.' }, { role: 'user', content: 'Which options are there? List them.' }, sys('Options now: [Sort] button, [Archive] button.')]
  console.log('2b second', await call(model, second, [first.length - 1, second.length - 1]))

  // 3. Turn-scoped: does `clear_at` get through? Cleared, the code word isn't seen once a later user message exists.
  const scoped = (po?: Record<string, unknown>): ModelMessage[] => [...filler, { role: 'user', content: `(${tag}c) Hello.` }, sys('The code word is PLUM.', po), { role: 'assistant', content: 'Hello.' }, { role: 'user', content: 'Is there a code word anywhere in this conversation? Reply with the word, or NONE.' }]
  console.log('3a no clear_at', await call(model, scoped(), [filler.length - 1]))
  console.log('3b providerOptions.anthropic.clearAt', await call(model, scoped({ anthropic: { clearAt: 'next_user_message' } }), [filler.length - 1], { headers: { 'anthropic-beta': 'mid-conversation-system-clear-at-2026-08-21' } }))
  console.log('3c providerOptions.anthropic.clear_at', await call(model, scoped({ anthropic: { clear_at: 'next_user_message' } }), [filler.length - 1], { headers: { 'anthropic-beta': 'mid-conversation-system-clear-at-2026-08-21' } }))
}
