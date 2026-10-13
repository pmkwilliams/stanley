<script lang="ts">
  import type { AppUiProps } from '@stanley/app-sdk'
  import Icon from '@stanley/app-ui/Icon.svelte'
  import * as Alert from '@stanley/app-ui/components/alert'
  import * as App from '@stanley/app-ui/components/app'
  import { Button } from '@stanley/app-ui/components/button'
  import * as Empty from '@stanley/app-ui/components/empty'
  import * as Item from '@stanley/app-ui/components/item'
  import { Slider } from '@stanley/app-ui/components/slider'
  import { Switch } from '@stanley/app-ui/components/switch'
  import {
    CONNECT_TEXT,
    CONNECT_TITLE,
    OFFLINE_TITLE,
    glowOf,
    lightState,
    lightsOf,
    presetsFor,
    roomOf,
    roomPreset,
    roomState,
    type Light,
    type LightsState,
    type Room,
  } from './core'

  let { data, perform }: AppUiProps<LightsState> = $props()

  const room = $derived(data.route.startsWith('room/') ? roomOf(data, data.route.slice(5)) : undefined)
  const anyOn = $derived(data.lights.some((l) => l.on && l.reachable))
  const lit = (lights: Light[]) => lights.filter((l) => l.on && l.reachable)

  /** A room's glow: its lit lights' colors, blended along the row's bulb. */
  function glow(lights: Light[]): string | undefined {
    const colors = lit(lights).flatMap((l) => glowOf(l) ?? [])
    if (!colors.length) return undefined
    return colors.length === 1 ? colors[0] : `conic-gradient(${colors.join(', ')}, ${colors[0]})`
  }

  /** Brightness follows the room while nobody's dragging it. */
  let dragging = $state<number | null>(null)
  const brightness = $derived.by(() => {
    if (!room) return 0
    const on = lit(lightsOf(data, room))
    return on.length ? Math.round(on.reduce((n, l) => n + l.brightness, 0) / on.length) : 0
  })

  const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)
</script>

