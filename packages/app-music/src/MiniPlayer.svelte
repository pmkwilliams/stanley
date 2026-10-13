<script lang="ts">
  import type { AppUiProps } from '@stanley/app-sdk'
  import Icon from '@stanley/app-ui/Icon.svelte'
  import { cover, tint } from './art'
  import { nowPlaying, type MusicState } from './core'

  /**
   * The status bar's now-playing pill. Cover and title open Music; the right end is a live waveform
   * while playing, and turns into play/pause on hover (always shown while paused).
   */
  let { data, perform, onopen }: AppUiProps<MusicState> & { onopen: () => void } = $props()

  let track = $derived(nowPlaying(data))
</script>

{#if track}
  <!-- 200×42, rounded-xl. The art sits 8 in, so it's rounded-sm; the toggle 6 in, so rounded-md. -->
  <div
    class="group/mini flex h-10.5 w-50 items-center gap-1 rounded-xl bg-player pr-1.5 pl-2 text-foreground"
    data-playing={data.playing}
    style:--tint={tint(track)}
  >
    <button class="flex h-full min-w-0 flex-1 items-center gap-2 text-left" aria-label="Open Music" onclick={onopen}>
      <span class="size-6 flex-none rounded-sm ring-1 ring-white/10 ring-inset" style:background={cover(track)}></span>
      <span class="flex min-w-0 flex-col text-xs leading-tight">
        <span class="truncate font-semibold">{track.title}</span>
        <span class="truncate text-muted-foreground">{track.artist}</span>
      </span>
    </button>
    <button
      class="group/toggle relative flex size-7.5 flex-none items-center justify-center rounded-md transition-colors hover:bg-foreground/10"
      aria-label={data.playing ? 'Pause' : 'Play'}
      onclick={() => perform('toggle')}
    >
      <!-- The waveform and the play/pause icon share the spot: wave while playing, icon on hover or when paused. -->
      <span
        class="absolute inset-0 flex items-center justify-center gap-0.5 transition duration-200 ease-out group-hover/toggle:scale-70 group-hover/toggle:opacity-0 group-data-[playing=false]/mini:scale-70 group-data-[playing=false]/mini:opacity-0"
        aria-hidden="true"
      >
        {#each [0, 1, 2, 3] as i (i)}
          <!-- Covers' highlights are pale: deepen the bars to read on the light pill. -->
          <i class="level h-3.5 w-0.5 rounded-full bg-(--tint) in-data-[theme=light]:bg-[color-mix(in_srgb,var(--tint)_65%,black)]" style:animation-delay="{i * -0.27}s"></i>
        {/each}
      </span>
      <span
        class="absolute inset-0 flex scale-70 items-center justify-center opacity-0 transition duration-200 ease-out group-hover/toggle:scale-100 group-hover/toggle:opacity-100 group-data-[playing=false]/mini:scale-100 group-data-[playing=false]/mini:opacity-100"
      >
        <Icon name={data.playing ? 'pause' : 'play'} size={14} />
      </span>
    </button>
  </div>
{/if}

<style>
  /* Bars scale from the middle; paused (frozen) unless the track is playing. */
  .level { scale: 1 0.3; animation: level 0.9s ease-in-out infinite alternate paused; }
  [data-playing='true'] .level { animation-play-state: running; }

  @keyframes level {
    0% { scale: 1 0.25; }
    40% { scale: 1 0.9; }
    70% { scale: 1 0.45; }
    100% { scale: 1 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .level { animation: none; scale: 1 0.6; }
  }
</style>
