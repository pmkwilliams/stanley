<script lang="ts">
  import type { TickReport } from '@stanley/agent'
  import type { Snapshot } from '../../shared/ipc'

  let { snapshot, ticks }: { snapshot: Snapshot; ticks: TickReport[] } = $props()
  let typed = $state('')

  function say(e: SubmitEvent) {
    e.preventDefault()
    if (!typed.trim()) return
    window.stanley.say(typed)
    typed = ''
  }

  const sttLabel: Record<Snapshot['stt'], string> = {
    ready: 'Parakeet ready',
    loading: 'Loading STT…',
    'missing-models': 'Models missing — run pnpm models',
    error: 'STT failed to load',
  }
</script>

<aside>
  <div class="row">
    <span class="tag">{snapshot.status}</span>
    <span class="tag">{sttLabel[snapshot.stt]}</span>
    {#if snapshot.mock}<span class="tag warn">mock Jev</span>{/if}
  </div>

  <h2>Transcript</h2>
  <p class="transcript">
    {snapshot.transcript.finalized.join(' ')}
    <span class="partial">{snapshot.transcript.partial}</span>
    {#if !snapshot.transcript.finalized.length && !snapshot.transcript.partial}<span class="partial">—</span>{/if}
  </p>
  <form onsubmit={say}><input placeholder="Or type an utterance…" bind:value={typed} /></form>

  <h2>Decisions</h2>
  <ol>
    {#each ticks as t (t.id)}
      <li class={t.outcome}>
        <div class="head">
          <strong>{t.choice || 'error'}</strong>
          <span>{t.outcome} · c={t.confidence.toFixed(2)} · {Math.round(t.latencyMs)}ms</span>
        </div>
        {#each t.top as o (o.option)}
          <div class="bar"><span style:width="{o.p * 100}%"></span><em>{o.option}</em><b>{(o.p * 100).toFixed(0)}%</b></div>
        {/each}
        {#if t.detail}<div class="detail">{t.detail}</div>{/if}
      </li>
    {/each}
  </ol>
</aside>

<style>
  aside { border-left: 1px solid var(--border); background: var(--panel); padding: 12px; overflow: auto; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 16px 0 6px; }
  .row { display: flex; flex-wrap: wrap; gap: 6px; }
  .tag { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); }
  .tag.warn { color: #f59e0b; border-color: #f59e0b55; }
  .transcript { margin: 0 0 8px; line-height: 1.5; }
  .partial { color: var(--muted); }
  form input { width: 100%; padding: 6px 8px; }
  ol { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
  li { border: 1px solid var(--border); border-radius: 8px; padding: 8px; }
  li.stale-discarded, li.gated { opacity: 0.6; }
  li.forced-stop, li.error { border-color: var(--accent); }
  .head { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
  .head span { color: var(--muted); font-size: 11px; white-space: nowrap; }
  .bar { position: relative; display: flex; gap: 6px; font-size: 11px; padding: 2px 4px; }
  .bar span { position: absolute; inset: 0 auto 0 0; background: var(--focus); border-radius: 3px; }
  .bar em { position: relative; flex: 1; font-style: normal; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar b { position: relative; font-weight: 500; }
  .detail { font-size: 11px; color: var(--muted); margin-top: 4px; }
</style>
