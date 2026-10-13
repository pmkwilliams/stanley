<script lang="ts">
  import { DEFAULT_AGENT_NAME, type AppUiProps } from '@stanley/app-sdk'
  import Icon from '@stanley/app-ui/Icon.svelte'
  import type { IconName } from '@stanley/app-ui/icons'
  import { EMPTY_TITLE, emptyText, conditionLabel, forecastTitle, shortDay, splitPlace, temp, type WeatherState } from './core'

  let { data, perform, agentName = DEFAULT_AGENT_NAME }: AppUiProps<WeatherState> = $props()
  /** Local "in flight" flag: perform is fire-and-forget. A lookup always ends with the box cleared. */
  let pending = $state(false)

  $effect(() => {
    if (!data.box) pending = false
  })

  const busy = $derived(data.loading || pending)

  /** The box's text lives in app state, shared with the agent. */
  function search(e: SubmitEvent) {
    e.preventDefault()
    const text = new FormData(e.currentTarget as HTMLFormElement).get('city')?.toString() ?? ''
    if (!text.trim()) return
    pending = true
    perform('city', { text })
    perform('location')
  }

  /** WMO code → glyph, and which part of it carries colour (the sun, the rain…); the cloud stays in text colour. */
  function glyph(code: number): { icon: IconName; tone: string } {
    if (code <= 1) return { icon: 'sun', tone: 'sun' }
    if (code === 2) return { icon: 'cloud-sun', tone: 'partly' }
    if (code === 3) return { icon: 'cloud', tone: 'cloud' }
    if (code === 45 || code === 48) return { icon: 'cloud-fog', tone: 'fog' }
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return { icon: 'cloud-rain', tone: 'rain' }
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: 'cloud-snow', tone: 'snow' }
    if (code >= 95) return { icon: 'cloud-bolt', tone: 'storm' }
    return { icon: 'cloud', tone: 'cloud' }
  }

  /** Colours along the temperature scale (°C), cold to hot, like iOS Weather's range bars. */
  const scale: [number, [number, number, number]][] = [
    [-10, [122, 132, 255]],
    [0, [84, 190, 250]],
    [10, [94, 210, 170]],
    [18, [250, 210, 70]],
    [26, [255, 155, 40]],
    [34, [255, 85, 70]],
  ]
  function colorAt(t: number): string {
    const i = scale.findIndex(([at]) => at >= t)
    if (i <= 0) return rgb(scale[i === 0 ? 0 : scale.length - 1]![1])
    const [a, ca] = scale[i - 1]!
    const [b, cb] = scale[i]!
    const k = (t - a) / (b - a)
    return rgb(ca.map((c, j) => c + (cb[j]! - c) * k) as [number, number, number])
  }
  const rgb = ([r, g, b]: [number, number, number]) => `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`

  /** The week's span: every bar's track covers it, so the bars line up across days. */
  const week = $derived.by(() => {
    const r = data.result
    if (!r?.days.length) return null
    const lo = Math.min(r.temperature, ...r.days.map((d) => d.low))
    const hi = Math.max(r.temperature, ...r.days.map((d) => d.high))
    const span = Math.max(hi - lo, 1)
    const stops = [lo, ...scale.map(([t]) => t).filter((t) => t > lo && t < hi), hi]
    const gradient = `linear-gradient(90deg, ${stops.map((t) => `${colorAt(t)} ${(((t - lo) / span) * 100).toFixed(1)}%`).join(', ')})`
    return { at: (t: number) => ((t - lo) / span) * 100, gradient }
  })
</script>

