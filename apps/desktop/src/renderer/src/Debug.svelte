<script lang="ts">
  import { Badge } from '@stanley/app-ui/components/badge'
  import { Checkbox } from '@stanley/app-ui/components/checkbox'
  import { Input } from '@stanley/app-ui/components/input'
  import { Label } from '@stanley/app-ui/components/label'
  import * as Tabs from '@stanley/app-ui/components/tabs'
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

  /** Status pills: blue while something's happening, amber when something's off. */
  const hot = 'border-primary text-primary'
  const warn = 'border-warning/35 text-warning'
  const toggle = 'gap-1 text-xs font-normal text-muted-foreground'
</script>

<div class="grid h-screen grid-rows-[auto_1fr] text-sm">
  <header class="flex flex-wrap items-center gap-1.5 border-b px-3 py-2">
    {#if snapshot}
      <Badge variant="outline" class={snapshot.status !== 'idle' ? hot : undefined}>{snapshot.status}</Badge>
      <Badge variant="outline" class={snapshot.listening ? hot : undefined}>{snapshot.listening ? 'mic on' : 'mic off'}</Badge>
      <Badge variant="outline" class={snapshot.stt !== 'ready' ? warn : undefined}>{sttLabel[snapshot.stt]}</Badge>
      {#if snapshot.mock}<Badge variant="outline" class={warn}>mock Jev</Badge>{/if}
    {/if}
    {#if config}
      <span class="ml-1.5 text-xs text-muted-foreground" title="Agent guardrail config for this session">
        act {config.act} · speaking {config.speakingAct} · done {config.done} · step {config.stepConfidence} · stale nav {config.staleNavConfidence} ·
        steps {config.maxStepsPerUtterance} · oscillation {config.oscillation.repeats}/{config.oscillation.window} · elements {config.maxElements}
      </span>
    {/if}
    <span class="flex-1"></span>
    <select class="h-7 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring dark:bg-input/30" onfocus={refreshSessions} onchange={pickSession}>
      <option value="">Live session</option>
      {#each sessions as s (s.file)}
        <option value={s.file}>{new Date(s.modified).toLocaleString()} · {Math.round(s.bytes / 1024)} KB</option>
      {/each}
    </select>
    {#if !loaded}
      <form onsubmit={say}><Input class="h-7 w-60 text-xs md:text-xs" placeholder="Type an utterance…" bind:value={typed} /></form>
    {/if}
  </header>

  <div class="grid min-h-0 grid-cols-[minmax(24rem,2fr)_3fr]">
    <section class="grid min-h-0 grid-rows-[auto_1fr] border-r">
      <nav class="flex items-center gap-2 border-b px-2 py-1.5">
        <Tabs.Root value={tab} onValueChange={(v) => (tab = v as typeof tab)}>
          <Tabs.List>
            <Tabs.Trigger value="timeline" class="text-xs">Timeline</Tabs.Trigger>
            <Tabs.Trigger value="log" class="text-xs">History</Tabs.Trigger>
          </Tabs.List>
        </Tabs.Root>
        <span class="flex-1"></span>
        {#if tab === 'timeline'}
          {#each Object.keys(hidden) as Category[] as c (c)}
            <Label class={toggle}><Checkbox checked={!hidden[c]} onCheckedChange={() => (hidden[c] = !hidden[c])} />{c}</Label>
          {/each}
          {#if !loaded}<Label class={toggle}><Checkbox bind:checked={follow} />follow</Label>{/if}
        {/if}
      </nav>
      {#if tab === 'timeline'}
        <Timeline {model} {hidden} {follow} selectedId={selected?.id ?? null} onselect={select} onexport={exportTask} />
      {:else}
        <LogView {model} />
      {/if}
    </section>

    <section class="min-h-0 overflow-auto">
      {#if selected}
        {#key selected.id}
          <TickInspector tick={selected} {model} oncopy={copy} />
        {/key}
      {:else}
        <p class="p-6 text-muted-foreground">{model.ticks.length ? 'Select a tick to inspect it.' : 'No decisions yet. Speak, or type an utterance above.'}</p>
      {/if}
    </section>
  </div>

  {#if toast}<div class="fixed right-4 bottom-4 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">{toast}</div>{/if}
</div>
