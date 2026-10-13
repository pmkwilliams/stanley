import { DEFAULT_AGENT_NAME, defineApp, type AgentNode, type AppContext } from '@stanley/app-sdk'

export interface ForecastDay {
  /** `YYYY-MM-DD` in the location's timezone */
  date: string
  high: number
  low: number
  code: number
}

export interface WeatherResult {
  /** e.g. `Denver, Colorado, United States` */
  place: string
  /** Local time of the observation, `YYYY-MM-DDTHH:MM` */
  time: string
  temperature: number
  /** Apparent temperature: wind and humidity included. */
  feelsLike: number
  windSpeed: number
  code: number
  days: ForecastDay[]
  /** Found from the user's own location rather than by name. */
  here?: boolean
}

export interface WeatherState {
  /** `home` or `day/<n>` */
  route: string
  /** Last place the user asked for, even if the lookup failed. */
  query: string | null
  result: WeatherResult | null
  /** True while a lookup is in flight; perform always resolves with it cleared. */
  loading: boolean
  error: string | null
  /** Text typed in the city box, not yet looked up. */
  box: string
}

/** The search field's placeholder, which is its label. */
const FIELD_LABEL = 'Search for a city'
export const HERE_LABEL = 'Current location'

/** The empty state, before any city is looked up. */
export const EMPTY_TITLE = 'No forecast yet'
export const emptyText = (agentName: string) => `Search for a city, or ask ${agentName} about the weather anywhere.`

/** The forecast list's title. */
export const FORECAST_TITLE = 'Extended forecast'

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
/** IP geolocation: no key, no permission prompt, city-level. */
const LOCATE_URL = 'https://ipwho.is/'
/** Opening the app waits for the current location's forecast; give up on it after this. */
const LOCATE_TIMEOUT_MS = 5000

/** WMO weather interpretation codes, as used by Open-Meteo. */
const wmo: Record<number, string> = {
  0: 'clear sky',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'freezing fog',
  51: 'light drizzle',
  53: 'drizzle',
  55: 'heavy drizzle',
  56: 'light freezing drizzle',
  57: 'freezing drizzle',
  61: 'light rain',
  63: 'rain',
  65: 'heavy rain',
  66: 'light freezing rain',
  67: 'freezing rain',
  71: 'light snow',
  73: 'snow',
  75: 'heavy snow',
  77: 'snow grains',
  80: 'light rain showers',
  81: 'rain showers',
  82: 'violent rain showers',
  85: 'light snow showers',
  86: 'heavy snow showers',
  95: 'thunderstorm',
  96: 'thunderstorm with light hail',
  99: 'thunderstorm with heavy hail',
}

export const describeCode = (code: number): string => wmo[code] ?? 'unknown conditions'

/** As shown on screen: `partly cloudy` → `Partly cloudy`. */
export const conditionLabel = (code: number): string => {
  const d = describeCode(code)
  return d[0]!.toUpperCase() + d.slice(1)
}

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-10-10` → `Saturday Oct 10`. Parsed as UTC noon so the host timezone can't shift the day. */
export function dayName(date: string): string {
  const d = new Date(`${date}T12:00:00Z`)
  return `${weekdays[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/** `2026-10-14` → `Wed`: the forecast row's label. */
export const shortDay = (date: string): string => dayName(date).slice(0, 3)

/** The card's date line. */
export const TODAY_LABEL = 'Today'

/** `Denver, Colorado, United States` → `{ city: 'Denver', region: 'Colorado, United States' }` */
export function splitPlace(place: string): { city: string; region: string } {
  const [city = place, ...rest] = place.split(', ')
  return { city, region: rest.join(', ') }
}

/** A temperature as shown on screen: `18°`, `−1°` (a true minus sign). */
export const temp = (n: number) => `${Math.round(n)}°`.replace('-', '\u2212')

const deg = (n: number) => `${Math.round(n)}°C`

const dayLine = (d: ForecastDay) => `${dayName(d.date)}: ${describeCode(d.code)}, high ${deg(d.high)}, low ${deg(d.low)}`

function resultMarkdown(r: WeatherResult): string {
  const now = `${r.here ? `${HERE_LABEL}\n` : ''}Now: ${deg(r.temperature)} (feels like ${deg(r.feelsLike)}), ${describeCode(r.code)}, wind ${Math.round(r.windSpeed)} km/h`
  return `# Weather in ${r.place}\n${now}\n\n## ${FORECAST_TITLE}\n${r.days.map((d) => `- ${dayLine(d)}`).join('\n')}`
}

interface GeocodeResponse {
  results?: { name: string; latitude: number; longitude: number; country?: string; admin1?: string }[]
}

interface ForecastResponse {
  current: { time: string; temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number }
  daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] }
}

