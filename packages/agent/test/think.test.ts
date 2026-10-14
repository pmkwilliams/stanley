import { simulateReadableStream, type ModelMessage } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { createThinker, instructions, PartialTurn, unsilenced, type ThinkRequest } from '../src/think'

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

  it('never speaks the silence marker, even split across deltas', async () => {
    const spoken: string[] = []
    const parts = ['<sil', 'ent', '/>'].flatMap((d) => [{ type: 'text-delta', id: 't', delta: d }]) as Part[]
    const m = model([[call('c1', { option: 'Sort' }), finish('tool-calls')], [{ type: 'text-start', id: 't' } as Part, ...parts, { type: 'text-end', id: 't' } as Part, finish('stop')]])
    const result = await createThinker({ model: m }).run(request({ onText: (d) => spoken.push(d) }))
    expect(spoken).toEqual([])
    expect(result.text).toBe('')
    expect(JSON.stringify(result.messages)).toContain('<silent/>')
  })

  it('draws a page as its input comes, and gives the model a picture of how it came out', async () => {
    const json = JSON.stringify({ path: 'Pages/rain.html', content: '<h1>Rain</h1><p>It falls.</p>' })
    const write = [
      { type: 'tool-input-start', id: 'w1', toolName: 'write_file' },
      { type: 'tool-input-delta', id: 'w1', delta: json.slice(0, 44) },
      { type: 'tool-input-delta', id: 'w1', delta: json.slice(44) },
      { type: 'tool-input-end', id: 'w1' },
      { type: 'tool-call', toolCallId: 'w1', toolName: 'write_file', input: json },
      finish('tool-calls'),
    ] as Part[]
    const drawn: string[] = []
    const written: string[] = []
    const m = model([write, [...say('<silent/>'), finish('stop')]])
    await createThinker({ model: m }).run(
      request({
        onDraft: (id, path, content) => drawn.push(`${id} ${path}: ${content}`),
        writeFile: async (path, content) => (written.push(`${path}: ${content}`), { text: 'Wrote it.', image: { data: 'aGk=', mediaType: 'image/jpeg' } }),
        editFile: async () => ({ text: '' }),
      }),
    )
    expect(drawn).toEqual(['w1 Pages/rain.html: <h1>Rai'])
    expect(written).toEqual(['Pages/rain.html: <h1>Rain</h1><p>It falls.</p>'])
    const result = m.doStreamCalls[1]!.prompt.at(-1)!
    expect(result.role).toBe('tool')
    expect(result.content).toEqual([
      { type: 'tool-result', toolCallId: 'w1', toolName: 'write_file', output: { type: 'content', value: [{ type: 'text', text: 'Wrote it.' }, { type: 'file', mediaType: 'image/jpeg', data: { type: 'data', data: 'aGk=' } }] } },
    ])
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

describe('unsilenced', () => {
  it('drops the marker and its near misses', () => {
    expect(unsilenced('<silent/>', true)).toBe('')
    expect(unsilenced('<silent />', true)).toBe('')
    expect(unsilenced('Sam sent it. <SILENT/>', true)).toBe('Sam sent it. ')
  })

  it('holds back what may still become the marker, and only that', () => {
    expect(unsilenced('<sil', false)).toBe('')
    expect(unsilenced('Six <', false)).toBe('Six ')
    expect(unsilenced('Six <b', false)).toBe('Six <b')
    expect(unsilenced('<sil', true)).toBe('<sil')
  })
})
