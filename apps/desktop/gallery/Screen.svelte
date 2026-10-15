<script lang="ts">
  import StatusBar from '../src/renderer/src/StatusBar.svelte'
  import { screenGrid, windowPlace, windowTile } from '../src/renderer/src/screen'
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
  const snapshot = { layout: { sides }, surfaces: states, focus: null, status: 'idle', listening: false, tasks: [] } as any
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
  style="--bar-height: 80px; --caption-height: 0px; --window-max-width: calc(100vw - 2rem); --window-max-height: calc(100vh - var(--bar-height) - 2rem);
         background: radial-gradient(40% 30% at 30% 100%, rgba(79, 209, 165, 0.35), transparent 70%), radial-gradient(40% 30% at 70% 100%, rgba(138, 124, 240, 0.35), transparent 70%), var(--background)"
>
  <div><StatusBar {snapshot} onlock={() => {}} /></div>
  <main class={['grid min-h-0 place-items-center overflow-hidden', screenGrid(sides)]}>
    {#each sides as side}
      {#each side as id (id)}
        {@const Surface = surfaces[id]}
        <div class={[appWindow, windowTile(sides)]} style={windowPlace(sides, id)}>
          <Surface data={states[id]} perform={() => {}} />
        </div>
      {/each}
    {/each}
  </main>
</div>
