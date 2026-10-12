<script lang="ts">
  import type { DebugEvent } from '../../../shared/ipc'
  import { ms, offset, tickLabel, type Category, type DebugModel, type Row, type TaskView } from './model'

  let {
    model,
    hidden,
    follow,
    selectedId,
    onselect,
    onexport,
  }: {
    model: DebugModel
    hidden: Record<Category, boolean>
    follow: boolean
    selectedId: number | null
    onselect: (id: number) => void
    onexport: (task: TaskView) => void
  } = $props()

  let list: HTMLOListElement | undefined = $state()
  const rows = $derived(model.rows.filter((r) => r.kind !== 'event' || !r.category || !hidden[r.category]))

  $effect(() => {
    if (follow && rows.length && list) list.scrollTop = list.scrollHeight
  })

  const why = {
    deferred: 'Jev call in flight — queued',
    'no-new-words': 'no new words since the last tick',
    halted: 'loop halted, waiting on the user',
    'nothing-to-re-ask': 'utterance ended, nothing to re-ask',
    held: 'a held step is still waiting for the user to finish',
    released: 'the user finished: running the held step',
    tick: '',
  }

  function describe(e: DebugEvent): { who: string; text: string; tone?: string } {
    if (e.source === 'stt') {
      const ev = e.event
      if (ev.type === 'speech-start') return { who: 'vad', text: 'speech started' }
      if (ev.type === 'speech-end') return { who: 'vad', text: 'speech ended' }
      if (ev.type === 'silence') return { who: 'stt', text: `silence for ${ms(ev.afterMs)} → ending utterance` }
      if (ev.type === 'turn') return { who: 'turn', text: `voice sounds ${(ev.complete * 100).toFixed(0)}% finished · ${ms(ev.audioMs)} heard in ${ms(ev.latencyMs)}${ev.emitted ? '' : ' · dropped'}`, tone: 'muted' }
      return {
        who: ev.kind,
        text: `"${ev.text}" · ${ms(ev.audioMs)} audio decoded in ${ms(ev.decodeMs)}${ev.unsure?.length ? ` · unsure: ${ev.unsure.join(', ')}` : ''}${ev.emitted ? '' : ' · dropped'}`,
        tone: ev.kind === 'segment' ? 'strong' : 'muted',
      }
    }
    if (e.source === 'agent' && e.event.type === 'request') {
      return { who: 'skip', text: `${e.event.reason}: ${why[e.event.result]}`, tone: 'muted' }
    }
    if (e.source === 'agent' && e.event.type === 'turn') {
      const pct = (p: number | null) => (p === null ? '?' : `${(p * 100).toFixed(0)}%`)
      return { who: 'turn', text: `paused · voice ${pct(e.event.voice)} finished, words ${pct(e.event.heard)} · ends in ${ms(e.event.endInMs)} if quiet` }
    }
    if (e.source === 'agent' && e.event.type === 'turn-end') {
      return { who: 'turn', text: `finished → utterance ended ${ms(e.event.afterPauseMs)} into the pause`, tone: 'strong' }
    }
    if (e.source === 'agent' && e.event.type === 'turn-resumed') {
      return { who: 'turn', text: `the user went on ${ms(e.event.afterEndMs)} after the end → same utterance` }
    }
    if (e.source === 'agent' && e.event.type === 'say') {
      return { who: 'say', text: `${e.event.result}: "${e.event.text}"`, tone: e.event.result === 'dropped' ? 'muted' : undefined }
    }
    if (e.source === 'agent' && e.event.type === 'cut') {
      return { who: 'cut', text: `heard "${e.event.spoken}" of "${e.event.text}"`, tone: 'strong' }
    }
    if (e.source === 'agent' && e.event.type === 'overlap') {
      const ev = e.event
      const verdict = ev.verdict ? ` · ${ev.verdict.choice} ${(ev.verdict.probabilities[ev.verdict.choice]! * 100).toFixed(0)}% in ${ms(ev.verdict.latencyMs)}` : ''
      const text = `${ev.action}${ev.heard ? `: "${ev.heard}"` : ''}${ev.echo ? ` · echo "${ev.echo}"` : ''}${verdict}${ev.reason ? ` · ${ev.reason}` : ''}`
      return { who: 'overlap', text, tone: ev.action === 'cut' ? 'strong' : ev.action === 'duck' ? 'muted' : undefined }
    }
    if (e.source === 'tts') {
      const ev = e.event
      if (ev.type === 'synth') return { who: 'voice', text: `"${ev.text}" · ${ms(ev.audioMs)} audio in ${ms(ev.synthMs)} · ${ms(ev.queuedMs)} queued ahead`, tone: 'muted' }
      if (ev.type === 'stop') return { who: 'voice', text: `stopped after "${ev.spoken}"` }
      return { who: 'voice', text: `couldn't say "${ev.text}": ${ev.error}`, tone: 'bad' }
    }
    if (e.source === 'app') {
      const ev = e.event
      switch (ev.type) {
        case 'session-start':
          return { who: 'app', text: `session ${ev.session}${ev.mock ? ' · mock Jev' : ''}` }
        case 'listening':
          return { who: 'mic', text: `${ev.on ? 'on' : 'off'} (${ev.via})` }
        case 'status':
          return { who: 'status', text: ev.status, tone: 'muted' }
        case 'typed':
          return { who: 'typed', text: `"${ev.text}"`, tone: 'strong' }
        case 'manual':
          return { who: 'user', text: `clicked ${ev.option} → ${ev.summary}` }
        case 'stt-state':
          return { who: 'stt', text: `${ev.stt}${ev.error ? ` — ${ev.error}` : ''}`, tone: ev.error ? 'bad' : undefined }
        case 'tts-state':
          return { who: 'voice', text: `${ev.tts}${ev.error ? ` — ${ev.error}` : ''}`, tone: ev.error ? 'bad' : undefined }
      }
    }
    return { who: e.source, text: '' }
  }

  function key(row: Row) {
    return row.kind === 'task' ? `task-${row.task.index}` : row.kind === 'tick' ? `tick-${row.tick.id}` : `event-${row.event.seq}`
  }

  function duration(task: TaskView) {
    return task.endAt ? `${((task.endAt - task.at) / 1000).toFixed(1)}s` : 'open'
  }
