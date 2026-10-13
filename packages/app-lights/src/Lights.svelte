<script lang="ts">
  import type { AppUiProps } from '@stanley/app-sdk'
  import Icon from '@stanley/app-ui/Icon.svelte'
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
</script>

{#snippet roomRow(r: Room)}
  {@const lights = lightsOf(data, r)}
  {@const state = roomState(lights)}
  {@const g = glow(lights)}
  <li>
    <div class="ui-row interactive">
      <span class="ui-row-lead bulb" class:on={!!g} style:--glow={g}><Icon name="lightbulb" size={18} /></span>
      <button class="ui-row-main open" onclick={() => perform(`room/${r.id}`)}>
        <span class="ui-row-title">{r.name}</span>
        <span class="ui-row-sub">{state === 'off' ? 'Off' : state[0]!.toUpperCase() + state.slice(1)}</span>
      </button>
      <input type="checkbox" role="switch" class="ui-switch" aria-label="switch" checked={state !== 'off'} onchange={() => perform(`room/${r.id}/power`)} />
    </div>
  </li>
{/snippet}

<section class="ui-app compact lights">
  {#if data.status !== 'ready'}
    <header class="ui-bar"><h1 class="ui-title">Lights</h1></header>
    <div class="ui-body">
      <div class="ui-empty">
        <Icon name="lightbulb" size={40} />
        {#if data.status === 'unpaired'}
          <p class="ui-empty-title">{CONNECT_TITLE}</p>
          <p class="ui-empty-text">{CONNECT_TEXT}</p>
          {#if data.error}<p class="ui-empty-text problem" role="alert">{data.error}</p>{/if}
          <button class="ui-btn primary" onclick={() => perform('connect')}>Connect</button>
        {:else}
          <p class="ui-empty-title">{OFFLINE_TITLE}</p>
          {#if data.error}<p class="ui-empty-text">{data.error}</p>{/if}
          <button class="ui-btn" onclick={() => perform('retry')}>Try again</button>
        {/if}
      </div>
    </div>
  {:else if room}
    {@const lights = lightsOf(data, room)}
    {@const preset = roomPreset(lights)}
    {@const presets = presetsFor(lights)}
    <header class="ui-bar">
      <button class="ui-btn plain small back" onclick={() => perform('home')}><Icon name="chevron-left" size={16} weight={2} />Rooms</button>
      <h1 class="ui-title">{room.name}</h1>
      <span class="ui-spacer"></span>
      <input type="checkbox" role="switch" class="ui-switch" aria-label={room.name} checked={roomState(lights) !== 'off'} onchange={() => perform(`room/${room.id}/power`)} />
    </header>

    <div class="ui-body">
      {#if data.error}<p class="ui-notice" role="alert"><Icon name="exclamation" size={16} /><span>{data.error}</span></p>{/if}

      {#if lights.some((l) => l.dims)}
        <div class="ui-card dimmer">
          <Icon name="sun" size={16} />
          <input
            type="range"
            aria-label="Brightness"
            min="0"
            max="100"
            value={dragging ?? brightness}
            style:--fill="{dragging ?? brightness}%"
            oninput={(e) => (dragging = Number(e.currentTarget.value))}
            onchange={(e) => {
              perform(`room/${room.id}/brightness`, { text: `${e.currentTarget.value}%` })
              dragging = null
            }}
          />
          <span class="pct ui-num">{dragging ?? brightness}%</span>
        </div>
      {/if}

      {#if room.scenes.length}
        <section class="ui-section">
          <h2 class="ui-section-title">Scenes</h2>
          <div class="scenes">
            {#each room.scenes as sc (sc.id)}
              <button class="ui-btn small" onclick={() => perform(`room/${room.id}/scene/${sc.id}`)}>{sc.name}</button>
            {/each}
          </div>
        </section>
      {/if}

      {#if presets.length}
        <section class="ui-section">
          <h2 class="ui-section-title" id="lights-color">Color</h2>
          <div class="swatches" role="radiogroup" aria-labelledby="lights-color">
            {#each presets as p (p.id)}
              <button
                class="swatch"
                role="radio"
                aria-checked={p === preset}
                aria-label={p.label}
                title={p.label}
                style:--swatch={p.swatch}
                onclick={() => perform(`room/${room.id}/color/${p.id}`)}
              ></button>
            {/each}
          </div>
        </section>
      {/if}

      <section class="ui-section">
        <h2 class="ui-section-title">Lights</h2>
        <ul class="ui-group">
          {#each lights as l (l.id)}
            {@const g = glowOf(l)}
            <li>
              <label class="ui-row" class:unreachable={!l.reachable}>
                <span class="ui-row-lead bulb" class:on={!!g} style:--glow={g}><Icon name="lightbulb" size={18} /></span>
                <span class="ui-row-main">
                  <span class="ui-row-title">{l.name}</span>
                  <span class="ui-row-sub">{lightState(l)[0]!.toUpperCase() + lightState(l).slice(1)}</span>
                </span>
                <input type="checkbox" role="switch" class="ui-switch" aria-label={l.name} checked={l.on} disabled={!l.reachable} onchange={() => perform(`light/${l.id}/power`)} />
              </label>
            </li>
          {/each}
        </ul>
      </section>
    </div>
  {:else}
    <header class="ui-bar">
      <h1 class="ui-title">Lights</h1>
      <span class="ui-spacer"></span>
      {#if data.lights.length}<button class="ui-btn small" onclick={() => perform('all')}>{anyOn ? 'Turn all off' : 'Turn all on'}</button>{/if}
    </header>
    <div class="ui-body">
      {#if data.error}<p class="ui-notice" role="alert"><Icon name="exclamation" size={16} /><span>{data.error}</span></p>{/if}
      {#each [['Rooms', 'room'], ['Zones', 'zone']] as const as [title, kind] (kind)}
        {@const rooms = data.rooms.filter((r) => r.kind === kind)}
        {#if rooms.length}
          <section class="ui-section">
            <h2 class="ui-section-title">{title}</h2>
            <ul class="ui-group">
              {#each rooms as r (r.id)}{@render roomRow(r)}{/each}
            </ul>
          </section>
        {/if}
      {/each}
      {#if !data.rooms.length}
        <div class="ui-empty">
          <Icon name="lightbulb" size={40} />
          <p class="ui-empty-title">No rooms yet</p>
          <p class="ui-empty-text">Set up rooms in the Hue app and they'll show here.</p>
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  .ui-notice { margin: 0 0 12px; }
  .problem { color: var(--danger); }
  .ui-empty .ui-btn { margin-top: 10px; }

  .back { margin-left: -8px; gap: 2px; padding-left: 4px; }
  .ui-bar .ui-title { min-width: 0; }

  /* The open button fills the row, so the whole row opens the room but the switch stays its own. */
  .open { align-self: stretch; justify-content: center; padding: 0; color: inherit; font: inherit; text-align: left; background: none; border: 0; cursor: default; }

  /* A bulb lights up in the color it shows: content, like artwork. */
  .bulb { width: 30px; height: 30px; border-radius: 50%; background: var(--fill); transition: background var(--dur) var(--ease), color var(--dur) var(--ease); }
  .bulb.on { color: #1d1d1f; background: var(--glow); box-shadow: 0 0 14px -2px color-mix(in srgb, var(--glow) 60%, transparent); }
  .unreachable { opacity: 0.5; }

  .dimmer { display: flex; align-items: center; gap: 12px; padding: 12px 16px; color: var(--muted); }
  .pct { width: 38px; text-align: right; color: var(--text); font-size: 13px; }
  .dimmer input {
    flex: 1; height: 28px; margin: 0; appearance: none; border-radius: var(--r-capsule); cursor: default;
    background: linear-gradient(90deg, var(--accent) var(--fill), var(--fill-active) var(--fill));
  }
  .dimmer input::-webkit-slider-thumb { appearance: none; width: 28px; height: 28px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35); }
  .dimmer input:focus-visible { outline: none; box-shadow: var(--focus-ring); }

  .scenes { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 4px; }

  .swatches { display: flex; flex-wrap: wrap; gap: 10px; padding: 2px 6px; }
  .swatch {
    width: 30px; height: 30px; padding: 0; border: 0; border-radius: 50%; cursor: default;
    background: var(--swatch); box-shadow: inset 0 0 0 0.5px rgba(127, 127, 127, 0.4);
    outline: 2px solid transparent; outline-offset: 2px; transition: outline-color var(--dur) var(--ease), transform var(--dur-fast);
  }
  .swatch:hover { transform: scale(1.08); }
  .swatch[aria-checked='true'] { outline-color: var(--accent); }
  .swatch:focus-visible { box-shadow: var(--focus-ring); }
</style>
