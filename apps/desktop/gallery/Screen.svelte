<script lang="ts">
  import { untrack } from 'svelte'
  import StatusBar from '../src/renderer/src/StatusBar.svelte'
  import { enter, leave, Motion } from '../src/renderer/src/motion'
  import { screenGrid, windowPlace, windowTile } from '../src/renderer/src/screen'
  import { surfaces } from '../src/renderer/src/surfaces'
  import { appWindow } from '@stanley/app-ui/components/app'

  /**
   * The screen with up to three apps, as the shell lays them out and moves them (App.svelte): one
   * alone, two side by side, or three with two stacked on one side. Given by whoever opens the page
   * (an eval, through `addInitScript`): the sides, each app's state, and the HTML a web page shows.
   * `window.__screenTo(sides)` lays it out again, for watching the windows move.
   */
  type Given = { sides: string[][]; states: Record<string, unknown>; pages?: Record<string, string> }
  const given = (window as any).__screen as Given
  document.documentElement.dataset.theme = 'dark'
  const { states } = given
  let sides = $state(given.sides)
  const shown = $derived(sides.flat())
  ;(window as any).__screenTo = (next: string[][]) => (sides = next)
  const snapshot = $derived({ layout: { sides }, surfaces: states, focus: null, status: 'idle', listening: false, tasks: [] } as any)
  ;(window as any).stanley = { perform: () => {}, open: () => {}, toggleListening: () => {}, lock: () => {} }

  const motion = new Motion()
  let wasShown: string[] = []
  $effect.pre(() => {
    void JSON.stringify(sides)
    untrack(() => motion.measure(wasShown))
  })
  $effect(() => {
    void JSON.stringify(sides)
    untrack(() => {
      motion.play(shown)
      wasShown = shown
    })
  })

  // A browser has no <webview>: the page's HTML goes in a frame where it would be.
  $effect(() => {
    void shown.length
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

<!-- The shell's sizes (App.svelte), the strip for captions included, so tiles are as big as they are there. -->
<div
  class="relative grid h-screen grid-rows-[var(--bar-height)_minmax(0,1fr)]"
  style="--bar-height: 80px; --caption-height: 48px; --window-max-width: calc(100vw - 2rem); --window-max-height: calc(100vh - var(--bar-height) - var(--caption-height) - 2rem);
         background: radial-gradient(40% 30% at 30% 100%, rgba(79, 209, 165, 0.35), transparent 70%), radial-gradient(40% 30% at 70% 100%, rgba(138, 124, 240, 0.35), transparent 70%), var(--background)"
>
  <div><StatusBar {snapshot} onlock={() => {}} /></div>
  <main class={['relative grid min-h-0 place-items-center overflow-hidden pb-(--caption-height)', screenGrid(sides)]}>
    {#each shown as id (id)}
      {@const Surface = surfaces[id]}
      <div class={[appWindow, sides.length < 2 && 'col-start-1 row-start-1', windowTile(sides), 'inert:z-0']} style={windowPlace(sides, id)} {@attach motion.track(id)} in:enter out:leave={{ from: motion.was(id) }}>
        <Surface data={states[id]} perform={() => {}} />
      </div>
    {/each}
  </main>
</div>
