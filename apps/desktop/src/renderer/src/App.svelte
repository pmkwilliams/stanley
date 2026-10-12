<script lang="ts">
  import type { Snapshot } from '../../shared/ipc'
  import { cubicIn, cubicOut } from 'svelte/easing'
  import { fade, scale } from 'svelte/transition'
  import LockScreen from './LockScreen.svelte'
  import { startMic } from './mic'
  import Presence from './Presence.svelte'
  import StatusBar from './StatusBar.svelte'
  import { loudness, mic, voiceOut } from './presence'
  import { backgrounds, surfaces } from './surfaces'
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

  const visible = $derived(snapshot?.layout.visible ?? null)
  /** Main owns it (see `lock` there); locked until the first snapshot says otherwise. */
  const locked = $derived(snapshot?.locked ?? true)
</script>

<!-- Inert while locked, so nothing under the lock screen can be focused or clicked. -->
<div class="shell" class:locked inert={locked}>
  {#if snapshot}<Presence {snapshot} docked={!!visible && !locked} captions={!locked} />{/if}
  <StatusBar {snapshot} onlock={() => window.stanley.lock()} />

  <main>
    {#if snapshot}
      <!-- Keyed on the app, so switching plays the old window's outro while the new one pops in over it. -->
      {#each visible && surfaces[visible] ? [visible] : [] as id (id)}
        {@const Surface = surfaces[id]}
        <div class="window" in:scale={{ start: 0.96, duration: 180, easing: cubicOut }} out:scale={{ start: 0.94, duration: 140, easing: cubicIn }}>
          <Surface data={snapshot.surfaces[id]} perform={(nodeId: string, args?: { text?: string }) => window.stanley.perform(id, nodeId, args)} />
        </div>
      {/each}
    {/if}
  </main>
</div>

{#if locked}
  <div transition:fade={{ duration: 250 }}><LockScreen onunlock={() => window.stanley.unlock()} /></div>
{/if}

{#if snapshot}
  {#each Object.entries(backgrounds) as [appId, Background] (appId)}
    {#if snapshot.surfaces[appId] !== undefined}
      <Background data={snapshot.surfaces[appId]} perform={(nodeId: string, args?: { text?: string }) => window.stanley.perform(appId, nodeId, args)} volume={snapshot.talking ? 0.25 : 1} />
    {/if}
  {/each}
{/if}

<style>
  .shell {
    display: grid; grid-template-columns: 1fr; grid-template-rows: var(--bar-height) minmax(0, 1fr); height: 100vh;
    background: var(--wallpaper);
    --bar-height: 80px;
    /* Largest a window may grow; surfaces that have no natural size (e.g. a web page) fill it. */
    --window-max-width: calc(100vw - 64px);
    --window-max-height: calc(100vh - var(--bar-height) - 64px);
  }

  /* Locked, only the aura stays: the bar and windows fade with the lock screen's own fade. */
  .shell > :global(header), main { transition: opacity 0.25s; }
  .shell.locked > :global(header), .shell.locked > main { opacity: 0; }

  main { overflow: auto; position: relative; }
  main:has(> .window) { display: grid; place-items: center; overflow: hidden; }
  .window {
    /* Share one cell so an outgoing window sinks behind the incoming one instead of pushing it aside. */
    grid-area: 1 / 1; z-index: 1;
    display: flex; flex-direction: column; max-width: var(--window-max-width); max-height: var(--window-max-height); overflow: auto;
    background: var(--window); backdrop-filter: blur(40px) saturate(1.6);
    border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 14px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 0 0 0.5px rgba(0, 0, 0, 0.8), 0 24px 80px rgba(0, 0, 0, 0.55);
  }
  /* Svelte marks an outroing element inert; keep it underneath the incoming window. */
  .window:global([inert]) { z-index: 0; }
</style>
