import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AppStore, LivePage } from '@stanley/app-sdk'
import { emailApp } from '@stanley/app-email/core'
import { readSettings, settingsApp } from '@stanley/app-settings/core'
import { todoApp } from '@stanley/app-todo/core'
import { webApp } from '@stanley/app-web/core'
import { Shell } from './shell'

const make = () => new Shell([emailApp, todoApp], { env: {}, fetch }, () => {})

type Site = Record<string, { title: string; text: string; links?: Record<string, string> }>

/** A browser in memory: each page has a title, text and links, and following a link goes to its page. */
class FakePage implements LivePage {
  url = 'about:blank'
  /** Addresses gone to by `goto`. */
  loads: string[] = []

  constructor(private site: Site) {}

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

const SITE: Site = {
  'https://a.test/': { title: 'Page A', text: 'All about A.', links: { 'Go to B': 'https://b.test/' } },
  'https://b.test/': { title: 'Page B', text: 'All about B.', links: { 'Back to A': 'https://a.test/' } },
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
    const shell = new Shell([todoApp], { env: {}, fetch }, () => {}, () => locks++)
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
    await shell.open('todo')
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
    const shell = new Shell([webApp, todoApp], { env: {}, fetch: () => Promise.reject(new Error('offline')) }, () => {})
    await shell.openUrl('https://en.wikipedia.org/wiki/Louvre')
    await shell.openUrl('https://www.toureiffel.paris/en')
    let screen = await shell.screen()
    expect(screen).toMatchObject({ id: 'web:page/1', url: 'https://www.toureiffel.paris/en', elements: [] })
    await shell.global('back')
    screen = await shell.screen()
    expect(screen).toMatchObject({ id: 'web:page/0', url: 'https://en.wikipedia.org/wiki/Louvre' })
  })

  it("works a live page: its links are the screen's elements, and a page a link went to can be gone back from", async () => {
    const page = new FakePage(SITE)
    const shell = new Shell([webApp, todoApp], { env: {}, fetch, page }, () => {})
    await shell.openUrl('https://a.test/')
    let screen = await shell.screen()
    expect(screen).toMatchObject({ id: 'web:page/0', url: 'https://a.test/' })
    expect(screen.markdown).toBe('# Web › Page A\nhttps://a.test/\n\nAll about A.')
    const link = screen.elements.find((e) => e.label === 'Go to B')!
    expect((await shell.perform(link, {})).summary).toBe('Now on "Page B"')
    screen = await shell.screen()
    expect(screen).toMatchObject({ id: 'web:page/1', url: 'https://b.test/' })
    expect(screen.elements.map((e) => e.label)).toEqual(['Back to A'])
    await shell.global('back')
    expect(await shell.screen()).toMatchObject({ id: 'web:page/0', url: 'https://a.test/' })
    expect(page.loads).toEqual(['https://a.test/', 'https://a.test/'])
  })

  it('offers the Web app once it has a page, to go back to it from another app', async () => {
    const shell = new Shell([webApp, todoApp], { env: {}, fetch, page: new FakePage(SITE) }, () => {})
    expect(shell.appList().map((a) => a.id)).toEqual(['todo'])
    await shell.openUrl('https://a.test/')
    await shell.open('todo')
    expect(shell.appList().map((a) => a.id)).toEqual(['web', 'todo'])
    await shell.open('web')
    expect(await shell.screen()).toMatchObject({ id: 'web:page/0', url: 'https://a.test/' })
  })

  it('keeps a page opened again as the one page in the history', async () => {
    const page = new FakePage(SITE)
    const shell = new Shell([webApp], { env: {}, fetch, page }, () => {})
    await shell.openUrl('https://a.test/')
    await shell.openUrl('https://a.test/')
    expect(shell.screenNow()).toMatchObject({ id: 'web:page/0', url: 'https://a.test/' })
    expect(page.loads).toEqual(['https://a.test/', 'https://a.test/'])
  })

  it('takes a page the user went to themselves into the history when it reads the page again', async () => {
    const page = new FakePage(SITE)
    const shell = new Shell([webApp], { env: {}, fetch, page }, () => {})
    await shell.openUrl('https://a.test/')
    expect(await shell.refresh('web')).toBe(false)
    page.url = 'https://b.test/'
    expect(await shell.refresh('web')).toBe(true)
    expect(shell.screenNow()).toMatchObject({ id: 'web:page/1', url: 'https://b.test/' })
    await shell.global('back')
    expect(shell.screenNow()).toMatchObject({ id: 'web:page/0', url: 'https://a.test/' })
  })

  it("opens a page that can't load with what went wrong, and no elements", async () => {
    const shell = new Shell([webApp], { env: {}, fetch, page: new FakePage(SITE) }, () => {})
    const result = await shell.openUrl('https://nowhere.test/')
    expect(result.summary).toBe("Opened nowhere.test; Couldn't open the page: ERR_NAME_NOT_RESOLVED")
    expect(await shell.screen()).toMatchObject({ id: 'web:page/0', elements: [] })
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
    expect(new Shell([todoApp], { env: {}, fetch }, () => {}, undefined, { folder: { root, shown: '~/Stanley' } }).fileUrl('My pages/plan.html')).toBeUndefined()
  })
})
