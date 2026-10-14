import { describe, expect, it } from 'vitest'
import type { AppStore } from '@stanley/app-sdk'
import { emailApp, linkify } from '@stanley/app-email/core'
import { readSettings, settingsApp } from '@stanley/app-settings/core'
import { todoApp } from '@stanley/app-todo/core'
import { webApp } from '@stanley/app-web/core'
import { Shell } from './shell'

const make = () => new Shell([emailApp, todoApp], { env: {}, fetch }, () => {})

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
    const shell = new Shell([webApp, todoApp], { env: {}, fetch: () => Promise.reject(new Error('offline')) }, () => {})
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
    await shell.open('todo')
    await shell.global('show')
    expect(shell.layout).toEqual({ visible: 'todo', fullscreen: false })
    await shell.openUrl('https://www.toureiffel.paris/en')
    await shell.global('show')
    expect(shell.layout).toEqual({ visible: 'web', fullscreen: true })
    await shell.performIn('web', '@fullscreen', {})
    expect(shell.layout).toEqual({ visible: 'web', fullscreen: false })
  })
})
