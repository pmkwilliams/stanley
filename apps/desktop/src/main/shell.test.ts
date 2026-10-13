import { describe, expect, it } from 'vitest'
import type { AppStore } from '@stanley/app-sdk'
import { emailApp } from '@stanley/app-email/core'
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
    expect(screen).toMatchObject({ id: 'web:page/1', url: 'https://www.toureiffel.paris/en', elements: [] })
    await shell.global('back')
    screen = await shell.screen()
    expect(screen).toMatchObject({ id: 'web:page/0', url: 'https://en.wikipedia.org/wiki/Louvre' })
  })
})
