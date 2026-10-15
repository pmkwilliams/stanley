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
  it('starts paused on the first of the hard-coded tracks, without touching the network', async () => {
    const s = await musicApp.init(ctx)
    expect(s.tracks).toHaveLength(12)
    expect(s.tracks).toEqual(playlist)
    expect(s).toMatchObject({ currentId: playlist[0]!.id, playing: false })
    expect(fetch).not.toHaveBeenCalled()
    expect(nodeIds(s)).toEqual(['previous', 'toggle', 'next', 'songs', ...playlist.map((t) => `track/${t.id}`)])
    expect(musicApp.toMarkdown(s)).toContain('## Playlist\n- ▶ Hallucinogens — Konteks (1:54)')
    expect(musicApp.toMarkdown(s)).toContain('Music from SoundCloud')
  })

  it('has no search', async () => {
    const s = await musicApp.init(ctx)
    expect(nodeIds(s)).not.toContain('search')
    expect((await musicApp.perform(s, 'search/enter', {}, ctx)).summary).toBe('Unknown action search/enter')
  })

  it('every track plays from SoundCloud, with its page and, mostly, a cover', () => {
    expect(new Set(playlist.map((t) => t.id)).size).toBe(playlist.length)
    for (const t of playlist) {
      expect(t.audio).toBe(`https://api.soundcloud.com/tracks/${t.id.slice(1)}`)
      expect(t.image).toMatch(/^(https:\/\/i1\.sndcdn\.com\/(artworks|avatars)-[\w-]+-t500x500\.(jpg|png))?$/)
      expect(t.url).toMatch(/^https:\/\/soundcloud\.com\/[\w-]+\/[\w-]+$/)
      expect(t.title && t.artist && t.album).toBeTruthy()
      expect(t.durationSec).toBeGreaterThan(30)
    }
  })

  it('plays, skips and wraps around', async () => {
    let s = await run(await musicApp.init(ctx), 'toggle')
    expect(s.playing).toBe(true)
    s = await run(s, 'previous')
    expect(s.currentId).toBe(playlist.at(-1)!.id)
    s = await run(s, 'next', 'next')
    expect(s.currentId).toBe(playlist[1]!.id)
    s = await run(s, `track/${playlist[9]!.id}`)
    expect(s).toMatchObject({ currentId: playlist[9]!.id, playing: true })
    expect(nowPlaying(s)?.title).toBe('Blink Twice')
    expect(musicApp.nodes(s).find((n) => n.id === 'songs')?.children?.[9]).toMatchObject({ description: 'playing' })
  })

})
