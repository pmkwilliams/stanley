<script lang="ts">
  import { targetOf, type LogEntry } from '@stanley/agent'
  import { offset, type DebugModel } from './model'

  let { model }: { model: DebugModel } = $props()

  function line(e: LogEntry): string {
    switch (e.role) {
      case 'user':
        return e.content
      case 'step': {
        const who = e.by === 'user' ? 'user' : e.by === 'thinking' ? 'thinking' : 'fast'
        const text = e.text !== undefined ? ` ("${e.text}")` : ''
        const conf = e.decision?.step ? ` · ${e.decision.step.confidence.toFixed(2)}` : ''
        return `${who}: ${targetOf(e.target)}${text}${conf} → ${e.result.summary}`
      }
      case 'search':
        return `searched "${e.query}" → ${e.error ? `failed: ${e.error}` : e.results.map((r) => r.title).join(' · ') || 'nothing found'}`
      case 'read':
        return `read ${e.url}${e.error ? ` → failed: ${e.error}` : ` → "${e.title}"`}`
      case 'said':
        return `Stanley said: "${e.content}"`
      case 'event':
        return `${e.kind}${e.detail ? `: ${e.detail}` : ''}`
    }
  }
</script>

<p class="note">The raw log. The models read it rendered as a conversation; see a tick's Jev input.</p>
<ol>
  {#each model.log as e, i (i)}
    <li class={e.role}>
      <span class="time">{offset(e.at, model.startAt)}</span>
      <span class="role">{e.role}</span>
      <div class="body">
        {line(e)}
        {#if e.role === 'step' && e.result.observation}
          <details><summary>full result</summary><pre>{e.result.observation}</pre></details>
        {/if}
      </div>
    </li>
  {/each}
</ol>

<style>
  .note { margin: 4px 10px; font-size: 11px; color: var(--muted); }
  ol { list-style: none; margin: 0; padding: 4px 0; overflow: auto; font-size: 12px; min-height: 0; }
  li { display: flex; gap: 6px; padding: 3px 10px; }
  .time { color: var(--muted); font-variant-numeric: tabular-nums; width: 64px; flex: none; }
  .role { color: var(--muted); width: 64px; flex: none; }
  .body { flex: 1; min-width: 0; }
  li.user .body { font-weight: 600; }
  li.event .body { color: var(--muted); }
  summary { cursor: pointer; color: var(--muted); }
  pre { font-family: ui-monospace, monospace; font-size: 11px; white-space: pre-wrap; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 8px; }
</style>
