<script lang="ts">
  import type { Snapshot } from '../../shared/ipc'
  import MiniPlayer from '@stanley/app-music/mini'
  import type { MusicState } from '@stanley/app-music/core'
  import { fade } from 'svelte/transition'
  import { clock, time, weekday } from './clock.svelte'

  let { snapshot, onlock }: { snapshot: Snapshot | null; onlock: () => void } = $props()

  const visible = $derived(snapshot?.layout.visible ?? null)
  const music = $derived(snapshot?.surfaces.music as MusicState | undefined)
  const background = $derived(!!snapshot && snapshot.focus !== visible && (snapshot.status === 'writing' || snapshot.status === 'acting'))
</script>

<!--
  Measured off the reference: pills are 40 high (h-10), inset 20 from every edge of the screen, padded 20 inside,
  holding 20px icons 20 apart. Anything rounded inside a pill is concentric with it: its radius is the pill's less the inset.
  The bar is what you drag the window by; its controls aren't.
-->
<header class="relative z-3 flex h-(--bar-height) items-center justify-between px-5 [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]">
  <div class="flex flex-1 items-center gap-2.5">
    <!-- Icons swap on a vertical track: the torus drops out the bottom as the lock drops in from the top; reversed on leave. -->
    <button
      class="group relative flex size-10 items-center overflow-hidden rounded-xl bg-pill text-foreground backdrop-blur-xl before:absolute before:inset-0 before:transition-colors hover:before:bg-accent"
      aria-label="Lock"
      onclick={onlock}
    >
      <svg class="absolute top-2.5 left-2.5 transition-transform duration-300 ease-out group-hover:translate-y-7.5" viewBox="0 0 20 20" width="20" height="20"><path fill="currentColor" fill-rule="evenodd" d="M10 4c5 0 9 2.7 9 6s-4 6-9 6-9-2.7-9-6 4-6 9-6zm0 3.6c-2.1 0-3.8.7-3.8 1.6S7.9 10.8 10 10.8s3.8-.7 3.8-1.6S12.1 7.6 10 7.6z" /></svg>
      <svg class="absolute top-2.5 left-2.5 -translate-y-7.5 transition-transform duration-300 ease-out group-hover:translate-y-0" viewBox="0 0 20 20" width="20" height="20">
        <path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" fill="none" stroke="currentColor" stroke-width="1.8" /><rect x="4" y="8.5" width="12" height="9" rx="2" fill="currentColor" />
      </svg>
    </button>
    {#if background}<span class="flex h-10 items-center rounded-xl bg-pill px-5 text-sm text-muted-foreground backdrop-blur-xl">Working in background…</span>{/if}
  </div>

  <!-- Now playing: there while Music has a track, whether or not its window is open. -->
  <div class="flex w-50 flex-none justify-center [-webkit-app-region:no-drag]">
    {#if music}
      <div transition:fade={{ duration: 180 }}>
        <MiniPlayer data={music} perform={(nodeId: string) => window.stanley.perform('music', nodeId)} onopen={() => window.stanley.open('music')} />
      </div>
    {/if}
  </div>

  <div class="flex flex-1 items-center justify-end gap-2.5">
    <div class="flex h-10 items-center gap-5 rounded-xl bg-pill px-5 text-foreground backdrop-blur-xl">
      <span class="grid size-5 place-items-center">
        <!-- Hover fills a 32px square, 4 in from the pill's top and bottom, so its radius is the pill's less 4. -->
        <button
          class="group relative grid size-5 place-items-center before:absolute before:-inset-1.5 before:rounded-lg before:transition-colors hover:before:bg-foreground/12"
          aria-label={snapshot?.listening ? 'Stop listening' : 'Talk'}
          onclick={() => window.stanley.toggleListening()}
        >
          {#if snapshot?.listening}
            <!-- Listening: a plain dot that squares off into a stop button on hover. -->
            <span class="relative size-3.5 rounded-full bg-current transition-[border-radius] duration-200 ease-out group-hover:rounded-xs"></span>
          {:else}
            <svg class="relative" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <rect x="6.75" y="1.9" width="6.5" height="10.6" rx="3.25" fill="currentColor" stroke="none" /><path d="M3.9 9.4a6.1 6.1 0 0 0 12.2 0M10 15.6v2.6" />
            </svg>
          {/if}
        </button>
      </span>
      <span class="grid size-5 place-items-center" aria-label="Wi-Fi">
        <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round">
          <path d="M1.6 7.6a12 12 0 0 1 16.8 0M4.6 10.6a7.8 7.8 0 0 1 10.8 0M7.6 13.6a3.6 3.6 0 0 1 4.8 0" /><circle cx="10" cy="16.4" r="1.3" fill="currentColor" stroke="none" />
        </svg>
      </span>
      <span class="grid h-5 w-6.5 place-items-center" aria-label="Battery">
        <svg viewBox="0 0 26 20" width="26" height="20">
          <rect x="0.8" y="4.3" width="21.4" height="11.4" rx="3.4" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.5" />
          <rect x="2.7" y="6.2" width="13" height="7.6" rx="1.6" fill="currentColor" />
          <path d="M24 8v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity="0.5" />
        </svg>
      </span>
      <span class="text-base font-medium whitespace-nowrap tabular-nums">{weekday(clock.now)} {time(clock.now)}</span>
    </div>
  </div>
</header>
