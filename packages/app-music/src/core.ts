import { defineApp, type AgentNode } from '@stanley/app-sdk'

export interface Track {
  /** `j<jamendo id>`. */
  id: string
  title: string
  artist: string
  durationSec: number
  /** Stream URL (an MP3 on Jamendo). */
  audio: string
  /** Cover image URL. Until it loads (or if it fails) the UI draws a generated cover. */
  image: string
  album: string
  /** Creative Commons licence URL. */
  license: string
  /** The track's page on Jamendo. */
  url: string
}

export interface MusicState {
  /** The playlist. */
  tracks: Track[]
  /** The current track, always one of `tracks`. */
  currentId: string
  playing: boolean
}

/** A Creative Commons track on Jamendo. Its stream and cover need no API key. */
const jamendo = (id: number, album: number, title: string, artist: string, albumName: string, durationSec: number, license: string): Track => ({
  id: `j${id}`,
  title,
  artist,
  durationSec,
  audio: `https://prod-1.storage.jamendo.com/?trackid=${id}&format=mp32`,
  image: `https://usercontent.jamendo.com?type=album&id=${album}&width=300&trackid=${id}`,
  album: albumName,
  license: `http://creativecommons.org/licenses/${license}/`,
  url: `https://www.jamendo.com/track/${id}`,
})

/** The playlist: a dozen of Jamendo's all-time most popular tracks. */
export const playlist: Track[] = [
  jamendo(1214935, 145774, 'Wish You Were Here', 'The.madpix.project', 'Wish You Were Here', 270, 'by-nc-sa/3.0'),
  jamendo(1204669, 144705, 'What Is Love', 'Melanie Ungar', 'What Is Love', 212, 'by/3.0'),
  jamendo(1141572, 136930, 'Love Will Come Back Again', 'Chaz Robinson', 'Chaz Robinson', 236, 'by-sa/3.0'),
  jamendo(1157362, 138887, 'First', 'JekK', 'Dear Dreams', 204, 'by-nc-nd/3.0'),
  jamendo(1129271, 135310, 'Energy', 'Pokki DJ', 'Energy', 230, 'by/3.0'),
  jamendo(1165005, 140048, 'Boys, Girls, Toys & Words', 'Modern Pitch', 'Eye Of The Storm', 357, 'by-sa/3.0'),
  jamendo(1194315, 143735, 'Human Light', 'John Dada & the Weathermen', 'folK.itUp', 234, 'by-nc-nd/3.0'),
  jamendo(1215788, 145856, "We'll Light The Sky", 'Lyonn', "We'll Light The Sky", 168, 'by-nd/3.0'),
  jamendo(1122085, 134086, 'Sweet', 'Tamara Laurel', 'Lightning', 214, 'by-nc-nd/3.0'),
  jamendo(26736, 3661, "Struttin'", 'Tryad', 'Listen', 242, 'by-sa/2.5'),
  jamendo(354778, 46325, 'Skydiving (feat. Jasmine Kara)', 'Jonay', 'Skydiving', 247, 'by-sa/3.0'),
  jamendo(391002, 49216, 'Balrog Boogie', 'Diablo Swing Orchestra', "The Butcher's Ballroom", 233, 'by-nc-nd/3.0'),
]

/** The song list's section title. */
export const LIST_TITLE = 'Playlist'
/** Shown under the list: the tracks are Creative Commons, credited to their artists. */
export const CREDIT = 'Music from Jamendo'

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
  description: 'Music player: play, pause, skip tracks and pick a song from the playlist',

  init() {
    const tracks = structuredClone(playlist)
    return { tracks, currentId: tracks[0]!.id, playing: false }
  },

  current: () => 'player',

  nodes(s) {
    // As on screen: the transport buttons (named by their aria-labels), then the playlist.
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
      { id: 'songs', kind: 'group', label: LIST_TITLE, children: tracks },
    ]
  },

  async perform(s, nodeId) {
    const now = nowPlaying(s)
    const play = (t: Track) => ({ state: { ...s, currentId: t.id, playing: true }, summary: `Playing ${name(t)}` })

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

    const [, id] = nodeId.split('/')
    const track = s.tracks.find((t) => t.id === id)
    if (nodeId.startsWith('track/') && track) return play(track)
    return { state: s, summary: `Unknown action ${nodeId}` }
  },

  toMarkdown(s) {
    const now = nowPlaying(s)
    const head = `# Music\n${now ? `${s.playing ? 'Playing' : 'Paused'}: ${name(now)}` : 'Not playing'}`
    return `${head}\n\n${listMarkdown(s)}`
  },
})

export default musicApp
