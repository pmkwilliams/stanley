import { defineApp, type AgentNode, type AppContext } from '@stanley/app-sdk'

export interface Track {
  /** Bundled tracks are `k1`…; Jamendo tracks are `j<jamendo id>`. */
  id: string
  title: string
  artist: string
  durationSec: number
  /** Bundled asset key; the UI maps it to a bundled file URL (`assets/<src>.wav`). */
  src?: string
  /** Remote stream URL (an MP3 on Jamendo). Played instead of `src` when set. */
  audio?: string
  /** Cover image URL. Without one the UI draws a generated cover. */
  image?: string
  album?: string
  /** Creative Commons licence URL. */
  license?: string
  /** The track's page on Jamendo. */
  url?: string
}

/** What the song list holds: the bundled songs, this week's popular Jamendo tracks, or search results. */
export type Listing = 'songs' | 'popular' | 'results'

export interface MusicState {
  /** The song list on screen. */
  tracks: Track[]
  /**
   * What Previous and Next step through: the list the current track was picked from. A search
   * replaces `tracks` but not this, so the track playing keeps playing and skipping stays in its list.
   */
  queue: Track[]
  /** The current track, always one of `queue`. */
  currentId: string
  playing: boolean
  /** 0–1 */
  volume: number
  listing: Listing
  /** The search the results are for. */
  query: string | null
  /** Text typed in the search field, not yet searched. */
  box: string
  /** A catalogue to search is configured (`JAMENDO_CLIENT_ID`); without one there is no search field. */
  search: boolean
  /** True while a search is in flight; perform always resolves with it cleared. */
  loading: boolean
  error: string | null
}

const seed: Track[] = [
  { id: 'k1', title: 'Morning Light', artist: 'Juniper Trio', durationSec: 20, src: 'sunrise' },
  { id: 'k2', title: 'Slow Drift', artist: 'Harbor Lights', durationSec: 20, src: 'drift' },
  { id: 'k3', title: 'Night Pulse', artist: 'Neon Avenue', durationSec: 20, src: 'pulse' },
]

/** The search field's placeholder, which is its label. */
export const FIELD_LABEL = 'Search music'
/** Shown under a Jamendo list: the tracks are Creative Commons, credited to their artists. */
export const CREDIT = 'Music from Jamendo'
export const NO_RESULTS_TEXT = 'Try an artist, a song title or a genre.'

/** The song list's section title. */
export function listTitle(s: Pick<MusicState, 'listing' | 'query'>): string {
  if (s.listing === 'popular') return 'Popular this week'
  if (s.listing === 'results') return `Results for “${s.query ?? ''}”`
  return 'Songs'
}
export const noResultsTitle = (query: string | null) => `No results for “${query ?? ''}”`

/** The track in the hero and the status bar. */
export const nowPlaying = (s: Pick<MusicState, 'queue' | 'tracks' | 'currentId'>): Track | undefined =>
  s.queue.find((t) => t.id === s.currentId) ?? s.tracks.find((t) => t.id === s.currentId)

/** `200` → `3:20`, as shown on screen. */
export const time = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

const STEP = 0.1

const pct = (v: number) => `${Math.round(v * 100)}%`
const name = (t: Track) => `"${t.title}" by ${t.artist}`
const clamp = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10) / 10

// ── Jamendo ───────────────────────────────────────────────────────────────

const JAMENDO_URL = 'https://api.jamendo.com/v3.0/tracks/'
const LIMIT = '20'
const TIMEOUT_MS = 8000
const ATTEMPTS = 3
const RETRY_MS = 250

interface JamendoTrack {
  id?: string | number | null
  name?: string
  duration?: number | string
  artist_name?: string
  album_name?: string
  image?: string
  album_image?: string
  audio?: string
  shareurl?: string
  license_ccurl?: string
}

interface JamendoResponse {
  headers?: { status?: string; code?: number; error_message?: string }
  results?: JamendoTrack[]
}

/** Jamendo's text fields arrive HTML-escaped ("Angus &amp; Friends"). */
const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
export function unescapeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return entities[e.toLowerCase()] ?? m
  })
}
const clean = (text: string | undefined) => (text ? unescapeHtml(text).trim() : '')

