import { describe, expect, it, vi } from 'vitest'
import { rankingFor } from '../src/agent'
import { defaultConfig } from '../src/config'
import { candidatesOf, stepOptions } from '../src/options'
import { Relevance, type Embed } from '../src/relevance'
import type { Screen } from '../src/world'

/** A stand-in embedding model: a text's vector is which of a few words it has; each call takes `ms` per text. */
function fake(ms = 0, calls: string[][] = []): Embed {
  const axes = ['music', 'pause', 'mail', 'archive', 'dana', 'sam', 'lee']
  return async (texts, signal) => {
    calls.push(texts)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms * texts.length)
      signal?.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)))
    })
    return texts.map((t) => [...axes.map((a) => (t.toLowerCase().includes(a) ? 1 : 0)), 0.1])
  }
}

describe('Relevance', () => {
  it('scores what is embedded, and embeds the rest in the background without making the request wait', async () => {
    const calls: string[][] = []
    const r = new Relevance(fake(5, calls), 100)
    const texts = Array.from({ length: 60 }, (_, i) => (i === 59 ? 'Music › Pause' : `item ${i}`))
    // Sixty texts take 300 ms to embed, past the budget: the request is scored against none yet.
    const first = await r.score('pause the music', texts)
    expect(first.size).toBe(0)
    await r.idle()
    expect(r.embedded(texts)).toBe(60)
    const next = await r.score('pause the music', texts)
    expect(next.size).toBe(60)
    expect([...next].sort((a, b) => b[1] - a[1])[0]![0]).toBe('Music › Pause')
    // Each text was embedded once, in batches; the requests alone after that.
    expect(calls.flat().filter((t) => t === 'Music › Pause')).toHaveLength(1)
  })

  it('embeds what the request names with the request, so it is scored while the rest of the page is still being embedded', async () => {
    const r = new Relevance(fake(5), 200)
    const texts = [...Array.from({ length: 200 }, (_, i) => `item ${i}`), 'Mail › Archive']
    const scores = await r.score('archive it', texts, ['Mail › Archive'])
    expect(scores.has('Mail › Archive')).toBe(true)
    expect(scores.size).toBeLessThan(texts.length)
  })

  it('moves what is waiting forward when it is on the screens now', async () => {
    const calls: string[][] = []
    const r = new Relevance(fake(1, calls), 1000)
    r.prepare(Array.from({ length: 100 }, (_, i) => `old ${i}`))
    r.prepare(Array.from({ length: 100 }, (_, i) => `other ${i}`))
    // "old 99" was queued first, behind "other": seen again, it goes ahead of them.
    r.prepare(['old 99'])
    await r.idle()
    const batches = calls.filter((c) => !c[0]!.startsWith('Represent'))
    expect(batches.findIndex((b) => b.includes('old 99'))).toBeLessThan(batches.findIndex((b) => b.includes('other 99')))
  })

  it('still scores with a request it knows when it cannot embed what the request names', async () => {
    let slow = false
    const model = fake()
    const r = new Relevance(async (texts, signal) => {
      if (slow && texts.length > 1) await new Promise((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason)))
      return model(texts, signal)
    }, 50)
    const texts = ['Music › Pause', 'Mail › Archive']
    r.prepare(texts)
    await r.idle()
    await r.score('pause the music', texts)
    slow = true
    const scores = await r.score('pause the music', texts, ['Music › Next'])
    expect(scores.size).toBe(2)
  })

  it('embeds what was seen last first', async () => {
    const calls: string[][] = []
    const r = new Relevance(fake(1, calls), 1000)
    r.prepare(Array.from({ length: 200 }, (_, i) => `old ${i}`))
    r.prepare(['mail archive'])
    await r.idle()
    const batches = calls.filter((c) => !c[0]!.startsWith('Represent'))
    const at = batches.findIndex((b) => b.includes('mail archive'))
    expect(at).toBeLessThan(5)
    expect(at).toBeLessThan(batches.findIndex((b) => b.includes('old 199')))
  })

  it("stops sending while the model is down, and embeds what is seen again once it has had time to come back", async () => {
    let up = false
    let calls = 0
    const model = fake()
    const r = new Relevance(async (texts, signal) => {
      calls++
      if (!up) throw new Error('down')
      return model(texts, signal)
    })
    const texts = Array.from({ length: 100 }, (_, i) => `item ${i}`)
    r.prepare(texts)
    await r.idle()
    // Two batches in flight fail; the rest aren't sent, nor are they on the next decisions.
    expect(calls).toBeLessThanOrEqual(2)
    r.prepare(texts)
    await r.idle()
    expect(calls).toBeLessThanOrEqual(2)
    up = true
    vi.setSystemTime(Date.now() + 6_000)
    r.prepare(texts)
    await r.idle()
    vi.useRealTimers()
    expect(r.embedded(texts)).toBe(100)
  })

  it('ranks a request leaning on what was asked before ("archive it") by what that was about', async () => {
    const row = (id: string, who: string) => ({ id, kind: 'group' as const, label: `${who}: Invoice`, children: [{ id: `${id}/archive`, kind: 'action' as const, label: 'Archive' }] })
    const screen: Screen = { id: 'mail:inbox', title: 'Mail', visible: true, markdown: '# Inbox', elements: [row('a', 'Sam'), row('b', 'Lee'), row('c', 'Dana')] }
    const r = new Relevance(fake(), 1000)
    const candidates = candidatesOf(screen)
    const offered = async (before: string) => {
      const ranking = await rankingFor(r, defaultConfig.ranking, 'archive it', candidates, 1, before)
      return Object.keys(stepOptions(screen, [], 1, 'archive it', [], false, undefined, [], false, false, false, { ranking }).criteria)[0]
    }
    await offered('')
    await r.idle()
    expect(await offered('')).toBe('Sam: Invoice › Archive')
    expect(await offered('did Dana send me anything')).toBe('Dana: Invoice › Archive')
  })

  it("doesn't let what was asked before lift what is far from both", async () => {
    const screen: Screen = { id: 'mail:inbox', title: 'Mail', visible: true, markdown: '', elements: [{ id: 'm', kind: 'action', label: 'Music' }, { id: 'p', kind: 'action', label: 'Pause' }] }
    const r = new Relevance(fake(), 1000)
    const candidates = candidatesOf(screen)
    await rankingFor(r, defaultConfig.ranking, 'pause', candidates, 1)
    await r.idle()
    const now = (await rankingFor(r, defaultConfig.ranking, 'pause', candidates, 1)).meaning!
    const leaning = (await rankingFor(r, defaultConfig.ranking, 'pause', candidates, 1, 'archive the mail')).meaning!
    // Neither is close to the mail asked about before: their scores don't move.
    expect([...leaning]).toEqual([...now])
    const off = (await rankingFor(r, { ...defaultConfig.ranking, weights: { ...defaultConfig.ranking.weights, before: 0 } }, 'pause', candidates, 1, 'music')).meaning!
    expect([...off]).toEqual([...now])
  })
})
