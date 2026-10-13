import type { AppContext } from '@stanley/app-sdk'
import { describe, expect, it } from 'vitest'
import { lightsApp, type LightsState } from '../src/core'
import { hexToXy, xyToHex } from '../src/hue'

/** A bridge at 10.0.0.2 whose state changes as it's told; pairs once its link button is "pressed". */
function bridge() {
  const lights: Record<string, any> = {
    '1': { name: 'Floor lamp', type: 'Extended color light', state: { on: true, bri: 203, ct: 370, colormode: 'ct', reachable: true }, capabilities: { control: { colorgamut: [], ct: {} } } },
    '2': { name: 'Ceiling', type: 'Color temperature light', state: { on: false, bri: 100, ct: 370, colormode: 'ct', reachable: true }, capabilities: { control: { ct: {} } } },
    '3': { name: 'Porch', type: 'Dimmable light', state: { on: false, bri: 254, reachable: false } },
  }
  const groups = {
    '1': { name: 'Living room', type: 'Room', lights: ['1', '2'] },
    '2': { name: 'Outside', type: 'Room', lights: ['3'] },
    '3': { name: 'Downstairs', type: 'Zone', lights: ['1', '2'] },
    '9': { name: 'TV area', type: 'Entertainment', lights: ['1'] },
  }
  const scenes = { a: { name: 'Relax', group: '1' }, b: { name: 'Relax', group: '1' }, c: { name: 'Read', group: '1' }, d: { name: 'Auto', group: '1', recycle: true } }
  const b = { pressed: false, puts: [] as { path: string; body: any }[] }
  const json = (v: unknown) => new Response(JSON.stringify(v))
  const fetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (url === 'https://discovery.meethue.com') return json([{ internalipaddress: '10.0.0.2' }])
    if (url === 'http://10.0.0.2/api') return json(b.pressed ? [{ success: { username: 'key' } }] : [{ error: { type: 101, description: 'link button not pressed' } }])
    const path = url.replace('http://10.0.0.2/api/key', '')
    if (method === 'PUT') {
      const body = JSON.parse(init!.body as string)
      b.puts.push({ path, body })
      const ids = path.startsWith('/groups/0') ? Object.keys(lights) : path.startsWith('/groups/') ? groups[path.split('/')[2] as '1'].lights : [path.split('/')[2]!]
      for (const id of ids) Object.assign(lights[id].state, body.ct ? { colormode: 'ct' } : body.xy ? { colormode: 'xy' } : {}, body.scene ? { on: true } : body)
      return json(Object.keys(body).map((k) => ({ success: { [`${path}/${k}`]: body[k] } })))
    }
    return json({ '/lights': lights, '/groups': groups, '/scenes': scenes }[path])
  }) as typeof globalThis.fetch
  const saved = new Map<string, unknown>()
  const ctx: AppContext = { env: {}, fetch, store: { get: (k) => saved.get(k), set: (k, v) => void saved.set(k, v) } }
  return Object.assign(b, { ctx, saved, lights })
}

const labels = (s: LightsState) => {
  const out: string[] = []
  const walk = (ns: ReturnType<typeof lightsApp.nodes>, path: string[] = []) =>
    ns.forEach((n) => {
      out.push([...path, n.label].join(' › ') + (n.description ? ` (${n.description})` : '') + (n.value !== undefined ? ` [${n.value}]` : ''))
      if (n.children) walk(n.children, [...path, n.label])
    })
  walk(lightsApp.nodes(s))
  return out
}

