import type { AppContext } from '@stanley/app-sdk'
import { describe, expect, it, vi } from 'vitest'
import { fromJamendo, musicApp, nowPlaying, type MusicState } from '../src/core'

const jt = (id: number, name: string, artist = 'Artist') => ({
  id: String(id),
  name,
  duration: 200 + id,
  artist_name: artist,
  album_name: 'Album',
  image: `https://usercontent.jamendo.com?type=album&id=${id}&width=400`,
  album_image: '',
  audio: `https://prod-1.storage.jamendo.com/?trackid=${id}&format=mp32`,
  shareurl: `https://www.jamendo.com/track/${id}`,
  license_ccurl: 'http://creativecommons.org/licenses/by-sa/3.0/',
})

const ok = (results: unknown[]) =>
  new Response(JSON.stringify({ headers: { status: 'success', code: 0, error_message: '', warnings: '', results_count: results.length }, results }))

const popular = [jt(101, 'Weekly One'), jt(102, 'Weekly Two'), jt(103, 'Weekly Three')]
const jazz = [jt(201, 'Blue Hour', 'Sax Club'), jt(202, 'Late Set', 'Sax Club')]

/** A ctx whose fetch answers from `route(url)`; records every URL asked for. */
function context(route: (url: URL) => Response | Promise<Response>, env: Record<string, string> = { JAMENDO_CLIENT_ID: 'test-id' }) {
  const urls: URL[] = []
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input))
    urls.push(url)
    return route(url)
  }) as unknown as typeof globalThis.fetch
  return { ctx: { env, fetch } satisfies AppContext, urls }
}

const catalogue = (url: URL) => ok(url.searchParams.get('search') === 'jazz' ? jazz : url.searchParams.has('search') ? [] : popular)

async function run(s: MusicState, ctx: AppContext, ...steps: [string, string?][]) {
  for (const [nodeId, text] of steps) s = (await musicApp.perform(s, nodeId, text === undefined ? {} : { text }, ctx)).state
  return s
}

const ids = (s: MusicState) => s.tracks.map((t) => t.id)
const nodeIds = (s: MusicState) => {
  const out: string[] = []
  const visit = (ns: ReturnType<typeof musicApp.nodes>) => ns.forEach((n) => (out.push(n.id), n.children && visit(n.children)))
  visit(musicApp.nodes(s))
  return out
}

describe('music without a Jamendo key', () => {
  it('starts with the three bundled tracks, no search and no network', async () => {
    const { ctx, urls } = context(() => ok([]), {})
    const s = await musicApp.init(ctx)
    expect(ids(s)).toEqual(['k1', 'k2', 'k3'])
    expect(s).toMatchObject({ currentId: 'k1', playing: false, search: false, listing: 'songs', error: null })
    expect(urls).toEqual([])
    expect(nodeIds(s)).toEqual(['previous', 'toggle', 'next', 'volume-down', 'volume-up', 'songs', 'track/k1', 'track/k2', 'track/k3'])
    expect(musicApp.toMarkdown(s)).toContain('## Songs\n- ▶ Morning Light — Juniper Trio (0:20)')
    expect(musicApp.toMarkdown(s)).not.toContain('Jamendo')
  })

  it('plays, skips and wraps around as before', async () => {
    const { ctx } = context(() => ok([]), {})
    let s = await musicApp.init(ctx)
    s = await run(s, ctx, ['toggle'])
    expect(s.playing).toBe(true)
    s = await run(s, ctx, ['next'], ['next'], ['next'])
    expect(s.currentId).toBe('k1')
    s = await run(s, ctx, ['previous'])
    expect(s.currentId).toBe('k3')
    s = await run(s, ctx, ['track/k2'])
    expect(s).toMatchObject({ currentId: 'k2', playing: true })
  })
})

