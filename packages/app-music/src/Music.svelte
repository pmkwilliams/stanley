<script lang="ts">
  import { DEFAULT_AGENT_NAME, type AppUiProps } from '@stanley/app-sdk'
  import Icon from '@stanley/app-ui/Icon.svelte'
  import * as App from '@stanley/app-ui/components/app'
  import { Button } from '@stanley/app-ui/components/button'
  import * as Item from '@stanley/app-ui/components/item'
  import { Progress } from '@stanley/app-ui/components/progress'
  import { cover } from './art'
  import { CREDIT, LIST_TITLE, nowPlaying, time, type MusicState } from './core'
  import { playback } from './Player.svelte'

  let { data, perform, agentName = DEFAULT_AGENT_NAME }: AppUiProps<MusicState> = $props()
  let track = $derived(nowPlaying(data))
  let elapsed = $derived(track ? Math.min(playback.elapsed, track.durationSec) : 0)

  /** The playlist's columns, shared by its header and rows: number · art, title and artist · album · time. */
  const COLUMNS = 'grid grid-cols-[1.25rem_minmax(0,3fr)_minmax(0,2fr)_2.5rem] items-center gap-3'
</script>

<App.Root>
  <!-- No title bar, as in Weather. The current track stays put, 16px in from the window's edges; only the playlist scrolls. -->
  <div class="flex flex-none gap-6 px-4 pt-4 pb-2">
    <div class={['grid size-56 flex-none place-items-center rounded-lg', track ? 'shadow-xl' : 'bg-accent text-muted-foreground/60']} style:background={track ? cover(track) : null}>
      {#if !track}<Icon name="music" size={64} weight={1.5} />{/if}
    </div>

    <!-- Centred beside the art: artist over title, the progress bar, then the transport with the play button in a solid circle. -->
    <div class="flex min-w-0 flex-1 flex-col justify-center gap-4 px-3 text-center">
      <div class="mb-4 min-w-0">
        {#if track}
          <p class="truncate text-base text-muted-foreground">{track.artist}</p>
          <h2 class="truncate text-2xl font-semibold tracking-tight">{track.title}</h2>
        {:else}
          <p class="truncate text-base text-muted-foreground">Choose a song, or ask {agentName}</p>
          <h2 class="truncate text-2xl font-semibold tracking-tight text-muted-foreground">Not playing</h2>
        {/if}
      </div>

      <div>
        <Progress class="bg-foreground/15 *:bg-foreground" aria-label="Playback position" max={track?.durationSec ?? 1} value={elapsed} />
        <div class="mt-1.5 flex justify-between text-xs text-muted-foreground tabular-nums">
          <span>{time(elapsed)}</span>
          <span>{time(track?.durationSec ?? 0)}</span>
        </div>
      </div>

      <div class="flex items-center justify-center gap-6">
        <Button variant="ghost" size="icon-lg" class="size-11 rounded-full [&_svg]:size-7!" aria-label="Previous" onclick={() => perform('previous')}>
          <Icon name="skip-back" weight={1.5} />
        </Button>
        <Button size="icon-lg" class="size-12 rounded-full bg-foreground text-background hover:bg-foreground/90 [&_svg]:size-5!" aria-label={data.playing ? 'Pause' : 'Play'} onclick={() => perform('toggle')}>
          <Icon name={data.playing ? 'pause' : 'play'} />
        </Button>
        <Button variant="ghost" size="icon-lg" class="size-11 rounded-full [&_svg]:size-7!" aria-label="Next" onclick={() => perform('next')}>
          <Icon name="skip-forward" weight={1.5} />
        </Button>
      </div>
    </div>
  </div>

  <App.Body class="pt-0">
    <!-- Column titles, as in Spotify, stick while the list scrolls under them: frosted glass down to a hairline, inset to the text. -->
    <div
      class={[COLUMNS, 'sticky top-0 z-10 -mx-4 bg-card/60 px-7 pt-5 pb-2 text-xs font-semibold text-muted-foreground after:absolute after:inset-x-7 after:bottom-0 after:h-px after:bg-border']}
      aria-hidden="true"
    >
      <span class="absolute inset-0 -z-10 backdrop-blur-lg"></span>
      <span class="col-start-2">Title</span>
      <span>Album</span>
    </div>
    <!-- Rows without hairlines between them, as in Spotify. -->
    <App.Group aria-label={LIST_TITLE} class="mt-2 bg-transparent p-0 backdrop-blur-none [&>*+*]:before:hidden">
      {#each data.tracks as t, i (t.id)}
        {@const current = t.id === data.currentId}
        <li>
          <Item.Root size="row" class={[COLUMNS, 'hover:bg-accent']} data-selected={current}>
            {#snippet child({ props })}
              <button {...props} aria-current={current} onclick={() => perform(`track/${t.id}`)}>
                <!-- The number: three bars on the current track (moving while it plays, still while paused), a play glyph on hover. -->
                <span class="grid place-items-center text-muted-foreground tabular-nums">
                  {#if current}
                    <span class="flex h-3.5 items-end gap-0.5" aria-hidden="true">
                      <i class={['bar h-3.5 w-0.75 origin-bottom scale-y-40 rounded-full bg-foreground', data.playing && 'live']}></i>
                      <i class={['bar h-3.5 w-0.75 origin-bottom scale-y-75 rounded-full bg-foreground', data.playing && 'live']}></i>
                      <i class={['bar h-3.5 w-0.75 origin-bottom scale-y-55 rounded-full bg-foreground', data.playing && 'live']}></i>
                    </span>
                  {:else}
                    <span class="group-hover/item:hidden">{i + 1}</span>
                    <span class="hidden text-foreground group-hover/item:block"><Icon name="play" size={14} /></span>
                  {/if}
                </span>
                <span class="flex min-w-0 items-center gap-3">
                  <span class="size-9 flex-none rounded-md" style:background={cover(t)}></span>
                  <span class="flex min-w-0 flex-col text-left">
                    <span class="truncate font-medium">{t.title}</span>
                    <span class="truncate text-xs text-muted-foreground">{t.artist}</span>
                  </span>
                </span>
                <span class="truncate text-left text-muted-foreground">{t.album}</span>
                <span class="text-right text-muted-foreground tabular-nums">{time(t.durationSec)}</span>
              </button>
            {/snippet}
          </Item.Root>
        </li>
      {/each}
    </App.Group>
    <p class="mt-1.5 px-3 text-xs text-muted-foreground">{CREDIT}</p>
  </App.Body>
</App.Root>

<style>
  /* The equalizer's motion: each bar on its own period, so they never line up. */
  .bar.live { animation: bar 0.9s ease-in-out infinite alternate; }
  .bar.live:nth-child(2) { animation-duration: 0.7s; animation-delay: -0.3s; }
  .bar.live:nth-child(3) { animation-duration: 1.1s; animation-delay: -0.6s; }
  @keyframes bar { from { scale: 1 0.3; } to { scale: 1 0.95; } }

  @media (prefers-reduced-motion: reduce) {
    .bar.live { animation: none; }
  }
</style>