<!-- A bulb lights up in the color it shows: content, like artwork. A single color also glows around it. -->
{#snippet bulb(g: string | undefined)}
  <span
    class={[
      'flex size-8 items-center justify-center rounded-full transition-colors duration-200',
      g ? 'text-neutral-900 shadow-md shadow-(color:--glow)/60' : 'bg-accent text-muted-foreground',
    ]}
    style:--glow={g}
    style:background={g}
  >
    <Icon name="lightbulb" size={18} />
  </span>
{/snippet}

{#snippet notice(text: string)}
  <Alert.Root variant="destructive" class="mb-3">
    <Icon name="exclamation" size={16} />
    <Alert.Description>{text}</Alert.Description>
  </Alert.Root>
{/snippet}

{#snippet roomRow(r: Room)}
  {@const lights = lightsOf(data, r)}
  {@const state = roomState(lights)}
  <li>
    <Item.Root size="row" class="hover:bg-accent has-[.open:focus-visible]:ring-3 has-[.open:focus-visible]:ring-ring/50">
      <Item.Media>{@render bulb(glow(lights))}</Item.Media>
      <!-- The open button fills the row, so the whole row opens the room but the switch stays its own. -->
      <button class="open flex min-w-0 flex-1 self-stretch text-left outline-none" onclick={() => perform(`room/${r.id}`)}>
        <Item.Content class="justify-center gap-0">
          <Item.Title>{r.name}</Item.Title>
          <Item.Description class="text-xs">{state === 'off' ? 'Off' : cap(state)}</Item.Description>
        </Item.Content>
      </button>
      <Switch aria-label="switch" checked={state !== 'off'} onCheckedChange={() => perform(`room/${r.id}/power`)} />
    </Item.Root>
  </li>
{/snippet}

<App.Root size="compact">
  {#if data.status !== 'ready'}
    <App.Bar><App.Title>Lights</App.Title></App.Bar>
    <App.Body>
      <Empty.Root>
        <Empty.Header>
          <Empty.Media class="text-muted-foreground/60"><Icon name="lightbulb" size={40} /></Empty.Media>
          {#if data.status === 'unpaired'}
            <Empty.Title>{CONNECT_TITLE}</Empty.Title>
            <Empty.Description>{CONNECT_TEXT}</Empty.Description>
            {#if data.error}<Empty.Description class="text-destructive" role="alert">{data.error}</Empty.Description>{/if}
          {:else}
            <Empty.Title>{OFFLINE_TITLE}</Empty.Title>
            {#if data.error}<Empty.Description>{data.error}</Empty.Description>{/if}
          {/if}
        </Empty.Header>
        <Empty.Content>
          {#if data.status === 'unpaired'}
            <Button onclick={() => perform('connect')}>Connect</Button>
          {:else}
            <Button variant="secondary" onclick={() => perform('retry')}>Try again</Button>
          {/if}
        </Empty.Content>
      </Empty.Root>
    </App.Body>
  {:else if room}
    {@const lights = lightsOf(data, room)}
    {@const preset = roomPreset(lights)}
    {@const presets = presetsFor(lights)}
    <App.Bar>
      <Button variant="ghost" size="sm" class="-ml-2 gap-0.5 pl-1 text-muted-foreground" onclick={() => perform('home')}>
        <Icon name="chevron-left" size={16} weight={2} />Rooms
      </Button>
      <App.Title>{room.name}</App.Title>
      <Switch aria-label={room.name} checked={roomState(lights) !== 'off'} onCheckedChange={() => perform(`room/${room.id}/power`)} />
    </App.Bar>

    <App.Body>
      {#if data.error}{@render notice(data.error)}{/if}

      {#if lights.some((l) => l.dims)}
        <div class="flex items-center gap-3 rounded-lg bg-muted px-4 py-3 text-muted-foreground">
          <Icon name="sun" size={16} />
          <Slider
            thumbLabel="Brightness"
            type="single"
            min={0}
            max={100}
            value={dragging ?? brightness}
            onValueChange={(v) => (dragging = v)}
            onValueCommit={(v) => {
              perform(`room/${room.id}/brightness`, { text: `${v}%` })
              dragging = null
            }}
          />
          <span class="w-10 text-right text-sm text-foreground tabular-nums">{dragging ?? brightness}%</span>
        </div>
      {/if}

      {#if room.scenes.length}
        <App.Section title="Scenes">
          <div class="flex flex-wrap gap-2 px-1">
            {#each room.scenes as sc (sc.id)}
              <Button variant="secondary" size="sm" onclick={() => perform(`room/${room.id}/scene/${sc.id}`)}>{sc.name}</Button>
            {/each}
          </div>
        </App.Section>
      {/if}

      {#if presets.length}
        {#snippet colorTitle()}<span id="lights-color">Color</span>{/snippet}
        <App.Section title={colorTitle}>
          <div class="flex flex-wrap gap-2.5 px-1.5 py-0.5" role="radiogroup" aria-labelledby="lights-color">
            {#each presets as p (p.id)}
              <!-- Swatches are content: each shows the light's own color. -->
              <button
                class="size-8 rounded-full inset-ring inset-ring-foreground/20 outline-2 outline-offset-2 outline-transparent transition-[outline-color,scale] duration-200 hover:scale-110 focus-visible:ring-3 focus-visible:ring-ring/50 aria-checked:outline-primary"
                role="radio"
                aria-checked={p === preset}
                aria-label={p.label}
                title={p.label}
                style:background={p.swatch}
                onclick={() => perform(`room/${room.id}/color/${p.id}`)}
              ></button>
            {/each}
          </div>
        </App.Section>
      {/if}

      <App.Section title="Lights">
        <App.Group>
          {#each lights as l (l.id)}
            <li>
              <Item.Root size="row" class={l.reachable ? undefined : 'opacity-50'}>
                {#snippet child({ props })}
                  <label {...props}>
                    <Item.Media>{@render bulb(glowOf(l))}</Item.Media>
                    <Item.Content class="gap-0">
                      <Item.Title>{l.name}</Item.Title>
                      <Item.Description class="text-xs">{cap(lightState(l))}</Item.Description>
                    </Item.Content>
                    <Switch aria-label={l.name} checked={l.on} disabled={!l.reachable} onCheckedChange={() => perform(`light/${l.id}/power`)} />
                  </label>
                {/snippet}
              </Item.Root>
            </li>
          {/each}
        </App.Group>
      </App.Section>
    </App.Body>
  {:else}
    <App.Bar>
      <App.Title>Lights</App.Title>
      {#if data.lights.length}<Button variant="secondary" size="sm" onclick={() => perform('all')}>{anyOn ? 'Turn all off' : 'Turn all on'}</Button>{/if}
    </App.Bar>
    <App.Body>
      {#if data.error}{@render notice(data.error)}{/if}
      {#each [['Rooms', 'room'], ['Zones', 'zone']] as const as [title, kind] (kind)}
        {@const rooms = data.rooms.filter((r) => r.kind === kind)}
        {#if rooms.length}
          <App.Section {title}>
            <App.Group>
              {#each rooms as r (r.id)}{@render roomRow(r)}{/each}
            </App.Group>
          </App.Section>
        {/if}
      {/each}
      {#if !data.rooms.length}
        <Empty.Root>
          <Empty.Header>
            <Empty.Media class="text-muted-foreground/60"><Icon name="lightbulb" size={40} /></Empty.Media>
            <Empty.Title>No rooms yet</Empty.Title>
            <Empty.Description>Set up rooms in the Hue app and they'll show here.</Empty.Description>
          </Empty.Header>
        </Empty.Root>
      {/if}
    </App.Body>
  {/if}
</App.Root>
