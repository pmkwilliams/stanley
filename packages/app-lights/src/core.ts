import { defineApp, type AgentNode, type AppContext } from '@stanley/app-sdk'
import { hexToXy, hue, NotPaired, xyToHex, type Change, type Home, type Light, type Room } from './hue'

export type { Light, Room } from './hue'

export interface LightsState {
  /** `home` or `room/<id>`. */
  route: string
  /** `unpaired`: the bridge hasn't given a key yet. `offline`: it couldn't be reached. */
  status: 'ready' | 'unpaired' | 'offline'
  rooms: Room[]
  lights: Light[]
  /** What went wrong last, shown until something works. */
  error: string | null
}

/** A swatch: a white (kelvin) or a color (hex). `swatch` is how it is drawn. */
export interface Preset {
  id: string
  label: string
  kelvin?: number
  hex?: string
  swatch: string
}

export const WHITES: Preset[] = [
  { id: 'candle', label: 'Candlelight', kelvin: 2200, swatch: '#ffad5c' },
  { id: 'warm', label: 'Warm white', kelvin: 2700, swatch: '#ffc58a' },
  { id: 'neutral', label: 'Neutral', kelvin: 4000, swatch: '#ffe9d1' },
  { id: 'daylight', label: 'Daylight', kelvin: 6500, swatch: '#eef3ff' },
]

export const COLORS: Preset[] = [
  { id: 'red', label: 'Red', hex: '#ff0000' },
  { id: 'orange', label: 'Orange', hex: '#ff7a00' },
  { id: 'yellow', label: 'Yellow', hex: '#ffd000' },
  { id: 'green', label: 'Green', hex: '#00ff00' },
  { id: 'teal', label: 'Teal', hex: '#00ffd0' },
  { id: 'blue', label: 'Blue', hex: '#0000ff' },
  { id: 'purple', label: 'Purple', hex: '#8a00ff' },
  { id: 'pink', label: 'Pink', hex: '#ff2d9a' },
].map((p) => ({ ...p, swatch: p.hex }))

export const CONNECT_TITLE = 'Connect your Hue Bridge'
export const CONNECT_TEXT = 'Press the round link button on top of the bridge, then Connect.'
export const OFFLINE_TITLE = "Can't reach your Hue Bridge"

export const roomOf = (s: LightsState, id: string) => s.rooms.find((r) => r.id === id)
export const lightsOf = (s: LightsState, room: Room) => room.lights.flatMap((id) => s.lights.find((l) => l.id === id) ?? [])
const allOn = (s: LightsState) => s.lights.some((l) => l.on && l.reachable)

/** `2 of 3 on, 80%`, `on, 80%`, `off`: how much of a room is lit, and how brightly. */
export function roomState(lights: Light[]): string {
  const on = lights.filter((l) => l.on && l.reachable)
  if (!on.length) return 'off'
  const bright = `${Math.round(on.reduce((n, l) => n + l.brightness, 0) / on.length)}%`
  return on.length === lights.length ? `on, ${bright}` : `${on.length} of ${lights.length} on, ${bright}`
}

/** `on, 80%, Warm white`, `off`, `unreachable`. */
export function lightState(l: Light): string {
  if (!l.reachable) return 'unreachable'
  if (!l.on) return 'off'
  const preset = presetOf(l)
  return ['on', ...(l.dims ? [`${l.brightness}%`] : []), ...(preset ? [preset.label] : [])].join(', ')
}

/** The swatch a light matches, if it's showing one. */
export function presetOf(l: Light): Preset | undefined {
  const s = l.shows
  if (!s) return undefined
  if ('kelvin' in s) {
    // Mireds, as the bridge counts them: equal steps look equally different.
    const near = WHITES.map((p) => ({ p, d: Math.abs(1e6 / p.kelvin! - 1e6 / s.kelvin) })).sort((a, b) => a.d - b.d)[0]!
    return near.d <= 40 ? near.p : undefined
  }
  const near = COLORS.map((p) => {
    const [x, y] = hexToXy(p.hex!)
    return { p, d: Math.hypot(x - s.xy[0], y - s.xy[1]) }
  }).sort((a, b) => a.d - b.d)[0]!
  return near.d <= 0.08 ? near.p : undefined
}

/** The swatch every lit light in a room matches, if they all match the same one. */
export function roomPreset(lights: Light[]): Preset | undefined {
  const on = lights.filter((l) => l.on && l.reachable)
  const first = on[0] && presetOf(on[0])
  return first && on.every((l) => presetOf(l) === first) ? first : undefined
}

/** How a light glows on screen: its color, or its white. */
export function glowOf(l: Light): string | undefined {
  if (!l.on || !l.reachable) return undefined
  const s = l.shows
  if (!s) return '#ffe2b8'
  return 'kelvin' in s ? (presetOf(l)?.swatch ?? '#ffe2b8') : xyToHex(s.xy)
}

