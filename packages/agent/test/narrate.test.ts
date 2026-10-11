import { describe, expect, it } from 'vitest'
import type { LogEntry, Message } from '../src/log'
import { narrate } from '../src/narrate'
import type { Screen } from '../src/world'

const screen: Screen = { id: 'todo:list', title: 'To-do', visible: true, markdown: '# To-do\n- [ ] Buy eggs', elements: [] }
const entries = (...messages: Message[]): LogEntry[] => messages.map((m) => ({ ...m, at: 0 }) as LogEntry)
const typed = (text: string, utteranceId: number, wrote?: 'user' | 'stanley'): Message => ({
  role: 'step',
  id: 's',
  by: 'thinking',
  target: { kind: 'element', name: 'Add a task', role: 'field', nodeKind: 'input', nodeId: 'todo:title' },
  text,
  wrote,
  result: { summary: 'typed' },
  utteranceId,
})

describe('narrate', () => {
  it("puts an utterance's words before the steps taken for it, even ones decided mid-sentence", () => {
    const log = entries(
      { role: 'event', kind: 'task-start' },
      { role: 'step', id: 's1', by: 'fast', target: { kind: 'app', appId: 'todo', title: 'To-do' }, result: { summary: 'Opened To-do' }, utteranceId: 1 },
      { role: 'user', content: 'add a task called', utteranceId: 1 },
      { role: 'user', content: 'buy eggs', utteranceId: 1 },
      typed('Buy eggs', 1),
      {
        role: 'step',
        id: 's3',
        by: 'fast',
        target: { kind: 'element', name: 'Add a task › press Enter', role: 'key', nodeKind: 'action', nodeId: 'todo:add' },
        result: { summary: 'Added to-do "Buy eggs".' },
        utteranceId: 1,
      },
      { role: 'event', kind: 'task-end' },
    )
    expect(narrate(log, screen)).toBe(
      [
        '## Conversation',
        'User: add a task called buy eggs',
        'Stanley opened To-do.',
        'Stanley typed "Buy eggs" into [Add a task].',
        'Stanley pressed Enter in [Add a task]: Added to-do "Buy eggs".',
        '',
        '## Screen: To-do (in front of the user)',
        '# To-do\n- [ ] Buy eggs',
      ].join('\n'),
    )
  })

  it('shows the live utterance with its unfinished words, and marks it while the user is speaking', () => {
    const log = entries({ role: 'user', content: 'add a task', utteranceId: 2 })
    expect(narrate(log, screen, { utteranceId: 2, text: 'add a task called um', ended: false })).toContain('User (still speaking): add a task called um')
    expect(narrate([], screen, { utteranceId: 3, text: 'open', ended: false })).toContain('## Conversation\nUser (still speaking): open\n')
  })

  it("says whose words were typed, what Stanley said, and the user's own clicks", () => {
    const log = entries(
      { role: 'user', content: 'reply with something funny', utteranceId: 1 },
      typed('Ramen? Always.', 1, 'stanley'),
      { role: 'said', content: 'I wrote "Ramen? Always." Send it?' },
      { role: 'step', id: 'u1', by: 'user', target: { kind: 'element', name: 'Send reply', role: 'button', nodeKind: 'action', nodeId: 'e:send' }, result: { summary: 'Reply sent' } },
      { role: 'step', id: 'u2', by: 'user', target: { kind: 'home' }, result: { summary: 'Went home' } },
    )
    expect(narrate(log, { ...screen, visible: false })).toBe(
      [
        '## Conversation',
        'User: reply with something funny',
        'Stanley wrote its own words into [Add a task]: "Ramen? Always."',
        'Stanley said: "I wrote "Ramen? Always." Send it?"',
        'User pressed [Send reply]: Reply sent.',
        'User went home.',
        '',
        "## Screen: To-do (in the background, the user can't see it)",
        '# To-do\n- [ ] Buy eggs',
      ].join('\n'),
    )
  })

  it('leaves out task boundaries and anything that is not a step, words or speech', () => {
    const log = entries({ role: 'event', kind: 'task-start' }, { role: 'event', kind: 'task-end' })
    expect(narrate(log, screen)).toContain('## Conversation\n(nothing yet)\n')
  })

  it('keeps only the most recent turns of a long session', () => {
    const log = entries(...Array.from({ length: 5 }, (_, i): Message => ({ role: 'user', content: `turn ${i}`, utteranceId: i })))
    const text = narrate(log, screen, undefined, 2)
    expect(text).toContain('## Conversation\n(earlier conversation left out)\nUser: turn 3\nUser: turn 4\n')
    expect(text).not.toContain('turn 2')
  })
})
