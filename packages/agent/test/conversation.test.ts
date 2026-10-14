import type { ModelMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import { Conversation, replay, validate, type HistoryRecord, type Ran } from '../src/conversation'
import { narrate } from '../src/narrate'
import { recorder } from './history'

const roles = (messages: ModelMessage[]) => messages.map((m) => (typeof m.content === 'string' ? `${m.role}: ${m.content}` : `${m.role}: ${m.content.map((p) => (p.type === 'text' ? p.text : p.type === 'tool-call' ? `call ${p.toolCallId}` : p.type === 'tool-result' ? `result ${p.toolCallId}` : p.type)).join(' + ')}`))
const viewed = (h: Conversation) => roles(h.view().flatMap((e) => (e.message ? [e.message] : [])))
const button = (name: string, heardWords: number) => ({ target: { kind: 'element' as const, name, role: 'button', nodeKind: 'action' as const, nodeId: name }, summary: `pressed ${name}`, utteranceId: 1, heardWords })

/** A thinking turn's messages as the SDK returns them: one step with a call, then a reply. */
function turn(toolCallId: string, reply: string): ModelMessage[] {
  return [
    { role: 'assistant', content: [{ type: 'reasoning', text: 'hmm', providerOptions: { anthropic: { signature: 'sig' } } }, { type: 'tool-call', toolCallId, toolName: 'act', input: { option: 'Red' } }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId, toolName: 'act', output: { type: 'text', value: 'Marked "Red" done.' } }] },
    { role: 'assistant', content: [{ type: 'reasoning', text: 'done', providerOptions: { anthropic: { signature: 'sig2' } } }, { type: 'text', text: reply }] },
  ]
}

const ran = (toolCallId: string): Map<string, Ran> =>
  new Map([[toolCallId, { tool: 'act', input: { option: 'Red' }, output: { type: 'text', value: 'Marked "Red" done.' }, result: { toolCallId, step: { id: 't1', by: 'thinking', target: button('Red', 0).target, summary: 'Marked "Red" done' } } }]])

