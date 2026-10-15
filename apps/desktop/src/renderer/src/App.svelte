<script lang="ts">
  import type { Snapshot } from '../../shared/ipc'
  import { untrack } from 'svelte'
  import { fade } from 'svelte/transition'
  import { FULLSCREEN } from '@stanley/app-sdk'
  import { appWindow } from '@stanley/app-ui/components/app'
  import LockScreen from './LockScreen.svelte'
  import { startMic } from './mic'
  import Presence from './Presence.svelte'
  import StatusBar from './StatusBar.svelte'
  import { ONSET_HOLD_MS, voiceMayStart } from './duck'
  import { dbfs, loudness, mic, voiceOut } from './presence'
  import { enter, leave, Motion } from './motion'
  import { screenGrid, windowPlace, windowTile } from './screen'
  import { backgrounds, kept, surfaces } from './surfaces'
  import { setTheme } from './theme.svelte'
  import { startVoice } from './voice'

  let snapshot = $state<Snapshot | null>(null)
  let stopMic: (() => void) | null = null
  /** Bumped on every listening change, so a mic that finishes starting after a newer change is stopped. */
  let micRequest = 0
  /** The (cancelled) mic's level says the user may be talking, ahead of the VAD (see `voiceMayStart`). */
  let voiceOnset = $state(false)
  let voiceOnsetEnds: ReturnType<typeof setTimeout> | undefined

  $effect(() => {
    const voice = startVoice()
    voiceOut.level = voice.level
    return () => {
      voiceOut.level = () => 0
      voice.stop()
    }
  })

  $effect(() => {
    const offs = [
      window.stanley.onSnapshot((s) => {
        snapshot = s
      }),
      window.stanley.onListening(async (on) => {
        const request = ++micRequest
        stopMic?.()
        stopMic = null
        // Dev: localStorage['stanley.noMic'] lets tests inject audio without the real mic mixing in.
        mic.level = 0
        if (!on || localStorage.getItem('stanley.noMic')) return
        const stop = await startMic((c, uncancelled) => {
          mic.level = loudness(c)
          if (voiceMayStart(dbfs(c))) {
            voiceOnset = true
            clearTimeout(voiceOnsetEnds)
            voiceOnsetEnds = setTimeout(() => (voiceOnset = false), ONSET_HOLD_MS)
          }
          // While the user talks over music, the transcriber hears them without the canceller (see
          // startMic). Never while Stanley talks: the canceller is what keeps it from hearing itself.
          window.stanley.audio(uncancelled && voiceOnset && !snapshot?.talking ? uncancelled : c)
        })
        if (request === micRequest) stopMic = stop
        else stop()
      }),
    ]
    return () => offs.forEach((off) => off())
  })

  $effect(() => {
    if (snapshot) setTheme(snapshot.theme)
  })

  /**
   * How loud apps' own sound may be: a quarter while Stanley talks or the user speaks. The mic's
   * level ducks it as the user starts, the VAD keeps it down, and the utterance holds it between
   * words, so music doesn't pump up and down with each pause.
   */
  const appVolume = $derived(snapshot?.talking || voiceOnset || snapshot?.speaking || snapshot?.utteranceOpen ? 0.25 : 1)

  /** The apps on the screen, left to right (see screen.ts). */
  const sides = $derived(snapshot?.layout.sides ?? [])
  const shown = $derived(sides.flat())
  /** The one app shown fills the screen, over the status bar but under the captions. */
  const fullscreen = $derived(!!snapshot?.layout.fullscreen)

  /**
   * Windows glide to their new places when the layout changes (motion.ts): where they are is
   * measured before the change reaches the page, and each moves from there once it has.
   */
  const motion = new Motion()
  const layoutKey = $derived(`${JSON.stringify(sides)} ${fullscreen}`)
  let wasShown: string[] = []
  $effect.pre(() => {
    void layoutKey
    untrack(() => motion.measure(wasShown))
  })
  $effect(() => {
    void layoutKey
    untrack(() => {
      motion.play(shown)
      wasShown = shown
    })
  })

  function leaveFullscreen(e: KeyboardEvent) {
    if (e.key === 'Escape' && fullscreen && shown.length === 1 && !locked) window.stanley.perform(shown[0]!, FULLSCREEN)
  }
  /** Main owns it (see `lock` there); locked until the first snapshot says otherwise. */
  const locked = $derived(snapshot?.locked ?? true)
