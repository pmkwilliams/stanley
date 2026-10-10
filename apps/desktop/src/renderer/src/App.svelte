<script lang="ts">
  import type { Snapshot } from '../../shared/ipc'
  import Home from './Home.svelte'
  import { startMic } from './mic'
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
        if (!on || localStorage.getItem('stanley.noMic')) return
        const stop = await startMic((c) => window.stanley.audio(c))
        if (request === micRequest) stopMic = stop
        else stop()
      }),
    ]
    return () => offs.forEach((off) => off())
  })

  const visible = $derived(snapshot?.layout.visible ?? null)
  const Surface = $derived(visible ? surfaces[visible] : null)
  const background = $derived(!!snapshot && snapshot.focus !== visible && snapshot.status === 'acting')

  function pttLabel(accel: string) {
    return accel.replace('CommandOrControl', '⌘').replace('Alt', '⌥').replace('Shift', '⇧').replaceAll('+', '')
  }
</script>

<div class="shell">
  <header>
    <button class="crumb" onclick={() => window.stanley.open(null)}>Stanley</button>
    {#if visible}<span class="muted">› {snapshot?.apps.find((a) => a.id === visible)?.title}</span>{/if}
    <span class="spacer"></span>
    {#if background}<span class="pill working">Working in background…</span>{/if}
    <button class="pill" class:live={snapshot?.listening} onclick={() => window.stanley.toggleListening()}>
      {snapshot?.listening ? '● Listening' : snapshot?.ptt ? `${pttLabel(snapshot.ptt)} to talk` : 'Click to talk'}
    </button>
  </header>

  <main>
    {#if snapshot && Surface && visible}
      <Surface data={snapshot.surfaces[visible]} perform={(nodeId: string, args?: { text?: string }) => window.stanley.perform(visible, nodeId, args)} />
    {:else if snapshot}
      <Home apps={snapshot.apps} />
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
  .shell { display: grid; grid-template-columns: 1fr; grid-template-rows: 44px 1fr; height: 100vh; }
  header {
    grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; padding: 0 12px 0 84px;
    border-bottom: 1px solid var(--border); -webkit-app-region: drag;
  }
  header button { -webkit-app-region: no-drag; }
  .crumb { background: none; border: 0; font-weight: 600; cursor: pointer; }
  .muted { color: var(--muted); }
  .spacer { flex: 1; }
  .pill { background: var(--panel); border: 1px solid var(--border); border-radius: 999px; padding: 4px 10px; font-size: 12px; cursor: pointer; }
  .pill.live { border-color: var(--accent); color: var(--accent); }
  .pill.working { color: var(--muted); cursor: default; }
  main { overflow: auto; position: relative; }
</style>
