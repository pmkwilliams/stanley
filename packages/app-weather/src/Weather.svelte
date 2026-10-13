<script lang="ts">
  import { DEFAULT_AGENT_NAME, type AppUiProps } from '@stanley/app-sdk'
  import Icon from '@stanley/app-ui/Icon.svelte'
  import * as Alert from '@stanley/app-ui/components/alert'
  import * as App from '@stanley/app-ui/components/app'
  import * as Empty from '@stanley/app-ui/components/empty'
  import * as InputGroup from '@stanley/app-ui/components/input-group'
  import * as Item from '@stanley/app-ui/components/item'
  import { Spinner } from '@stanley/app-ui/components/spinner'
  import { EMPTY_TITLE, HERE_LABEL, emptyText, conditionLabel, FORECAST_TITLE, shortDay, splitPlace, temp, TODAY_LABEL, type WeatherState } from './core'

  let { data, perform, agentName = DEFAULT_AGENT_NAME }: AppUiProps<WeatherState> = $props()
  /** Local "in flight" flag: perform is fire-and-forget. A lookup always ends with the box cleared. */
  let pending = $state(false)

  $effect(() => {
    if (!data.box) pending = false
  })

  /** Back to the current location's forecast: spins until the app's state next changes. */
  let locating = $state(false)
  $effect(() => {
    void data
    locating = false
  })
  function here() {
    locating = true
    perform('here')
  }

  const busy = $derived(data.loading || pending || locating)

  /** The field shows the place until it's focused, then what to type. */
  let typing = $state(false)

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
   * WMO code → SF Symbol, as in iOS Weather. The images are rendered from SF Symbols by
   * scripts/render-icons.swift: `-dark` for dark backgrounds (white clouds), `-light` for light ones.
   */
  function symbol(code: number): string {
    if (code <= 1) return 'sun-max-fill'
    if (code === 2) return 'cloud-sun-fill'
    if (code === 45 || code === 48) return 'cloud-fog-fill'
    if (code >= 51 && code <= 55) return 'cloud-drizzle-fill'
    if (code === 56 || code === 57 || code === 66 || code === 67) return 'cloud-sleet-fill'
    if (code === 65 || code === 82) return 'cloud-heavyrain-fill'
    if ((code >= 61 && code <= 63) || code === 80 || code === 81) return 'cloud-rain-fill'
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'cloud-snow-fill'
    if (code >= 95) return 'cloud-bolt-rain-fill'
    return 'cloud-fill'
  }
  const icon = (code: number, on: 'dark' | 'light') => new URL(`./icons/${symbol(code)}-${on}.png`, import.meta.url).href

  /** `18°` → `18`: the hero sets its degree sign apart. */
  const degrees = (n: number) => temp(n).slice(0, -1)
</script>