/** A Jamendo track as ours. `null` when it has nothing to stream. */
export function fromJamendo(t: JamendoTrack): Track | null {
  const id = String(t.id ?? '').trim()
  if (!t.audio || !id) return null
  return {
    id: `j${id}`,
    title: clean(t.name) || 'Untitled',
    artist: clean(t.artist_name) || 'Unknown artist',
    durationSec: Math.max(0, Math.round(Number(t.duration) || 0)),
    audio: t.audio,
    image: t.image || t.album_image || undefined,
    album: clean(t.album_name) || undefined,
    license: t.license_ccurl || undefined,
    url: t.shareurl || undefined,
  }
}

/**
 * Tracks from Jamendo's catalogue. Throws a plain-words error on timeouts, HTTP and API failures.
 * Jamendo answers about a third of good requests with an empty list (seen live, 2026-10), so an empty
 * answer is asked again, up to three times in all; only then is it taken to mean "nothing found".
 */
async function jamendo(ctx: AppContext, clientId: string, params: Record<string, string>): Promise<Track[]> {
  for (let attempt = 1; ; attempt++) {
    const tracks = await jamendoOnce(ctx, clientId, params)
    if (tracks.length || attempt === ATTEMPTS) return tracks
    await new Promise((r) => setTimeout(r, RETRY_MS))
  }
}

