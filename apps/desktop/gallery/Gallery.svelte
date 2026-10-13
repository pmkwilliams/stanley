<script lang="ts">
  import type { ActionArgs, AppContext, AppModule } from '@stanley/app-sdk'
  import { emailApp } from '@stanley/app-email/core'
  import { lightsApp } from '@stanley/app-lights/core'
  import { musicApp } from '@stanley/app-music/core'
  import { settingsApp } from '@stanley/app-settings/core'
  import { todoApp } from '@stanley/app-todo/core'
  import { weatherApp } from '@stanley/app-weather/core'
  import { webApp } from '@stanley/app-web/core'
  import StatusBar from '../src/renderer/src/StatusBar.svelte'
  import { backgrounds, surfaces } from '../src/renderer/src/surfaces'
  import { fixtures } from './fixtures'

  const apps: Record<string, AppModule<any>> = { email: emailApp, lights: lightsApp, music: musicApp, settings: settingsApp, todo: todoApp, weather: weatherApp, web: webApp }

  const params = new URLSearchParams(location.search)
  const id = params.get('app') ?? ''
  const app = apps[id]
  const theme = params.get('theme') === 'light' ? 'light' : 'dark'
  document.documentElement.dataset.theme = theme

  /** The shell's store, starting with the theme asked for (Settings reads it from there). */
  const saved = new Map<string, unknown>([['theme', theme]])
  const ctx: AppContext = { env: {}, fetch: (...a) => fetch(...a), store: { get: (k) => saved.get(k), set: (k, v) => void saved.set(k, v) } }

  let data = $state<unknown>(null)
  let log = $state<string[]>([])
  /** Like the shell's surface queue: actions run one at a time, in order. */
  let queue: Promise<void> = Promise.resolve()

  function perform(nodeId: string, args: ActionArgs = {}) {
    queue = queue.then(async () => {
      const r = await app.perform(data, nodeId, args, ctx)
      data = r.state
      log = [...log, r.summary]
    })
    return queue
  }

  if (app) {
    queue = (async () => {
      const fixture = params.get('fixture')
      data = fixture ? structuredClone(fixtures[id]?.[fixture]) : await app.init(ctx)
    })()
    // `do=nodeId` or `do=nodeId|text`, repeated, run in order before the screenshot.
    for (const step of params.getAll('do')) {
      const [nodeId, text] = step.split('|')
      perform(nodeId, text === undefined ? {} : { text })
    }
    queue.then(() => document.body.setAttribute('data-ready', ''))
  } else document.body.setAttribute('data-ready', '')

  // Settings drives the theme, as it does in the shell.
  $effect(() => {
    const t = (data as { theme?: string } | null)?.theme
    if (id === 'settings' && t) document.documentElement.dataset.theme = t
  })

  /** Just enough of the shell's snapshot for the real status bar; its buttons act on this app. */
  const snapshot = $derived({ layout: { visible: id }, surfaces: data ? { [id]: data } : {}, focus: null, status: 'idle', listening: false } as any)
  ;(window as any).stanley = { perform: (_: string, nodeId: string, args?: ActionArgs) => perform(nodeId, args), open: () => {}, toggleListening: () => {}, lock: () => {} }

  const Surface = surfaces[id]
  const Background = backgrounds[id]
</script>

<div class="stage">
  <div class="bar">{#if app}<StatusBar {snapshot} onlock={() => {}} />{/if}</div>
  <main>
    {#if app && data}
      <div class="window ui-window"><Surface {data} {perform} /></div>
      {#if Background}<Background {data} {perform} />{/if}
    {:else if !app}
      <nav>
        {#each Object.keys(apps) as a (a)}
          <a href="?app={a}&theme=dark">{a} · dark</a><a href="?app={a}&theme=light">{a} · light</a>
        {/each}
      </nav>
    {/if}
  </main>
  {#if params.has('log')}<pre class="log">{log.join('\n')}</pre>{/if}
</div>

<style>
  /* Mirrors the shell's layout (App.svelte): an 80px status bar, then the window centred under it. */
  .stage {
    display: grid; grid-template-rows: var(--bar-height) minmax(0, 1fr); height: 100vh; position: relative;
    --bar-height: 80px;
    --window-max-width: calc(100vw - 64px);
    --window-max-height: calc(100vh - var(--bar-height) - 64px);
    /* Stand-in for Stanley's aurora, so the window's glass has something to show through. */
    background:
      radial-gradient(40% 30% at 30% 100%, rgba(79, 209, 165, 0.35), transparent 70%),
      radial-gradient(40% 30% at 70% 100%, rgba(138, 124, 240, 0.35), transparent 70%),
      var(--wallpaper);
  }
  main { display: grid; place-items: center; min-height: 0; overflow: hidden; }
  .window { display: flex; flex-direction: column; max-width: var(--window-max-width); max-height: var(--window-max-height); overflow: hidden; }
  nav { display: grid; grid-template-columns: repeat(2, auto); gap: 8px 24px; }
  nav a { color: var(--text); }
  .log { position: fixed; left: 12px; bottom: 12px; margin: 0; font-size: 11px; color: var(--muted); }
  /* Electron's <webview> doesn't exist in a browser: show where the page would be. */
  :global(webview) { display: block; background: repeating-linear-gradient(45deg, var(--panel) 0 12px, transparent 12px 24px); }
</style>
