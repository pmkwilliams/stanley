import { describe, expect, it } from 'vitest'
import type { AgentNode } from '@stanley/app-sdk'
import { resolveOption } from '../src/agent'
import { findElement, navigates, stepOptions } from '../src/options'
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
const apps = [{ id: 'todo', title: 'To-do', description: 'tasks' }]

describe('stepOptions', () => {
  const options = stepOptions(screen, apps, 50)

  it('offers the screen in order, named by the containers that tell elements apart, then apps, back and home', () => {
    expect(Object.keys(options.criteria)).toEqual(['Inbox (5)', 'Sam: Lunch Friday?', '"Lunch Friday?" › Archive', '"Lunch Friday?" › Reply to Sam', 'Archive', 'open To-do', 'back', 'home'])
  })

  it('offers lock last, only when the world can lock', () => {
    expect(Object.keys(stepOptions(screen, apps, 50, '', [], true).criteria).slice(-3)).toEqual(['back', 'home', 'lock'])
  })

  it('describes elements by role and what the screen shows, nothing more', () => {
    expect(options.criteria['Inbox (5)']).toBe('tab, selected')
    expect(options.criteria['"Lunch Friday?" › Reply to Sam']).toBe('field, containing "Sure"')
    expect(options.criteria['"Lunch Friday?" › Archive']).toBe('button')
    expect(options.criteria['open To-do']).toBe('app: tasks')
  })

  it('keeps names unique and respects the limit', () => {
    const twice = stepOptions({ ...screen, elements: [screen.elements[3]!, screen.elements[3]!] }, [], 50)
    expect(Object.keys(twice.criteria).slice(0, 2)).toEqual(['Archive', 'Archive (2)'])
    expect(Object.keys(stepOptions(screen, [], 1).criteria)).toEqual(['Inbox (5)', 'back', 'home'])
  })

  it('treats links, apps, back and home as navigation, and buttons and fields as not', () => {
    expect(navigates(options.targets.get('Sam: Lunch Friday?')!)).toBe(true)
    expect(navigates(options.targets.get('open To-do')!)).toBe(true)
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
    expect(Object.keys(options.criteria)).toEqual(['Inbox (5)', 'open page: Louvre - Wikipedia', 'back', 'home'])
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
    expect(resolveOption(options, '[open To-do]')).toBe('open To-do')
    expect(resolveOption(options, 'Lunch Friday? › Reply to Sam')).toBe('"Lunch Friday?" › Reply to Sam')
    expect(resolveOption(options, 'reply to sam')).toBe('"Lunch Friday?" › Reply to Sam')
  })

  it('refuses an ambiguous or unknown name', () => {
    expect(resolveOption(options, 'archive')).toBe('Archive')
    expect(resolveOption(options, 'rchive')).toBeUndefined()
    expect(resolveOption(options, 'Send')).toBeUndefined()
  })
})
