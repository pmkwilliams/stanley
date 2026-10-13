<script lang="ts">
  import { Button } from '@stanley/app-ui/components/button'
  import { Textarea } from '@stanley/app-ui/components/textarea'
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

  const label = 'block text-xs text-muted-foreground'
  /** Fixed sizing, so `rows` holds and a long state scrolls rather than growing the field. */
  const field = 'mt-1 field-sizing-fixed font-mono text-xs text-foreground md:text-xs'
  const cell = 'border-t px-1.5 py-1'
</script>

<div class="space-y-2">
  {#if !draft}
    <p class="text-muted-foreground">Re-run this decision against Jev, as recorded or with an edited state or questions.</p>
    <Button variant="outline" size="sm" onclick={edit}>Edit &amp; re-run…</Button>
  {:else}
    <label class={label}>State <Textarea class={field} rows={14} bind:value={draft.state} /></label>
    <label class={label}>Questions (JSON: id → instructions and options) <Textarea class={field} rows={10} bind:value={draft.questions} /></label>
    <div class="flex gap-2">
      <Button variant="outline" size="sm" onclick={run} disabled={running}>{running ? 'Running…' : 'Run against Jev'}</Button>
      <Button variant="outline" size="sm" onclick={edit} disabled={running}>Reset to recorded</Button>
    </div>
    {#if error}<p class="text-destructive">{error}</p>{/if}
    {#if result}
      <p class="text-muted-foreground">{ms(result.latencyMs)}</p>
      {#each compared as q (q.id)}
        <p class="pt-2">
          {q.id}: <strong>{q.choice}</strong> · confidence {q.confidence.toFixed(2)}
          {#if q.choice !== q.recorded}<span class="text-warning"> · differs from recorded ({q.recorded ?? '—'})</span>{/if}
        </p>
        <table class="w-full border-collapse text-xs">
          <thead>
            <tr><th class="{cell} text-left font-medium text-muted-foreground">Option</th><th class="{cell} text-left font-medium text-muted-foreground">Recorded</th><th class="{cell} text-left font-medium text-muted-foreground">Replay</th></tr>
          </thead>
          <tbody>
            {#each q.rows as c (c.option)}
              <tr>
                <td class={cell}>{c.option}</td>
                <td class="{cell} w-20 tabular-nums">{c.before === undefined ? '—' : `${(c.before * 100).toFixed(1)}%`}</td>
                <td class="{cell} w-20 tabular-nums">{(c.p * 100).toFixed(1)}%</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/each}
    {/if}
  {/if}
</div>
