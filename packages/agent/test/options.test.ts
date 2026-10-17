import { describe, expect, it } from 'vitest'
import type { AgentNode } from '@stanley/app-sdk'
import { resolveOption } from '../src/agent'
import { candidatesOf, candidateText, findElement, navigates, stepOptions, type Ranking } from '../src/options'
import type { Screen } from '../src/world'

const article: AgentNode = {
  id: 'email:m1/article',
  kind: 'group',
  role: 'article',
  label: '"Lunch Friday?"',
  children: [
    { id: 'email:m1/archive', kind: 'action', label: 'Archive' },
    { id: 'email:m1/reply', kind: 'input', label: 'Reply to Sam', value: 'Sure' },
  ],
}
const screen: Screen = {
  id: 'email:m1',
  title: 'Email',
  visible: true,
  markdown: '# Email',
  elements: [{ id: 'email:inbox', kind: 'location', role: 'tab', label: 'Inbox (5)', description: 'selected' }, { id: 'email:m1', kind: 'location', label: 'Sam: Lunch Friday?' }, article, { id: 'email:archive2', kind: 'action', label: 'Archive' }],
}
const apps = [{ id: 'tasks', title: 'Tasks', description: 'tasks' }]

describe('stepOptions', () => {
  const options = stepOptions(screen, apps, 50)

  it('offers the screen in order, named by the containers that tell elements apart, then apps, back and home', () => {
    expect(Object.keys(options.criteria)).toEqual(['Inbox (5)', 'Sam: Lunch Friday?', '"Lunch Friday?" › Archive', '"Lunch Friday?" › Reply to Sam', 'Archive', 'open Tasks', 'back', 'home screen'])
  })

  it("offers the user's skills before the apps, described by when they are for", () => {
    const skills = stepOptions(screen, apps, 50, '', [], false, undefined, [{ name: 'wind-down', description: 'When the user winds down.', path: '.agents/skills/wind-down/SKILL.md' }])
    expect(Object.keys(skills.criteria).slice(-4)).toEqual(['use skill: wind-down', 'open Tasks', 'back', 'home screen'])
    expect(skills.criteria['use skill: wind-down']).toBe('skill: When the user winds down.')
    expect(navigates(skills.targets.get('use skill: wind-down')!)).toBe(true)
  })

  it('offers lock last, only when the world can lock', () => {
    expect(Object.keys(stepOptions(screen, apps, 50, '', [], true).criteria).slice(-3)).toEqual(['back', 'home screen', 'lock'])
  })

  it('describes elements by role and what the screen shows, nothing more', () => {
    expect(options.criteria['Inbox (5)']).toBe('tab, selected')
    expect(options.criteria['"Lunch Friday?" › Reply to Sam']).toBe('field, containing "Sure"')
    expect(options.criteria['"Lunch Friday?" › Archive']).toBe('button')
    expect(options.criteria['open Tasks']).toBe('app: tasks')
  })

  it('keeps names unique and respects the limit', () => {
    const twice = stepOptions({ ...screen, elements: [screen.elements[3]!, screen.elements[3]!] }, [], 50)
    expect(Object.keys(twice.criteria).slice(0, 2)).toEqual(['Archive', 'Archive (2)'])
    expect(Object.keys(stepOptions(screen, [], 1).criteria)).toEqual(['Inbox (5)', 'back', 'home screen'])
  })

  it('treats links, apps, back and home as navigation, and buttons and fields as not', () => {
    expect(navigates(options.targets.get('Sam: Lunch Friday?')!)).toBe(true)
    expect(navigates(options.targets.get('open Tasks')!)).toBe(true)
    expect(navigates(options.targets.get('back')!)).toBe(true)
    expect(navigates({ kind: 'lock' })).toBe(false)
    expect(navigates(options.targets.get('Archive')!)).toBe(false)
    expect(navigates(options.targets.get('"Lunch Friday?" › Reply to Sam')!)).toBe(false)
  })
})

