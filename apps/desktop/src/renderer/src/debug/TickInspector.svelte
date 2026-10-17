<script lang="ts">
  import { decided, inputText, messageParts, modelInput, ms, offset, rankedOptions, tickLabel, type DebugModel, type TickView } from './model'
  import { Badge } from '@stanley/app-ui/components/badge'
  import { Button } from '@stanley/app-ui/components/button'
  import Replay from './Replay.svelte'

  let { tick, model, oncopy }: { tick: TickView; model: DebugModel; oncopy: (text: string, what: string) => void } = $props()

  const answers = $derived(tick.decision?.result.answers)
  const result = $derived(tick.decision?.result)
  const heard = $derived(tick.start.transcript)
  const usage = $derived(result?.usage)
  const nextOptions = $derived(rankedOptions(tick, 'next'))
  const stepOptions = $derived(rankedOptions(tick, 'step'))

  const reasons = {
    words: 'new words in the transcript',
    action: 'the previous step finished',
    end: 'the utterance ended',
    pause: 'the user paused',
    task: 'a background task ended: telling the user',
  }

  /** The outcome pill: green when it went through, amber when held back, red when it failed. */
  function tone(outcome: string | undefined) {
    if (outcome === undefined) return 'text-muted-foreground'
    if (outcome === 'gated' || outcome === 'stale-discarded') return 'border-warning/50 text-warning'
    if (outcome === 'forced-stop' || outcome === 'error') return 'border-destructive text-destructive'
    return 'border-success/50 text-success'
  }

  const h2 = 'mt-5 mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase'
  const para = 'my-2'
  const list = 'list-disc pl-4.5'
  const code = 'rounded-sm bg-muted px-1 py-px font-mono text-xs'
  const pre = 'max-h-105 overflow-auto rounded-md border bg-muted p-2 font-mono text-xs whitespace-pre-wrap'
  const details = 'my-1'
  const summary = 'cursor-pointer text-muted-foreground'
</script>

