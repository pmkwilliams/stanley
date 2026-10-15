import { defineApp, type AgentNode } from '@stanley/app-sdk'
import { playlist } from './playlist'

export interface Track {
  /** `s<soundcloud id>`. */
  id: string
  title: string
  artist: string
  durationSec: number
  /** The track's API URL, which SoundCloud's embedded player loads. */
  audio: string
  /** Cover image URL, or empty. Until it loads (or if it fails, or there is none) the UI draws a generated cover. */
  image: string
  album: string
  /** The track's page on SoundCloud. */
  url: string
}

export interface MusicState {
  /** The playlist. */
  tracks: Track[]
  /** The current track, always one of `tracks`. */
  currentId: string
  playing: boolean
  /** How loud the music plays, 0–100. Kept for the next session. */
  volume: number
}

export { playlist }

/** The song list's section title. */
export const LIST_TITLE = 'Playlist'
/** Shown under the list, crediting where the tracks come from. */
export const CREDIT = 'Music from SoundCloud'

/** How far Volume down and Volume up move it. */
export const VOLUME_STEP = 20
/** Where the volume is kept, so it outlasts a session. */
const VOLUME_KEY = 'musicVolume'

/** `40`, `40%`, `40 percent` → 40. */
function percent(text: string): number | undefined {
  const n = Number(text.match(/\d+(\.\d+)?/)?.[0])
  return Number.isFinite(n) && /\d/.test(text) ? Math.min(100, Math.max(0, Math.round(n))) : undefined
}

/**
 * How loud the player plays at `volume` (0–100), 0–1: on a square curve, as volume sliders are, so
 * each step sounds about as big as the last.
 */
export const gain = (volume: number) => (volume / 100) ** 2

/** The track in the hero and the status bar. */
export const nowPlaying = (s: Pick<MusicState, 'tracks' | 'currentId'>): Track | undefined => s.tracks.find((t) => t.id === s.currentId)

/** `200` → `3:20`, as shown on screen. */
export const time = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

const name = (t: Track) => `"${t.title}" by ${t.artist}`

function listMarkdown(s: MusicState): string {
  const rows = s.tracks.map((t) => `- ${t.id === s.currentId ? '▶ ' : ''}${t.title} — ${t.artist} (${time(t.durationSec)})`).join('\n')
  return `## ${LIST_TITLE}\n${rows}\n\n${CREDIT}`
}

export const musicApp = defineApp<MusicState>({
  id: 'music',
  title: 'Music',
  description: 'Music player: play, pause, skip tracks, pick a song from the playlist and set the volume',

  init(ctx) {
    const tracks = structuredClone(playlist)
    const saved = ctx.store?.get(VOLUME_KEY)
    return { tracks, currentId: tracks[0]!.id, playing: false, volume: typeof saved === 'number' ? saved : 100 }
  },

  current: () => 'player',

  nodes(s) {
    // As on screen: the transport buttons (named by their aria-labels), the volume, then the playlist.
    const tracks: AgentNode[] = s.tracks.map((t) => ({
      id: `track/${t.id}`,
      kind: 'action',
      label: `${t.title} — ${t.artist}`,
      description: t.id === s.currentId ? (s.playing ? 'playing' : 'paused') : undefined,
    }))
    return [
      { id: 'previous', kind: 'action', label: 'Previous' },
      { id: 'toggle', kind: 'action', label: s.playing ? 'Pause' : 'Play' },
      { id: 'next', kind: 'action', label: 'Next' },
      { id: 'volume-down', kind: 'action', label: 'Volume down' },
      { id: 'volume', kind: 'input', role: 'slider', label: 'Volume', value: `${s.volume}%` },
      { id: 'volume-up', kind: 'action', label: 'Volume up' },
      { id: 'songs', kind: 'group', label: LIST_TITLE, children: tracks },
    ]
  },

  async perform(s, nodeId, args, ctx) {
    const now = nowPlaying(s)
    const play = (t: Track) => ({ state: { ...s, currentId: t.id, playing: true }, summary: `Playing ${name(t)}` })
    const setVolume = (volume: number, summary: string) => {
      ctx.store?.set(VOLUME_KEY, volume)
      return { state: { ...s, volume }, summary }
    }

    if (nodeId === 'player') return { state: s, summary: 'Opened music player' }
    if (nodeId === 'toggle') {
      if (!now) return s.tracks[0] ? play(s.tracks[0]) : { state: s, summary: 'Nothing to play' }
      return { state: { ...s, playing: !s.playing }, summary: `${s.playing ? 'Paused' : 'Playing'} ${name(now)}` }
    }
    if (nodeId === 'next' || nodeId === 'previous') {
      if (!s.tracks.length) return { state: s, summary: 'Nothing to play' }
      const i = s.tracks.findIndex((t) => t.id === s.currentId)
      const by = nodeId === 'next' ? 1 : -1
      return play(s.tracks[i < 0 ? 0 : (i + by + s.tracks.length) % s.tracks.length]!)
    }

    if (nodeId === 'volume') {
      const volume = percent(args.text ?? '')
      if (volume === undefined) return { state: s, summary: `Volume takes a percentage, not "${args.text ?? ''}"` }
      return setVolume(volume, volume ? `Set the music's volume to ${volume}%` : 'Turned the music all the way down')
    }
    if (nodeId === 'volume-down') {
      if (s.volume === 0) return { state: s, summary: 'The music is already all the way down' }
      const volume = Math.max(0, s.volume - VOLUME_STEP)
      return setVolume(volume, volume ? `Turned the music down to ${volume}%` : 'Turned the music all the way down')
    }
    if (nodeId === 'volume-up') {
      if (s.volume === 100) return { state: s, summary: 'The music is already at full volume' }
      const volume = Math.min(100, s.volume + VOLUME_STEP)
      return setVolume(volume, `Turned the music up to ${volume}%`)
    }

    const [, id] = nodeId.split('/')
    const track = s.tracks.find((t) => t.id === id)
    if (nodeId.startsWith('track/') && track) return play(track)
    return { state: s, summary: `Unknown action ${nodeId}` }
  },

  toMarkdown(s) {
    const now = nowPlaying(s)
    const head = `# Music\n${now ? `${s.playing ? 'Playing' : 'Paused'}: ${name(now)}` : 'Not playing'}\nVolume: ${s.volume}%`
    return `${head}\n\n${listMarkdown(s)}`
  },
})

export default musicApp