describe('music with a Jamendo key', () => {
  it('loads this week’s popular tracks with namespaced ids', async () => {
    const { ctx, urls } = context(catalogue)
    const s = await musicApp.init(ctx)
    expect(urls).toHaveLength(1)
    expect(urls[0]!.origin + urls[0]!.pathname).toBe('https://api.jamendo.com/v3.0/tracks/')
    expect(Object.fromEntries(urls[0]!.searchParams)).toMatchObject({ client_id: 'test-id', format: 'json', order: 'popularity_week', audioformat: 'mp32' })
    expect(ids(s)).toEqual(['j101', 'j102', 'j103'])
    expect(s).toMatchObject({ currentId: 'j101', listing: 'popular', search: true, error: null })
    expect(s.tracks[0]).toMatchObject({ title: 'Weekly One', artist: 'Artist', durationSec: 301, audio: expect.stringContaining('trackid=101'), image: expect.stringContaining('id=101') })
    expect(musicApp.toMarkdown(s)).toContain('## Popular this week\n- ▶ Weekly One — Artist (5:01)')
    expect(musicApp.toMarkdown(s)).toContain('Music from Jamendo')
  })

  it('falls back to the bundled tracks with an error when Jamendo fails', async () => {
    for (const fail of [
      () => Promise.reject(new TypeError('fetch failed')),
      () => Promise.reject(new DOMException('timed out', 'TimeoutError')),
      () => new Response('nope', { status: 503 }),
      () => new Response(JSON.stringify({ headers: { status: 'failed', code: 5, error_message: 'Invalid client id' }, results: [] })),
      () => new Response('<html>'),
    ]) {
      const { ctx } = context(fail)
      const s = await musicApp.init(ctx)
      expect(ids(s)).toEqual(['k1', 'k2', 'k3'])
      expect(s.search).toBe(true)
      expect(s.error).toMatch(/^Couldn't load music from Jamendo: /)
    }
    const { ctx } = context(() => Promise.reject(new DOMException('timed out', 'TimeoutError')))
    expect((await musicApp.init(ctx)).error).toContain("didn't respond in time")
  })

  it('searches from the field and Enter, keeping the track that is playing', async () => {
    const { ctx, urls } = context(catalogue)
    let s = await run(await musicApp.init(ctx), ctx, ['toggle'], ['search', 'jazz'])
    expect(musicApp.nodes(s)[0]).toMatchObject({ id: 'search', kind: 'input', label: 'Search music', value: 'jazz', children: [{ id: 'search/enter', label: 'press Enter' }] })
    const result = await musicApp.perform(s, 'search/enter', {}, ctx)
    s = result.state
    expect(urls.at(-1)!.searchParams.get('search')).toBe('jazz')
    expect(ids(s)).toEqual(['j201', 'j202'])
    expect(s).toMatchObject({ listing: 'results', query: 'jazz', box: '', loading: false, error: null, playing: true, currentId: 'j101' })
    expect(nowPlaying(s)?.title).toBe('Weekly One')
    expect(result.observation).toContain('## Results for “jazz”\n- Blue Hour — Sax Club')
    expect(musicApp.nodes(s).find((n) => n.id === 'songs')?.label).toBe('Results for “jazz”')
    expect(musicApp.toMarkdown(s)).toContain('Playing: "Weekly One" by Artist')
    // Skipping without picking a result stays in the list the track came from.
    s = await run(s, ctx, ['next'])
    expect(nowPlaying(s)?.title).toBe('Weekly Two')
  })

  it('plays a result, then skips through the results', async () => {
    const { ctx } = context(catalogue)
    let s = await run(await musicApp.init(ctx), ctx, ['search', 'jazz'], ['search/enter'], ['track/j201'])
    expect(s).toMatchObject({ currentId: 'j201', playing: true })
    expect(musicApp.nodes(s).find((n) => n.id === 'songs')?.children?.[0]).toMatchObject({ id: 'track/j201', label: 'Blue Hour — Sax Club', description: 'playing' })
    s = await run(s, ctx, ['next'])
    expect(s.currentId).toBe('j202')
    s = await run(s, ctx, ['next'])
    expect(s.currentId).toBe('j201')
    s = await run(s, ctx, ['previous'])
    expect(s.currentId).toBe('j202')
  })

  it('shows no results as an empty list', async () => {
    const { ctx } = context(catalogue)
    const s = await run(await musicApp.init(ctx), ctx, ['search', 'zzzz'], ['search/enter'])
    expect(s.tracks).toEqual([])
    expect(s.currentId).toBe('j101')
    expect(nodeIds(s)).not.toContain('songs')
    expect(musicApp.toMarkdown(s)).toContain('No results for “zzzz”')
  })

  it('keeps the list and reports an error when a search fails', async () => {
    let down = false
    const { ctx } = context((url) => (down ? Promise.reject(new TypeError('fetch failed')) : catalogue(url)))
    let s = await musicApp.init(ctx)
    down = true
    const result = await musicApp.perform(await run(s, ctx, ['search', 'jazz']), 'search/enter', {}, ctx)
    s = result.state
    expect(ids(s)).toEqual(['j101', 'j102', 'j103'])
    expect(s).toMatchObject({ listing: 'popular', box: '', loading: false, error: "Search failed: Couldn't reach Jamendo" })
    expect(result.summary).toBe("Search failed: Couldn't reach Jamendo")
    expect(musicApp.toMarkdown(s)).toContain("_Search failed: Couldn't reach Jamendo_")
    // A later search that works clears the error.
    down = false
    s = await run(s, ctx, ['search', 'jazz'], ['search/enter'])
    expect(s.error).toBeNull()
  })

  it('does nothing on Enter with an empty field', async () => {
    const { ctx, urls } = context(catalogue)
    const s = await musicApp.init(ctx)
    const r = await musicApp.perform(s, 'search/enter', {}, ctx)
    expect(r.state).toBe(s)
    expect(urls).toHaveLength(1)
  })
})

describe('fromJamendo', () => {
  it('namespaces ids stably and skips tracks with nothing to stream', () => {
    expect(fromJamendo(jt(7, 'A'))?.id).toBe('j7')
    expect(fromJamendo({ ...jt(7, 'A'), id: 7 })?.id).toBe('j7')
    expect(fromJamendo({ ...jt(8, 'B'), audio: '' })).toBeNull()
    expect(fromJamendo({ ...jt(9, 'C'), image: '', album_image: 'https://x.test/a.jpg' })?.image).toBe('https://x.test/a.jpg')
  })
})

describe('Jamendo text', () => {
  it('unescapes HTML entities in names', () => {
    const t = fromJamendo({ id: '1', name: 'Rock &amp; Roll &#8211; Live', artist_name: 'Angus &amp; Friends', audio: 'https://prod-1.storage.jamendo.com/x' })
    expect(t?.title).toBe('Rock & Roll – Live')
    expect(t?.artist).toBe('Angus & Friends')
  })
})