<article class="px-4 pt-3 pb-8 text-sm">
  <header class="flex items-center gap-2">
    <h1 class="text-base font-semibold">Tick #{tick.id}</h1>
    <Badge variant="outline" class={tone(tick.end?.outcome)}>{tick.end?.outcome ?? 'in flight'}</Badge>
    <span class="text-muted-foreground">{offset(tick.at, model.startAt)}{tick.task ? ` · task ${tick.task}` : ''}</span>
    <Button variant="outline" size="xs" class="ml-auto" onclick={() => oncopy(JSON.stringify(tick, null, 2), `tick #${tick.id} as JSON`)}>Copy tick JSON</Button>
  </header>

  <dl class="mt-3.5 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5">
    <dt class="text-muted-foreground">Triggered by</dt>
    <dd>{reasons[tick.start.reason]}</dd>
    <dt class="text-muted-foreground">Heard</dt>
    <dd>
      {heard.finalized.join(' ')} <span class="text-muted-foreground">{heard.partial}</span>
      {#if !heard.finalized.length && !heard.partial}<span class="text-muted-foreground">—</span>{/if}
      <span class="text-muted-foreground">({tick.start.utteranceEnded ? 'finished' : 'still speaking'})</span>
    </dd>
    <dt class="text-muted-foreground">Screen</dt>
    <dd><code class={code}>{tick.start.screenId}</code></dd>
    <dt class="text-muted-foreground">Jev decided</dt>
    <dd>
      {#if answers}
        <strong>{decided(tick)}</strong>
        · next {answers.next?.confidence.toFixed(2)} · step {answers.step?.confidence.toFixed(2)} · {ms(result?.latencyMs)}
        {#if usage}<span class="text-muted-foreground"> · {usage.inputTokens ?? '?'} in / {usage.outputTokens ?? '?'} out tokens</span>{/if}
        {#if tick.decision?.stale}<span class="text-warning"> · transcript changed during the call</span>{/if}
        {#if tick.decision?.endedDuringCall}<span class="text-muted-foreground"> · utterance ended during the call</span>{/if}
      {:else if tick.end?.outcome === 'error'}
        <span class="text-destructive">call failed</span>
      {:else}
        <span class="text-muted-foreground">waiting for Jev…</span>
      {/if}
    </dd>
    <dt class="text-muted-foreground">Took effect</dt>
    <dd><strong>{tickLabel(tick)}</strong>{#if tick.end?.detail}<span class="text-muted-foreground"> · {tick.end.detail}</span>{/if}</dd>
  </dl>

  <h2 class={h2}>Guardrails</h2>
  {#if tick.gates.length}
    <ul class={list}>
      {#each tick.gates as g, i (i)}<li><strong>{g.rule}</strong> — {g.detail}</li>{/each}
    </ul>
  {:else if tick.end && tick.end.outcome !== 'error'}
    <p class="{para} text-muted-foreground">Passed all guardrails.</p>
  {/if}

  {#if tick.screens.length}
    <h2 class={h2}>The screen</h2>
    <ul class={list}>
      {#each tick.screens as sc, i (i)}
        <li>
          <strong>{sc.source}</strong>: {sc.before || 'home'} → {sc.after === null ? `left as it was (${sc.reason})` : sc.after || 'home'}
          <span class="text-muted-foreground">{sc.confidence === undefined ? '' : `· show ${(sc.confidence * 100).toFixed(0)}%`}{sc.left == null ? '' : ` · left ${(sc.left * 100).toFixed(0)}%`}{sc.latencyMs === undefined ? '' : ` · ${ms(sc.latencyMs)}`}</span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if tick.acts.length}
    <h2 class={h2}>Steps</h2>
    {#each tick.acts as act, i (i)}
      <p class={para}>
        <strong>{act.option}</strong>{#if act.args?.text !== undefined} <code class={code}>{act.args.text}</code>{/if}
        {#if act.summary}→ {act.summary}{/if}
        <span class="text-muted-foreground">· {ms(act.latencyMs)}</span>
      </p>
      {#if act.observation}<details class={details}><summary class={summary}>Observation</summary><pre class={pre}>{act.observation}</pre></details>{/if}
    {/each}
  {/if}

  {#each tick.thinking as t, ti (ti)}
    {@const input = modelInput(model, t)}
    {@const u = t.end?.usage}
    <h2 class={h2}>Thinking{t.start.mode === 'run' ? '' : `: one step, ${t.start.mode === 'write' ? 'typing into' : 'pressing'} [${t.start.option}]`}</h2>
    <p class="{para} text-muted-foreground">Why: {t.start.handover}</p>
    <ol class="list-decimal pl-4.5">
      {#each t.steps as step, i (i)}
        <li>
          <strong>{step.option}</strong>{#if step.text} <code class={code}>{step.text}</code>{/if}
          <details class={details}><summary class={summary}>result</summary><pre class={pre}>{step.result}</pre></details>
        </li>
      {/each}
    </ol>
    {#if t.end}
      <p class={para}>
        {#if t.end.aborted}<span class="text-warning">Dropped: the user said more.</span>
        {:else if t.end.text}Said <strong>"{t.end.text}"</strong>
        {:else}<span class="text-muted-foreground">Said nothing.</span>{/if}
        <span class="text-muted-foreground">· {t.end.steps} steps · {ms(t.end.latencyMs)}</span>
        {#if u}<span class="text-muted-foreground"> · {u.inputTokens ?? "?"} in ({u.cacheReadTokens ?? 0} cached, {u.cacheWriteTokens ?? 0} written; last step {u.lastInputTokens ?? "?"}) / {u.outputTokens ?? '?'} out tokens</span>{/if}
      </p>
    {:else}
      <p class="{para} text-muted-foreground">working…</p>
    {/if}
    <details class={details}>
      <summary class={summary}>Model input ({input.length} messages{t.start.cacheAt !== undefined ? `, cache read at #${t.start.cacheAt}` : ''})</summary>
      <Button variant="outline" size="xs" class="my-1" onclick={() => oncopy(inputText(model, t), 'the model input')}>Copy model input</Button>
      <details class={details}><summary class={summary}>Instructions</summary><pre class={pre}>{model.session?.instructions ?? '(not recorded in this session)'}</pre></details>
      <ol class="my-1.5">
        {#each input as m, i (i)}
          <li class={['border-t py-1', m.role === 'assistant' && 'bg-muted']}>
            <span class="text-xs text-muted-foreground">#{i} {m.role}</span>
            {#each messageParts(m) as part, j (j)}
              {#if part.kind === 'reasoning'}<details class={details}><summary class={summary}>reasoning</summary><pre class={pre}>{part.text}</pre></details>
              {:else if part.kind === 'call'}<div><strong>→ {part.text}</strong></div>
              {:else if part.kind === 'result'}<details class={details}><summary class={summary}>result</summary><pre class={pre}>{part.text}</pre></details>
              {:else}<pre class={pre}>{part.text}</pre>{/if}
            {/each}
          </li>
        {/each}
      </ol>
    </details>
  {/each}

  {#each [{ title: 'What now', options: nextOptions, question: 'next' }, { title: 'Which step', options: stepOptions, question: 'step' }] as q (q.question)}
    {@const chosen = answers?.[q.question]?.choice}
    <h2 class={h2}>{q.title} <span class="text-muted-foreground">({q.options.length}, ranked by probability)</span></h2>
    <table class="w-full border-collapse">
      <tbody>
        {#each q.options as o (o.option)}
          <tr class={[o.option === chosen && 'bg-accent']}>
            <td class="w-28 border-t px-1.5 py-1 align-top text-xs tabular-nums">
              <div class="mb-0.5 h-1 rounded-full bg-muted"><span class="block h-full rounded-full bg-primary" style:width="{(o.p ?? 0) * 100}%"></span></div>
              {o.p === null ? '—' : `${(o.p * 100).toFixed(1)}%`}
            </td>
            <td class="border-t px-1.5 py-1 align-top">
              <div>{o.option}{#if o.option === chosen} <em class="ml-1 text-xs text-primary not-italic">chosen</em>{/if}</div>
              {#if o.description}<div class="text-xs text-muted-foreground">{o.description}</div>{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/each}

  <h2 class={h2}>Jev input</h2>
  {#each Object.entries(tick.start.questions) as [id, q] (id)}
    <p class="{para} text-muted-foreground">{id}: {q.instructions}</p>
  {/each}
  <details class={details}>
    <summary class={summary}>State ({tick.start.state.length.toLocaleString()} chars)</summary>
    <pre class={pre}>{tick.start.state}</pre>
  </details>

  <h2 class={h2}>Replay</h2>
  <Replay {tick} />
</article>
