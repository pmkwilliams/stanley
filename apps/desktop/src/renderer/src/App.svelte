<script lang="ts">
  import type { Snapshot } from '../../shared/ipc'
  import { cubicIn, cubicOut } from 'svelte/easing'
  import { scale } from 'svelte/transition'
  import { startMic } from './mic'
  import Presence from './Presence.svelte'
  import { loudness, mic } from './presence'
  import { backgrounds, surfaces } from './surfaces'

  let snapshot = $state<Snapshot | null>(null)
  let stopMic: (() => void) | null = null
  /** Bumped on every listening change, so a mic that finishes starting after a newer change is stopped. */
  let micRequest = 0

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
  const background = $derived(!!snapshot && snapshot.focus !== visible && (snapshot.status === 'writing' || snapshot.status === 'acting'))

  const KEYS: Record<string, string> = { CommandOrControl: '⌘', Command: '⌘', Control: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧' }
  function keys(accel: string) {
    return accel.split('+').map((k) => KEYS[k] ?? k)
  }
</script>

<div class="shell">
  {#if snapshot}<Presence {snapshot} docked={!!visible} />{/if}
  <header>
    <button class="crumb" onclick={() => window.stanley.open(null)}>Stanley</button>
    {#if visible}<span class="muted">›</span><span>{snapshot?.apps.find((a) => a.id === visible)?.title}</span>{/if}
    <span class="spacer"></span>
    {#if background}<span class="pill working">Working in background…</span>{/if}
    <button class="pill" class:live={snapshot?.listening} onclick={() => window.stanley.toggleListening()}>
      {#if snapshot?.listening}<span class="dot"></span>Listening
      {:else if snapshot?.ptt}{#each keys(snapshot.ptt) as key, i (i)}<kbd>{key}</kbd>{/each} to talk
      {:else}Click to talk{/if}
    </button>
  </header>

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

{#if snapshot}
  {#each Object.entries(backgrounds) as [appId, Background] (appId)}
    {#if snapshot.surfaces[appId] !== undefined}
      <Background data={snapshot.surfaces[appId]} perform={(nodeId: string, args?: { text?: string }) => window.stanley.perform(appId, nodeId, args)} />
    {/if}
  {/each}
{/if}

<style>
  .shell {
    display: grid; grid-template-columns: 1fr; grid-template-rows: 44px minmax(0, 1fr); height: 100vh;
    background:
      radial-gradient(1200px 600px at 15% -10%, rgba(255, 255, 255, 0.07), transparent 60%),
      radial-gradient(900px 500px at 110% 110%, rgba(255, 99, 99, 0.06), transparent 60%),
      var(--bg);
    /* Largest a window may grow; surfaces that have no natural size (e.g. a web page) fill it. */
    --window-max-width: calc(100vw - 64px);
    --window-max-height: calc(100vh - 44px - 64px);
  }
  header {
    position: relative; z-index: 1;
    grid-column: 1 / -1; display: flex; align-items: center; gap: 6px; padding: 0 10px 0 84px;
    -webkit-app-region: drag;
  }
  header button { -webkit-app-region: no-drag; }
  .crumb { background: none; border: 0; font-weight: 600; padding: 4px 6px; }
  .crumb:hover { background: var(--hover); }
  .muted { color: var(--muted); }
  .spacer { flex: 1; }
  .pill {
    display: flex; align-items: center; gap: 4px; height: 28px; padding: 0 10px; font-size: 12px;
    background: var(--window); border: 1px solid var(--border); border-radius: 8px; backdrop-filter: blur(20px);
  }
  .pill.live { border-color: rgba(255, 99, 99, 0.5); }
  .pill.working { color: var(--muted); cursor: default; }
  .pill :global(kbd:last-of-type) { margin-right: 2px; }
  .dot { width: 7px; height: 7px; margin-right: 4px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 8px var(--accent); animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.35; } }

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
