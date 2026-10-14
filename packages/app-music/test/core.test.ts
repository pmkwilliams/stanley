import type { AppContext } from '@stanley/app-sdk'
import { describe, expect, it, vi } from 'vitest'
import { musicApp, nowPlaying, playlist, type MusicState } from '../src/core'

const fetch = vi.fn() as unknown as typeof globalThis.fetch
const ctx: AppContext = { env: {}, fetch }

async function run(s: MusicState, ...steps: string[]) {
  for (const nodeId of steps) s = (await musicApp.perform(s, nodeId, {}, ctx)).state
  return s
}

const nodeIds = (s: MusicState) => {
  const out: string[] = []
  const visit = (ns: ReturnType<typeof musicApp.nodes>) => ns.forEach((n) => (out.push(n.id), n.children && visit(n.children)))
  visit(musicApp.nodes(s))
  return out
}

describe('music', () => {
  it('starts paused on the first of sixteen hard-coded tracks, without touching the network', async () => {
    const s = await musicApp.init(ctx)
    expect(s.tracks).toHaveLength(16)
    expect(s.tracks).toEqual(playlist)
    expect(s).toMatchObject({ currentId: playlist[0]!.id, playing: false })
    expect(fetch).not.toHaveBeenCalled()
    expect(nodeIds(s)).toEqual(['previous', 'toggle', 'next', 'songs', ...playlist.map((t) => `track/${t.id}`)])
    expect(musicApp.toMarkdown(s)).toContain('## Playlist\n- ▶ Sad Robot — Pornophonique (5:12)')
    expect(musicApp.toMarkdown(s)).toContain('Music from Jamendo and SoundCloud')
  })

  it('has no search', async () => {
    const s = await musicApp.init(ctx)
    expect(nodeIds(s)).not.toContain('search')
    expect((await musicApp.perform(s, 'search/enter', {}, ctx)).summary).toBe('Unknown action search/enter')
  })

  it('a dozen tracks stream from Jamendo with a cover and a licence, then four play from SoundCloud', () => {
    expect(new Set(playlist.map((t) => t.id)).size).toBe(16)
    expect(playlist.map((t) => t.source)).toEqual([...Array(12).fill('jamendo'), ...Array(4).fill('soundcloud')])
    for (const t of playlist.filter((t) => t.source === 'jamendo')) {
      expect(t.id).toMatch(/^j\d+$/)
      expect(t.audio).toMatch(/^https:\/\/prod-1\.storage\.jamendo\.com\/\?trackid=\d+&format=mp32$/)
      expect(t.image).toMatch(/^https:\/\/usercontent\.jamendo\.com\?/)
      expect(t.license).toMatch(/^http:\/\/creativecommons\.org\/licenses\//)
    }
    for (const t of playlist.filter((t) => t.source === 'soundcloud')) {
      expect(t.audio).toBe(`https://api.soundcloud.com/tracks/${t.id.slice(1)}`)
      expect(t.image).toMatch(/^https:\/\/i1\.sndcdn\.com\/artworks-.+-t500x500\.jpg$/)
      expect(t.url).toMatch(/^https:\/\/soundcloud\.com\/[\w-]+\/[\w-]+$/)
    }
  })

  it('plays, skips and wraps around', async () => {
    let s = await run(await musicApp.init(ctx), 'toggle')
    expect(s.playing).toBe(true)
    s = await run(s, 'previous')
    expect(s.currentId).toBe(playlist.at(-1)!.id)
    s = await run(s, 'next', 'next')
    expect(s.currentId).toBe(playlist[1]!.id)
    s = await run(s, `track/${playlist[7]!.id}`)
    expect(s).toMatchObject({ currentId: playlist[7]!.id, playing: true })
    expect(nowPlaying(s)?.title).toBe('A Dive Bar off Main Street')
    expect(musicApp.nodes(s).find((n) => n.id === 'songs')?.children?.[7]).toMatchObject({ description: 'playing' })
  })

})
