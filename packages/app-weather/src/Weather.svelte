<script lang="ts">
  import { DEFAULT_AGENT_NAME, type AppUiProps } from '@stanley/app-sdk'
  import Icon from '@stanley/app-ui/Icon.svelte'
  import type { IconName } from '@stanley/app-ui/icons'
  import * as Alert from '@stanley/app-ui/components/alert'
  import * as App from '@stanley/app-ui/components/app'
  import * as Empty from '@stanley/app-ui/components/empty'
  import * as InputGroup from '@stanley/app-ui/components/input-group'
  import * as Item from '@stanley/app-ui/components/item'
  import { Spinner } from '@stanley/app-ui/components/spinner'
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

  /**
   * Weather glyph colours are content, like artwork, so they're fixed per theme rather than tokens.
   * Only the part that carries colour is tinted (the sun, the rain…); the cloud stays in text colour.
   */
  const tones = {
    sun: 'text-amber-500 dark:text-amber-300',
    partly: '[&_path:not(:last-child)]:stroke-amber-500 dark:[&_path:not(:last-child)]:stroke-amber-300',
    cloud: '',
    fog: '[&_path:not(:first-child)]:stroke-muted-foreground',
    rain: '[&_path:not(:first-child)]:stroke-sky-600 dark:[&_path:not(:first-child)]:stroke-sky-400',
    // Flakes are dots: a heavier stroke so they read at row size.
    snow: '[&_path:not(:first-child)]:stroke-sky-400 dark:[&_path:not(:first-child)]:stroke-sky-200 [&_path:not(:first-child)]:stroke-[2.6]',
    storm: '[&_path:not(:first-child)]:stroke-amber-500 dark:[&_path:not(:first-child)]:stroke-amber-300',
  }

  /** WMO code → glyph, and the classes that colour it. */
  function glyph(code: number): { icon: IconName; tone: string } {
    if (code <= 1) return { icon: 'sun', tone: tones.sun }
    if (code === 2) return { icon: 'cloud-sun', tone: tones.partly }
    if (code === 3) return { icon: 'cloud', tone: tones.cloud }
    if (code === 45 || code === 48) return { icon: 'cloud-fog', tone: tones.fog }
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return { icon: 'cloud-rain', tone: tones.rain }
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: 'cloud-snow', tone: tones.snow }
    if (code >= 95) return { icon: 'cloud-bolt', tone: tones.storm }
    return { icon: 'cloud', tone: tones.cloud }
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

