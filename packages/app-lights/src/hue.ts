import type { AppContext } from '@stanley/app-sdk'

/**
 * Philips Hue through the bridge's local API (v1, plain HTTP on the home network).
 *
 * The bridge is found through Philips' discovery service, or `HUE_BRIDGE`. It only gives out a key
 * in the 30 s after its link button is pressed; the key is kept with the bridge's address in the
 * shell's store (`hue`), so that happens once.
 */

export interface Light {
  id: string
  name: string
  on: boolean
  /** 0–100 %. */
  brightness: number
  reachable: boolean
  /** Can show colors. */
  color: boolean
  /** Can change its white (color temperature). */
  white: boolean
  /** Dimmable: everything but plugs. */
  dims: boolean
  /** What it shows now: a white in kelvin, or a color as CIE xy. */
  shows?: { kelvin: number } | { xy: [number, number] }
}

export interface Room {
  id: string
  name: string
  kind: 'room' | 'zone'
  lights: string[]
  scenes: { id: string; name: string }[]
}

export interface Home {
  rooms: Room[]
  lights: Light[]
}

/** What to set on a light or room. Anything but `on: false` turns it on. */
export interface Change {
  on?: boolean
  /** 1–100 %. */
  brightness?: number
  kelvin?: number
  /** `#rrggbb`. */
  hex?: string
  scene?: string
}

/** The bridge wants its link button pressed before it gives a key. */
export class NotPaired extends Error {
  constructor() {
    super("The link button on the Hue Bridge wasn't pressed")
    this.name = 'NotPaired'
  }
}

const DISCOVERY_URL = 'https://discovery.meethue.com'
const STORE_KEY = 'hue'
const TIMEOUT_MS = 5000

interface Saved {
  bridge?: string
  username?: string
}

/** Where the bridge and its key are kept without a store (tests): as long as the process. */
let memory: Saved = {}

interface RawLight {
  name: string
  type?: string
  state: { on: boolean; bri?: number; ct?: number; xy?: [number, number]; colormode?: 'ct' | 'xy' | 'hs'; reachable?: boolean }
  capabilities?: { control?: { colorgamut?: unknown; ct?: unknown } }
}
interface RawGroup {
  name: string
  type: string
  lights: string[]
}
interface RawScene {
  name: string
  group?: string
  recycle?: boolean
}
type Reply = ({ error: { type: number; description: string } } | { success: unknown })[]

export function hue(ctx: AppContext) {
  const saved = (): Saved => (ctx.store ? ((ctx.store.get(STORE_KEY) as Saved | undefined) ?? {}) : memory)
  const save = (next: Saved) => (ctx.store ? ctx.store.set(STORE_KEY, next) : (memory = next))

  async function get(url: string, init: RequestInit = {}): Promise<unknown> {
    const res = await ctx.fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`)
    return res.json()
  }

  async function bridge(): Promise<string> {
    const known = ctx.env.HUE_BRIDGE || saved().bridge
    if (known) return known
    const found = (await get(DISCOVERY_URL).catch(() => [])) as { internalipaddress?: string }[]
    const address = found[0]?.internalipaddress
    if (!address) throw new Error("Couldn't find a Hue Bridge on this network")
    save({ ...saved(), bridge: address })
    return address
  }

  function key(): string {
    const username = ctx.env.HUE_USERNAME || saved().username
    if (!username) throw new NotPaired()
    return username
  }

  /** A call on the API. A saved bridge that stopped answering is looked for again, once. */
  async function api(method: 'GET' | 'PUT', path: string, body?: unknown, again = true): Promise<unknown> {
    const address = await bridge()
    const username = key()
    let reply: unknown
    try {
      reply = await get(`http://${address}/api/${username}${path}`, { method, ...(body !== undefined && { body: JSON.stringify(body) }) })
    } catch (err) {
      if (!again || ctx.env.HUE_BRIDGE) throw new Error(`Couldn't reach the Hue Bridge at ${address}`, { cause: err })
      save({ ...saved(), bridge: undefined })
      return api(method, path, body, false)
    }
    const error = Array.isArray(reply) ? (reply as Reply).find((r) => 'error' in r) : undefined
    if (error && 'error' in error) {
      // The key was taken back (in the Hue app): it has to pair again.
      if (error.error.type === 1 && !ctx.env.HUE_USERNAME) {
        save({ ...saved(), username: undefined })
        throw new NotPaired()
      }
      if (method === 'GET' || !(reply as Reply).some((r) => 'success' in r)) throw new Error(error.error.description)
    }
    return reply
  }

  return {
    /** Asks the bridge for a key, which it only gives in the 30 s after its link button is pressed. */
    async pair(): Promise<void> {
      const address = await bridge()
      const reply = (await get(`http://${address}/api`, { method: 'POST', body: JSON.stringify({ devicetype: 'stanley#desktop' }) })) as Reply
      const first = reply[0]
      if (first && 'success' in first) {
        save({ ...saved(), bridge: address, username: (first.success as { username: string }).username })
        return
      }
      if (first && 'error' in first && first.error.type === 101) throw new NotPaired()
      throw new Error(first && 'error' in first ? first.error.description : 'The Hue Bridge gave no key')
    },

    /** Every room and zone with its lights and scenes, and every light as it is now. */
    async load(): Promise<Home> {
      const [lights, groups, scenes] = (await Promise.all([api('GET', '/lights'), api('GET', '/groups'), api('GET', '/scenes')])) as [
        Record<string, RawLight>,
        Record<string, RawGroup>,
        Record<string, RawScene>,
      ]
      const rooms: Room[] = Object.entries(groups)
        .filter(([, g]) => g.type === 'Room' || g.type === 'Zone')
        .map(([id, g]) => {
          const seen = new Set<string>()
          return {
            id,
            name: g.name,
            kind: g.type === 'Room' ? 'room' : 'zone',
            lights: g.lights.filter((l) => l in lights),
            // Once each by name, without the ones the bridge made for itself.
            scenes: Object.entries(scenes)
              .filter(([, s]) => s.group === id && !s.recycle && !seen.has(s.name) && seen.add(s.name))
              .map(([sid, s]) => ({ id: sid, name: s.name })),
          }
        })
      // Rooms before zones, each as the Hue app lists them.
      rooms.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'room' ? -1 : 1))
      return { rooms, lights: Object.entries(lights).map(([id, l]) => toLight(id, l)) }
    },

    /** Sets a room or zone (`group`), or a single light. Group `0` is every light. */
    async set(target: { group: string } | { light: string }, change: Change): Promise<void> {
      const path = 'group' in target ? `/groups/${target.group}/action` : `/lights/${target.light}/state`
      if (change.scene) await api('PUT', path, { scene: change.scene })
      const body = stateOf(change)
      if (Object.keys(body).length) await api('PUT', path, body)
    },
  }
}

