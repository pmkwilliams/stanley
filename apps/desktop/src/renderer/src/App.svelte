<script lang="ts">
  import type { TickReport } from '@stanley/agent'
  import type { Snapshot } from '../../shared/ipc'
  import Home from './Home.svelte'
  import Hud from './Hud.svelte'
  import { startMic } from './mic'
  import { surfaces } from './surfaces'

  let snapshot = $state<Snapshot | null>(null)
  let ticks = $state<TickReport[]>([])
  let hud = $state(true)
  let stopMic: (() => void) | null = null

  $effect(() => {
    const offs = [
      window.stanley.onSnapshot((s) => (snapshot = s)),
      window.stanley.onTick((t) => (ticks = [t, ...ticks].slice(0, 50))),
      window.stanley.onListening(async (on) => {
        stopMic?.()
        // Dev: localStorage['stanley.noMic'] lets tests inject audio without the real mic mixing in.
        const useMic = on && !localStorage.getItem('stanley.noMic')
        stopMic = useMic ? await startMic((c) => window.stanley.audio(c)) : null
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

  function onKey(e: KeyboardEvent) {
    if (e.metaKey && e.key === '.') hud = !hud
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="shell" class:with-hud={hud}>
  <header>
    <button class="crumb" onclick={() => window.stanley.open(null)}>Stanley</button>
    {#if visible}<span class="muted">› {snapshot?.apps.find((a) => a.id === visible)?.title}</span>{/if}
    <span class="spacer"></span>
    {#if background}<span class="pill working">Working in background…</span>{/if}
    <button class="pill" class:live={snapshot?.listening} onclick={() => window.stanley.toggleListening()}>
      {snapshot?.listening ? '● Listening' : snapshot?.ptt ? `${pttLabel(snapshot.ptt)} to talk` : 'Click to talk'}
    </button>
    <button class="pill" onclick={() => (hud = !hud)}>HUD</button>
  </header>

  <main>
    {#if snapshot && Surface && visible}
      <Surface data={snapshot.surfaces[visible]} perform={(nodeId: string, args?: { text?: string }) => window.stanley.perform(visible, nodeId, args)} />
    {:else if snapshot}
      <Home apps={snapshot.apps} />
    {/if}
  </main>

  {#if hud && snapshot}
    <Hud {snapshot} {ticks} />
  {/if}
</div>

<style>
  .shell { display: grid; grid-template-columns: 1fr; grid-template-rows: 44px 1fr; height: 100vh; }
  .shell.with-hud { grid-template-columns: 1fr 360px; }
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