<App.Root size="compact">
  <App.Bar class="gap-4">
    <App.Title>Weather</App.Title>
    <form class="min-w-0 flex-1" onsubmit={search}>
      <InputGroup.Root>
        <InputGroup.Input
          name="city"
          placeholder="Search for a city"
          aria-label="Search for a city"
          autocomplete="off"
          spellcheck="false"
          value={data.box}
          onchange={(e) => perform('city', { text: e.currentTarget.value })}
        />
        <InputGroup.Addon><Icon name="search" size={16} /></InputGroup.Addon>
        <!-- A new lookup over a forecast already on screen: spin here rather than move the forecast. -->
        {#if busy && data.result}
          <InputGroup.Addon align="inline-end"><Spinner aria-label="Looking up {data.box || data.query}" /></InputGroup.Addon>
        {/if}
      </InputGroup.Root>
    </form>
  </App.Bar>

  <App.Body>
    {#if data.error}
      <Alert.Root variant="destructive" class="mb-3">
        <Icon name="exclamation" size={16} />
        <Alert.Description>{data.error}</Alert.Description>
      </Alert.Root>
    {/if}

    {#if data.result}
      {@const r = data.result}
      {@const place = splitPlace(r.place)}
      {@const today = r.days[0]}
      {@const g = glyph(r.code)}
      <!-- Now: like an iOS Weather widget. Where and how warm on the left, what it's like on the right.
           Selectable like a row, so it is where Stanley "is" on home. -->
      <Item.Root data-selected={data.route === 'home'} class="flex-none flex-nowrap items-stretch justify-between gap-4 rounded-xl px-4 pt-3.5 pb-4 hover:bg-accent">
        {#snippet child({ props })}
          <button {...props} aria-current={data.route === 'home'} onclick={() => perform('home')}>
            <span class="flex min-w-0 flex-col text-left">
              <span class="truncate text-xl leading-tight font-semibold tracking-tight">{place.city}</span>
              {#if place.region}<span class="mt-px truncate text-xs text-muted-foreground">{place.region}</span>{/if}
              <span class="mt-auto -mb-1.5 -ml-1 pt-2 text-7xl leading-none font-extralight tracking-tighter tabular-nums">{temp(r.temperature)}</span>
            </span>
            <span class="flex flex-none flex-col items-end text-right">
              <span class={['-mr-0.5 mb-auto pb-3', g.tone]}><Icon name={g.icon} size={32} weight={1.5} /></span>
              <span class="text-base font-medium">{conditionLabel(r.code)}</span>
              {#if today}<span class="mt-0.5 text-sm text-muted-foreground tabular-nums">H:{temp(today.high)}&ensp;L:{temp(today.low)}</span>{/if}
              <span class="mt-0.5 inline-flex items-center gap-1 text-sm text-muted-foreground tabular-nums"><Icon name="wind" size={14} />{Math.round(r.windSpeed)} km/h</span>
            </span>
          </button>
        {/snippet}
      </Item.Root>

      {#if r.days.length && week}
        <App.Section class="mt-4" title={forecastTitle(r)}>
          <App.Group>
            {#each r.days as d, i (d.date)}
              {@const g = glyph(d.code)}
              {@const selected = data.route === `day/${i}`}
              <li>
                <!-- Day · glyph · low · range bar · high, in fixed columns so the bars line up. -->
                <Item.Root size="row" data-selected={selected} class="gap-2.5 hover:bg-accent">
                  {#snippet child({ props })}
                    <button {...props} aria-current={selected} onclick={() => perform(`day/${i}`)}>
                      <span class="w-13 flex-none text-left font-medium">{i === 0 ? 'Today' : shortDay(d.date)}</span>
                      <span class={['grid w-7 flex-none place-items-center', g.tone]}><Icon name={g.icon} size={20} /></span>
                      <span class="w-9 flex-none text-right text-muted-foreground tabular-nums">{temp(d.low)}</span>
                      <span class="relative mx-1 h-1.5 flex-1 rounded-full bg-input" aria-hidden="true">
                        <span class="absolute inset-0 rounded-full" style:background={week.gradient} style:clip-path="inset(0 {100 - week.at(d.high)}% 0 {week.at(d.low)}% round 3px)"></span>
                        <!-- Today's bar: a dot at the current temperature. -->
                        {#if i === 0}<span class="absolute top-1/2 size-2 -translate-1/2 rounded-full bg-white ring-2 ring-black/40" style:left="{week.at(r.temperature)}%"></span>{/if}
                      </span>
                      <span class="w-9 flex-none text-right font-medium tabular-nums">{temp(d.high)}</span>
                    </button>
                  {/snippet}
                </Item.Root>
              </li>
            {/each}
          </App.Group>
        </App.Section>
      {/if}
    {:else if busy}
      <p class="flex flex-1 items-center justify-center gap-2.5 text-sm text-muted-foreground"><Spinner />Looking up {data.box || data.query}…</p>
    {:else}
      <Empty.Root>
        <Empty.Header>
          <Empty.Media class="text-muted-foreground/60"><Icon name="cloud-sun" size={40} /></Empty.Media>
          <Empty.Title>{EMPTY_TITLE}</Empty.Title>
          <Empty.Description>{emptyText(agentName)}</Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {/if}
  </App.Body>
</App.Root>
