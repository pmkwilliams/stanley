import { simulateReadableStream, type ModelMessage } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { createThinker, instructions, PartialTurn, type ThinkRequest } from '../src/think'

type Part = Parameters<typeof simulateReadableStream>[0]['chunks'][number]

const usage = { inputTokens: { total: 10, noCache: 2, cacheRead: 8, cacheWrite: 0 }, outputTokens: { total: 3, text: 3, reasoning: 0 } }
const finish = (unified: 'stop' | 'tool-calls') => ({ type: 'finish', finishReason: { unified, raw: unified }, usage }) as Part
const say = (text: string): Part[] => [{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: text }, { type: 'text-end', id: 't' }] as Part[]
const call = (toolCallId: string, input: object): Part => ({ type: 'tool-call', toolCallId, toolName: 'act', input: JSON.stringify(input) }) as Part

/** A model that answers each step with the next of `steps`. */
function model(steps: Part[][]) {
  let i = 0
  return new MockLanguageModelV4({ doStream: async () => ({ stream: simulateReadableStream({ chunks: steps[i++]!, chunkDelayInMs: 0 }) }) })
}

const history: ModelMessage[] = [
  { role: 'user', content: 'sort my list' },
  { role: 'user', content: '<screen title="To-do">…</screen>' },
]

const request = (over: Partial<ThinkRequest> = {}): ThinkRequest => ({
  instructions: instructions({ web: false, today: new Date('2026-10-12T10:00:00') }),
  messages: history,
  act: async ({ option }) => `Did ${option}.\n\n<screen unchanged/>`,
  maxSteps: 5,
  signal: new AbortController().signal,
  ...over,
})

const cached = (m: { providerOptions?: Record<string, unknown> }) => !!(m.providerOptions?.anthropic as { cacheControl?: unknown } | undefined)?.cacheControl

describe('createThinker', () => {
  it('caches the instructions, the read point and the tail, moving the tail each step', async () => {
    const m = model([[call('c1', { option: 'Sort' }), finish('tool-calls')], [...say('Sorted.'), finish('stop')]])
    const result = await createThinker({ model: m }).run(request({ messages: [...history, { role: 'user', content: 'thanks' }], cacheAt: 1 }))
    const [first, second] = m.doStreamCalls.map((c) => c.prompt)
    expect(first!.map(cached)).toEqual([true, false, true, true])
    expect(second!.map(cached)).toEqual([true, false, true, false, false, true])
    expect(result.text).toBe('Sorted.')
    expect(result.sent).toBe(2)
    expect(result.messages.map((x) => x.role)).toEqual(['assistant', 'tool', 'assistant'])
    expect(result.usage?.inputTokenDetails.cacheReadTokens).toBe(16)
    expect(result.calls).toEqual([])
  })

  it("brings a single step's call back unrun, and holds its text until the end", async () => {
    const spoken: string[] = []
    let acted = false
    const m = model([[...say('Typing it.'), call('w1', { option: 'Add a task', text: 'Eggs', wrote: 'user' }), finish('tool-calls')]])
    const result = await createThinker({ model: m }).run(request({ single: { kind: 'write', option: 'Add a task' }, onText: (d) => spoken.push(d), act: async () => ((acted = true), '') }))
    expect(acted).toBe(false)
    expect(spoken).toEqual([])
    expect(result.text).toBe('Typing it.')
    expect(result.calls).toEqual([{ tool: 'act', input: { option: 'Add a task', text: 'Eggs', wrote: 'user' }, toolCallId: 'w1' }])
    expect(result.sent).toBe(0)
    expect(m.doStreamCalls[0]!.tools?.map((t) => t.name)).toEqual(['act'])
  })

  it('returns the steps that finished when the turn is aborted', async () => {
    const controller = new AbortController()
    const m = model([[call('c1', { option: 'Sort' }), finish('tool-calls')], [...say('Sorted.'), finish('stop')]])
    const run = createThinker({ model: m }).run(request({ signal: controller.signal, act: async ({ option }) => (option === 'Sort' && setTimeout(() => controller.abort(), 0), `Did ${option}.`) }))
    const error = await run.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PartialTurn)
    expect((error as PartialTurn).messages.map((x) => x.role)).toEqual(['assistant', 'tool'])
  })
})
