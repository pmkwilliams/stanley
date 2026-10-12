import { describe, expect, it } from 'vitest'
import { emailApp } from '@stanley/app-email/core'
import { todoApp } from '@stanley/app-todo/core'
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
})
