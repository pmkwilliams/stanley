import { defineApp, type AgentNode, type AppContext } from '@stanley/app-sdk'

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
  windSpeed: number
  code: number
  days: ForecastDay[]
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
}

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'

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

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-10-10` → `Saturday Oct 10`. Parsed as UTC noon so the host timezone can't shift the day. */
export function dayName(date: string): string {
  const d = new Date(`${date}T12:00:00Z`)
  return `${weekdays[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${d.getUTCDate()}`
}

const deg = (n: number) => `${Math.round(n)}°C`

const dayLine = (d: ForecastDay) => `${dayName(d.date)}: ${describeCode(d.code)}, high ${deg(d.high)}, low ${deg(d.low)}`

function resultMarkdown(r: WeatherResult): string {
  const now = `Now: ${deg(r.temperature)}, ${describeCode(r.code)}, wind ${Math.round(r.windSpeed)} km/h`
  return `# Weather in ${r.place}\n${now}\n\n## Next ${r.days.length} days\n${r.days.map((d) => `- ${dayLine(d)}`).join('\n')}`
}

interface GeocodeResponse {
  results?: { name: string; latitude: number; longitude: number; country?: string; admin1?: string }[]
}

interface ForecastResponse {
  current: { time: string; temperature_2m: number; weather_code: number; wind_speed_10m: number }
  daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] }
}

async function getJson<T>(ctx: AppContext, url: string): Promise<T> {
  const res = await ctx.fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`)
  return (await res.json()) as T
}

/** Geocode a place name, then fetch current conditions and a 5-day forecast. `null` = place not found. */
async function lookup(ctx: AppContext, query: string): Promise<WeatherResult | null> {
  const geo = await getJson<GeocodeResponse>(ctx, `${GEOCODE_URL}?${new URLSearchParams({ name: query, count: '1', language: 'en', format: 'json' })}`)
  const place = geo.results?.[0]
  if (!place) return null

  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: 'temperature_2m,weather_code,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    forecast_days: '5',
    timezone: 'auto',
  })
  const f = await getJson<ForecastResponse>(ctx, `${FORECAST_URL}?${params}`)
  return {
    place: [place.name, place.admin1, place.country].filter((p, i, all) => p && all.indexOf(p) === i).join(', '),
    time: f.current.time,
    temperature: f.current.temperature_2m,
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
  description: 'Weather: current conditions and 5-day forecast for any city',

  init: () => ({ route: 'home', query: null, result: null, loading: false, error: null }),

  current: (s) => s.route,

  nodes(s) {
    const r = s.result
    const days: AgentNode[] = (r?.days ?? []).map((d, i) => ({
      id: `day/${i}`,
      kind: 'location',
      label: `${dayName(d.date)} forecast for ${r?.place}`,
      description: `${describeCode(d.code)}, high ${deg(d.high)}, low ${deg(d.low)}`,
    }))
    return [
      {
        id: 'home',
        kind: 'location',
        label: r ? `current weather in ${r.place}` : 'weather overview',
        description: r ? `${deg(r.temperature)}, ${describeCode(r.code)}` : 'no city looked up yet',
        children: [
          {
            id: 'location',
            kind: 'input',
            label: 'look up weather for a city',
            description: 'search a city or place by name',
            input: { instructions: 'The city name to look up, e.g. "Denver" or "Paris". Just the place name, nothing else.', placeholder: 'City name' },
          },
          ...days,
        ],
      },
    ]
  },

  async perform(s, nodeId, args, ctx) {
    if (nodeId === 'home') return { state: { ...s, route: 'home' }, summary: 'Opened weather overview' }

    if (nodeId === 'location') {
      const query = args.text?.trim()
      if (!query) return { state: s, summary: 'No city given; nothing looked up' }
      try {
        const result = await lookup(ctx, query)
        if (!result) {
          const error = `Couldn't find a place called "${query}"`
          return { state: { ...s, query, loading: false, error }, summary: error, observation: error }
        }
        return {
          state: { route: 'home', query, result, loading: false, error: null },
          summary: `Weather in ${result.place}: ${deg(result.temperature)}, ${describeCode(result.code)}`,
          observation: resultMarkdown(result),
        }
      } catch (err) {
        const error = `Weather lookup failed: ${err instanceof Error ? err.message : String(err)}`
        return { state: { ...s, query, loading: false, error }, summary: error }
      }
    }

    const [, n] = nodeId.split('/')
    const day = s.result?.days[Number(n)]
    if (nodeId.startsWith('day/') && day) {
      return { state: { ...s, route: nodeId }, summary: `Opened ${dayName(day.date)} forecast` }
    }
    return { state: s, summary: `Unknown action ${nodeId}` }
  },

  toMarkdown(s) {
    const notice = s.error ? `\n\n_${s.error}_` : ''
    if (!s.result) return `# Weather\n_No city looked up yet_${notice}`
    const day = s.route.startsWith('day/') ? s.result.days[Number(s.route.split('/')[1])] : undefined
    if (day) return `# Weather › ${s.result.place} › ${dayName(day.date)}\n${dayLine(day)}${notice}`
    return `${resultMarkdown(s.result)}${notice}`
  },
})

export default weatherApp
