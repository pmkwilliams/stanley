<script lang="ts">
  import type { AppUiProps } from '@stanley/app-sdk'
  import { dayName, describeCode, type WeatherState } from './core'

  let { data, perform }: AppUiProps<WeatherState> = $props()
  let draft = $state('')
  /** Local "in flight" flag: perform is fire-and-forget, so clear it when new state arrives. */
  let pending = $state(false)

  $effect(() => {
    void data
    pending = false
  })

  function search(e: SubmitEvent) {
    e.preventDefault()
    if (!draft.trim()) return
    pending = true
    perform('location', { text: draft })
    draft = ''
  }
</script>

<section class="app">
  <h1>Weather</h1>
  <form onsubmit={search}>
    <input placeholder="Search a city" bind:value={draft} />
  </form>

  {#if data.loading || pending}
    <p class="muted">Looking up…</p>
  {/if}
  {#if data.error}
    <p class="error">{data.error}</p>
  {/if}

  {#if data.result}
    {@const r = data.result}
    <button class="now" class:focused={data.route === 'home'} onclick={() => perform('home')}>
      <div class="place">{r.place}</div>
      <div class="temp">{Math.round(r.temperature)}°</div>
      <div class="muted">{describeCode(r.code)} · wind {Math.round(r.windSpeed)} km/h</div>
    </button>
    <ul>
      {#each r.days as day, i (day.date)}
        <li class:focused={data.route === `day/${i}`}>
          <button onclick={() => perform(`day/${i}`)}>
            <span class="day">{i === 0 ? 'Today' : dayName(day.date).split(' ')[0]}</span>
            <span class="cond">{describeCode(day.code)}</span>
            <span class="range">{Math.round(day.high)}° / <span class="muted">{Math.round(day.low)}°</span></span>
          </button>
        </li>
      {/each}
    </ul>
  {:else if !data.loading && !pending}
    <p class="muted">Search a city to see the forecast.</p>
  {/if}
</section>

<style>
  .app { padding: 24px; max-width: 560px; }
  form input { width: 100%; padding: 10px 12px; margin-bottom: 12px; }
  button { background: none; border: 0; color: inherit; font: inherit; cursor: pointer; text-align: left; }
  .now { display: block; width: 100%; padding: 12px; border-radius: 8px; margin-bottom: 12px; }
  .now.focused, li.focused { background: var(--focus); }
  .place { font-weight: 600; }
  .temp { font-size: 56px; font-weight: 300; line-height: 1.1; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { border-radius: 8px; }
  li button { display: flex; width: 100%; gap: 12px; padding: 8px 12px; }
  .day { width: 96px; }
  .cond { flex: 1; opacity: 0.7; }
  .muted { opacity: 0.5; }
  .error { font-style: italic; opacity: 0.8; }
</style>
