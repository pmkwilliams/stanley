import { defineApp, type AgentNode } from '@stanley/app-sdk'

export interface Track {
  id: string
  title: string
  artist: string
  durationSec: number
  /** Asset key; the UI maps it to a bundled file URL (`assets/<src>.wav`). */
  src: string
}

export interface MusicState {
  tracks: Track[]
  currentId: string
  playing: boolean
  /** 0–1 */
  volume: number
}

const seed: Track[] = [
  { id: 'k1', title: 'Morning Light', artist: 'Juniper Trio', durationSec: 20, src: 'sunrise' },
  { id: 'k2', title: 'Slow Drift', artist: 'Harbor Lights', durationSec: 20, src: 'drift' },
  { id: 'k3', title: 'Night Pulse', artist: 'Neon Avenue', durationSec: 20, src: 'pulse' },
]

const STEP = 0.1

const pct = (v: number) => `${Math.round(v * 100)}%`
const name = (t: Track) => `"${t.title}" by ${t.artist}`
const clamp = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10) / 10

export const musicApp = defineApp<MusicState>({
  id: 'music',
  title: 'Music',
  description: 'Music player: play, pause, skip tracks and change volume',

  init: () => ({ tracks: structuredClone(seed), currentId: seed[0]!.id, playing: false, volume: 0.6 }),

  current: () => 'player',

  nodes(s) {
    // As on screen: the transport buttons (named by their aria-labels), then the track list.
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
      { id: 'volume-down', kind: 'action', label: 'Volume down', description: pct(s.volume) },
      { id: 'volume-up', kind: 'action', label: 'Volume up', description: pct(s.volume) },
      ...tracks,
    ]
  },

  async perform(s, nodeId) {
    const i = s.tracks.findIndex((t) => t.id === s.currentId)
    const skip = (by: number) => s.tracks[(i + by + s.tracks.length) % s.tracks.length]!

    if (nodeId === 'player') return { state: s, summary: 'Opened music player' }
    if (nodeId === 'toggle') {
      const now = s.tracks[i]
      return { state: { ...s, playing: !s.playing }, summary: `${s.playing ? 'Paused' : 'Playing'} ${now ? name(now) : 'music'}` }
    }
    if (nodeId === 'next' || nodeId === 'previous') {
      const t = skip(nodeId === 'next' ? 1 : -1)
      return { state: { ...s, currentId: t.id, playing: true }, summary: `Playing ${name(t)}` }
    }
    if (nodeId === 'volume-up' || nodeId === 'volume-down') {
      const volume = clamp(s.volume + (nodeId === 'volume-up' ? STEP : -STEP))
      return { state: { ...s, volume }, summary: `Volume ${pct(volume)}` }
    }

    const [, id] = nodeId.split('/')
    const track = s.tracks.find((t) => t.id === id)
    if (nodeId.startsWith('track/') && track) {
      return { state: { ...s, currentId: track.id, playing: true }, summary: `Playing ${name(track)}` }
    }
    return { state: s, summary: `Unknown action ${nodeId}` }
  },

  toMarkdown(s) {
    const now = s.tracks.find((t) => t.id === s.currentId)
    const list = s.tracks.map((t) => `- ${t.id === s.currentId ? '▶ ' : ''}${t.title} — ${t.artist} (${t.durationSec}s)`).join('\n')
    return `# Music\n${now ? `${s.playing ? 'Playing' : 'Paused'}: ${name(now)}` : 'Nothing selected'} · volume ${pct(s.volume)}\n\n${list}`
  },
})

export default musicApp