<section class="ui-app compact weather">
  <header class="ui-bar">
    <h1 class="ui-title">Weather</h1>
    <form class="find" onsubmit={search}>
      <label class="ui-field search">
        <Icon name="search" size={16} />
        <input
          name="city"
          placeholder="Search for a city"
          aria-label="Search for a city"
          autocomplete="off"
          spellcheck="false"
          value={data.box}
          onchange={(e) => perform('city', { text: e.currentTarget.value })}
        />
        <!-- A new lookup over a forecast already on screen: spin here rather than move the forecast. -->
        {#if busy && data.result}<span class="ui-spinner" role="status" aria-label="Looking up {data.box || data.query}"></span>{/if}
      </label>
    </form>
  </header>

  <div class="ui-body">
    {#if data.error}
      <p class="ui-notice" role="alert"><Icon name="exclamation" size={16} /><span>{data.error}</span></p>
    {/if}

    {#if data.result}
      {@const r = data.result}
      {@const place = splitPlace(r.place)}
      {@const today = r.days[0]}

      {@const g = glyph(r.code)}
      <button class="hero" class:selected={data.route === 'home'} aria-current={data.route === 'home'} onclick={() => perform('home')}>
        <span class="where">
          <span class="city">{place.city}</span>
          {#if place.region}<span class="region">{place.region}</span>{/if}
          <span class="temp ui-num">{temp(r.temperature)}</span>
        </span>
        <span class="now-detail">
          <span class="glyph big {g.tone}"><Icon name={g.icon} size={32} weight={1.5} /></span>
          <span class="cond">{conditionLabel(r.code)}</span>
          {#if today}<span class="meta ui-num">H:{temp(today.high)}&ensp;L:{temp(today.low)}</span>{/if}
          <span class="meta wind ui-num"><Icon name="wind" size={14} />{Math.round(r.windSpeed)} km/h</span>
        </span>
      </button>

      {#if r.days.length && week}
        <section class="ui-section forecast">
          <h2 class="ui-section-title">{forecastTitle(r)}</h2>
          <ul class="ui-group">
            {#each r.days as d, i (d.date)}
              {@const g = glyph(d.code)}
              {@const selected = data.route === `day/${i}`}
              <li>
                <button class="ui-row day" class:selected aria-current={selected} onclick={() => perform(`day/${i}`)}>
                  <span class="name">{i === 0 ? 'Today' : shortDay(d.date)}</span>
                  <span class="glyph {g.tone}"><Icon name={g.icon} size={20} /></span>
                  <span class="lo ui-num">{temp(d.low)}</span>
                  <span class="range" aria-hidden="true">
                    <span class="fill" style:background={week.gradient} style:clip-path="inset(0 {100 - week.at(d.high)}% 0 {week.at(d.low)}% round 3px)"></span>
                    {#if i === 0}<span class="now" style:left="{week.at(r.temperature)}%"></span>{/if}
                  </span>
                  <span class="hi ui-num">{temp(d.high)}</span>
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {:else if busy}
      <p class="busy"><span class="ui-spinner"></span>Looking up {data.box || data.query}…</p>
    {:else}
      <div class="ui-empty">
        <Icon name="cloud-sun" size={40} />
        <p class="ui-empty-title">{EMPTY_TITLE}</p>
        <p class="ui-empty-text">{emptyText(agentName)}</p>
      </div>
    {/if}
  </div>
</section>

<style>
  /* Weather glyph colours: content, like artwork, so fixed per theme rather than tokens. */
  .weather { --wx-sun: #ffcf33; --wx-rain: #5cb8ff; --wx-snow: #a9dcff; }
  :global([data-theme='light']) .weather { --wx-sun: #f0a000; --wx-rain: #2b86e0; --wx-snow: #5fa6e0; }

  .ui-bar { gap: 16px; }
  .find { flex: 1; min-width: 0; }
  .ui-body { display: flex; flex-direction: column; }
  .ui-notice { margin: 0 0 12px; }

  .busy { display: flex; align-items: center; justify-content: center; gap: 10px; flex: 1; margin: 0; color: var(--muted); font-size: 13px; }

  /* Now: like an iOS Weather widget. Where and how warm on the left, what it's like on the right.
     Selectable like a row, so it is where Stanley "is" on home. */
  .hero {
    flex: none; display: flex; justify-content: space-between; gap: 16px; width: 100%; padding: 14px 16px 16px;
    color: inherit; font: inherit; text-align: left; background: none; border: 0; border-radius: var(--r-group); cursor: default;
    transition: background var(--dur-fast);
  }
  .hero:hover { background: var(--fill); }
  .hero.selected { background: var(--selected); }
  .hero:focus-visible { outline: none; box-shadow: var(--focus-ring); }
  .where, .now-detail { display: flex; flex-direction: column; min-width: 0; }
  .now-detail { flex: none; align-items: flex-end; text-align: right; }
  .city { font-size: var(--fs-title); font-weight: 600; letter-spacing: -0.02em; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .region { margin-top: 1px; font-size: var(--fs-footnote); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .temp { margin: auto 0 -6px -4px; padding-top: 8px; font-size: 76px; font-weight: 200; letter-spacing: -0.045em; line-height: 1; }
  .glyph.big { width: auto; margin: 0 -2px auto 0; padding-bottom: 12px; }
  .cond { font-size: var(--fs-headline); font-weight: 500; }
  .meta { margin-top: 2px; font-size: 13px; color: var(--muted); }
  .wind { display: inline-flex; align-items: center; gap: 4px; }

  .forecast { margin-top: 16px; }

  /* Day · glyph · low · range bar · high, in fixed columns so the bars line up. */
  .day { gap: 10px; }
  .name { flex: none; width: 52px; font-weight: 500; }
  .glyph { flex: none; display: grid; place-items: center; width: 28px; color: var(--text); }
  .glyph.sun { color: var(--wx-sun); }
  .glyph.partly :global(path:not(:last-child)) { stroke: var(--wx-sun); }
  .glyph.rain :global(path:not(:first-child)) { stroke: var(--wx-rain); }
  /* Flakes are dots: a heavier stroke so they read at row size. */
  .glyph.snow :global(path:not(:first-child)) { stroke: var(--wx-snow); stroke-width: 2.6; }
  .glyph.storm :global(path:not(:first-child)) { stroke: var(--wx-sun); }
  .glyph.fog :global(path:not(:first-child)) { stroke: var(--muted); }
  .lo, .hi { flex: none; width: 34px; text-align: right; }
  .lo { color: var(--muted); }
  .hi { font-weight: 500; }
  .range { position: relative; flex: 1; height: 5px; margin: 0 4px; border-radius: var(--r-capsule); background: var(--fill-active); }
  .fill { position: absolute; inset: 0; border-radius: var(--r-capsule); }
  /* Today's bar: a dot at the current temperature. */
  .now {
    position: absolute; top: 50%; width: 7px; height: 7px; translate: -50% -50%; border-radius: 50%;
    background: #fff; box-shadow: 0 0 0 1.5px rgba(0, 0, 0, 0.45);
  }
</style>