<!-- Grows past the usual fixed height to fit the whole forecast, up to what the shell allows. -->
<App.Root size="compact" class="h-auto min-h-150">
  <!-- The sky card: 8px inside the window's corners, so rounded-2xl (24 − 8). Its colours are content, like artwork. -->
  <div class="flex-none px-2 pt-2">
    <div class="flex flex-col gap-3 rounded-2xl bg-linear-to-t from-sky-500 to-blue-600 px-3 pt-4 pb-3 text-white">
      <form class="mx-auto w-full max-w-64" onsubmit={search}>
        <InputGroup.Root class="rounded-full border-transparent bg-sky-950/30 dark:bg-sky-950/30 has-[[data-slot=input-group-control]:focus-visible]:border-white/60 has-[[data-slot=input-group-control]:focus-visible]:ring-white/30">
          <!-- Shows where the forecast is for; typing searches for a city instead. -->
          <InputGroup.Addon class="text-white"><Icon name={data.result?.here ? 'location' : 'search'} size={16} /></InputGroup.Addon>
          <InputGroup.Input
            name="city"
            placeholder={data.result && !typing ? splitPlace(data.result.place).city : 'Search for a city'}
            aria-label="Search for a city"
            autocomplete="off"
            spellcheck="false"
            onfocus={() => (typing = true)}
            onblur={() => (typing = false)}
            class="text-center font-medium placeholder:text-white focus:placeholder:text-white/70"
            value={data.box}
            onchange={(e) => perform('city', { text: e.currentTarget.value })}
          />
          <!-- A new lookup over a forecast already on screen: spin here rather than move the forecast. -->
          {#if busy && data.result}
            <InputGroup.Addon align="inline-end" class="text-white"><Spinner aria-label="Looking up {locating ? HERE_LABEL : data.box || data.query}" /></InputGroup.Addon>
          {:else if !data.result?.here}
            <InputGroup.Addon align="inline-end">
              <InputGroup.Button size="icon-xs" class="text-white hover:bg-white/20 hover:text-white" aria-label={HERE_LABEL} title={HERE_LABEL} onclick={here}><Icon name="location" size={16} /></InputGroup.Button>
            </InputGroup.Addon>
          {:else}
            <!-- Balances the leading icon, so the place name sits in the middle. -->
            <InputGroup.Addon align="inline-end" aria-hidden="true" class="invisible"><Icon name="location" size={16} /></InputGroup.Addon>
          {/if}
        </InputGroup.Root>
      </form>

      {#if data.result}
        {@const r = data.result}
        {@const today = r.days[0]}
        <!-- Now: how warm on the left, what it's like on the right. Selectable like a row, so it is where Stanley "is" on home. -->
        <Item.Root data-selected={data.route === 'home'} class="flex-col flex-nowrap items-stretch gap-3 px-2 pt-3 pb-1 hover:bg-white/10 data-[selected=true]:bg-transparent">
          {#snippet child({ props })}
            <button {...props} aria-current={data.route === 'home'} onclick={() => perform('home')}>
              <span class="text-center text-sm font-medium">{TODAY_LABEL}</span>
              <span class="grid grid-cols-2 items-center gap-4 py-4">
                <span class="flex flex-col items-center text-center">
                  <!-- The degree sign hangs off the number, so the number itself is what's centred. -->
                  <span class="relative text-[5.25rem] leading-none font-medium tracking-tighter tabular-nums">{degrees(r.temperature)}<span class="absolute top-0 left-full text-4xl text-white/50">°</span></span>
                  <span class="mt-2 text-sm text-white/80 tabular-nums">Feels like {temp(r.feelsLike)}</span>
                  {#if today}<span class="text-sm font-medium tabular-nums">H:{temp(today.high)}&ensp;L:{temp(today.low)}</span>{/if}
                </span>
                <span class="flex flex-col items-center gap-2 text-center">
                  <img src={icon(r.code, 'dark')} alt="" class="size-24" />
                  <span class="text-base font-medium">{conditionLabel(r.code)}</span>
                </span>
              </span>
            </button>
          {/snippet}
        </Item.Root>
      {/if}
    </div>
  </div>

  {#if data.error}
    <Alert.Root variant="destructive" class="mx-4 mt-2 w-auto flex-none">
      <Icon name="exclamation" size={16} />
      <Alert.Description>{data.error}</Alert.Description>
    </Alert.Root>
  {/if}

  <App.Body class={data.result ? 'pt-0' : 'pt-2'}>
    {#if data.result}
      {@const r = data.result}
      <!-- The forecast's title (App.Section's title style) sticks while the list scrolls under it. Its glass holds for the top half, then fades
           out: tint 60% → 0, and a large blur masked away towards the bottom. -->
      <h2 id="forecast-title" class="sticky top-0 z-10 -mx-4 bg-linear-to-b from-card/60 from-50% to-card/0 px-7 pt-5 pb-3 text-xs font-semibold text-muted-foreground">
        <span class="absolute inset-0 -z-10 backdrop-blur-lg mask-b-from-50%" aria-hidden="true"></span>{FORECAST_TITLE}
      </h2>
      <!-- The forecast, as a plain list: day · condition · high, low. -->
      <App.Group aria-labelledby="forecast-title" class="bg-transparent p-0 backdrop-blur-none">
        {#each r.days as d, i (d.date)}
          {@const selected = data.route === `day/${i}`}
          <li>
            <!-- Even columns, the condition taking two so it fits: day · condition · high and low. -->
            <Item.Root size="row" data-selected={selected} class="grid grid-cols-4 gap-3 hover:bg-accent">
              {#snippet child({ props })}
                <button {...props} aria-current={selected} onclick={() => perform(`day/${i}`)}>
                  <span class="text-left font-medium">{shortDay(d.date)}</span>
                  <span class="col-span-2 flex min-w-0 items-center gap-2.5 text-left">
                    <span class="grid w-6 flex-none place-items-center">
                      <img src={icon(d.code, 'light')} alt="" class="size-6 dark:hidden" />
                      <img src={icon(d.code, 'dark')} alt="" class="hidden size-6 dark:block" />
                    </span>
                    <span class="truncate">{conditionLabel(d.code)}</span>
                  </span>
                  <span class="flex justify-end gap-2 tabular-nums">
                    <span class="font-medium">{temp(d.high)}</span>
                    <span class="text-foreground/70">{temp(d.low)}</span>
                  </span>
                </button>
              {/snippet}
            </Item.Root>
          </li>
        {/each}
      </App.Group>
    {:else if busy}
      <p class="flex flex-1 items-center justify-center gap-2.5 text-sm text-muted-foreground"><Spinner />Looking up {locating ? HERE_LABEL.toLowerCase() : data.box || data.query}…</p>
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
