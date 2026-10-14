<script lang="ts">
  import { Button } from '@stanley/app-ui/components/button'
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
    if (e.source === 'agent' && e.event.type === 'working') {
      const ev = e.event
      const verdict = ev.verdict ? ` · ${ev.verdict.choice} ${(ev.verdict.probabilities[ev.verdict.choice]! * 100).toFixed(0)}% in ${ms(ev.verdict.latencyMs)}` : ''
      return { who: 'working', text: `${ev.action}: "${ev.heard}"${verdict}${ev.reason ? ` · ${ev.reason}` : ''}`, tone: ev.action === 'stop' ? 'strong' : undefined }
    }
    if (e.source === 'agent' && e.event.type === 'task') {
      const ev = e.event
      const head = `${ev.taskId} "${ev.title}"`
      if (ev.action === 'start') return { who: 'task', text: `${head} started: ${ev.text}`, tone: 'strong' }
      if (ev.action === 'step') return { who: 'task', text: `${head} · ${ev.tool} ${ev.text}${ev.result ? ` → ${ev.result.split('\n')[0]}` : ''}`, tone: 'muted' }
      if (ev.action === 'end') return { who: 'task', text: `${head} ${ev.state === 'failed' ? 'failed' : 'finished'}: ${ev.text}`, tone: ev.state === 'failed' ? 'bad' : 'strong' }
      if (ev.action === 'cancel') return { who: 'task', text: `${head} stopped` }
      return { who: 'task', text: `${head}: telling the user (tick #${ev.tickId})` }
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

  /** A tick's left edge: green when it went through, amber when held back, red when it failed. */
  function edge(outcome: string | undefined) {
    if (outcome === undefined) return 'border-l-muted-foreground'
    if (outcome === 'gated' || outcome === 'stale-discarded') return 'border-l-warning'
    if (outcome === 'forced-stop' || outcome === 'error') return 'border-l-destructive'
    return 'border-l-success'
  }

  const tones: Record<string, string> = { muted: 'text-muted-foreground', strong: 'font-semibold', bad: 'text-destructive' }
  const time = 'w-16 flex-none text-muted-foreground tabular-nums'
  const who = 'w-14 flex-none text-muted-foreground'
  const sub = 'truncate pl-33 text-muted-foreground'
</script>

<ol class="min-h-0 overflow-auto py-1 text-xs" bind:this={list}>
  {#each rows as row (key(row))}
    {#if row.kind === 'task'}
      <li class="mt-2.5 flex items-center gap-2 border-t bg-muted px-2.5 py-1.5">
        <strong>Task {row.task.index}</strong>
        <span class="flex-1 truncate">{row.task.utterances.join(' / ') || '—'}</span>
        <span class="text-muted-foreground">{row.task.ticks.length} ticks · {duration(row.task)}</span>
        <Button variant="outline" size="xs" onclick={() => onexport(row.task)} title="Copy a scenario for evals/scenarios.mts">Copy as eval</Button>
      </li>
    {:else if row.kind === 'tick'}
      {@const t = row.tick}
      <li class={['my-0.5 border-l-3 px-2.5 py-0.5', edge(t.end?.outcome), t.id === selectedId && 'bg-primary/20']}>
        <button class="flex w-full cursor-pointer gap-1.5 py-0.5 text-left" onclick={() => onselect(t.id)}>
          <span class={time}>{offset(t.at, model.startAt)}</span>
          <span class={who}>#{t.id}</span>
          <span class="w-11 flex-none text-muted-foreground">{t.start.reason}</span>
          <span class="flex-1 truncate font-semibold">{tickLabel(t)}</span>
          {#if t.decision}<span class="text-muted-foreground">{t.decision.result.answers.next?.confidence.toFixed(2)} · {ms(t.decision.result.latencyMs)}</span>{/if}
        </button>
        {#each t.acts as act, i (i)}{#if act.summary}<div class={sub}>→ {act.summary}</div>{/if}{/each}
        {#each t.thinking as th, i (i)}{#if th.end?.text}<div class={sub}>said "{th.end.text}"</div>{/if}{/each}
        {#if t.end?.outcome === 'error'}<div class="truncate pl-33 text-destructive">{t.end.detail}</div>{/if}
      </li>
    {:else}
      {@const d = describe(row.event)}
      <li class="flex gap-1.5 px-2.5 py-0.5">
        <span class={time}>{offset(row.event.at, model.startAt)}</span>
        <span class={who}>{d.who}</span>
        <span class={['truncate', d.tone && tones[d.tone]]}>{d.text}</span>
      </li>
    {/if}
  {/each}
</ol>
