<script lang="ts">
  import StatusBar from '../src/renderer/src/StatusBar.svelte'
  import { surfaces } from '../src/renderer/src/surfaces'
  import { appWindow } from '@stanley/app-ui/components/app'

  /**
   * The screen with up to three apps, as the shell would lay them out: one fills it, two sit side
   * by side, and with three, two are stacked on one side. Given by whoever opens the page (an eval
   * through `addInitScript`): the sides, each app's state, and the HTML a web page shows.
   */
  type Given = { sides: string[][]; states: Record<string, unknown>; pages?: Record<string, string> }
  const given = (window as any).__screen as Given
  document.documentElement.dataset.theme = 'dark'
  const { sides, states } = given
  const apps = sides.flat()
  const three = apps.length === 3

  /** Each window's cell: a side with one app spans both rows when the other side has two. */
  const cell = (side: number, row: number, of: number) =>
    sides.length === 1 ? '' : `grid-column: ${side + 1}; grid-row: ${of === 1 ? (three ? '1 / span 2' : '1') : row + 1};`
  /** The most a window may take: its share of the screen, less the gaps. */
  const size = (of: number) =>
    `--window-max-width: ${sides.length === 1 ? 'calc(100vw - 64px)' : 'calc((100vw - 88px) / 2)'}; --window-max-height: ${of === 2 ? 'calc((100vh - var(--bar-height) - 88px) / 2)' : 'calc(100vh - var(--bar-height) - 64px)'};`

  const snapshot = { layout: { visible: apps[0] }, surfaces: states, focus: null, status: 'idle', listening: false, tasks: [] } as any
  ;(window as any).stanley = { perform: () => {}, open: () => {}, toggleListening: () => {}, lock: () => {} }

  // A browser has no <webview>: the page's HTML goes in a frame where it would be.
  $effect(() => {
    for (const view of document.querySelectorAll('webview')) {
      const frame = document.createElement('iframe')
      frame.className = view.className
      frame.srcdoc = given.pages?.web ?? ''
      frame.style.border = '0'
      frame.style.background = 'white'
      view.replaceWith(frame)
    }
    document.body.setAttribute('data-ready', '')
  })
</script>

<div
  class="relative grid h-screen grid-rows-[var(--bar-height)_minmax(0,1fr)]"
  style="--bar-height: 80px;
         background: radial-gradient(40% 30% at 30% 100%, rgba(79, 209, 165, 0.35), transparent 70%), radial-gradient(40% 30% at 70% 100%, rgba(138, 124, 240, 0.35), transparent 70%), var(--background)"
>
  <div><StatusBar {snapshot} onlock={() => {}} /></div>
  <main class={['grid min-h-0 gap-6 overflow-hidden p-8', sides.length === 1 ? 'place-items-center' : 'grid-cols-2 place-items-center', three && 'grid-rows-2']}>
    {#each sides as side, s}
      {#each side as id, r (id)}
        {@const Surface = surfaces[id]}
        <div class={appWindow} style="{cell(s, r, side.length)} {size(side.length)}">
          <Surface data={states[id]} perform={() => {}} />
        </div>
      {/each}
    {/each}
  </main>
</div>
