import type { LightsState } from '@stanley/app-lights/core'
import { playlist, type MusicState } from '@stanley/app-music/core'
import type { WeatherState } from '@stanley/app-weather/core'
import type { WebState } from '@stanley/app-web/core'

/** Canned states, so a screenshot doesn't depend on the network. Pick one with `?fixture=<name>`. */
export const fixtures: Record<string, Record<string, unknown>> = {
  lights: {
    home: {
      route: 'home',
      status: 'ready',
      error: null,
      rooms: [
        { id: '1', name: 'Living room', kind: 'room', lights: ['1', '2', '3'], scenes: [{ id: 'a', name: 'Relax' }, { id: 'b', name: 'Read' }, { id: 'c', name: 'Concentrate' }, { id: 'd', name: 'Nightlight' }] },
        { id: '2', name: 'Office', kind: 'room', lights: ['4'], scenes: [{ id: 'e', name: 'Energize' }] },
        { id: '3', name: 'Bedroom', kind: 'room', lights: ['5', '6'], scenes: [] },
        { id: '4', name: 'Downstairs', kind: 'zone', lights: ['1', '2', '3', '4'], scenes: [] },
      ],
      lights: [
        { id: '1', name: 'Floor lamp', on: true, brightness: 80, reachable: true, color: true, white: true, dims: true, shows: { kelvin: 2703 } },
        { id: '2', name: 'Ceiling', on: true, brightness: 80, reachable: true, color: false, white: true, dims: true, shows: { kelvin: 2703 } },
        { id: '3', name: 'TV strip', on: false, brightness: 40, reachable: true, color: true, white: true, dims: true, shows: { xy: [0.17, 0.7] } },
        { id: '4', name: 'Desk lamp', on: true, brightness: 50, reachable: true, color: true, white: true, dims: true, shows: { xy: [0.1355, 0.0399] } },
        { id: '5', name: 'Bedside left', on: false, brightness: 30, reachable: true, color: false, white: false, dims: true },
        { id: '6', name: 'Bedside right', on: false, brightness: 30, reachable: false, color: false, white: false, dims: true },
      ],
    } satisfies LightsState,
    room: null as unknown as LightsState,
    unpaired: { route: 'home', status: 'unpaired', error: null, rooms: [], lights: [] } satisfies LightsState,
    offline: { route: 'home', status: 'offline', error: "Couldn't reach the Hue Bridge at 192.168.1.20", rooms: [], lights: [] } satisfies LightsState,
  },
  music: {
    /** The playlist, its first track playing. */
    playing: { tracks: playlist, currentId: playlist[0]!.id, playing: true, volume: 0.6 } satisfies MusicState,
    /** Paused partway down the list. */
    paused: { tracks: playlist, currentId: playlist[5]!.id, playing: false, volume: 0.6 } satisfies MusicState,
  },
  weather: {
    denver: {
      route: 'home',
      query: 'Denver',
      box: '',
      loading: false,
      error: null,
      result: {
        place: 'Denver, Colorado, United States',
        time: '2026-10-12T14:00',
        temperature: 18.4,
        feelsLike: 17.1,
        windSpeed: 12.2,
        code: 2,
        days: [
          { date: '2026-10-12', high: 21, low: 6, code: 2 },
          { date: '2026-10-13', high: 17, low: 4, code: 3 },
          { date: '2026-10-14', high: 12, low: 2, code: 61 },
          { date: '2026-10-15', high: 9, low: -1, code: 71 },
          { date: '2026-10-16', high: 14, low: 3, code: 0 },
          { date: '2026-10-17', high: 19, low: 5, code: 1 },
          { date: '2026-10-18', high: 22, low: 8, code: 95 },
        ],
      },
    } satisfies WeatherState,
    /** A new lookup running over a forecast already on screen. */
    refreshing: null as unknown as WeatherState, // filled in below from `denver`
    loading: { route: 'home', query: 'Lisbon', box: 'Lisbon', loading: true, error: null, result: null } satisfies WeatherState,
    error: { route: 'home', query: 'Atlantis', box: '', loading: false, error: 'No place called "Atlantis"', result: null } satisfies WeatherState,
  },
  web: {
    page: {
      route: 'page/0',
      error: null,
      pages: [{ url: 'https://en.wikipedia.org/wiki/Eiffel_Tower', title: 'Eiffel Tower - Wikipedia', markdown: '# Eiffel Tower\n\nThe Eiffel Tower is a wrought-iron lattice tower in Paris.' }],
    } satisfies WebState,
    error: {
      route: 'page/0',
      error: 'Page reader unavailable: PARALLEL_API_KEY is not set',
      pages: [{ url: 'https://www.bbc.com/news', title: 'bbc.com', markdown: '' }],
    } satisfies WebState,
  },
}

const weather = fixtures.weather as Record<string, WeatherState>
weather.refreshing = { ...weather.denver!, query: 'Lisbon', box: 'Lisbon', loading: true }

const lights = fixtures.lights as Record<string, LightsState>
lights.room = { ...lights.home!, route: 'room/1' }
