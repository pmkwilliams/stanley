<script lang="ts">
  import type { Snapshot } from '../../shared/ipc'
  import { cubicIn, cubicOut } from 'svelte/easing'
  import { fade, scale } from 'svelte/transition'
  import { appWindow } from '@stanley/app-ui/components/app'
  import LockScreen from './LockScreen.svelte'
  import { startMic } from './mic'
  import Presence from './Presence.svelte'
  import StatusBar from './StatusBar.svelte'
  import { loudness, mic, voiceOut } from './presence'
  import { backgrounds, kept, surfaces } from './surfaces'
  import { setTheme } from './theme.svelte'
  import { startVoice } from './voice'

  let snapshot = $state<Snapshot | null>(null)
  let stopMic: (() => void) | null = null
  /** Bumped on every listening change, so a mic that finishes starting after a newer change is stopped. */
  let micRequest = 0

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
        const stop = await startMic((c) => {
          mic.level = loudness(c)
          window.stanley.audio(c)
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

  const visible = $derived(snapshot?.layout.visible ?? null)
  /** Main owns it (see `lock` there); locked until the first snapshot says otherwise. */
  const locked = $derived(snapshot?.locked ?? true)
</script>

<!--
  Inert while locked, so nothing under the lock screen can be focused or clicked.
  `--caption-height`: a strip at the bottom kept clear for the captions (see Presence). It is main's padding,
  not its own row, so a window's shadow can still spill into it rather than being clipped.
  `--window-max-*`: the largest a window may grow; surfaces with no natural size (e.g. a web page) fill it.
  Locked, only the aura stays: the bar and windows fade with the lock screen's own fade.
-->
<div
  class={['grid h-screen grid-cols-1 grid-rows-[var(--bar-height)_minmax(0,1fr)] bg-background [&>header]:transition-opacity [&>header]:duration-250', locked && '[&>header]:opacity-0']}
  style="--bar-height: 80px; --caption-height: 48px; --window-max-width: calc(100vw - 64px); --window-max-height: calc(100vh - var(--bar-height) - var(--caption-height) - 64px)"
  inert={locked}
>
  {#if snapshot}<Presence {snapshot} docked={!!visible && !locked} captions={!locked} />{/if}
  <StatusBar {snapshot} onlock={() => window.stanley.lock()} />

  <main class={['relative overflow-auto pb-(--caption-height) transition-opacity duration-250 has-[>div]:grid has-[>div]:place-items-center has-[>div]:overflow-hidden', locked && 'opacity-0']}>
    {#if snapshot}
      <!-- Keyed on the app, so switching plays the old window's outro while the new one pops in over it. -->
      <!-- Windows share one cell, so an outgoing one sinks behind the incoming one instead of pushing it aside; Svelte marks it inert. -->
      {#each visible && surfaces[visible] && !kept.has(visible) ? [visible] : [] as id (id)}
        {@const Surface = surfaces[id]}
        <div
          class={[appWindow, 'z-1 col-start-1 row-start-1 inert:z-0']}
          in:scale={{ start: 0.85, duration: 340, easing: cubicOut }}
          out:scale={{ start: 0.88, duration: 260, easing: cubicIn }}
        >
          <Surface data={snapshot.surfaces[id]} perform={(nodeId: string, args?: { text?: string }) => window.stanley.perform(id, nodeId, args)} agentName={snapshot.name} />
        </div>
      {/each}
      <!-- A kept window is never taken out: hidden, it stays laid out at full size, out of sight and out of reach, and pops in and out the same way. -->
      {#each [...kept].filter((id) => snapshot!.surfaces[id] !== undefined) as id (id)}
        {@const Surface = surfaces[id]}
        <div
          class={[appWindow, 'col-start-1 row-start-1 transition-all', visible === id ? 'z-1 duration-340 ease-out' : 'invisible z-0 scale-88 opacity-0 duration-260 ease-in']}
          inert={visible !== id}
        >
          <Surface data={snapshot.surfaces[id]} perform={(nodeId: string, args?: { text?: string }) => window.stanley.perform(id, nodeId, args)} agentName={snapshot.name} />
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
      <Background data={snapshot.surfaces[appId]} perform={(nodeId: string, args?: { text?: string }) => window.stanley.perform(appId, nodeId, args)} volume={snapshot.talking ? 0.25 : 1} agentName={snapshot.name} />
    {/if}
  {/each}
{/if}
