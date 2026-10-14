import { describe, expect, it } from 'vitest'
import type { StepTarget } from '../src/conversation'
import { narrate } from '../src/narrate'
import type { Screen } from '../src/world'
import { recorder } from './history'

const screen: Screen = { id: 'tasks:list', title: 'Tasks', visible: true, markdown: '# Tasks\n- [ ] Buy eggs', elements: [] }
const field: StepTarget = { kind: 'element', name: 'Add a task', role: 'field', nodeKind: 'input', nodeId: 'tasks:title' }

describe('narrate', () => {
  it("puts an utterance's words before the steps taken for it, even ones decided mid-sentence", () => {
    const r = recorder()
    r.event('task-start')
    r.step({ target: { kind: 'app', appId: 'tasks', title: 'Tasks' }, summary: 'Opened Tasks', utteranceId: 1 })
    r.words(1, 'add a task called')
    r.words(1, 'buy eggs')
    r.step({ target: field, text: 'Buy eggs', by: 'thinking', summary: 'typed', utteranceId: 1 })
    r.step({ target: { kind: 'element', name: 'Add a task › press Enter', role: 'key', nodeKind: 'action', nodeId: 'tasks:add' }, summary: 'Added task "Buy eggs".', utteranceId: 1 })
    r.event('task-end')
    expect(narrate(r.h.view(), screen)).toBe(
      [
        '## Conversation',
        'User: add a task called buy eggs',
        'Stanley opened Tasks.',
        'Stanley typed "Buy eggs" into [Add a task].',
        'Stanley pressed Enter in [Add a task]: Added task "Buy eggs".',
        '',
        '## Screen: Tasks (in front of the user)',
        '# Tasks\n- [ ] Buy eggs',
      ].join('\n'),
    )
  })

  it('shows the live utterance with its unfinished words, and marks it while the user is speaking', () => {
    const r = recorder()
    r.words(2, 'add a task')
    const live = { utteranceId: 2, text: 'add a task called um', ended: false }
    expect(narrate(r.h.view(live), screen, live)).toContain('User (still speaking): add a task called um')
    const fresh = { utteranceId: 3, text: 'open', ended: false }
    expect(narrate(recorder().h.view(fresh), screen, fresh)).toContain('## Conversation\nUser (still speaking): open\n')
  })

  it("says whose words were typed, what Stanley said, and the user's own clicks", () => {
    const r = recorder()
    r.words(1, 'reply with something funny')
    r.step({ target: field, text: 'Ramen? Always.', wrote: 'stanley', by: 'thinking', summary: 'typed', utteranceId: 1 })
    r.said('I wrote "Ramen? Always." Send it?')
    r.userStep({ kind: 'element', name: 'Send reply', role: 'button', nodeKind: 'action', nodeId: 'e:send' }, 'Reply sent')
    r.userStep({ kind: 'home' }, 'Went home')
    expect(narrate(r.h.view(), { ...screen, visible: false })).toBe(
      [
        '## Conversation',
        'User: reply with something funny',
        'Stanley wrote its own words into [Add a task]: "Ramen? Always."',
        'Stanley said: "I wrote "Ramen? Always." Send it?"',
        'User pressed [Send reply]: Reply sent.',
        'User went home.',
        '',
        "## Screen: Tasks (in the background, the user can't see it)",
        '# Tasks\n- [ ] Buy eggs',
      ].join('\n'),
    )
  })

  it('splits a turn at a change made before the user finished, so a correction reads after it', () => {
    const tick = (name: string, heardWords: number) => ({
      target: { kind: 'element' as const, name: `${name} › checkbox`, role: 'checkbox', nodeKind: 'action' as const, nodeId: name },
      summary: `Marked "${name}" done`,
      utteranceId: 1,
      heardWords,
    })
    const r = recorder()
    r.step({ target: { kind: 'app', appId: 'tasks', title: 'Tasks' }, summary: 'Opened', utteranceId: 1, heardWords: 2 })
    r.words(1, 'tick the blue one')
    r.step(tick('Blue', 4))
    const live = { utteranceId: 1, text: 'tick the blue one sorry the', ended: false }
    expect(narrate(r.h.view(live), screen, live)).toContain('Stanley pressed [Blue › checkbox]: Marked "Blue" done.\nUser (went on, still speaking): sorry the\n')
    r.words(1, 'sorry the red one')
    r.step(tick('Red', 8))
    expect(narrate(r.h.view(), screen).split('\n').slice(0, 6)).toEqual([
      '## Conversation',
      'User: tick the blue one',
      'Stanley opened Tasks.',
      'Stanley pressed [Blue › checkbox]: Marked "Blue" done.',
      'User (went on): sorry the red one',
      'Stanley pressed [Red › checkbox]: Marked "Red" done.',
    ])
  })

  it('leaves out task boundaries and anything that is not a step, words or speech', () => {
    const r = recorder()
    r.event('task-start')
    r.event('task-end')
    expect(narrate(r.h.view(), screen)).toContain('## Conversation\n(nothing yet)\n')
  })

  it('keeps only the most recent turns of a long session', () => {
    const r = recorder()
    for (let i = 0; i < 5; i++) {
      r.words(i, `turn ${i}`)
      r.h.begin()
    }
    const text = narrate(r.h.view(), screen, undefined, 2)
    expect(text).toContain('## Conversation\n(earlier conversation left out)\nUser: turn 3\nUser: turn 4\n')
    expect(text).not.toContain('turn 2')
  })

  it('reads the same whether the order was committed at each utterance or is still staged', () => {
    const r = recorder()
    r.words(1, 'open my email')
    r.step({ target: { kind: 'app', appId: 'email', title: 'Email' }, utteranceId: 1, heardWords: 2 })
    r.said('Here it is.')
    const staged = narrate(r.h.view(), screen)
    r.h.begin()
    expect(narrate(r.h.view(), screen)).toBe(staged)
  })
})