describe('stepOptions with known web pages', () => {
  const pages = [
    { url: 'https://en.wikipedia.org/wiki/Eiffel_Tower', title: 'Eiffel Tower', latest: true },
    { url: 'https://www.toureiffel.paris/en', title: 'Eiffel Tower', latest: true },
    { url: 'https://en.wikipedia.org/wiki/Louvre', title: 'Louvre - Wikipedia', latest: false },
  ]

  it('offers each page after the screen, told apart by site when titles clash', () => {
    const options = stepOptions(screen, [], 50, '', pages)
    expect(Object.keys(options.criteria).slice(5, 8)).toEqual(['open page: Eiffel Tower (en.wikipedia.org)', 'open page: Eiffel Tower (toureiffel.paris)', 'open page: Louvre - Wikipedia'])
    expect(options.criteria['open page: Louvre - Wikipedia']).toBe('web page on en.wikipedia.org')
    expect(options.targets.get('open page: Louvre - Wikipedia')).toEqual({ kind: 'page', url: 'https://en.wikipedia.org/wiki/Louvre', title: 'Louvre - Wikipedia' })
    expect(navigates(options.targets.get('open page: Louvre - Wikipedia')!)).toBe(true)
  })

  it("doesn't offer the page already on screen", () => {
    const options = stepOptions({ ...screen, url: 'https://en.wikipedia.org/wiki/Louvre#History' }, [], 50, '', pages)
    expect(Object.keys(options.criteria).filter((n) => n.includes('Louvre'))).toEqual([])
  })

  it('ranks pages with the screen when there are too many, by the words the user said', () => {
    const options = stepOptions(screen, [], 2, 'show me the louvre', pages)
    expect(Object.keys(options.criteria)).toEqual(['Inbox (5)', 'open page: Louvre - Wikipedia', 'back', 'home screen'])
  })
})

describe('stepOptions with the user\'s files', () => {
  const files = [
    { path: 'Pages/rain.html', latest: true, url: 'stanley://files/Pages/rain.html' },
    { path: 'notes.md', latest: false },
  ]

  it('offers to open a file the screen can show, and leaves out the one on screen', () => {
    expect(Object.keys(stepOptions(screen, [], 50, '', [], false, files).criteria)).toEqual(expect.arrayContaining(['read file: Pages/rain.html', 'open file: Pages/rain.html', 'read file: notes.md']))
    expect(stepOptions(screen, [], 50, '', [], false, files).targets.get('open file: Pages/rain.html')).toEqual({ kind: 'page', url: 'stanley://files/Pages/rain.html', title: 'rain.html' })
    const names = Object.keys(stepOptions({ ...screen, url: 'stanley://files/Pages/rain.html' }, [], 50, '', [], false, files).criteria)
    expect(names.filter((n) => n.includes('rain'))).toEqual([])
    expect(names).toContain('read file: notes.md')
  })
})

describe('findElement', () => {
  it('finds an element by id with its option name', () => {
    expect(findElement(screen, 'email:m1/reply')?.name).toBe('"Lunch Friday?" › Reply to Sam')
    expect(findElement(screen, 'nope')).toBeUndefined()
  })
})

describe('resolveOption', () => {
  const options = stepOptions(screen, apps, 50)
  it('takes exact names, and the one option a paraphrase points to', () => {
    expect(resolveOption(options, 'Inbox (5)')).toBe('Inbox (5)')
    expect(resolveOption(options, '[open Tasks]')).toBe('open Tasks')
    expect(resolveOption(options, 'Lunch Friday? › Reply to Sam')).toBe('"Lunch Friday?" › Reply to Sam')
    expect(resolveOption(options, 'reply to sam')).toBe('"Lunch Friday?" › Reply to Sam')
  })

  it('refuses an ambiguous or unknown name', () => {
    expect(resolveOption(options, 'archive')).toBe('Archive')
    expect(resolveOption(options, 'rchive')).toBeUndefined()
    expect(resolveOption(options, 'Send')).toBeUndefined()
  })
})

