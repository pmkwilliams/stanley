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

<!-- Mirrors the shell's layout (App.svelte): an 80px status bar, then the window centred under it.
     The stage's background is a stand-in for Stanley's aurora, so the window's glass has something to show through. -->
<div
  class="relative grid h-screen grid-rows-[var(--bar-height)_minmax(0,1fr)]"
  style="--bar-height: 80px; --window-max-width: calc(100vw - 64px); --window-max-height: calc(100vh - var(--bar-height) - 64px);
         background: radial-gradient(40% 30% at 30% 100%, rgba(79, 209, 165, 0.35), transparent 70%), radial-gradient(40% 30% at 70% 100%, rgba(138, 124, 240, 0.35), transparent 70%), var(--wallpaper)"
>
  <div>{#if app}<StatusBar {snapshot} onlock={() => {}} />{/if}</div>
  <main class="grid min-h-0 place-items-center overflow-hidden">
    {#if app && data}
      <div class="flex max-h-(--window-max-height) max-w-(--window-max-width) flex-col overflow-hidden rounded-3xl border bg-card/80 shadow-window backdrop-blur-2xl backdrop-saturate-150"><Surface {data} {perform} /></div>
      {#if Background}<Background {data} {perform} />{/if}
    {:else if !app}
      <nav class="grid grid-cols-[repeat(2,auto)] gap-x-6 gap-y-2">
        {#each Object.keys(apps) as a (a)}
          <a class="text-foreground underline" href="?app={a}&theme=dark">{a} · dark</a><a class="text-foreground underline" href="?app={a}&theme=light">{a} · light</a>
        {/each}
      </nav>
    {/if}
  </main>
  {#if params.has('log')}<pre class="fixed bottom-3 left-3 text-xs text-muted-foreground">{log.join('\n')}</pre>{/if}
</div>

<style>
  /* Electron's <webview> doesn't exist in a browser: show where the page would be. */
  :global(webview) { display: block; background: repeating-linear-gradient(45deg, var(--muted) 0 12px, transparent 12px 24px); }
</style>