/** The swatches a room's lights can show. */
export function presetsFor(lights: Light[]): Preset[] {
  return [...(lights.some((l) => l.white || l.color) ? WHITES : []), ...(lights.some((l) => l.color) ? COLORS : [])]
}

/** `40`, `40%`, `40 percent` → 40. */
function percent(text: string): number | undefined {
  const n = Number(text.match(/\d+(\.\d+)?/)?.[0])
  return Number.isFinite(n) && /\d/.test(text) ? Math.min(100, Math.max(0, Math.round(n))) : undefined
}

const describeError = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** The bridge's lights, or why there are none. */
async function reload(s: LightsState, ctx: AppContext, route = s.route): Promise<LightsState> {
  try {
    const home: Home = await hue(ctx).load()
    const fine = route === 'home' || home.rooms.some((r) => `room/${r.id}` === route)
    return { ...s, ...home, route: fine ? route : 'home', status: 'ready', error: null }
  } catch (err) {
    if (err instanceof NotPaired) return { ...s, route: 'home', status: 'unpaired', error: null }
    return { ...s, route: 'home', status: 'offline', error: describeError(err) }
  }
}

export const lightsApp = defineApp<LightsState>({
  id: 'lights',
  title: 'Lights',
  description: 'Lights: Philips Hue rooms and lights, on or off, brightness, color and scenes',

  init: (ctx) => reload({ route: 'home', status: 'ready', rooms: [], lights: [], error: null }, ctx),

  current: (s) => s.route,

  nodes(s) {
    if (s.status === 'unpaired') return [{ id: 'connect', kind: 'action', label: 'Connect' }]
    if (s.status === 'offline') return [{ id: 'retry', kind: 'action', label: 'Try again' }]

    const room = s.route.startsWith('room/') ? roomOf(s, s.route.slice(5)) : undefined
    if (!room) {
      // As on screen: the all-lights button in the bar, then rooms and zones, each a row with a switch.
      const row = (r: Room): AgentNode => ({
        id: `room/${r.id}`,
        kind: 'location',
        role: 'button',
        label: r.name,
        description: roomState(lightsOf(s, r)),
        children: [{ id: `room/${r.id}/power`, kind: 'action', role: 'switch', label: 'switch', description: roomState(lightsOf(s, r)) === 'off' ? 'off' : 'on' }],
      })
      const section = (label: string, kind: Room['kind']): AgentNode[] => {
        const rooms = s.rooms.filter((r) => r.kind === kind)
        return rooms.length ? [{ id: `${kind}s`, kind: 'group', label, children: rooms.map(row) }] : []
      }
      const all: AgentNode = { id: 'all', kind: 'action', label: allOn(s) ? 'Turn all off' : 'Turn all on' }
      return [...(s.lights.length ? [all] : []), ...section('Rooms', 'room'), ...section('Zones', 'zone')]
    }

    // A room: back to the rooms, its switch and brightness, its scenes and colors, then each light.
    const lights = lightsOf(s, room)
    const state = roomState(lights)
    const preset = roomPreset(lights)
    const nodes: AgentNode[] = [
      { id: 'home', kind: 'location', label: 'Rooms' },
      { id: `room/${room.id}/power`, kind: 'action', role: 'switch', label: room.name, description: state === 'off' ? 'off' : 'on' },
    ]
    if (lights.some((l) => l.dims)) {
      const on = lights.filter((l) => l.on && l.reachable)
      const value = on.length ? `${Math.round(on.reduce((n, l) => n + l.brightness, 0) / on.length)}%` : '0%'
      nodes.push({ id: `room/${room.id}/brightness`, kind: 'input', role: 'slider', label: 'Brightness', value })
    }
    if (room.scenes.length) {
      nodes.push({ id: 'scenes', kind: 'group', label: 'Scenes', children: room.scenes.map((sc) => ({ id: `room/${room.id}/scene/${sc.id}`, kind: 'action', label: sc.name })) })
    }
    const presets = presetsFor(lights)
    if (presets.length) {
      nodes.push({
        id: 'color',
        kind: 'group',
        label: 'Color',
        children: presets.map((p) => ({ id: `room/${room.id}/color/${p.id}`, kind: 'action', role: 'radio', label: p.label, description: p === preset ? 'selected' : 'not selected' })),
      })
    }
    nodes.push({
      id: 'lights',
      kind: 'group',
      label: 'Lights',
      children: lights.map((l) => ({ id: `light/${l.id}/power`, kind: 'action', role: 'switch', label: l.name, description: lightState(l) })),
    })
    return nodes
  },

  async perform(s, nodeId, args, ctx) {
    if (nodeId === 'retry') {
      const next = await reload(s, ctx, 'home')
      return { state: next, summary: next.status === 'ready' ? 'Connected to the Hue Bridge' : (next.error ?? 'Still not connected') }
    }
    if (nodeId === 'connect') {
      try {
        await hue(ctx).pair()
      } catch (err) {
        const error = err instanceof NotPaired ? "The bridge's link button wasn't pressed" : describeError(err)
        return { state: { ...s, error }, summary: error, observation: error }
      }
      const next = await reload(s, ctx, 'home')
      return { state: next, summary: 'Connected to the Hue Bridge', observation: markdown(next) }
    }
    if (nodeId === 'home') return { state: await reload(s, ctx, 'home'), summary: 'Opened rooms' }

    const parts = nodeId.split('/')
    const [kind, id, verb, arg] = parts
    if (kind === 'light' && verb === 'power') {
      const light = s.lights.find((l) => l.id === id)
      if (!light) return { state: s, summary: `No such light ${id}` }
      return change(s, ctx, { light: light.id }, { on: !light.on }, `Turned ${light.name} ${light.on ? 'off' : 'on'}`)
    }
    if (nodeId === 'all') {
      const on = allOn(s)
      return change(s, ctx, { group: '0' }, { on: !on }, `Turned all lights ${on ? 'off' : 'on'}`)
    }

    const room = kind === 'room' && id ? roomOf(s, id) : undefined
    if (!room) return { state: s, summary: `Unknown action ${nodeId}` }
    if (parts.length === 2) {
      const next = await reload(s, ctx, `room/${room.id}`)
      return { state: next, summary: `Opened ${room.name}` }
    }
    const target = { group: room.id }
    if (verb === 'power') {
      const on = roomState(lightsOf(s, room)) !== 'off'
      return change(s, ctx, target, { on: !on }, `Turned ${room.name} ${on ? 'off' : 'on'}`)
    }
    if (verb === 'brightness') {
      const brightness = percent(args.text ?? '')
      if (brightness === undefined) return { state: s, summary: `Brightness takes a percentage, not "${args.text ?? ''}"` }
      return change(s, ctx, target, { brightness }, brightness ? `Set ${room.name} to ${brightness}%` : `Turned ${room.name} off`)
    }
    if (verb === 'scene') {
      const scene = room.scenes.find((sc) => sc.id === arg)
      if (!scene) return { state: s, summary: `No such scene ${arg}` }
      return change(s, ctx, target, { scene: scene.id }, `Set ${room.name} to ${scene.name}`)
    }
    if (verb === 'color') {
      const preset = [...WHITES, ...COLORS].find((p) => p.id === arg)
      if (!preset) return { state: s, summary: `No such color ${arg}` }
      const c: Change = preset.kelvin ? { kelvin: preset.kelvin } : { hex: preset.hex }
      return change(s, ctx, target, c, `Set ${room.name} to ${preset.label.toLowerCase()}`)
    }
    return { state: s, summary: `Unknown action ${nodeId}` }
  },

  toMarkdown: (s) => markdown(s),
})

