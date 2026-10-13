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

<header>
  <div class="side">
    <button class="pill home" aria-label="Lock" onclick={onlock}>
      <svg class="torus" viewBox="0 0 20 20" width="20" height="20"><path fill="currentColor" fill-rule="evenodd" d="M10 4c5 0 9 2.7 9 6s-4 6-9 6-9-2.7-9-6 4-6 9-6zm0 3.6c-2.1 0-3.8.7-3.8 1.6S7.9 10.8 10 10.8s3.8-.7 3.8-1.6S12.1 7.6 10 7.6z" /></svg>
      <svg class="lock" viewBox="0 0 20 20" width="20" height="20">
        <path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" fill="none" stroke="currentColor" stroke-width="1.8" /><rect x="4" y="8.5" width="12" height="9" rx="2" fill="currentColor" />
      </svg>
    </button>
    {#if background}<span class="pill working">Working in background…</span>{/if}
  </div>

  <!-- Now playing: there while Music has a track, whether or not its window is open. -->
  <div class="middle">
    {#if music}
      <div transition:fade={{ duration: 180 }}>
        <MiniPlayer data={music} perform={(nodeId: string) => window.stanley.perform('music', nodeId)} onopen={() => window.stanley.open('music')} />
      </div>
    {/if}
  </div>

  <div class="side right">
    <div class="pill tray">
      <span class="slot">
        <button class="icon mic" aria-label={snapshot?.listening ? 'Stop listening' : 'Talk'} onclick={() => window.stanley.toggleListening()}>
          {#if snapshot?.listening}
            <span class="stop"></span>
          {:else}
            <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <rect x="6.75" y="1.9" width="6.5" height="10.6" rx="3.25" fill="currentColor" stroke="none" /><path d="M3.9 9.4a6.1 6.1 0 0 0 12.2 0M10 15.6v2.6" />
            </svg>
          {/if}
        </button>
      </span>
      <span class="slot" aria-label="Wi-Fi">
        <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round">
          <path d="M1.6 7.6a12 12 0 0 1 16.8 0M4.6 10.6a7.8 7.8 0 0 1 10.8 0M7.6 13.6a3.6 3.6 0 0 1 4.8 0" /><circle cx="10" cy="16.4" r="1.3" fill="currentColor" stroke="none" />
        </svg>
      </span>
      <span class="slot battery" aria-label="Battery">
        <svg viewBox="0 0 26 20" width="26" height="20">
          <rect x="0.8" y="4.3" width="21.4" height="11.4" rx="3.4" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.5" />
          <rect x="2.7" y="6.2" width="13" height="7.6" rx="1.6" fill="currentColor" />
          <path d="M24 8v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity="0.5" />
        </svg>
      </span>
      <span class="clock">{weekday(clock.now)} {time(clock.now)}</span>
    </div>
  </div>
</header>

<style>
  /*
   * Measured off the reference: pills are 40 high with a 10 radius, inset 20 from every edge of the
   * screen, padded 20 inside, holding 20px icons 20 apart. Anything rounded inside a pill is
   * concentric with it: its radius is the pill's less the inset.
   */
  header {
    --pill-h: 40px; --pill-r: 10px; --pad: 20px;
    position: relative; z-index: 3;
    display: flex; align-items: center; justify-content: space-between; height: var(--bar-height); padding: 0 var(--pad);
    -webkit-app-region: drag;
  }
  header button { -webkit-app-region: no-drag; }
  .side { flex: 1; display: flex; align-items: center; gap: 10px; }
  .side.right { justify-content: flex-end; }

  .pill {
    display: flex; align-items: center; height: var(--pill-h); padding: 0 var(--pad); border: 0; border-radius: var(--pill-r);
    color: var(--text); background: var(--pill); backdrop-filter: blur(20px);
  }
  .home { position: relative; width: var(--pill-h); padding: 0; overflow: hidden; transition: background 0.12s; }
  .home:hover { background: var(--pill-hover); }
  /* Icons swap on a vertical track: the torus drops out the bottom as the lock drops in from the top; reversed on leave. */
  .home svg { position: absolute; top: 10px; left: 10px; transition: transform 0.32s cubic-bezier(0.2, 0.8, 0.2, 1); }
  .home .lock { transform: translateY(-30px); }
  .home:hover .torus { transform: translateY(30px); }
  .home:hover .lock { transform: none; }
  .working { font-size: 13px; color: color-mix(in srgb, var(--text) 60%, transparent); }

  .tray { gap: 20px; }
  .slot { display: grid; place-items: center; width: 20px; height: 20px; }
  .slot.battery { width: 26px; }
  .clock { font-size: 16px; font-weight: 500; white-space: nowrap; font-variant-numeric: tabular-nums; }

  /* Hover fills a 32px square: 4 in from the pill's top and bottom, so its radius is 10 - 4. */
  .icon {
    position: relative; display: grid; place-items: center; width: 20px; height: 20px; padding: 0;
    color: inherit; background: none; border: 0;
  }
  .icon::before { content: ''; position: absolute; inset: -6px; border-radius: calc(var(--pill-r) - 4px); transition: background 0.12s; }
  .icon:hover::before { background: color-mix(in srgb, var(--text) 12%, transparent); }
  .icon svg { position: relative; }
  /* Listening: a plain dot that squares off into a stop button on hover. */
  .stop { position: relative; width: 14px; height: 14px; border-radius: 50%; background: currentColor; transition: border-radius 0.24s cubic-bezier(0.2, 0.8, 0.2, 1); }
  .mic:hover .stop { border-radius: 1px; }

  .middle { flex: none; display: flex; justify-content: center; width: 200px; -webkit-app-region: no-drag; }
</style>
