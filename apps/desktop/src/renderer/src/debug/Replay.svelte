<script lang="ts">
  import type { MultiChoiceResult, Question } from '@stanley/jev'
  import { ms, type TickView } from './model'

  let { tick }: { tick: TickView } = $props()

  let draft = $state<{ state: string; questions: string } | null>(null)
  let running = $state(false)
  let result = $state<MultiChoiceResult | null>(null)
  let error = $state('')

  function edit() {
    draft = { state: tick.start.state, questions: JSON.stringify(tick.start.questions, null, 2) }
  }

  async function run() {
    if (!draft) return
    running = true
    error = ''
    try {
      const questions = JSON.parse(draft.questions) as Record<string, Question>
      result = await window.stanley.debug.replay({ state: draft.state, questions })
    } catch (err) {
      error = String(err)
    } finally {
      running = false
    }
  }

  const compared = $derived(
    result
      ? Object.entries(result.answers).map(([id, answer]) => {
          const before = tick.decision?.result.answers[id]
          return {
            id,
            choice: answer.choice,
            confidence: answer.confidence,
            recorded: before?.choice,
            rows: Object.entries(answer.probabilities)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 8)
              .map(([option, p]) => ({ option, p, before: before?.probabilities[option] })),
          }
        })
      : [],
  )
</script>

{#if !draft}
  <p class="muted">Re-run this decision against Jev, as recorded or with an edited state or questions.</p>
  <button onclick={edit}>Edit &amp; re-run…</button>
{:else}
  <label>State <textarea rows="14" bind:value={draft.state}></textarea></label>
  <label>Questions (JSON: id → instructions and options) <textarea rows="10" bind:value={draft.questions}></textarea></label>
  <div class="row">
    <button onclick={run} disabled={running}>{running ? 'Running…' : 'Run against Jev'}</button>
    <button onclick={edit} disabled={running}>Reset to recorded</button>
  </div>
  {#if error}<p class="bad">{error}</p>{/if}
  {#if result}
    <p class="muted">{ms(result.latencyMs)}</p>
    {#each compared as q (q.id)}
      <p>
        {q.id}: <strong>{q.choice}</strong> · confidence {q.confidence.toFixed(2)}
        {#if q.choice !== q.recorded}<span class="warn"> · differs from recorded ({q.recorded ?? '—'})</span>{/if}
      </p>
      <table>
        <thead><tr><th>Option</th><th>Recorded</th><th>Replay</th></tr></thead>
        <tbody>
          {#each q.rows as c (c.option)}
            <tr>
              <td>{c.option}</td>
              <td>{c.before === undefined ? '—' : `${(c.before * 100).toFixed(1)}%`}</td>
              <td>{(c.p * 100).toFixed(1)}%</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/each}
  {/if}
{/if}

<style>
  label { display: block; color: var(--muted); font-size: 11px; margin-bottom: 8px; }
  textarea { display: block; width: 100%; margin-top: 3px; padding: 6px 8px; font-family: ui-monospace, monospace; font-size: 11px; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; color: var(--text); }
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
