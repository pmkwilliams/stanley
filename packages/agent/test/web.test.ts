import { describe, expect, it } from 'vitest'
import { recentEntries } from '../src/conversation'
import { narrate } from '../src/narrate'
import { knownPages, sameUrl } from '../src/web'
import { recorder } from './history'

const result = (title: string, url: string) => ({ title, url, excerpt: '' })

describe('knownPages', () => {
  it('lists each page once, the latest lookup first and a search in its order', () => {
    const r = recorder()
    r.lookup({ kind: 'search', query: 'a', results: [result('One', 'https://one.test/'), result('Two', 'https://two.test')] })
    r.lookup({ kind: 'read', url: 'https://www.one.test', title: 'One again' })
    r.lookup({ kind: 'search', query: 'b', results: [], error: 'down' })
    r.lookup({ kind: 'read', url: 'https://three.test', title: 'Three', error: 'blocked' })
    expect(knownPages(r.h.view())).toEqual([
      { url: 'https://www.one.test', title: 'One again', latest: true },
      { url: 'https://two.test', title: 'Two', latest: false },
    ])
  })

  it('treats protocol, www, fragment and a trailing slash as the same page', () => {
    expect(sameUrl('https://www.a.test/x/#top', 'http://a.test/x')).toBe(true)
    expect(sameUrl('https://a.test/x', 'https://a.test/y')).toBe(false)
  })

  it('forgets pages the conversation no longer shows', () => {
    const r = recorder()
    r.words(1, 'first')
    r.lookup({ kind: 'search', query: 'old', results: [result('Old', 'https://old.test')], utteranceId: 1 })
    r.h.begin()
    r.words(2, 'second')
    r.lookup({ kind: 'search', query: 'new', results: [result('New', 'https://new.test')], utteranceId: 2 })
    expect(knownPages(recentEntries(r.h.view(), 1)).map((p) => p.title)).toEqual(['New'])
    expect(knownPages(recentEntries(r.h.view(), 2)).map((p) => p.title)).toEqual(['New', 'Old'])
  })
})

describe('narrate lookups', () => {
  it('lists what a search found and names the page read, after the words they were for', () => {
    const screen = { id: 'home', title: 'Home', visible: true, markdown: '# Home', elements: [] }
    const r = recorder()
    r.words(1, 'who designed it')
    r.lookup({
      kind: 'search',
      query: 'Eiffel Tower designer',
      results: [{ title: 'Eiffel Tower', url: 'https://en.wikipedia.org/wiki/Eiffel_Tower', excerpt: 'Designed by the company of   Gustave Eiffel.' }],
      utteranceId: 1,
    })
    r.lookup({ kind: 'read', url: 'https://www.toureiffel.paris/en', title: 'Official site', utteranceId: 1 })
    r.lookup({ kind: 'search', query: 'nothing', results: [], utteranceId: 1 })
    r.said("Gustave Eiffel's company.")
    expect(narrate(r.h.view(), screen).split('\n').slice(1, 7)).toEqual([
      'User: who designed it',
      'Stanley searched the web for "Eiffel Tower designer":',
      '- "Eiffel Tower" (en.wikipedia.org/wiki/Eiffel_Tower): Designed by the company of Gustave Eiffel.',
      'Stanley read "Official site" (toureiffel.paris/en).',
      'Stanley searched the web for "nothing": nothing found.',
      `Stanley said: "Gustave Eiffel's company."`,
    ])
  })

  it('cuts a long excerpt to a line', () => {
    const r = recorder()
    r.lookup({ kind: 'search', query: 'q', results: [result('Long', 'https://long.test')].map((p) => ({ ...p, excerpt: 'word '.repeat(60) })) })
    const line = narrate(r.h.view(), null).split('\n')[2]!
    expect(line.length).toBeLessThan(140)
    expect(line.endsWith('…')).toBe(true)
  })
})
