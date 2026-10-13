/**
 * Launches the built desktop app (run `pnpm build` first), types two utterances, and saves
 * screenshots of the main and debug windows. Fails on any page error or error log. Paid: a
 * handful of Jev and Sonnet calls (free in mock mode, without AI_GATEWAY_API_KEY).
 *
 *   pnpm smoke:desktop [out-dir]
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { _electron } from 'playwright-core'

const root = join(import.meta.dirname, '..')
const out = process.argv[2] ?? '/tmp'
const pnpm = join(root, 'node_modules/.pnpm')
const electron = readdirSync(pnpm).find((d) => d.startsWith('electron@'))!
const env = { ...process.env } as Record<string, string>
// The agent shell may export this; Electron then runs as plain Node and can't open windows.
delete env.ELECTRON_RUN_AS_NODE
const app = await _electron.launch({ executablePath: join(pnpm, electron, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [join(root, 'apps/desktop')], env })

const problems: string[] = []
app.process().stderr?.on('data', (d) => /error/i.test(String(d)) && problems.push(String(d).trim()))
const main = await app.firstWindow()
main.on('pageerror', (e) => problems.push(`main window: ${e.message}`))
await main.waitForLoadState('domcontentloaded')

// Debug › Open Debug Window. (No named inner functions: tsx's helpers don't exist in Electron.)
await app.evaluate(({ Menu }) => {
  const stack: any[] = [...Menu.getApplicationMenu()!.items]
  while (stack.length) {
    const item = stack.shift()
    if (/Debug Window/.test(item.label)) return item.click()
    if (item.submenu) stack.push(...item.submenu.items)
  }
})
const debug = await app.waitForEvent('window')
debug.on('pageerror', (e) => problems.push(`debug window: ${e.message}`))
await debug.waitForLoadState('domcontentloaded')

for (const utterance of ['add call the plumber to my to do list', 'open my email']) {
  await main.evaluate(`window.stanley.say(${JSON.stringify(utterance)})`)
  await main.waitForTimeout(8000)
}
await main.screenshot({ path: join(out, 'stanley-main.png') })
const ticks = debug.locator('.tick')
const count = await ticks.count()
if (count) await ticks.nth(0).click()
await debug.waitForTimeout(300)
await debug.screenshot({ path: join(out, 'stanley-debug.png') })
await app.close()

console.log(`${count} ticks in the debug timeline; screenshots in ${out}`)
if (!count) problems.push('no ticks reached the debug window')
if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
