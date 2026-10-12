import { describe, expect, it } from 'vitest'
import { emailApp } from '@stanley/app-email/core'
import { todoApp } from '@stanley/app-todo/core'
import { webApp } from '@stanley/app-web/core'
import { Shell } from './shell'

const make = () => new Shell([emailApp, todoApp], { env: {}, fetch }, () => {})

describe('Shell', () => {
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