describe('stepOptions across apps', () => {
  const music: Screen = { id: 'music:player', title: 'Music', visible: false, markdown: '# Music\nPlaying: "Tura" by Hulk Hodn', elements: [{ id: 'music:toggle', kind: 'action', label: 'Pause' }, { id: 'music:next', kind: 'action', label: 'Next' }] }
  const tasks: Screen = { id: 'tasks:list', title: 'Tasks', visible: true, markdown: '# Tasks', elements: [{ id: 'tasks:title', kind: 'input', label: 'New task' }] }
  const weights: Ranking['weights'] = { meaning: 1, own: 0.25, before: 0.5, word: 0.1, tier: { focused: 0.06, visible: 0.03, background: 0 }, near: 0.02 }
  /** What the embedding model makes of "stop the song": the music closest. */
  const meaning = (text: string) => (text === 'Pause' ? 0.69 : text === 'Next' ? 0.61 : 0.45)
  const ranked = (order: Ranking['order'], limit = 50) => {
    const texts = candidatesOf(screen, [tasks, music]).map(candidateText)
    return stepOptions(screen, apps, limit, 'stop the song', [], false, undefined, [], false, false, false, { others: [tasks, music], ranking: { meaning: new Map(texts.map((t) => [t, meaning(t)])), weights, order, clear: 0.6 } })
  }

  it("offers the other apps' elements after the screen's, named by their app and said where they are", () => {
    const options = stepOptions(screen, apps, 50, '', [], false, undefined, [], false, false, false, { others: [tasks, music] })
    expect(Object.keys(options.criteria).slice(4, 8)).toEqual(['Archive', 'Tasks › New task', 'Music › Pause', 'Music › Next'])
    expect(options.criteria['Tasks › New task']).toBe('field, empty, in Tasks, on screen')
    expect(options.criteria['Music › Pause']).toBe('button, in Music, in the background')
    expect(options.targets.get('Music › Pause')).toMatchObject({ kind: 'element', app: music })
  })

  it('marks what clearly matches what the user asks, by its own words or by meaning', () => {
    const clear = (focus: string) => [...stepOptions(screen, apps, 50, focus, [], false, undefined, [], false, false, false, { others: [tasks, music] }).clear]
    expect(clear('thanks')).toEqual([])
    // Its app's name is on all of them, so it matches none.
    expect(clear('open my music')).toEqual([])
    expect(clear('next one')).toEqual(['Music › Next'])
    expect([...ranked('relevance').clear]).toEqual(['Music › Pause', 'Music › Next'])
  })

  it('keeps what the request means when there are more than fit, in screen order', () => {
    expect(Object.keys(ranked('screen', 3).criteria).slice(0, 3)).toEqual(['Inbox (5)', 'Music › Pause', 'Music › Next'])
  })

  it('names each element the same whatever is offered, so a step read earlier is still the step it was', () => {
    // Two "Download"s, the first out of view: the second ranks first, and keeps the name it has when both are offered.
    const two: Screen = { ...screen, elements: [{ id: 'a', kind: 'action', label: 'Download', offscreen: true }, { id: 'b', kind: 'action', label: 'Download' }] }
    const offer = (limit: number) => stepOptions(two, [], limit, 'download', [], false, undefined, [], false, false, false, { ranking: { weights, order: 'relevance' } })
    expect(offer(50).targets.get('Download (2)')).toMatchObject({ node: { id: 'b' } })
    const one = offer(1)
    expect(Object.keys(one.criteria)[0]).toBe('Download (2)')
    expect(one.targets.get('Download (2)')).toMatchObject({ node: { id: 'b' } })
  })

  it('keeps an element named by a number in its place, not first', () => {
    const pages: Screen = { ...screen, elements: [{ id: 'next', kind: 'location', label: 'Next page' }, { id: 'p2', kind: 'location', label: '2' }, { id: 'p3', kind: 'location', label: '3' }] }
    const names = Object.keys(stepOptions(pages, [], 50).criteria)
    expect(names.slice(0, 3)).toEqual(['Next page', '"2"', '"3"'])
  })

  it("ranks what isn't embedded yet as no closer to the request than to nothing", () => {
    // Scores are closeness beyond a request for nothing: what isn't scored yet (0) goes below what is
    // closer (Archive) and above what is further (Pause).
    const meaning = new Map([['Pause', -0.1], ['Next', 0], ['Archive', 0.2]])
    const order = Object.keys(stepOptions(screen, apps, 50, 'x', [], false, undefined, [], false, false, false, { others: [tasks, music], ranking: { meaning, weights, order: 'relevance' } }).criteria)
    expect(order.indexOf('Inbox (5)')).toBeLessThan(order.indexOf('Music › Pause'))
    expect(order.indexOf('Archive')).toBeLessThan(order.indexOf('Inbox (5)'))
  })

  it('puts the most relevant first when ordered by relevance', () => {
    expect(Object.keys(ranked('relevance').criteria).slice(0, 3)).toEqual(['Music › Pause', 'Music › Next', 'Inbox (5)'])
  })
})
