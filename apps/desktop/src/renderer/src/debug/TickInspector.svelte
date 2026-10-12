<script lang="ts">
  import { decided, ms, offset, rankedOptions, tickLabel, type DebugModel, type TickView } from './model'
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
  }
</script>

<article>
  <header>
    <h1>Tick #{tick.id}</h1>
    <span class="outcome {tick.end?.outcome ?? 'pending'}">{tick.end?.outcome ?? 'in flight'}</span>
    <span class="muted">{offset(tick.at, model.startAt)}{tick.task ? ` · task ${tick.task}` : ''}</span>
    <span class="spacer"></span>
    <button onclick={() => oncopy(JSON.stringify(tick, null, 2), `tick #${tick.id} as JSON`)}>Copy tick JSON</button>
  </header>

  <dl>
    <dt>Triggered by</dt>
    <dd>{reasons[tick.start.reason]}</dd>
    <dt>Heard</dt>
    <dd>
      {heard.finalized.join(' ')} <span class="muted">{heard.partial}</span>
      {#if !heard.finalized.length && !heard.partial}<span class="muted">—</span>{/if}
      <span class="muted">({tick.start.utteranceEnded ? 'finished' : 'still speaking'})</span>
    </dd>
    <dt>Screen</dt>
    <dd><code>{tick.start.screenId}</code></dd>
    <dt>Jev decided</dt>
    <dd>
      {#if answers}
        <strong>{decided(tick)}</strong>
        · next {answers.next?.confidence.toFixed(2)} · step {answers.step?.confidence.toFixed(2)} · {ms(result?.latencyMs)}
        {#if usage}<span class="muted"> · {usage.inputTokens ?? '?'} in / {usage.outputTokens ?? '?'} out tokens</span>{/if}
        {#if tick.decision?.stale}<span class="warn"> · transcript changed during the call</span>{/if}
        {#if tick.decision?.endedDuringCall}<span class="muted"> · utterance ended during the call</span>{/if}
      {:else if tick.end?.outcome === 'error'}
        <span class="bad">call failed</span>
      {:else}
        <span class="muted">waiting for Jev…</span>
      {/if}
    </dd>
    <dt>Took effect</dt>
    <dd><strong>{tickLabel(tick)}</strong>{#if tick.end?.detail}<span class="muted"> · {tick.end.detail}</span>{/if}</dd>
  </dl>

  <h2>Guardrails</h2>
  {#if tick.gates.length}
    <ul class="gates">
      {#each tick.gates as g, i (i)}<li><strong>{g.rule}</strong> — {g.detail}</li>{/each}
    </ul>
  {:else if tick.end && tick.end.outcome !== 'error'}
    <p class="muted">Passed all guardrails.</p>
  {/if}

  {#if tick.effects.length}
    <h2>What the button does</h2>
    <ul class="gates">
      {#each tick.effects as e, i (i)}
        <li>
          <strong>{e.option}</strong> → <span class={e.effect === 'commits' ? 'warn' : ''}>{e.effect}</span>{e.cached ? ' (cached)' : ''}
          <span class="muted">· {ms(e.latencyMs)} · {Object.entries(e.probabilities).map(([k, p]) => `${k} ${(p * 100).toFixed(0)}%`).join(', ')}</span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if tick.write}
    {@const w = tick.write}
    <h2>Writing</h2>
    {#if w.aborted}
      <p class="warn">Dropped: the user said more. <span class="muted">· {ms(w.latencyMs)}</span></p>
    {:else}
      <p>
        <strong>{w.option}</strong>: {w.source} <code>{w.text || '—'}</code>
        {#if w.say}· said <strong>"{w.say}"</strong>{/if}
        <span class="muted">· {ms(w.latencyMs)}</span>
      </p>
    {/if}
    <details><summary>Context sent to thinking</summary><pre>{w.context}</pre></details>
  {/if}

  {#if tick.confirm}
    {@const c = tick.confirm}
    <h2>Go-ahead</h2>
    {#if c.aborted}
      <p class="warn">Dropped: the user said more. <span class="muted">· {ms(c.latencyMs)}</span></p>
    {:else}
      <p>
        <strong>{c.option}</strong>: {c.press ? 'pressed it' : 'asked first'}
        {#if c.say}· said <strong>"{c.say}"</strong>{/if}
        <span class="muted">· {ms(c.latencyMs)}</span>
      </p>
    {/if}
    <details><summary>Context sent to thinking</summary><pre>{c.context}</pre></details>
  {/if}

  {#if tick.acts.length}
    <h2>Steps</h2>
    {#each tick.acts as act, i (i)}
      <p>
        <strong>{act.option}</strong>{#if act.args?.text !== undefined} <code>{act.args.text}</code>{/if}
        {#if act.summary}→ {act.summary}{/if}
        <span class="muted">· {ms(act.latencyMs)}</span>
      </p>
      {#if act.observation}<details><summary>Observation</summary><pre>{act.observation}</pre></details>{/if}
    {/each}
  {/if}

  {#if tick.thinking}
    {@const t = tick.thinking}
    <h2>Thinking</h2>
    <p>{t.start.reason}</p>
    <ol class="gates">
      {#each t.steps as step, i (i)}
        <li>
          <strong>{step.option}</strong>{#if step.text} <code>{step.text}</code>{/if}
          <details><summary>result</summary><pre>{step.result}</pre></details>
        </li>
      {/each}
    </ol>
    {#if t.end}
      <p>
        {#if t.end.aborted}<span class="warn">Dropped: the user said more.</span>
        {:else if t.end.text}Said <strong>"{t.end.text}"</strong>
        {:else}<span class="muted">Said nothing.</span>{/if}
        <span class="muted">· {t.end.steps} steps · {ms(t.end.latencyMs)}</span>
      </p>
    {:else}
      <p class="muted">working…</p>
    {/if}
    <details><summary>Context sent to thinking</summary><pre>{t.start.context}</pre></details>
    <details><summary>Options it had</summary><pre>{t.start.options}</pre></details>
  {/if}

  {#each [{ title: 'What now', options: nextOptions, question: 'next' }, { title: 'Which step', options: stepOptions, question: 'step' }] as q (q.question)}
    {@const chosen = answers?.[q.question]?.choice}
    <h2>{q.title} <span class="muted">({q.options.length}, ranked by probability)</span></h2>
    <table>
      <tbody>
        {#each q.options as o (o.option)}
          <tr class:raw={o.option === chosen}>
            <td class="p">
              <div class="bar"><span style:width="{(o.p ?? 0) * 100}%"></span></div>
              {o.p === null ? '—' : `${(o.p * 100).toFixed(1)}%`}
            </td>
            <td>
              <div class="name">{o.option}{#if o.option === chosen} <em>chosen</em>{/if}</div>
              {#if o.description}<div class="desc">{o.description}</div>{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/each}

  <h2>Jev input</h2>
  {#each Object.entries(tick.start.questions) as [id, q] (id)}
    <p class="muted">{id}: {q.instructions}</p>
  {/each}
  <details>
    <summary>State ({tick.start.state.length.toLocaleString()} chars)</summary>
    <pre>{tick.start.state}</pre>
  </details>

  <h2>Replay</h2>
  <Replay {tick} />
</article>

<style>
  article { padding: 12px 16px 32px; font-size: 13px; }
  header { display: flex; align-items: center; gap: 8px; }
  h1 { font-size: 16px; margin: 0; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 20px 0 8px; }
  .spacer { flex: 1; }
  header button { font-size: 11px; background: none; border: 1px solid var(--border); border-radius: 6px; padding: 3px 8px; cursor: pointer; }
  .outcome { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid #22c55e88; color: #22c55e; }
  .outcome.gated, .outcome.stale-discarded { color: #f59e0b; border-color: #f59e0b88; }
  .outcome.forced-stop, .outcome.error { color: var(--danger); border-color: var(--danger); }
  .outcome.pending { color: var(--muted); border-color: var(--border); }
  dl { display: grid; grid-template-columns: 100px 1fr; gap: 6px 12px; margin: 14px 0 0; }
  dt { color: var(--muted); }
  dd { margin: 0; }
  .muted { color: var(--muted); }
  .warn { color: #f59e0b; }
  .bad { color: var(--danger); }
  .gates { margin: 0; padding-left: 18px; }
  code { font-family: ui-monospace, monospace; font-size: 12px; background: var(--panel); padding: 1px 4px; border-radius: 4px; }
  pre { font-family: ui-monospace, monospace; font-size: 11px; white-space: pre-wrap; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 8px; max-height: 420px; overflow: auto; }
  details { margin: 4px 0; }
  summary { cursor: pointer; color: var(--muted); }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 4px 6px; border-top: 1px solid var(--border); vertical-align: top; }
  td.p { width: 110px; font-variant-numeric: tabular-nums; font-size: 12px; }
  .bar { height: 4px; background: var(--panel); border-radius: 2px; margin-bottom: 3px; }
  .bar span { display: block; height: 100%; background: var(--accent); border-radius: 2px; }
  tr.raw { background: var(--focus); }
  .name em { font-style: normal; font-size: 10px; color: var(--accent); margin-left: 4px; }
  .desc { color: var(--muted); font-size: 11px; }
</style>
