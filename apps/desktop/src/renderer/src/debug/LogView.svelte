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

  const note = 'mx-2.5 my-1 text-xs text-muted-foreground'
  const list = 'min-h-0 overflow-auto py-1 text-xs'
  const time = 'w-16 flex-none text-muted-foreground tabular-nums'
</script>

<div class="flex min-h-0 flex-col">
  {#if model.legacy.length}
    <p class={note}>An older session: its message log, before the history.</p>
    <ol class={list}>
      {#each model.legacy as e, i (i)}
        <li class="flex gap-1.5 px-2.5 py-0.5"><span class={time}>{offset(e.at, model.startAt)}</span><div class="min-w-0 flex-1 whitespace-pre-wrap">{legacy(e)}</div></li>
      {/each}
    </ol>
  {:else}
    <p class={note}>The history thinking reads, in the order it was committed; staged entries haven't been sent to thinking yet. Jev reads it rendered; see a tick's Jev input.</p>
    <ol class={list}>
      {#each [...model.history.map((e) => ({ e, staged: false })), ...model.staged.filter((e) => e.meta.kind !== 'heard').map((e) => ({ e, staged: true }))] as { e, staged }, i (i)}
        <li class={['flex gap-1.5 px-2.5 py-0.5', staged && 'opacity-60']}>
          <span class={time}>{offset(e.meta.at, model.startAt)}</span>
          <span class="w-30 flex-none text-muted-foreground">{e.meta.kind}{e.meta.by ? ` · ${e.meta.by}` : ''}{staged ? ' · staged' : ''}</span>
          <div
            class={[
              'min-w-0 flex-1 whitespace-pre-wrap',
              e.meta.kind === 'words' && 'font-semibold',
              (e.meta.kind === 'event' || e.meta.kind === 'observation') && 'text-muted-foreground',
            ]}
          >
            {line(e)}
            {#if e.meta.results?.some((r) => r.step?.observation)}
              <details>
                <summary class="cursor-pointer text-muted-foreground">full result</summary>
                <pre class="rounded-md border bg-muted p-2 font-mono text-xs whitespace-pre-wrap">{e.meta.results.map((r) => r.step?.observation ?? '').join('\n')}</pre>
              </details>
            {/if}
          </div>
        </li>
      {/each}
    </ol>
  {/if}
</div>
