import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AppStore, LivePage, LivePages } from '@stanley/app-sdk'
import { emailApp, linkify } from '@stanley/app-email/core'
import { readSettings, settingsApp } from '@stanley/app-settings/core'
import { tasksApp } from '@stanley/app-tasks/core'
import { MAX_TABS, webApp, type WebState } from '@stanley/app-web/core'
import { Shell } from './shell'

const make = () => new Shell([emailApp, tasksApp], { env: {}, fetch }, () => {})

type Site = Record<string, { title: string; text: string; links?: Record<string, string> }>

/** A tab of a browser in memory: each page has a title, text and links, and following a link goes to its page. */
class FakePage implements LivePage {
  url = 'about:blank'

  constructor(
    private site: Site,
    /** Addresses gone to by `goto`, by any tab. */
    private loads: string[],
  ) {}

  async goto(url: string) {
    if (!this.site[url]) throw new Error('ERR_NAME_NOT_RESOLVED')
    this.url = url
    this.loads.push(url)
  }

  async read() {
    const { title, text, links = {} } = this.site[this.url]!
    return { url: this.url, title, markdown: text, elements: Object.keys(links).map((label, i) => ({ id: `e${i + 1}`, kind: 'location' as const, role: 'link', label })) }
  }

  async perform(nodeId: string) {
    const links = this.site[this.url]!.links ?? {}
    const label = Object.keys(links)[Number(nodeId.slice(1)) - 1]
    if (!label) throw new Error("Can't use it: it is no longer on the page")
    this.url = links[label]!
    return `Now on "${this.site[this.url]!.title}"`
  }
}

/** The browser's tabs, made as they are asked for. */
class FakePages implements LivePages {
  loads: string[] = []
  tabs = new Map<number, FakePage>()

  constructor(private site: Site) {}

  tab(id: number): FakePage {
    if (!this.tabs.has(id)) this.tabs.set(id, new FakePage(this.site, this.loads))
    return this.tabs.get(id)!
  }
}

const SITE: Site = {
  'https://a.test/': { title: 'Page A', text: 'All about A.', links: { 'Go to B': 'https://b.test/' } },
  'https://b.test/': { title: 'Page B', text: 'All about B.', links: { 'Back to A': 'https://a.test/' } },
  'https://c.test/': { title: 'Page C', text: 'All about C.' },
}