</script>

<!--
  Inert while locked, so nothing under the lock screen can be focused or clicked.
  `--caption-height`: a strip at the bottom kept clear for the captions (see Presence). It is main's padding,
  not its own row, so a window's shadow can still spill into it rather than being clipped.
  `--window-max-*`: the largest a window may grow; surfaces with no natural size (e.g. a web page) fill it.
  Locked, only the aura stays: the bar and windows fade with the lock screen's own fade.
  Escape leaves full screen, as it does in a browser.
-->
<svelte:window onkeydown={leaveFullscreen} />
<div
  class={['grid h-screen grid-cols-1 grid-rows-[var(--bar-height)_minmax(0,1fr)] bg-background [&>header]:transition-opacity [&>header]:duration-250', locked && '[&>header]:opacity-0']}
  style="--bar-height: 80px; --caption-height: 48px; --window-max-width: calc(100vw - 2rem); --window-max-height: calc(100vh - var(--bar-height) - var(--caption-height) - 2rem)"
  inert={locked}
>
  {#if snapshot}<Presence {snapshot} docked={shown.length > 0 && !locked} captions={!locked} />{/if}
  <StatusBar {snapshot} onlock={() => window.stanley.lock()} />

  <main class={['relative overflow-auto pb-(--caption-height) transition-opacity duration-250 has-[>div]:grid has-[>div]:place-items-center has-[>div]:overflow-hidden', screenGrid(sides), locked && 'opacity-0']}>
    {#if snapshot}
      <!-- Keyed on the app, so switching plays the old window's outro while the new one pops in over it. -->
      <!-- A window leaving stays where it was, out of the grid, and sinks behind the others as it goes; Svelte marks it inert. Those staying glide to their new places (motion.ts). -->
      {#each shown.filter((id) => surfaces[id] && !kept.has(id)) as id (id)}
        {@const Surface = surfaces[id]}
        <div
          class={[appWindow, sides.length < 2 && 'col-start-1 row-start-1', windowTile(sides), 'inert:z-0', fullscreen ? 'z-4' : 'z-1']}
          style={windowPlace(sides, id)}
          data-fullscreen={fullscreen || undefined}
          {@attach motion.track(id)}
          in:enter
          out:leave={{ from: motion.was(id) }}
        >
          <Surface data={snapshot.surfaces[id]} perform={(nodeId: string, args?: { text?: string }) => window.stanley.perform(id, nodeId, args)} agentName={snapshot.name} {fullscreen} />
        </div>
      {/each}
      <!-- A kept window is never taken out: hidden, it stays laid out at full size, out of sight, out of reach and out of the grid, and pops in and out the same way. -->
      {#each [...kept].filter((id) => snapshot!.surfaces[id] !== undefined) as id (id)}
        {@const Surface = surfaces[id]}
        {@const on = shown.includes(id)}
        {@const full = on && fullscreen}
        <div
          class={[appWindow, 'transition-all motion-reduce:transition-none', on ? [sides.length < 2 && 'col-start-1 row-start-1', windowTile(sides), 'duration-340 ease-out', full ? 'z-4' : 'z-1'] : 'invisible absolute z-0 scale-88 opacity-0 duration-260 ease-in']}
          style={on ? windowPlace(sides, id) : ''}
          data-fullscreen={full || undefined}
          inert={!on}
          {@attach motion.track(id)}
        >
          <Surface data={snapshot.surfaces[id]} perform={(nodeId: string, args?: { text?: string }) => window.stanley.perform(id, nodeId, args)} agentName={snapshot.name} fullscreen={full} />
        </div>
      {/each}
    {/if}
  </main>
</div>

{#if locked}
  <div transition:fade={{ duration: 250 }}><LockScreen name={snapshot?.name} onunlock={() => window.stanley.unlock()} /></div>
{/if}

{#if snapshot}
  {#each Object.entries(backgrounds) as [appId, Background] (appId)}
    {#if snapshot.surfaces[appId] !== undefined}
      <Background data={snapshot.surfaces[appId]} perform={(nodeId: string, args?: { text?: string }) => window.stanley.perform(appId, nodeId, args)} volume={appVolume} agentName={snapshot.name} />
    {/if}
  {/each}
{/if}