</script>

<ol bind:this={list}>
  {#each rows as row (key(row))}
    {#if row.kind === 'task'}
      <li class="task">
        <strong>Task {row.task.index}</strong>
        <span class="utterance">{row.task.utterances.join(' / ') || '—'}</span>
        <span class="muted">{row.task.ticks.length} ticks · {duration(row.task)}</span>
        <button onclick={() => onexport(row.task)} title="Copy a scenario for evals/scenarios.mts">Copy as eval</button>
      </li>
    {:else if row.kind === 'tick'}
      {@const t = row.tick}
      <li class="tick {t.end?.outcome ?? 'pending'}" class:selected={t.id === selectedId}>
        <button onclick={() => onselect(t.id)}>
          <span class="time">{offset(t.at, model.startAt)}</span>
          <span class="who">#{t.id}</span>
          <span class="reason">{t.start.reason}</span>
          <span class="choice">{tickLabel(t)}</span>
          {#if t.decision}<span class="muted">{t.decision.result.answers.next?.confidence.toFixed(2)} · {ms(t.decision.result.latencyMs)}</span>{/if}
        </button>
        {#each t.acts as act, i (i)}{#if act.summary}<div class="sub">→ {act.summary}</div>{/if}{/each}
        {#if t.write?.say}<div class="sub">said "{t.write.say}"</div>{/if}
        {#if t.confirm?.say}<div class="sub">said "{t.confirm.say}"</div>{/if}
        {#if t.thinking?.end?.text}<div class="sub">said "{t.thinking.end.text}"</div>{/if}
        {#if t.end?.outcome === 'error'}<div class="sub bad">{t.end.detail}</div>{/if}
      </li>
    {:else}
      {@const d = describe(row.event)}
      <li class="event {d.tone ?? ''}">
        <span class="time">{offset(row.event.at, model.startAt)}</span>
        <span class="who">{d.who}</span>
        <span class="text">{d.text}</span>
      </li>
    {/if}
  {/each}
</ol>

<style>
  ol { list-style: none; margin: 0; padding: 4px 0; overflow: auto; font-size: 12px; min-height: 0; }
  li { padding: 2px 10px; }
  .time { color: var(--muted); font-variant-numeric: tabular-nums; width: 64px; flex: none; }
  .who { width: 56px; flex: none; color: var(--muted); }
  .event { display: flex; gap: 6px; }
  .event.muted .text { color: var(--muted); }
  .event.strong .text { font-weight: 600; }
  .event.bad .text, .bad { color: var(--accent); }
  .text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .task { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding: 6px 10px; border-top: 1px solid var(--border); background: var(--panel); }
  .task .utterance { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .task button { font-size: 11px; background: none; border: 1px solid var(--border); border-radius: 6px; padding: 2px 8px; cursor: pointer; }
  .tick { border-left: 3px solid #22c55e; margin: 2px 0; }
  .tick.gated, .tick.stale-discarded { border-left-color: #f59e0b; }
  .tick.forced-stop, .tick.error { border-left-color: var(--accent); }
  .tick.pending { border-left-color: var(--muted); }
  .tick.selected { background: var(--focus); }
  .tick button { display: flex; gap: 6px; width: 100%; background: none; border: 0; padding: 2px 0; text-align: left; cursor: pointer; }
  .tick .reason { width: 44px; flex: none; color: var(--muted); }
  .tick .choice { font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sub { padding-left: 132px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .muted { color: var(--muted); }
</style>
