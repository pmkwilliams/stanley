import { describe, expect, it } from 'vitest'
import type { LogEntry, Message } from '../src/log'
import { narrate, recentEntries } from '../src/narrate'
import { knownPages, sameUrl } from '../src/web'

const entries = (...messages: Message[]): LogEntry[] => messages.map((m) => ({ ...m, at: 0 }) as LogEntry)
const result = (title: string, url: string) => ({ title, url, summary: '' })

describe('knownPages', () => {
  it('lists each page once, the latest lookup first and a search in its order', () => {
    const log = entries(
      { role: 'search', query: 'a', results: [result('One', 'https://one.test/'), result('Two', 'https://two.test')] },
      { role: 'read', url: 'https://www.one.test', title: 'One again' },
      { role: 'search', query: 'b', results: [], error: 'down' },
      { role: 'read', url: 'https://three.test', title: 'Three', error: 'blocked' },
    )
    expect(knownPages(log)).toEqual([
      { url: 'https://www.one.test', title: 'One again', latest: true },
      { url: 'https://two.test', title: 'Two', latest: false },
    ])
  })

  it('treats protocol, www, fragment and a trailing slash as the same page', () => {
    expect(sameUrl('https://www.a.test/x/#top', 'http://a.test/x')).toBe(true)
    expect(sameUrl('https://a.test/x', 'https://a.test/y')).toBe(false)
  })

  it('forgets pages the conversation no longer shows', () => {
    const log = entries(
      { role: 'user', content: 'first', utteranceId: 1 },
      { role: 'search', query: 'old', results: [result('Old', 'https://old.test')], utteranceId: 1 },
      { role: 'user', content: 'second', utteranceId: 2 },
      { role: 'search', query: 'new', results: [result('New', 'https://new.test')], utteranceId: 2 },
    )
    expect(knownPages(recentEntries(log, 1)).map((p) => p.title)).toEqual(['New'])
    expect(knownPages(recentEntries(log, 2)).map((p) => p.title)).toEqual(['New', 'Old'])
  })
})

describe('narrate lookups', () => {
  it('lists what a search found and names the page read, after the words they were for', () => {
    const screen = { id: 'home', title: 'Home', visible: true, markdown: '# Home', elements: [] }
    const log = entries(
      { role: 'user', content: 'who designed it', utteranceId: 1 },
      { role: 'search', query: 'Eiffel Tower designer', results: [{ title: 'Eiffel Tower', url: 'https://en.wikipedia.org/wiki/Eiffel_Tower', summary: 'Designed by the company of Gustave Eiffel.' }], utteranceId: 1 },
      { role: 'read', url: 'https://www.toureiffel.paris/en', title: 'Official site', utteranceId: 1 },
      { role: 'search', query: 'nothing', results: [], utteranceId: 1 },
      { role: 'said', content: "Gustave Eiffel's company." },
    )
    expect(narrate(log, screen).split('\n').slice(1, 7)).toEqual([
      'User: who designed it',
      'Stanley searched the web for "Eiffel Tower designer":',
      '- "Eiffel Tower" (en.wikipedia.org/wiki/Eiffel_Tower): Designed by the company of Gustave Eiffel.',
      'Stanley read "Official site" (toureiffel.paris/en).',
      'Stanley searched the web for "nothing": nothing found.',
      `Stanley said: "Gustave Eiffel's company."`,
    ])
  })
})
