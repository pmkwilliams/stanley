<script lang="ts">
  import { ms, offset, rankedOptions, tickLabel, type DebugModel, type TickView } from './model'
  import Replay from './Replay.svelte'

  let { tick, model, oncopy }: { tick: TickView; model: DebugModel; oncopy: (text: string, what: string) => void } = $props()

  const result = $derived(tick.decision?.result)
  const options = $derived(rankedOptions(tick))
  const raw = $derived(result?.choice)
  const effective = $derived(tick.end?.effective)
  const heard = $derived(tick.start.transcript)
  const usage = $derived(result?.usage)

  const reasons = {
    words: 'new words in the transcript',
    action: 'the previous action finished',
    end: 'the utterance ended',
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
    <dd><code>{tick.start.currentNodeId}</code></dd>
    <dt>Jev chose</dt>
    <dd>
      {#if result}
        <strong>{raw}</strong> · confidence {result.confidence.toFixed(2)} · {ms(result.latencyMs)}
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

  {#if tick.fill || tick.act}
    <h2>Action</h2>
    {#if tick.fill}
      <p>Filled <strong>{tick.fill.option}</strong> with <code>{tick.fill.text}</code> <span class="muted">· {ms(tick.fill.latencyMs)} · field: {tick.fill.instructions}</span></p>
      <details><summary>Fill context sent to the text model</summary><pre>{tick.fill.context}</pre></details>
    {/if}
    {#if tick.act}
      <p>
        Ran <strong>{tick.act.option}</strong>{#if tick.act.nodeId} <code>{tick.act.nodeId}</code>{/if}
        {#if tick.act.summary}→ {tick.act.summary}{/if}
        <span class="muted">· {ms(tick.act.latencyMs)}</span>
      </p>
      {#if tick.act.observation}<details><summary>Observation</summary><pre>{tick.act.observation}</pre></details>{/if}
    {/if}
  {/if}

  {#if tick.checks.length}
    <h2>Consequence checks</h2>
    <ul class="gates">
      {#each tick.checks as c, i (i)}
        <li>
          <strong>{c.option}</strong> → {c.effect}{c.cached ? ' (cached)' : ''}
          {#if c.consequential} · P(user asked) {(c.asked ?? 0).toFixed(2)} · <span class={c.allowed ? '' : 'warn'}>{c.allowed ? 'allowed' : 'needs the user'}</span>{/if}
          <span class="muted">· {ms(c.latencyMs)} · {Object.entries(c.effects).map(([k, p]) => `${k} ${(p * 100).toFixed(0)}%`).join(', ')}</span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if tick.escalation}
    {@const esc = tick.escalation}
    <h2>Escalation</h2>
    <p>{esc.start.reason}</p>
    <ol class="gates">
      {#each esc.steps as step, i (i)}
        <li class:warn={step.blocked}>
          <strong>{step.option}</strong>{#if step.text} <code>{step.text}</code>{/if}
          <details><summary>{step.blocked ? 'blocked' : 'result'}</summary><pre>{step.result}</pre></details>
        </li>
      {/each}
    </ol>
    {#if esc.end}
      <p>
        {#if esc.end.aborted}<span class="warn">Dropped: the user said more.</span>
        {:else if esc.end.text}Said <strong>"{esc.end.text}"</strong>
        {:else}<span class="muted">Said nothing.</span>{/if}
        <span class="muted">· {esc.end.steps} steps · {ms(esc.end.latencyMs)}</span>
      </p>
    {:else}
      <p class="muted">working…</p>
    {/if}
    <details><summary>Context sent to the escalation model</summary><pre>{esc.start.context}</pre></details>
    <details><summary>Options it had</summary><pre>{esc.start.options}</pre></details>
  {/if}

  <h2>Options <span class="muted">({options.length}, ranked by probability)</span></h2>
  <table>
    <tbody>
      {#each options as o (o.option)}
        <tr class:raw={o.option === raw} class:effective={o.option === effective && effective !== raw}>
          <td class="p">
            <div class="bar"><span style:width="{(o.p ?? 0) * 100}%"></span></div>
            {o.p === null ? '—' : `${(o.p * 100).toFixed(1)}%`}
          </td>
          <td>
            <div class="name">{o.option}{#if o.option === raw} <em>chosen</em>{/if}{#if o.option === effective && effective !== raw} <em>took effect</em>{/if}</div>
            {#if o.description}<div class="desc">{o.description}</div>{/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>

  <h2>Jev input</h2>
  <p class="muted">Instructions: {tick.start.instructions}</p>
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
  .outcome.forced-stop, .outcome.error { color: var(--accent); border-color: var(--accent); }
  .outcome.pending { color: var(--muted); border-color: var(--border); }
  dl { display: grid; grid-template-columns: 100px 1fr; gap: 6px 12px; margin: 14px 0 0; }
  dt { color: var(--muted); }
  dd { margin: 0; }
  .muted { color: var(--muted); }
  .warn { color: #f59e0b; }
  .bad { color: var(--accent); }
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
  tr.effective { background: #f59e0b1a; }
  .name em { font-style: normal; font-size: 10px; color: var(--accent); margin-left: 4px; }
  tr.effective .name em { color: #f59e0b; }
  .desc { color: var(--muted); font-size: 11px; }
</style>
