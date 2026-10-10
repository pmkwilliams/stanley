<script lang="ts">
  import type { LogEntry } from '@stanley/agent'
  import { offset, type DebugModel } from './model'

  let { model }: { model: DebugModel } = $props()

  function line(e: LogEntry): string {
    switch (e.role) {
      case 'system':
        return 'system prompt'
      case 'user':
        return e.content
      case 'assistant': {
        const who = e.origin === 'user' ? 'user clicked' : 'agent chose'
        const text = e.toolCall.args?.text ? ` ("${e.toolCall.args.text}")` : ''
        const conf = e.decision ? ` · ${e.decision.confidence.toFixed(2)}` : ''
        return `${who} ${e.toolCall.option}${text}${conf}`
      }
      case 'tool':
        return e.summary
      case 'event':
        return `${e.kind}${e.detail ? `: ${e.detail}` : ''}`
    }
  }
</script>

<ol>
  {#each model.log as e, i (i)}
    <li class={e.role}>
      <span class="time">{offset(e.at, model.startAt)}</span>
      <span class="role">{e.role}</span>
      <div class="body">
        {line(e)}
        {#if e.role === 'system' || (e.role === 'tool' && e.content !== e.summary)}
          <details><summary>full text</summary><pre>{e.content}</pre></details>
        {/if}
      </div>
    </li>
  {/each}
</ol>

<style>
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