interface LocateResponse {
  success: boolean
  message?: string
  city?: string
  region?: string
  country?: string
  latitude?: number
  longitude?: number
}

interface Place {
  name: string
  latitude: number
  longitude: number
  admin1?: string
  country?: string
}

async function getJson<T>(ctx: AppContext, url: string, signal?: AbortSignal): Promise<T> {
  const res = await ctx.fetch(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`)
  return (await res.json()) as T
}

/** Geocode a place name, then fetch its forecast. `null` = place not found. */
async function lookup(ctx: AppContext, query: string): Promise<WeatherResult | null> {
  const geo = await getJson<GeocodeResponse>(ctx, `${GEOCODE_URL}?${new URLSearchParams({ name: query, count: '1', language: 'en', format: 'json' })}`)
  const place = geo.results?.[0]
  return place ? forecast(ctx, place) : null
}

/** Locate the user by IP, then fetch the forecast there. `null` = couldn't tell where. */
async function lookupHere(ctx: AppContext, signal?: AbortSignal): Promise<WeatherResult | null> {
  const at = await getJson<LocateResponse>(ctx, LOCATE_URL, signal)
  if (!at.success || !at.city || at.latitude == null || at.longitude == null) return null
  const place = { name: at.city, latitude: at.latitude, longitude: at.longitude, admin1: at.region, country: at.country }
  return { ...(await forecast(ctx, place, signal)), here: true }
}

/** Current conditions and a 7-day forecast for a place. */
async function forecast(ctx: AppContext, place: Place, signal?: AbortSignal): Promise<WeatherResult> {
  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    forecast_days: '7',
    timezone: 'auto',
  })
  const f = await getJson<ForecastResponse>(ctx, `${FORECAST_URL}?${params}`, signal)
  return {
    place: [place.name, place.admin1, place.country].filter((p, i, all) => p && all.indexOf(p) === i).join(', '),
    time: f.current.time,
    temperature: f.current.temperature_2m,
    feelsLike: f.current.apparent_temperature,
    windSpeed: f.current.wind_speed_10m,
    code: f.current.weather_code,
    days: f.daily.time.map((date, i) => ({
      date,
      high: f.daily.temperature_2m_max[i] ?? NaN,
      low: f.daily.temperature_2m_min[i] ?? NaN,
      code: f.daily.weather_code[i] ?? -1,
    })),
  }
}

export const weatherApp = defineApp<WeatherState>({
  id: 'weather',
  title: 'Weather',
  description: 'Weather: current conditions and 7-day forecast for the current location or any city',

  /** Opens on the current location's forecast; if that can't be found, on the empty state. */
  async init(ctx) {
    const result = await lookupHere(ctx, AbortSignal.timeout(LOCATE_TIMEOUT_MS)).catch(() => null)
    return { route: 'home', query: null, result, loading: false, error: null, box: '' }
  },

  current: (s) => s.route,

  nodes(s) {
    // As on screen: the card (the search field, Enter looks it up; then now), then the forecast.
    const r = s.result
    const field: AgentNode = {
      id: 'city',
      kind: 'input',
      label: FIELD_LABEL,
      value: s.box,
      children: s.box ? [{ id: 'location', kind: 'action', role: 'key', label: 'press Enter' }] : [],
    }
    const here: AgentNode[] = r?.here ? [] : [{ id: 'here', kind: 'action', role: 'button', label: HERE_LABEL }]
    if (!r) return [field, ...here]
    const selected = (route: string) => (s.route === route ? ', selected' : '')
    const today = r.days[0]
    const now: AgentNode = {
      id: 'home',
      kind: 'location',
      role: 'button',
      label: r.place,
      description: [
        ...(r.here ? [HERE_LABEL] : []),
        TODAY_LABEL,
        temp(r.temperature),
        conditionLabel(r.code),
        ...(today ? [`H:${temp(today.high)} L:${temp(today.low)}`] : []),
        `Feels like ${temp(r.feelsLike)}`,
      ].join(', ') + selected('home'),
    }
    const days: AgentNode[] = r.days.map((d, i) => ({
      id: `day/${i}`,
      kind: 'location',
      role: 'button',
      label: shortDay(d.date),
      description: `${conditionLabel(d.code)}, high ${temp(d.high)}, low ${temp(d.low)}${selected(`day/${i}`)}`,
    }))
    return [field, ...here, now, { id: 'forecast', kind: 'group', label: FORECAST_TITLE, children: days }]
  },

  async perform(s, nodeId, args, ctx) {
    if (nodeId === 'home') return { state: { ...s, route: 'home' }, summary: 'Opened weather overview' }

    if (nodeId === 'city') {
      const box = args.text?.trim() ?? ''
      return { state: { ...s, box, route: 'home' }, summary: box ? `Typed "${box}" in the city box (not looked up yet)` : 'Cleared the city box' }
    }

    if (nodeId === 'here') {
      try {
        const result = await lookupHere(ctx)
        if (!result) {
          const error = "Couldn't find your current location"
          return { state: { ...s, loading: false, error }, summary: error, observation: error }
        }
        return {
          state: { route: 'home', query: null, result, loading: false, error: null, box: '' },
          summary: `Weather in ${result.place} (current location): ${deg(result.temperature)}, ${describeCode(result.code)}`,
          observation: resultMarkdown(result),
        }
      } catch (err) {
        const error = `Weather lookup failed: ${err instanceof Error ? err.message : String(err)}`
        return { state: { ...s, loading: false, error }, summary: error }
      }
    }

    if (nodeId === 'location') {
      const query = s.box.trim()
      if (!query) return { state: s, summary: 'No city typed; nothing looked up' }
      try {
        const result = await lookup(ctx, query)
        if (!result) {
          const error = `Couldn't find a place called "${query}"`
          return { state: { ...s, query, loading: false, error, box: '' }, summary: error, observation: error }
        }
        return {
          state: { route: 'home', query, result, loading: false, error: null, box: '' },
          summary: `Weather in ${result.place}: ${deg(result.temperature)}, ${describeCode(result.code)}`,
          observation: resultMarkdown(result),
        }
      } catch (err) {
        const error = `Weather lookup failed: ${err instanceof Error ? err.message : String(err)}`
        return { state: { ...s, query, loading: false, error, box: '' }, summary: error }
      }
    }

    const [, n] = nodeId.split('/')
    const day = s.result?.days[Number(n)]
    if (nodeId.startsWith('day/') && day) {
      return { state: { ...s, route: nodeId }, summary: `Opened ${dayName(day.date)} forecast` }
    }
    return { state: s, summary: `Unknown action ${nodeId}` }
  },

  toMarkdown(s, ctx) {
    const notice = `\n\n[${FIELD_LABEL}: ${s.box || 'empty'}]` + (s.error ? `\n\n_${s.error}_` : '')
    if (!s.result) return `# Weather\n**${EMPTY_TITLE}**\n${emptyText(ctx?.agentName ?? DEFAULT_AGENT_NAME)}${notice}`
    const day = s.route.startsWith('day/') ? s.result.days[Number(s.route.split('/')[1])] : undefined
    if (day) return `# Weather › ${s.result.place} › ${dayName(day.date)}\n${dayLine(day)}${notice}`
    return `${resultMarkdown(s.result)}${notice}`
  },
})

export default weatherApp
