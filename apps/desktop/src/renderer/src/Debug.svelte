<script lang="ts">
  import type { DebugEvent, DebugSession, Snapshot } from '../../shared/ipc'
  import LogView from './debug/LogView.svelte'
  import { buildModel, evalScenario, type Category, type TaskView } from './debug/model'
  import TickInspector from './debug/TickInspector.svelte'
  import Timeline from './debug/Timeline.svelte'

  let snapshot = $state<Snapshot | null>(null)
  // Raw: events are large and never mutated, so skip deep proxying.
  let live = $state.raw<DebugEvent[]>([])
  let loaded = $state.raw<{ file: string; events: DebugEvent[] } | null>(null)
  let sessions = $state<DebugSession[]>([])
  let tab = $state<'timeline' | 'log'>('timeline')
  /** Follow the newest tick and keep the timeline scrolled to the bottom. */
  let follow = $state(true)
  let selectedId = $state<number | null>(null)
  let hidden = $state<Record<Category, boolean>>({ partials: true, vad: true, skipped: true, status: true })
  let typed = $state('')
  let toast = $state('')

  $effect(() => {
    let ready = false
    const early: DebugEvent[] = []
    const offs = [
      window.stanley.onSnapshot((s) => {
        snapshot = s
      }),
      window.stanley.debug.onEvent((e) => {
        if (ready) live = [...live, e]
        else early.push(e)
      }),
    ]
    void window.stanley.debug.history().then((history) => {
      const last = history.at(-1)?.seq ?? 0
      live = [...history, ...early.filter((e) => e.seq > last)]
      ready = true
    })
    return () => offs.forEach((off) => off())
  })

  const model = $derived(buildModel(loaded?.events ?? live))
  const selected = $derived(model.ticks.find((t) => t.id === (follow ? model.ticks.at(-1)?.id : selectedId)) ?? null)
  const config = $derived(model.session?.config)

  async function refreshSessions() {
    sessions = (await window.stanley.debug.sessions()).filter((s) => !s.current)
  }

  async function pickSession(e: Event) {
    const file = (e.currentTarget as HTMLSelectElement).value
    loaded = file ? { file, events: await window.stanley.debug.load(file) } : null
    follow = !file
    selectedId = null
  }

  function select(id: number) {
    selectedId = id
    follow = false
  }

  function copy(text: string, what: string) {
    window.stanley.debug.copy(text)
    toast = `Copied ${what}`
    setTimeout(() => (toast = ''), 1500)
  }

  function exportTask(task: TaskView) {
    copy(evalScenario(model, task), `task ${task.index} as an eval scenario`)
  }

  function say(e: SubmitEvent) {
    e.preventDefault()
    if (!typed.trim()) return
    window.stanley.say(typed)
    typed = ''
  }

  const sttLabel: Record<Snapshot['stt'], string> = {
    ready: 'STT ready',
    loading: 'STT loading…',
    'missing-models': 'STT models missing — run pnpm models',
    error: 'STT failed to load',
  }
</script>

<div class="debug">
  <header>
    {#if snapshot}
      <span class="tag" class:hot={snapshot.status !== 'idle'}>{snapshot.status}</span>
      <span class="tag" class:hot={snapshot.listening}>{snapshot.listening ? 'mic on' : 'mic off'}</span>
      <span class="tag" class:warn={snapshot.stt !== 'ready'}>{sttLabel[snapshot.stt]}</span>
      {#if snapshot.mock}<span class="tag warn">mock Jev</span>{/if}
    {/if}
    {#if config}
      <span class="config" title="Agent guardrail config for this session">
        min {config.minConfidence} · speaking {config.speakingConfidence} · explicit ask {config.explicitAsk} · stale nav {config.staleNavConfidence} ·
        steps {config.maxActionsPerUtterance} · oscillation {config.oscillation.repeats}/{config.oscillation.window} · nodes {config.maxNodes}
      </span>
    {/if}
    <span class="spacer"></span>
    <select onfocus={refreshSessions} onchange={pickSession}>
      <option value="">Live session</option>
      {#each sessions as s (s.file)}
        <option value={s.file}>{new Date(s.modified).toLocaleString()} · {Math.round(s.bytes / 1024)} KB</option>
      {/each}
    </select>
    {#if !loaded}
      <form onsubmit={say}><input placeholder="Type an utterance…" bind:value={typed} /></form>
    {/if}
  </header>

  <div class="panes">
    <section class="left">
      <nav>
        <button class:active={tab === 'timeline'} onclick={() => (tab = 'timeline')}>Timeline</button>
        <button class:active={tab === 'log'} onclick={() => (tab = 'log')}>Message log</button>
        <span class="spacer"></span>
        {#if tab === 'timeline'}
          {#each Object.keys(hidden) as Category[] as c (c)}
            <label><input type="checkbox" checked={!hidden[c]} onchange={() => (hidden[c] = !hidden[c])} />{c}</label>
          {/each}
          {#if !loaded}<label><input type="checkbox" bind:checked={follow} />follow</label>{/if}
        {/if}
      </nav>
      {#if tab === 'timeline'}
        <Timeline {model} {hidden} {follow} selectedId={selected?.id ?? null} onselect={select} onexport={exportTask} />
      {:else}
        <LogView {model} />
      {/if}
    </section>

    <section class="right">
      {#if selected}
        {#key selected.id}
          <TickInspector tick={selected} {model} oncopy={copy} />
        {/key}
      {:else}
        <p class="empty">{model.ticks.length ? 'Select a tick to inspect it.' : 'No decisions yet. Speak, or type an utterance above.'}</p>
      {/if}
    </section>
  </div>

  {#if toast}<div class="toast">{toast}</div>{/if}
</div>

<style>
  .debug { display: grid; grid-template-rows: auto 1fr; height: 100vh; }
  header { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .tag { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); }
  .tag.hot { color: var(--accent); border-color: var(--accent); }
  .tag.warn { color: #f59e0b; border-color: #f59e0b55; }
  .config { font-size: 11px; color: var(--muted); margin-left: 6px; }
  .spacer { flex: 1; }
  select, form input { font-size: 12px; padding: 4px 8px; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; color: inherit; }
  form input { width: 240px; }
  .panes { display: grid; grid-template-columns: minmax(380px, 2fr) 3fr; min-height: 0; }
  .left { display: grid; grid-template-rows: auto 1fr; min-height: 0; border-right: 1px solid var(--border); }
  .right { overflow: auto; min-height: 0; }
  nav { display: flex; align-items: center; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--border); font-size: 12px; }
  nav button { background: none; border: 0; padding: 4px 8px; border-radius: 6px; color: var(--muted); cursor: pointer; }
  nav button.active { background: var(--panel); color: var(--text); }
  nav label { display: flex; align-items: center; gap: 3px; color: var(--muted); font-size: 11px; }
  .empty { color: var(--muted); padding: 24px; }
  .toast { position: fixed; bottom: 16px; right: 16px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; font-size: 12px; }
</style>