describe('lights app', () => {
  it('asks for the link button, then connects and keeps the key', async () => {
    const b = bridge()
    let s = await lightsApp.init(b.ctx)
    expect(s.status).toBe('unpaired')
    expect(labels(s)).toEqual(['Connect'])

    let r = await lightsApp.perform(s, 'connect', {}, b.ctx)
    expect(r.summary).toBe("The bridge's link button wasn't pressed")
    b.pressed = true
    r = await lightsApp.perform(r.state, 'connect', {}, b.ctx)
    expect(r.summary).toBe('Connected to the Hue Bridge')
    expect(b.saved.get('hue')).toEqual({ bridge: '10.0.0.2', username: 'key' })
    s = await lightsApp.init(b.ctx)
    expect(s.status).toBe('ready')
  })

  it('shows rooms and zones with switches, and each room with its controls', async () => {
    const b = bridge()
    b.saved.set('hue', { bridge: '10.0.0.2', username: 'key' })
    const s = await lightsApp.init(b.ctx)
    expect(labels(s)).toEqual([
      'Turn all off',
      'Rooms',
      'Rooms › Living room (1 of 2 on, 80%)',
      'Rooms › Living room › switch (on)',
      'Rooms › Outside (off)',
      'Rooms › Outside › switch (off)',
      'Zones',
      'Zones › Downstairs (1 of 2 on, 80%)',
      'Zones › Downstairs › switch (on)',
    ])
    const room = (await lightsApp.perform(s, 'room/1', {}, b.ctx)).state
    expect(labels(room)).toEqual([
      'Rooms',
      'Living room (on)',
      'Brightness [80%]',
      'Scenes',
      'Scenes › Relax',
      'Scenes › Read',
      'Color',
      'Color › Candlelight (not selected)',
      'Color › Warm white (selected)',
      'Color › Neutral (not selected)',
      'Color › Daylight (not selected)',
      'Color › Red (not selected)',
      'Color › Orange (not selected)',
      'Color › Yellow (not selected)',
      'Color › Green (not selected)',
      'Color › Teal (not selected)',
      'Color › Blue (not selected)',
      'Color › Purple (not selected)',
      'Color › Pink (not selected)',
      'Lights',
      'Lights › Floor lamp (on, 80%, Warm white)',
      'Lights › Ceiling (off)',
    ])
    expect(lightsApp.toMarkdown(room)).toBe('# Lights › Living room\n1 of 2 on, 80%, Warm white\n## Scenes\nRelax, Read\n## Lights\n- Floor lamp: on, 80%, Warm white\n- Ceiling: off')
  })

  it('switches, dims, colors and sets scenes, then shows what the bridge did', async () => {
    const b = bridge()
    b.saved.set('hue', { bridge: '10.0.0.2', username: 'key' })
    let s = (await lightsApp.perform(await lightsApp.init(b.ctx), 'room/1', {}, b.ctx)).state
    const run = async (id: string, text?: string) => {
      const r = await lightsApp.perform(s, id, text === undefined ? {} : { text }, b.ctx)
      s = r.state
      return r.summary
    }
    expect(await run('room/1/power')).toBe('Turned Living room off')
    expect(await run('room/1/brightness', '40%')).toBe('Set Living room to 40%')
    expect(await run('room/1/color/blue')).toBe('Set Living room to blue')
    expect(labels(s)).toContain('Color › Blue (selected)')
    expect(await run('room/1/scene/a')).toBe('Set Living room to Relax')
    expect(await run('light/2/power')).toBe('Turned Ceiling off')
    expect(await run('room/1/brightness', 'bright')).toBe('Brightness takes a percentage, not "bright"')
    expect(await run('all')).toBe('Turned all lights off')
    expect(b.puts).toEqual([
      { path: '/groups/1/action', body: { on: false } },
      { path: '/groups/1/action', body: { bri: 102, on: true } },
      { path: '/groups/1/action', body: { xy: hexToXy('#0000ff'), on: true } },
      { path: '/groups/1/action', body: { scene: 'a' } },
      { path: '/lights/2/state', body: { on: false } },
      { path: '/groups/0/action', body: { on: false } },
    ])
    expect(s.route).toBe('room/1')
  })

  it("says it can't reach the bridge, and tries again", async () => {
    const b = bridge()
    const ctx: AppContext = { ...b.ctx, env: { HUE_BRIDGE: '10.0.0.9', HUE_USERNAME: 'key' }, fetch: (async () => Promise.reject(new TypeError('fetch failed'))) as typeof fetch }
    const s = await lightsApp.init(ctx)
    expect(s.status).toBe('offline')
    expect(labels(s)).toEqual(['Try again'])
    expect(lightsApp.toMarkdown(s)).toContain("Couldn't reach the Hue Bridge at 10.0.0.9")
  })
})

describe('colors', () => {
  it('round-trips the primaries', () => {
    for (const hex of ['#ff0000', '#00ff00', '#0000ff']) expect(xyToHex(hexToXy(hex))).toBe(hex)
  })
})