async function jamendoOnce(ctx: AppContext, clientId: string, params: Record<string, string>): Promise<Track[]> {
  const query = new URLSearchParams({ client_id: clientId, format: 'json', limit: LIMIT, audioformat: 'mp32', imagesize: '300', ...params })
  let res: Response
  try {
    res = await ctx.fetch(`${JAMENDO_URL}?${query}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (err) {
    const name = (err as { name?: string } | null)?.name
    if (name === 'TimeoutError' || name === 'AbortError') throw new Error("Jamendo didn't respond in time")
    throw new Error("Couldn't reach Jamendo")
  }
  if (!res.ok) throw new Error(`Jamendo answered with HTTP ${res.status}`)
  let body: JamendoResponse
  try {
    body = (await res.json()) as JamendoResponse
  } catch {
    throw new Error('Jamendo sent an unreadable answer')
  }
  // Jamendo reports its own errors (e.g. a bad client id) inside a 200.
  if (body.headers?.status && body.headers.status !== 'success') throw new Error(body.headers.error_message || 'Jamendo refused the request')
  return (body.results ?? []).map(fromJamendo).filter((t): t is Track => t !== null)
}

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err))
const clientId = (ctx: AppContext) => ctx.env.JAMENDO_CLIENT_ID?.trim() || undefined

function listMarkdown(s: MusicState): string {
  if (!s.tracks.length) return `## ${listTitle(s)}\n**${noResultsTitle(s.query)}**\n${NO_RESULTS_TEXT}`
  const rows = s.tracks.map((t) => `- ${t.id === s.currentId ? '▶ ' : ''}${t.title} — ${t.artist} (${time(t.durationSec)})`).join('\n')
  return `## ${listTitle(s)}\n${rows}${s.listing === 'songs' ? '' : `\n\n${CREDIT}`}`
}

const bundled = (): MusicState => {
  const tracks = structuredClone(seed)
  return { tracks, queue: tracks, currentId: seed[0]!.id, playing: false, volume: 0.6, listing: 'songs', query: null, box: '', search: false, loading: false, error: null }
}

export const musicApp = defineApp<MusicState>({
  id: 'music',
  title: 'Music',
  description: 'Music player: play, pause, skip tracks, change volume and search for songs',

  async init(ctx) {
    const key = clientId(ctx)
    if (!key) return bundled()
    try {
      const tracks = await jamendo(ctx, key, { order: 'popularity_week' })
      if (!tracks.length) throw new Error('Jamendo sent no tracks')
      return { ...bundled(), tracks, queue: tracks, currentId: tracks[0]!.id, listing: 'popular', search: true }
    } catch (err) {
      return { ...bundled(), search: true, error: `Couldn't load music from Jamendo: ${reason(err)}` }
    }
  },

  current: () => 'player',

  nodes(s) {
    // As on screen: the search field (Enter searches), the transport and volume buttons (named by their
    // aria-labels), then the song list under its section title.
    const field: AgentNode[] = s.search
      ? [{
          id: 'search',
          kind: 'input',
          label: FIELD_LABEL,
          value: s.box,
          children: s.box ? [{ id: 'search/enter', kind: 'action', role: 'key', label: 'press Enter' }] : [],
        }]
      : []
    const tracks: AgentNode[] = s.tracks.map((t) => ({
      id: `track/${t.id}`,
      kind: 'action',
      label: `${t.title} — ${t.artist}`,
      description: t.id === s.currentId ? (s.playing ? 'playing' : 'paused') : undefined,
    }))
    return [
      ...field,
      { id: 'previous', kind: 'action', label: 'Previous' },
      { id: 'toggle', kind: 'action', label: s.playing ? 'Pause' : 'Play' },
      { id: 'next', kind: 'action', label: 'Next' },
      { id: 'volume-down', kind: 'action', label: 'Volume down', description: pct(s.volume) },
      { id: 'volume-up', kind: 'action', label: 'Volume up', description: pct(s.volume) },
      ...(tracks.length ? [{ id: 'songs', kind: 'group' as const, label: listTitle(s), children: tracks }] : []),
    ]
  },

  async perform(s, nodeId, args, ctx) {
    const now = nowPlaying(s)
    // Skipping steps through the list the current track came from; with none, the list on screen.
    const queue = now && s.queue.length ? s.queue : s.tracks
    const play = (t: Track, from: Track[]) => ({ state: { ...s, queue: from, currentId: t.id, playing: true }, summary: `Playing ${name(t)}` })

    if (nodeId === 'player') return { state: s, summary: 'Opened music player' }
    if (nodeId === 'toggle') {
      if (!now) return s.tracks[0] ? play(s.tracks[0], s.tracks) : { state: s, summary: 'Nothing to play' }
      return { state: { ...s, playing: !s.playing }, summary: `${s.playing ? 'Paused' : 'Playing'} ${name(now)}` }
    }
    if (nodeId === 'next' || nodeId === 'previous') {
      if (!queue.length) return { state: s, summary: 'Nothing to play' }
      const i = queue.findIndex((t) => t.id === s.currentId)
      const by = nodeId === 'next' ? 1 : -1
      const t = queue[i < 0 ? 0 : (i + by + queue.length) % queue.length]!
      return play(t, queue)
    }
    if (nodeId === 'volume-up' || nodeId === 'volume-down') {
      const volume = clamp(s.volume + (nodeId === 'volume-up' ? STEP : -STEP))
      return { state: { ...s, volume }, summary: `Volume ${pct(volume)}` }
    }

    if (nodeId === 'search') {
      const box = args.text?.trim() ?? ''
      return { state: { ...s, box }, summary: box ? `Typed "${box}" in the search field (not searched yet)` : 'Cleared the search field' }
    }
    if (nodeId === 'search/enter') {
      const query = s.box.trim()
      if (!query) return { state: s, summary: 'Search field is empty; nothing searched' }
      const key = clientId(ctx)
      if (!key) return { state: { ...s, box: '' }, summary: 'Search is unavailable' }
      try {
        const tracks = await jamendo(ctx, key, { search: query, boost: 'popularity_month' })
        const state: MusicState = { ...s, tracks, listing: 'results', query, box: '', loading: false, error: null }
        return {
          state,
          summary: tracks.length ? `Found ${tracks.length} songs for "${query}"` : `No results for "${query}"`,
          observation: listMarkdown(state),
        }
      } catch (err) {
        const error = `Search failed: ${reason(err)}`
        return { state: { ...s, box: '', loading: false, error }, summary: error }
      }
    }

    const [, id] = nodeId.split('/')
    const track = s.tracks.find((t) => t.id === id)
    if (nodeId.startsWith('track/') && track) return play(track, s.tracks)
    return { state: s, summary: `Unknown action ${nodeId}` }
  },

  toMarkdown(s) {
    const now = nowPlaying(s)
    const head = `# Music\n${now ? `${s.playing ? 'Playing' : 'Paused'}: ${name(now)}` : 'Not playing'} · volume ${pct(s.volume)}`
    const field = s.search ? `\n\n[${FIELD_LABEL}: ${s.box || 'empty'}]` : ''
    const error = s.error ? `\n\n_${s.error}_` : ''
    return `${head}${field}${error}\n\n${listMarkdown(s)}`
  },
})

export default musicApp