/** What the user would read on the current screen. */
function markdown(s: LightsState): string {
  if (s.status === 'unpaired') return `# Lights\n**${CONNECT_TITLE}**\n${CONNECT_TEXT}${s.error ? `\n\n_${s.error}_` : ''}`
  if (s.status === 'offline') return `# Lights\n**${OFFLINE_TITLE}**\n${s.error ?? ''}`
  const room = s.route.startsWith('room/') ? roomOf(s, s.route.slice(5)) : undefined
  const notice = s.error ? `\n\n_${s.error}_` : ''
  if (!room) {
    const list = (label: string, kind: Room['kind']) => {
      const rooms = s.rooms.filter((r) => r.kind === kind)
      return rooms.length ? [`## ${label}`, ...rooms.map((r) => `- ${r.name}: ${roomState(lightsOf(s, r))}`)] : []
    }
    const body = [...list('Rooms', 'room'), ...list('Zones', 'zone')]
    return `# Lights\n${body.length ? body.join('\n') : 'No rooms yet.'}${notice}`
  }
  const lights = lightsOf(s, room)
  const preset = roomPreset(lights)
  return [
    `# Lights › ${room.name}`,
    `${roomState(lights)}${preset ? `, ${preset.label}` : ''}`,
    ...(room.scenes.length ? ['## Scenes', room.scenes.map((sc) => sc.name).join(', ')] : []),
    '## Lights',
    ...lights.map((l) => `- ${l.name}: ${lightState(l)}`),
  ].join('\n') + notice
}

/** Sets a room or light, then reads back what the bridge did. */
async function change(s: LightsState, ctx: AppContext, target: { group: string } | { light: string }, c: Change, summary: string) {
  try {
    await hue(ctx).set(target, c)
  } catch (err) {
    const error = `That didn't work: ${describeError(err)}`
    const next = await reload(s, ctx)
    return { state: next.status === 'ready' ? { ...next, error } : next, summary: error }
  }
  return { state: await reload(s, ctx), summary }
}

export default lightsApp