describe('Shell', () => {
  it('changes the theme in Settings, and keeps it for the next session', async () => {
    const values = new Map<string, unknown>()
    const store: AppStore = { get: (k) => values.get(k), set: (k, v) => void values.set(k, v) }
    const shell = new Shell([settingsApp], { env: {}, fetch, store }, () => {})
    expect(readSettings(store).theme).toBe('dark')
    await shell.open('settings')
    const light = (await shell.screen()).elements.find((e) => e.label === 'Appearance')!.children!.find((e) => e.label === 'Light')!
    expect(light.role).toBe('radio')
    await shell.perform(light, {})
    expect(readSettings(store).theme).toBe('light')
    const next = new Shell([settingsApp], { env: {}, fetch, store }, () => {})
    await next.open('settings')
    expect((await next.screen()).markdown).toContain('(•) Light')
  })

  it('names the assistant in Settings, back to the default when the name is cleared', async () => {
    const values = new Map<string, unknown>()
    const store: AppStore = { get: (k) => values.get(k), set: (k, v) => void values.set(k, v) }
    const shell = new Shell([settingsApp], { env: {}, fetch, store }, () => {})
    expect(readSettings(store).name).toBe('Stanley')
    await shell.open('settings')
    const field = (await shell.screen()).elements.find((e) => e.label === 'Assistant')!.children!.find((e) => e.label === 'Name')!
    expect(field).toMatchObject({ kind: 'input', value: 'Stanley' })
    await shell.perform(field, { text: ' Jarvis ' })
    expect(readSettings(store).name).toBe('Jarvis')
    expect((await shell.screen()).markdown).toContain('[Name:  Jarvis ]')
    await shell.perform(field, { text: '' })
    expect(readSettings(store).name).toBe('Stanley')
  })

  it('locks through the host', async () => {
    let locks = 0
    const shell = new Shell([tasksApp], { env: {}, fetch }, () => {}, () => locks++)
    await shell.lock()
    expect(locks).toBe(1)
  })

  it("offers only the focused screen's elements, named as the UI shows them", async () => {
    const shell = make()
    await shell.open('email')
    const screen = await shell.screen()
    expect(screen.id).toBe('email:inbox')
    expect(screen.elements.map((e) => e.label)).toContain('Sam Lee: Lunch Friday?')
    expect(JSON.stringify(screen.elements)).not.toContain('"label":"Archive"')
    await shell.performIn('email', 'email/m1', {})
    expect(JSON.stringify((await shell.screen()).elements)).toContain('Archive')
  })

  it('goes back screen by screen, within an app and across apps, like a browser', async () => {
    const shell = make()
    await shell.open('email')
    await shell.performIn('email', 'email/m1', {})
    await shell.open('tasks')
    await shell.global('back')
    expect((await shell.screen()).id).toBe('email:email/m1')
    await shell.global('back')
    expect((await shell.screen()).id).toBe('email:inbox')
    await shell.global('back')
    expect((await shell.screen()).id).toBe('home')
    await shell.global('back')
    expect((await shell.screen()).id).toBe('home')
  })

  it('opens web pages by address in the Web app, and goes back through them without reading them again', async () => {
    const shell = new Shell([webApp, tasksApp], { env: {}, fetch: () => Promise.reject(new Error('offline')) }, () => {})
    await shell.openUrl('https://en.wikipedia.org/wiki/Louvre')
    await shell.openUrl('https://www.toureiffel.paris/en')
    let screen = await shell.screen()
    expect(screen).toMatchObject({ id: 'web:page/1', url: 'https://www.toureiffel.paris/en' })
    await shell.global('back')
    screen = await shell.screen()
    expect(screen).toMatchObject({ id: 'web:page/0', url: 'https://en.wikipedia.org/wiki/Louvre' })
  })
  it("opens an email's links in the Web app", async () => {
    const shell = new Shell([emailApp, webApp], { env: {}, fetch: () => Promise.reject(new Error('offline')) }, () => {})
    await shell.performIn('email', 'email/m5', {})
    const article = (await shell.screen()).elements.find((e) => e.role === 'article')!
    const links = article.children!.filter((e) => e.role === 'link')
    expect(links.map((e) => e.label)).toEqual([
      'https://github.com/pmkwilliams/stanley/pull/1',
      'https://github.com/pmkwilliams/stanley/pull/1.patch',
      'https://github.com/pmkwilliams/stanley/pull/1.diff',
    ])
    await shell.perform(links[1]!, {})
    expect(await shell.screen()).toMatchObject({ id: 'web:page/0', url: 'https://github.com/pmkwilliams/stanley/pull/1.patch' })
    await shell.global('back')
    expect((await shell.screen()).id).toBe('email:email/m5')
  })

  it('finds web addresses in text, leaving out the punctuation around them', () => {
    const urls = (text: string) => linkify(text).flatMap((p) => (p.url ? [p.url] : []))
    expect(urls('See https://example.com/a, then www.example.org.')).toEqual(['https://example.com/a', 'https://www.example.org'])
    expect(urls('(at https://en.wikipedia.org/wiki/Mercury_(planet))')).toEqual(['https://en.wikipedia.org/wiki/Mercury_(planet)'])
    expect(urls('Mail sam.lee@fastmail.com or visit example.com')).toEqual([])
    const text = 'Go to https://x.com/y! Now.'
    expect(linkify(text).map((p) => p.text).join('')).toBe(text)
  })

  it('puts a web page in full screen with its Full screen button, and keeps it there for the next page', async () => {
    const shell = new Shell([webApp, tasksApp], { env: {}, fetch: () => Promise.reject(new Error('offline')) }, () => {})
    await shell.open('web')
    expect((await shell.screen()).elements).toEqual([])
    await shell.openUrl('https://en.wikipedia.org/wiki/Louvre')
    await shell.global('show')
    const button = (await shell.screen()).elements[0]!
    expect(button).toMatchObject({ id: 'web:@fullscreen', role: 'button', label: 'Full screen' })
    expect(shell.layout).toEqual({ visible: 'web', fullscreen: false })
    await shell.perform(button, {})
    expect(shell.layout).toEqual({ visible: 'web', fullscreen: true })
    expect((await shell.screen()).elements[0]!.label).toBe('Exit full screen')
    await shell.open('tasks')
    await shell.global('show')
    expect(shell.layout).toEqual({ visible: 'tasks', fullscreen: false })
    await shell.openUrl('https://www.toureiffel.paris/en')
    await shell.global('show')
    expect(shell.layout).toEqual({ visible: 'web', fullscreen: true })
    await shell.performIn('web', '@fullscreen', {})
    expect(shell.layout).toEqual({ visible: 'web', fullscreen: false })
  })

  it("works a live page: its links are the screen's elements, and a page a link went to can be gone back from", async () => {
    const pages = new FakePages(SITE)
    const shell = new Shell([webApp, tasksApp], { env: {}, fetch, pages }, () => {})
    await shell.openUrl('https://a.test/')
    let screen = await shell.screen()
    expect(screen).toMatchObject({ id: 'web:page/0', url: 'https://a.test/' })
    expect(screen.markdown).toBe('# Web › Page A\nhttps://a.test/\n\nAll about A.')
    const link = screen.elements.find((e) => e.label === 'Go to B')!
    expect((await shell.perform(link, {})).summary).toBe('Now on "Page B"')
    screen = await shell.screen()
    expect(screen).toMatchObject({ id: 'web:page/1', url: 'https://b.test/' })
    expect(screen.elements.map((e) => e.label)).toEqual(['Full screen', 'Back to A'])
    await shell.global('back')
    expect(await shell.screen()).toMatchObject({ id: 'web:page/0', url: 'https://a.test/' })
    expect(pages.loads).toEqual(['https://a.test/', 'https://a.test/'])
  })

  it('keeps a page opened again as the one page in the history', async () => {
    const pages = new FakePages(SITE)
    const shell = new Shell([webApp], { env: {}, fetch, pages }, () => {})
    await shell.openUrl('https://a.test/')
    await shell.openUrl('https://a.test/')
    expect(shell.screenNow()).toMatchObject({ id: 'web:page/0', url: 'https://a.test/' })
    expect(pages.loads).toEqual(['https://a.test/', 'https://a.test/'])
  })

  it('takes a page the user went to themselves into the history when it reads the page again', async () => {
    const pages = new FakePages(SITE)
    const shell = new Shell([webApp], { env: {}, fetch, pages }, () => {})
    await shell.openUrl('https://a.test/')
    expect(await shell.refresh('web')).toBe(false)
    pages.tab(1).url = 'https://b.test/'
    expect(await shell.refresh('web')).toBe(true)
    expect(shell.screenNow()).toMatchObject({ id: 'web:page/1', url: 'https://b.test/' })
    await shell.global('back')
    expect(shell.screenNow()).toMatchObject({ id: 'web:page/0', url: 'https://a.test/' })
  })

  it('keeps pages open in tabs: going back to one shows it as it was left, unless it was just written', async () => {
    const pages = new FakePages(SITE)
    const shell = new Shell([webApp], { env: {}, fetch, pages }, () => {})
    await shell.openUrl('https://a.test/')
    await shell.openUrl('https://b.test/')
    expect(shell.openPages()).toEqual([{ url: 'https://a.test/', title: 'Page A' }])
    const back = await shell.openUrl('https://a.test/')
    expect(back.summary).toBe('Opened "Page A" (a.test), as it was left')
    expect(pages.loads).toEqual(['https://a.test/', 'https://b.test/'])
    expect(shell.screenNow()).toMatchObject({ id: 'web:page/0', url: 'https://a.test/' })
    expect(shell.openPages()).toEqual([{ url: 'https://b.test/', title: 'Page B' }])
    expect((shell.surfaces.get('web') as WebState).tabs).toEqual([
      { id: 2, page: 1 },
      { id: 1, page: 0 },
    ])
    await shell.openUrl('https://b.test/', { fresh: true })
    expect(pages.loads).toEqual(['https://a.test/', 'https://b.test/', 'https://b.test/'])
    expect(pages.tabs.get(2)!.url).toBe('https://b.test/')
    expect(shell.screenNow()).toMatchObject({ id: 'web:page/1', url: 'https://b.test/' })
  })

  it('closes the tab shown longest ago when one too many is open, and opens its page again in a new tab', async () => {
    const site: Site = Object.fromEntries(Array.from({ length: MAX_TABS + 1 }, (_, i) => [`https://p${i}.test/`, { title: `Page ${i}`, text: `Page ${i}.` }]))
    const pages = new FakePages(site)
    const shell = new Shell([webApp], { env: {}, fetch, pages }, () => {})
    for (let i = 0; i <= MAX_TABS; i++) await shell.openUrl(`https://p${i}.test/`)
    let state = shell.surfaces.get('web') as WebState
    expect(state.tabs.map((t) => t.id)).toEqual([2, 3, 4, 5, 6, 7])
    expect(shell.openPages().map((p) => p.title)).toEqual(['Page 1', 'Page 2', 'Page 3', 'Page 4', 'Page 5'])
    await shell.openUrl('https://p0.test/')
    state = shell.surfaces.get('web') as WebState
    expect(state.tabs.map((t) => t.id)).toEqual([3, 4, 5, 6, 7, 8])
    expect(pages.loads.filter((u) => u === 'https://p0.test/')).toHaveLength(2)
    expect(pages.tabs.get(8)!.url).toBe('https://p0.test/')
    await shell.global('back')
    expect(shell.screenNow()).toMatchObject({ url: 'https://p6.test/' })
    expect(pages.loads).toHaveLength(MAX_TABS + 2)
  })

  it("opens a page that can't load with what went wrong, and no elements", async () => {
    const shell = new Shell([webApp], { env: {}, fetch, pages: new FakePages(SITE) }, () => {})
    const result = await shell.openUrl('https://nowhere.test/')
    expect(result.summary).toBe("Opened nowhere.test; Couldn't open the page: ERR_NAME_NOT_RESOLVED")
    const screen = await shell.screen()
    expect(screen.id).toBe('web:page/0')
    expect(screen.elements.map((e) => e.label)).toEqual(['Full screen'])
  })

  it("gives the address of a file in the user's folder the Web app can show, however the path is written", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'shell-folder-')))
    mkdirSync(join(root, 'My pages'))
    writeFileSync(join(root, 'My pages', 'plan.html'), '<h1>Plan</h1>')
    writeFileSync(join(root, 'notes.docx'), '')
    const shell = new Shell([webApp], { env: {}, fetch }, () => {}, undefined, { folder: { root, shown: '~/Stanley' } })
    expect(shell.fileUrl('My pages/plan.html')).toBe('stanley://files/My%20pages/plan.html')
    expect(shell.fileUrl('~/Stanley/My pages/plan.html')).toBe('stanley://files/My%20pages/plan.html')
    expect(shell.fileUrl(join(root, 'My pages/plan.html'))).toBe('stanley://files/My%20pages/plan.html')
    expect(shell.fileUrl('notes.docx')).toBeUndefined()
    expect(shell.fileUrl('gone.html')).toBeUndefined()
    expect(shell.fileUrl('../plan.html')).toBeUndefined()
    expect(new Shell([tasksApp], { env: {}, fetch }, () => {}, undefined, { folder: { root, shown: '~/Stanley' } }).fileUrl('My pages/plan.html')).toBeUndefined()
  })
})