function toLight(id: string, l: RawLight): Light {
  const s = l.state
  const control = l.capabilities?.control
  const color = !!control?.colorgamut || /color light/i.test(l.type ?? '')
  const white = !!control?.ct || /color temperature/i.test(l.type ?? '')
  const shows =
    s.colormode === 'ct' && s.ct ? { kelvin: Math.round(1e6 / s.ct) } : (s.colormode === 'xy' || s.colormode === 'hs') && s.xy ? { xy: s.xy } : undefined
  return {
    id,
    name: l.name,
    on: s.on,
    brightness: s.bri === undefined ? 100 : Math.max(1, Math.round((s.bri / 254) * 100)),
    reachable: s.reachable !== false,
    color,
    white,
    dims: s.bri !== undefined,
    ...(shows && { shows }),
  }
}

/** The bridge's body for a change, without the scene. */
export function stateOf(c: Change): Record<string, unknown> {
  if (c.on === false || c.brightness === 0) return { on: false }
  const body: Record<string, unknown> = {}
  if (c.brightness !== undefined) body.bri = Math.min(254, Math.max(1, Math.round((c.brightness * 254) / 100)))
  if (c.hex) body.xy = hexToXy(c.hex)
  if (c.kelvin) body.ct = Math.min(500, Math.max(153, Math.round(1e6 / c.kelvin)))
  if (c.on || Object.keys(body).length) body.on = true
  return body
}

const linear = (v: number) => (v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92)
const gamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)
const round4 = (n: number) => Math.round(n * 1e4) / 1e4

/** sRGB to CIE xy, as Philips documents it. The bridge brings it into each light's gamut. */
export function hexToXy(hex: string): [number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => linear(parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number]
  const X = r * 0.664511 + g * 0.154324 + b * 0.162028
  const Y = r * 0.283881 + g * 0.668433 + b * 0.047685
  const Z = r * 0.000088 + g * 0.07231 + b * 0.986039
  const sum = X + Y + Z
  return sum ? [round4(X / sum), round4(Y / sum)] : [0.3127, 0.329]
}

/** CIE xy at full brightness to `#rrggbb`. */
export function xyToHex([x, y]: [number, number]): string {
  if (!y) return '#ffffff'
  const X = x / y
  const Z = (1 - x - y) / y
  const rgb = [X * 1.656492 - 0.354851 - Z * 0.255038, -X * 0.707196 + 1.655397 + Z * 0.036152, X * 0.051713 - 0.121364 + Z * 1.01153]
  const max = Math.max(...rgb, 1e-9)
  return `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, gamma(Math.max(0, v) / max))) * 255).toString(16).padStart(2, '0')).join('')}`
}
