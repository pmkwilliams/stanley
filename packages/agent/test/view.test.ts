import { describe, expect, it } from 'vitest'
import type { AgentNode } from '@stanley/app-sdk'
import { stepOptions, type Ranking } from '../src/options'
import { since, viewParts, viewText, type ViewPart } from '../src/view'
import type { Screen } from '../src/world'

const button = (id: string, label: string): AgentNode => ({ id, kind: 'action', label })
const tasks: Screen = { id: 'tasks:list', title: 'Tasks', visible: true, markdown: '# Tasks', elements: [button('tasks:sort', 'Sort'), button('tasks:delete', 'Delete')] }
const email: Screen = { id: 'email:inbox', title: 'Email', visible: true, markdown: '# Inbox', elements: [button('email:archive', 'Archive')] }
const music: Screen = { id: 'music:player', title: 'Music', visible: false, markdown: '# Music\nPlaying: "Tura"', elements: [button('music:pause', 'Pause'), button('music:next', 'Next')] }
const apps = [{ id: 'tasks', title: 'Tasks', description: 'tasks' }]
const weights: Ranking['weights'] = { meaning: 1, own: 0.25, before: 0.5, word: 0.1, tier: { focused: 0.06, visible: 0.03, background: 0 }, near: 0.02 }

/** The parts thinking reads, with what the user asked as `focus`, the options most relevant first. */
const parts = (focus: string, screen = tasks, others: Screen[] = [email, music]) => viewParts(screen, stepOptions(screen, apps, 50, focus, [], false, undefined, [], false, false, false, { others, ranking: { weights, order: 'relevance' } }), others)
/** Thinking reads `p` first, then what `since` gives. */
const after = (first: ViewPart[], next: ViewPart[], top = 20) => since(next, since(first, new Map(), top).seen, top).text

describe('viewParts', () => {
  it("gives each app on the screen its options, then the background's, then the rest", () => {
    expect(viewText(parts('pause it'))).toBe(
      [
        '<screen title="Tasks" where="in front of the user">\n# Tasks\n</screen>\n<options>\n- [Sort] button\n- [Delete] button\n</options>',
        '<screen title="Email" where="also in front of the user">\n# Inbox\n</screen>\n<options>\n- [Email › Archive] button, in Email, on screen\n</options>',
        '<background title="Music">\n- Music: Playing: "Tura"\n</background>\n<options>\n- [Music › Pause] button, in Music, in the background\n- [Music › Next] button, in Music, in the background\n</options>',
        '<options>\n- [open Tasks] app: tasks\n- [back] Go back to the previous screen.\n- [home screen] Go to the home screen, which lists the apps.\n</options>',
      ].join('\n'),
    )
  })
})

describe('since', () => {
  it('sends all of it first, then that none of it changed', () => {
    expect(since(parts('sort it'), new Map(), 20).text).toBe(viewText(parts('sort it')))
    expect(after(parts('sort it'), parts('sort it'))).toBe('<screen unchanged/>')
  })

  it("doesn't send a new order of the same options when nothing clearly matches lower down", () => {
    const first = parts('delete it')
    expect(first[0]!.names).toEqual(['Delete', 'Sort'])
    expect(after(first, parts('thanks'))).toBe('<screen unchanged/>')
  })

  it('sends an app again when what the user asks for now is further down than thinking read it', () => {
    const first = parts('delete it')
    expect(after(first, parts('sort it'), 1)).toBe(['<screen title="Tasks" where="in front of the user">\n# Tasks\n</screen>\n<options>\n- [Sort] button\n- [Delete] button\n</options>', '<screen title="Email" unchanged/>', '<background title="Music" unchanged/>', '<options unchanged/>'].join('\n'))
    expect(after(first, parts('sort it'), 20)).toBe('<screen unchanged/>')
  })

  it('sends only the app that changed', () => {
    const moved: Screen = { ...email, markdown: '# Archive' }
    expect(after(parts('thanks'), parts('thanks', tasks, [moved, music]))).toBe(['<screen title="Tasks" unchanged/>', '<screen title="Email" where="also in front of the user">\n# Archive\n</screen>\n<options>\n- [Email › Archive] button, in Email, on screen\n</options>', '<background title="Music" unchanged/>', '<options unchanged/>'].join('\n'))
  })

  it('sends only the background when an app there changes', () => {
    const next: Screen = { ...music, markdown: '# Music\nPlaying: "Sugar"' }
    expect(after(parts('thanks'), parts('thanks', tasks, [email, next]))).toBe(['<screen title="Tasks" unchanged/>', '<screen title="Email" unchanged/>', '<background title="Music">\n- Music: Playing: "Sugar"\n</background>\n<options>\n- [Music › Pause] button, in Music, in the background\n- [Music › Next] button, in Music, in the background\n</options>', '<options unchanged/>'].join('\n'))
  })

  it('keeps two apps with the same title apart', () => {
    const twin: Screen = { ...email, id: 'email:other', markdown: '# Other inbox' }
    const view = parts('thanks', tasks, [email, twin, music])
    expect(view.map((p) => p.key)).toEqual(['screen:Tasks', 'screen:Email', 'screen:Email#2', 'background:Music', 'options'])
  })

  it('stands when only the first of many clear matches are judged, all as read', () => {
    const rows: Screen = { ...tasks, elements: Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, kind: 'group' as const, label: `Row ${i}`, children: [{ id: `r${i}/archive`, kind: 'action' as const, label: 'Archive' }] })) }
    // "archive it" clearly matches all forty Archives: the same screen still reads as unchanged.
    expect(after(parts('archive it', rows, []), parts('archive it', rows, []))).toBe('<screen unchanged/>')
  })

  it('sends all of it when a part is gone', () => {
    expect(after(parts('thanks'), parts('thanks', tasks, [music]))).toBe(viewText(parts('thanks', tasks, [music])))
  })

  it('keeps what thinking read when a new order stands, so the next one is judged against that', () => {
    const first = since(parts('delete it'), new Map(), 1)
    const second = since(parts('thanks'), first.seen, 1)
    expect(second.text).toBe('<screen unchanged/>')
    expect(second.seen.get('screen:Tasks')!.names).toEqual(['Delete', 'Sort'])
  })
})
