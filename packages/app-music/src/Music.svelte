<script lang="ts">
  import { DEFAULT_AGENT_NAME, type AppUiProps } from '@stanley/app-sdk'
  import Icon from '@stanley/app-ui/Icon.svelte'
  import * as Alert from '@stanley/app-ui/components/alert'
  import * as App from '@stanley/app-ui/components/app'
  import { Button } from '@stanley/app-ui/components/button'
  import * as Empty from '@stanley/app-ui/components/empty'
  import * as InputGroup from '@stanley/app-ui/components/input-group'
  import * as Item from '@stanley/app-ui/components/item'
  import { Progress } from '@stanley/app-ui/components/progress'
  import { Spinner } from '@stanley/app-ui/components/spinner'
  import { cover } from './art'
  import { CREDIT, FIELD_LABEL, NO_RESULTS_TEXT, listTitle, noResultsTitle, nowPlaying, time, type MusicState } from './core'
  import { playback } from './Player.svelte'

  let { data, perform, agentName = DEFAULT_AGENT_NAME }: AppUiProps<MusicState> = $props()
  /** Local "in flight" flag: perform is fire-and-forget. A search always ends with the field cleared. */
  let pending = $state(false)

  $effect(() => {
    if (!data.box) pending = false
  })

  const busy = $derived(data.loading || pending)

  let track = $derived(nowPlaying(data))
  let elapsed = $derived(track ? Math.min(playback.elapsed, track.durationSec) : 0)
  /** With a catalogue to browse, the hero gives the list more room. */
  let compact = $derived(data.search)

  /** The field's text lives in app state, shared with the agent. */
  function search(e: SubmitEvent) {
    e.preventDefault()
    const text = new FormData(e.currentTarget as HTMLFormElement).get('q')?.toString() ?? ''
    if (!text.trim()) return
    pending = true
    perform('search', { text })
    perform('search/enter')
  }
</script>