describe('Conversation', () => {
  it('commits at a thinking call in the order narrate reads, and sends the observation last', () => {
    const r = recorder()
    r.step({ target: { kind: 'app', appId: 'tasks', title: 'Tasks' }, utteranceId: 1, heardWords: 2 })
    r.words(1, 'tick the blue one')
    r.step(button('Blue', 4))
    r.words(1, 'sorry the red one')
    const sent = r.h.send('<screen …/>', { utteranceId: 1, text: 'tick the blue one sorry the red one', ended: true })
    expect(roles(sent.messages)).toEqual([
      'user: tick the blue one',
      'assistant: call jev_s1',
      'tool: result jev_s1',
      'assistant: call jev_s2',
      'tool: result jev_s2',
      'user: sorry the red one',
      'user: <screen …/>',
    ])
    expect(sent.cacheAt).toBeUndefined()
    expect(sent.entries).toBe(r.h.entries.length)
  })

  it('starts with a greeting, committed without a thinking call, before the first utterance', () => {
    const h = new Conversation()
    h.greet('Hello, Stanley')
    expect(h.entries).toHaveLength(1)
    h.begin()
    h.heard(1, 'open music')
    const live = { utteranceId: 1, text: 'open music', ended: true }
    expect(narrate(h.view(live), null, live).split('\n').slice(1)).toEqual(['User: Hello, Stanley', 'User: open music'])
    const sent = h.send('<screen/>', live)
    expect(roles(sent.messages)).toEqual(['user: Hello, Stanley', 'user: open music', 'user: <screen/>'])
    expect(validate(sent.messages)).toBeUndefined()
  })

  it('puts words said after a thinking call after it, which is when they were said', () => {
    const r = recorder()
    r.words(1, 'tick the blue one')
    r.h.send('<screen/>', { utteranceId: 1, text: 'tick the blue one', ended: false })
    r.h.appendTurn(turn('call_1', ''), 2, ran('call_1'))
    r.words(1, 'please')
    const live = { utteranceId: 1, text: 'tick the blue one please', ended: false }
    expect(narrate(r.h.view(live), null, live).split('\n').slice(1)).toEqual(['User: tick the blue one', 'Stanley pressed [Red]: Marked "Red" done.', 'User (went on, still speaking): please'])
  })

  it("keeps a turn as sent, takes its final text out, and reads the cache where the turn's last step started", () => {
    const h = new Conversation()
    h.heard(1, 'mark red')
    h.send('<screen/>', { utteranceId: 1, text: 'mark red', ended: true })
    const { final } = h.appendTurn(turn('call_1', 'Done.'), 2, ran('call_1'))
    expect(final).toBe('Done.')
    h.said(1, 'Done.', final)
    h.begin()
    h.heard(2, 'thanks')
    const sent = h.send('<screen unchanged/>', { utteranceId: 2, text: 'thanks', ended: true })
    expect(roles(sent.messages)).toEqual(['user: mark red', 'user: <screen/>', 'assistant: reasoning + call call_1', 'tool: result call_1', 'assistant: Done.', 'user: thanks', 'user: <screen unchanged/>'])
    expect(sent.cacheAt).toBe(3)
    expect(validate(sent.messages)).toBeUndefined()
  })

  it('cuts a reply not yet sent to what the user heard; once sent, a note says it', () => {
    const r = recorder()
    r.words(1, "what's next")
    r.said('Your meeting is at three, with Sam.', 7)
    r.h.cut(7, 'Your meeting is at three,')
    expect(viewed(r.h)).toContain('assistant: Your meeting is at three,')
    expect(narrate(r.h.view(), null)).toContain('Stanley started to say: "Your meeting is at three," but the user cut in.')
    r.h.send('<screen/>')
    r.said('It is sunny.', 8)
    r.h.send('<screen unchanged/>')
    r.h.cut(8, 'It is')
    expect(viewed(r.h).at(-1)).toBe('user: <note>The user cut in while you were saying that. They heard only: "It is"</note>')
    expect(r.h.messages().some((m) => m.content === 'It is sunny.')).toBe(true)
  })

  it("answers a single-step turn's call when applied, and drops it otherwise", () => {
    const h = new Conversation()
    h.heard(1, 'add eggs')
    h.send('<screen/><note>Next: typing into [Add a task].</note>')
    const call: ModelMessage = { role: 'assistant', content: [{ type: 'text', text: 'Typing.' }, { type: 'tool-call', toolCallId: 'w1', toolName: 'act', input: { option: 'Add a task', text: 'Eggs' } }] }
    expect(h.appendTurn([call], 0, new Map()).final).toBe('Typing.')
    h.applyCall('w1', { tool: 'act', input: {} }, { type: 'text', value: 'Typed "Eggs".' }, { toolCallId: 'w1' })
    expect(roles(h.messages()).slice(2)).toEqual(['assistant: call w1', 'tool: result w1'])

    h.send('<screen/><note>Next: pressing [Send].</note>')
    h.appendTurn([{ role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'act', input: { option: 'Sort' } }] }], 0, new Map())
    h.dropCall('c1')
    expect(roles(h.messages()).at(-1)).toBe('user: <screen/><note>Next: pressing [Send].</note>')
  })

  it("drops a call left unanswered before the next thinking call, and pairs a late application as Stanley's own", () => {
    const h = new Conversation()
    h.heard(1, 'reply something funny')
    h.send('<screen/>')
    h.appendTurn([{ role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'w1', toolName: 'act', input: { option: 'Reply', text: 'Ha' } }] }], 0, new Map())
    const sent = h.send('<screen unchanged/>')
    expect(validate(sent.messages)).toBeUndefined()
    expect(roles(sent.messages)).not.toContain('assistant: call w1')
    h.applyCall('w1', { tool: 'act', input: { option: 'Reply', text: 'Ha' } }, { type: 'text', value: 'Typed.' }, { toolCallId: 'w1' })
    expect(validate(h.view().flatMap((e) => (e.message ? [e.message] : [])))).toBeUndefined()
    expect(viewed(h).slice(-2)).toEqual(['assistant: call stanley_' + viewed(h).at(-2)!.split('stanley_')[1], 'tool: result stanley_' + viewed(h).at(-2)!.split('stanley_')[1]])
  })

  it("adds a step that ran in a turn cut short as Stanley's own call and result, without reasoning", () => {
    const h = new Conversation()
    h.heard(1, 'mark red')
    h.send('<screen/>')
    h.appendTurn([], 0, ran('call_9'))
    expect(roles(h.messages()).slice(2)).toEqual(['assistant: call call_9', 'tool: result call_9'])
    expect(narrate(h.view(), null)).toContain('Stanley pressed [Red]: Marked "Red" done.')
  })

  it('rebuilds what thinking was sent from the records', () => {
    const records: HistoryRecord[] = []
    const r = recorder(new Conversation((rec) => records.push(rec)))
    r.words(1, "what's next")
    r.said('Your meeting is at three.', 3)
    r.h.cut(3, 'Your meeting')
    r.h.send('<screen/>')
    r.h.appendTurn(turn('call_1', 'Done.'), 2, ran('call_1'))
    expect(replay(records)).toEqual(r.h.entries)
  })

  it('finds what the API would reject', () => {
    const call: ModelMessage = { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'a', toolName: 'act', input: {} }] }
    const result: ModelMessage = { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'a', toolName: 'act', output: { type: 'text', value: 'ok' } }] }
    expect(validate([{ role: 'user', content: 'hi' }, call, result])).toBeUndefined()
    expect(validate([{ role: 'user', content: 'hi' }, call, { role: 'user', content: 'more' }])).toMatch(/0 results/)
    expect(validate([call, result])).toMatch(/first message/)
    expect(validate([{ role: 'user', content: 'hi' }, call, result, call, result])).toMatch(/twice/)
    expect(validate([{ role: 'user', content: ' ' }])).toMatch(/empty/)
    expect(validate([{ role: 'user', content: 'hi' }, result])).toMatch(/follow no call/)
  })
})
