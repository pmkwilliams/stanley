<script lang="ts">
  import { targetOf, type Entry } from '@stanley/agent'
  import type { LegacyLogEntry } from '../../../shared/ipc'
  import { messageParts, offset, type DebugModel } from './model'

  let { model }: { model: DebugModel } = $props()

  /** What an entry is, in a line: what happened, for whom, and what the models read of it. */
  function line(e: Entry): string {
    const m = e.meta
    const steps = (m.results ?? []).map((r) => {
      if (r.lookup) return r.lookup.kind === 'search' ? `searched "${r.lookup.query}" → ${r.lookup.error ? `failed: ${r.lookup.error}` : r.lookup.results.map((x) => x.title).join(' · ') || 'nothing found'}` : `read ${r.lookup.url}${r.lookup.error ? ` → failed: ${r.lookup.error}` : ` → "${r.lookup.title}"`}`
      if (r.file) {
        const f = r.file
        if (f.kind === 'bash') return `ran \`${f.command}\`${f.exitCode ? ` → exit code ${f.exitCode}` : ''}`
        if (f.kind === 'list') return `listed ${f.path || 'the files'} → ${f.error ? `failed: ${f.error}` : f.entries.join(' · ') || 'empty'}`
        return `read ${f.path}${f.error ? ` → failed: ${f.error}` : ''}`
      }
      if (!r.step) return ''
      const s = r.step
      const text = s.text !== undefined ? ` ("${s.text}")` : ''
      const conf = s.decision?.step ? ` · ${s.decision.step.confidence.toFixed(2)}` : ''
      const heard = s.heardWords !== undefined ? ` · heard ${s.heardWords} words` : ''
      return `${targetOf(s.target)}${text}${conf}${heard} → ${s.summary}`
    })
    if (steps.some(Boolean)) return steps.filter(Boolean).join('; ')
    if (m.kind === 'said' && m.said) return m.said.heard !== undefined ? `said "${m.said.text}"; the user heard: "${m.said.heard}"` : `said "${m.said.text}"`
    if (m.kind === 'event') return `${m.event}${m.detail ? `: ${m.detail}` : ''}`
    if (m.kind === 'heard') return `segment of utterance ${m.utteranceId}`
    return e.message ? messageParts(e.message).map((p) => (p.kind === 'reasoning' ? '[reasoning]' : p.kind === 'call' ? `→ ${p.text}` : p.text)).join(' ') : ''
  }

  function legacy(e: LegacyLogEntry): string {
    const { role, at: _, ...rest } = e
    return `${role}: ${JSON.stringify(rest)}`
  }
</script>

{#if model.legacy.length}
  <p class="note">An older session: its message log, before the history.</p>
  <ol>
    {#each model.legacy as e, i (i)}
      <li><span class="time">{offset(e.at, model.startAt)}</span><div class="body">{legacy(e)}</div></li>
    {/each}
  </ol>
{:else}
  <p class="note">The history thinking reads, in the order it was committed; staged entries haven't been sent to thinking yet. Jev reads it rendered; see a tick's Jev input.</p>
  <ol>
    {#each [...model.history.map((e) => ({ e, staged: false })), ...model.staged.filter((e) => e.meta.kind !== 'heard').map((e) => ({ e, staged: true }))] as { e, staged }, i (i)}
      <li class="{e.meta.kind} {e.message?.role ?? ''}" class:staged>
        <span class="time">{offset(e.meta.at, model.startAt)}</span>
        <span class="role">{e.meta.kind}{e.meta.by ? ` · ${e.meta.by}` : ''}{staged ? ' · staged' : ''}</span>
        <div class="body">
          {line(e)}
          {#if e.meta.results?.some((r) => r.step?.observation)}
            <details><summary>full result</summary><pre>{e.meta.results.map((r) => r.step?.observation ?? '').join('\n')}</pre></details>
          {/if}
        </div>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .note { margin: 4px 10px; font-size: 11px; color: var(--muted); }
  ol { list-style: none; margin: 0; padding: 4px 0; overflow: auto; font-size: 12px; min-height: 0; }
  li { display: flex; gap: 6px; padding: 3px 10px; }
  li.staged { opacity: 0.6; }
  .time { color: var(--muted); font-variant-numeric: tabular-nums; width: 64px; flex: none; }
  .role { color: var(--muted); width: 120px; flex: none; }
  .body { flex: 1; min-width: 0; white-space: pre-wrap; }
  li.words .body { font-weight: 600; }
  li.event .body, li.observation .body { color: var(--muted); }
  summary { cursor: pointer; color: var(--muted); }
  pre { font-family: ui-monospace, monospace; font-size: 11px; white-space: pre-wrap; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 8px; }
</style>
