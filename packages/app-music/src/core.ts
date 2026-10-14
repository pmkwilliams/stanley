import { defineApp, type AgentNode } from '@stanley/app-sdk'

export interface Track {
  /** `j<jamendo id>` or `s<soundcloud id>`. */
  id: string
  title: string
  artist: string
  durationSec: number
  /** How it plays: an MP3 in an `<audio>` element, or SoundCloud's embedded player. */
  source: 'jamendo' | 'soundcloud'
  /** For Jamendo, the MP3's URL; for SoundCloud, the track's API URL, which its player loads. */
  audio: string
  /** Cover image URL. Until it loads (or if it fails) the UI draws a generated cover. */
  image: string
  album: string
  /** Creative Commons licence URL, on Jamendo. SoundCloud tracks are the uploader's, all rights reserved. */
  license?: string
  /** The track's page on Jamendo or SoundCloud. */
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
  source: 'jamendo',
  audio: `https://prod-1.storage.jamendo.com/?trackid=${id}&format=mp32`,
  image: `https://usercontent.jamendo.com?type=album&id=${album}&width=300&trackid=${id}`,
  album: albumName,
  license: `http://creativecommons.org/licenses/${license}/`,
  url: `https://www.jamendo.com/track/${id}`,
})

/**
 * A track on SoundCloud, played through its embedded player (the widget), which needs no API key.
 * Only tracks whose uploader allows embedding everywhere, and that stream in full, belong here.
 */
const soundcloud = (id: number, path: string, artwork: string, title: string, artist: string, albumName: string, durationSec: number): Track => ({
  id: `s${id}`,
  title,
  artist,
  durationSec,
  source: 'soundcloud',
  audio: `https://api.soundcloud.com/tracks/${id}`,
  image: `https://i1.sndcdn.com/artworks-${artwork}-t500x500.jpg`,
  album: albumName,
  url: `https://soundcloud.com/${path}`,
})

/** The playlist: a dozen distinctive Creative Commons tracks, one per style, then a few from SoundCloud. */
export const playlist: Track[] = [
  jamendo(81740, 7505, 'Sad Robot', 'Pornophonique', '8-bit Lagerfeuer', 312, 'by-nc-nd/3.0'),
  jamendo(391002, 49216, 'Balrog Boogie', 'Diablo Swing Orchestra', "The Butcher's Ballroom", 233, 'by-nc-nd/3.0'),
  jamendo(1135700, 136365, 'Falcon 69', 'The Easton Ellises', 'Nightwavs', 224, 'by-nc-sa/3.0'),
  jamendo(30058, 3798, 'Making Me Nervous', 'Brad Sucks', "I Don't Know What I'm Doing", 159, 'by-nc-sa/3.0'),
  jamendo(885167, 104082, 'Swinging Shapes', 'Revolution Void', 'Like a Secret Dream', 304, 'by-nc-nd/3.0'),
  jamendo(1240697, 148689, 'Coffee', 'Professor Kliq', '28 Days With The OP-1', 196, 'by-nc-sa/3.0'),
  jamendo(26736, 3661, "Struttin'", 'Tryad', 'Listen', 242, 'by-sa/3.0'),
  jamendo(576435, 66456, 'A Dive Bar off Main Street', 'Monk Turner', 'Coordinates', 227, 'by-nc-nd/3.0'),
  jamendo(162041, 23755, 'Good to Go', 'Josh Woodward', 'The Simple Life', 189, 'by/3.0'),
  jamendo(29862, 3777, 'Deep Blue', 'Antony Raijekov', 'Jazz U', 202, 'by-nc-nd/3.0'),
  jamendo(868293, 101801, 'Eleven 11', 'Kellee Maize', 'Integration', 238, 'by-sa/3.0'),
  jamendo(1687406, 187872, 'Unframed Toaster', 'Ehma', 'Framed by Frames', 165, 'by/3.0'),
  soundcloud(293, 'forss/flickermood', '000067273316-smsiqx', 'Flickermood', 'Forss', 'Soulhack', 214),
  soundcloud(291313240, 'bonobo/kerala', 'nd5do3eR82sw-0', 'Kerala', 'Bonobo', 'Migration', 238),
  soundcloud(298851207, 'tycho/awake', 'VEsr8icpGzsm-0', 'Awake', 'Tycho', 'Awake', 284),
  soundcloud(341471474, 'odesza/a-moment-apart', 'nU2mhziz3vmX-0', 'A Moment Apart', 'ODESZA', 'A Moment Apart', 234),
]

/** The song list's section title. */
export const LIST_TITLE = 'Playlist'
/** Shown under the list, crediting where the tracks come from. */
export const CREDIT = 'Music from Jamendo and SoundCloud'

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