<App.Root>
  <App.Bar>
    <App.Title>Music</App.Title>
    {#if data.search}
      <form class="w-56 flex-none" onsubmit={search}>
        <InputGroup.Root>
          <InputGroup.Addon><Icon name="search" size={16} /></InputGroup.Addon>
          <InputGroup.Input
            name="q"
            placeholder={FIELD_LABEL}
            aria-label={FIELD_LABEL}
            autocomplete="off"
            spellcheck="false"
            value={data.box}
            onchange={(e) => perform('search', { text: e.currentTarget.value })}
          />
        </InputGroup.Root>
      </form>
    {/if}
  </App.Bar>

  <App.Body>
    <div class={['flex flex-none', compact ? 'gap-6 pt-1 pb-1' : 'gap-7 pt-2 pb-1']}>
      <!-- Paused art settles back a little, as on iOS. -->
      <div
        class={[
          'grid flex-none place-items-center transition-[scale,box-shadow] duration-200 motion-reduce:transition-none',
          compact ? 'size-42 rounded-lg' : 'size-60 rounded-xl',
          !track ? 'bg-accent text-muted-foreground/60' : data.playing ? 'shadow-xl' : 'scale-95 shadow-md',
        ]}
        style:background={track ? cover(track) : null}
      >
        {#if !track}<Icon name="music" size={64} weight={1.5} />{/if}
      </div>

      <div class={['flex min-w-0 flex-1 flex-col justify-between', compact ? 'pt-1.5' : 'pt-3 pb-1.5']}>
        <div class="min-w-0">
          {#if track}
            <h2 class="truncate text-base font-semibold">{track.title}</h2>
            <p class="mt-0.5 truncate text-muted-foreground">{track.artist}</p>
          {:else}
            <h2 class="truncate text-base font-semibold text-muted-foreground">Not playing</h2>
            <p class="mt-0.5 truncate text-muted-foreground">Choose a song, or ask {agentName} to play one.</p>
          {/if}
        </div>

        <div>
          <Progress class="bg-accent" aria-label="Playback position" max={track?.durationSec ?? 1} value={elapsed} />
          <div class="mt-1.5 flex justify-between text-xs text-muted-foreground tabular-nums">
            <span>{time(elapsed)}</span>
            <span>{track ? `−${time(track.durationSec - elapsed)}` : '0:00'}</span>
          </div>
        </div>

        <div class="flex items-center justify-center gap-5">
          <Button variant="ghost" size="icon-lg" class="size-10 rounded-full" aria-label="Previous" onclick={() => perform('previous')}>
            <Icon name="backward" size={24} />
          </Button>
          <Button variant="secondary" size="icon-lg" class="size-11 rounded-full" aria-label={data.playing ? 'Pause' : 'Play'} onclick={() => perform('toggle')}>
            <Icon name={data.playing ? 'pause' : 'play'} size={22} />
          </Button>
          <Button variant="ghost" size="icon-lg" class="size-10 rounded-full" aria-label="Next" onclick={() => perform('next')}>
            <Icon name="forward" size={24} />
          </Button>
        </div>

        <!-- The negative margin lines the speaker glyphs up with the scrubber's ends. -->
        <div class="-mx-1.5 flex items-center gap-1.5 text-muted-foreground">
          <Button variant="ghost" size="icon-sm" class="rounded-full" aria-label="Volume down" onclick={() => perform('volume-down')}>
            <Icon name="speaker-low" size={16} />
          </Button>
          <Progress class="flex-1 bg-accent" aria-label="Volume" max={1} value={data.volume} />
          <Button variant="ghost" size="icon-sm" class="rounded-full" aria-label="Volume up" onclick={() => perform('volume-up')}>
            <Icon name="speaker-high" size={16} />
          </Button>
        </div>
      </div>
    </div>

    {#if data.error}
      <Alert.Root variant="destructive" class="mt-5 flex-none">
        <Icon name="exclamation" size={16} />
        <Alert.Title>{data.error}</Alert.Title>
      </Alert.Root>
    {/if}

    {#if busy}
      <!-- Fills the space under the hero, where the songs will appear. -->
      <p class="flex min-h-40 flex-1 items-center justify-center gap-2.5 text-muted-foreground" role="status">
        <Spinner aria-hidden="true" />Searching for “{data.box || data.query}”…
      </p>
    {:else if !data.tracks.length}
      <Empty.Root class="min-h-40">
        <Empty.Header>
          <Empty.Media class="text-muted-foreground/60"><Icon name="search" size={40} /></Empty.Media>
          <Empty.Title>{noResultsTitle(data.query)}</Empty.Title>
          <Empty.Description>{NO_RESULTS_TEXT}</Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <App.Section
        class={['flex-none', data.error ? 'mt-4' : compact ? 'mt-6' : 'mt-8']}
        title={listTitle(data)}
        footer={data.listing !== 'songs' ? CREDIT : undefined}
      >
        <App.Group>
          {#each data.tracks as t (t.id)}
            {@const current = t.id === data.currentId}
            <li>
              <Item.Root size="row" class="hover:bg-accent" data-selected={current}>
                {#snippet child({ props })}
                  <button {...props} aria-current={current} onclick={() => perform(`track/${t.id}`)}>
                    <Item.Media class="relative size-9 self-center overflow-hidden rounded-md group-has-data-[slot=item-description]/item:translate-y-0 group-has-data-[slot=item-description]/item:self-center" style="background: {cover(t)}">
                      {#if current}
                        <!-- The playing track's art dims behind three bars: moving while it plays, still while paused. -->
                        <span class="absolute inset-0 flex items-center justify-center gap-0.5 bg-black/40" aria-hidden="true">
                          <i class={['bar h-3.5 w-0.75 origin-bottom scale-y-40 rounded-full bg-white', data.playing && 'live']}></i>
                          <i class={['bar h-3.5 w-0.75 origin-bottom scale-y-75 rounded-full bg-white', data.playing && 'live']}></i>
                          <i class={['bar h-3.5 w-0.75 origin-bottom scale-y-55 rounded-full bg-white', data.playing && 'live']}></i>
                        </span>
                      {/if}
                    </Item.Media>
                    <Item.Content class="min-w-0 gap-0">
                      <Item.Title class="w-full">{t.title}</Item.Title>
                      <Item.Description class="line-clamp-1 text-xs">{t.artist}</Item.Description>
                    </Item.Content>
                    <Item.Actions class="text-xs text-muted-foreground tabular-nums">{time(t.durationSec)}</Item.Actions>
                  </button>
                {/snippet}
              </Item.Root>
            </li>
          {/each}
        </App.Group>
      </App.Section>
    {/if}
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
