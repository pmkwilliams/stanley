<script lang="ts">
  import type { ChoiceResult } from '@stanley/jev'
  import { ms, type TickView } from './model'

  let { tick }: { tick: TickView } = $props()

  let draft = $state<{ state: string; instructions: string; options: string } | null>(null)
  let running = $state(false)
  let result = $state<ChoiceResult | null>(null)
  let error = $state('')

  function edit() {
    draft = {
      state: tick.start.state,
      instructions: tick.start.instructions,
      options: JSON.stringify(tick.start.options, null, 2),
    }
  }

  async function run() {
    if (!draft) return
    running = true
    error = ''
    try {
      const options = JSON.parse(draft.options) as Record<string, string | null>
      result = await window.stanley.debug.replay({ state: draft.state, instructions: draft.instructions, options })
    } catch (err) {
      error = String(err)
    } finally {
      running = false
    }
  }

  const original = $derived(tick.decision?.result.probabilities ?? {})
  const compared = $derived(
    result
      ? Object.entries(result.probabilities)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 12)
          .map(([option, p]) => ({ option, p, before: original[option] }))
      : [],
  )
</script>

{#if !draft}
  <p class="muted">Re-run this decision against Jev, as recorded or with edited state, instructions or options.</p>
  <button onclick={edit}>Edit &amp; re-run…</button>
{:else}
  <label>Instructions <input bind:value={draft.instructions} /></label>
  <label>State <textarea rows="14" bind:value={draft.state}></textarea></label>
  <label>Options (JSON: name → description) <textarea rows="10" bind:value={draft.options}></textarea></label>
  <div class="row">
    <button onclick={run} disabled={running}>{running ? 'Running…' : 'Run against Jev'}</button>
    <button onclick={edit} disabled={running}>Reset to recorded</button>
  </div>
  {#if error}<p class="bad">{error}</p>{/if}
  {#if result}
    <p>
      Replay chose <strong>{result.choice}</strong> · confidence {result.confidence.toFixed(2)} · {ms(result.latencyMs)}
      {#if result.choice !== tick.decision?.result.choice}<span class="warn"> · differs from recorded ({tick.decision?.result.choice ?? '—'})</span>{/if}
    </p>
    <table>
      <thead><tr><th>Option</th><th>Recorded</th><th>Replay</th></tr></thead>
      <tbody>
        {#each compared as c (c.option)}
          <tr>
            <td>{c.option}</td>
            <td>{c.before === undefined ? '—' : `${(c.before * 100).toFixed(1)}%`}</td>
            <td>{(c.p * 100).toFixed(1)}%</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
{/if}

<style>
  label { display: block; color: var(--muted); font-size: 11px; margin-bottom: 8px; }
  input, textarea { display: block; width: 100%; margin-top: 3px; padding: 6px 8px; font-family: ui-monospace, monospace; font-size: 11px; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; color: var(--text); }
  .row { display: flex; gap: 8px; }
  button { font-size: 12px; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
  button:disabled { opacity: 0.6; cursor: default; }
  .muted { color: var(--muted); }
  .warn { color: #f59e0b; }
  .bad { color: var(--accent); }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; color: var(--muted); font-weight: 500; }
  td, th { padding: 3px 6px; border-top: 1px solid var(--border); }
  td:not(:first-child) { font-variant-numeric: tabular-nums; width: 80px; }
</style>
