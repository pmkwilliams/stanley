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
  <div class="mini" class:playing={data.playing} style:--tint={tint(track)}>
    <button class="open" aria-label="Open Music" onclick={onopen}>
      <span class="art" style:background={cover(track)}></span>
      <span class="text">
        <span class="title">{track.title}</span>
        <span class="artist">{track.artist}</span>
      </span>
    </button>
    <button class="toggle" aria-label={data.playing ? 'Pause' : 'Play'} onclick={() => perform('toggle')}>
      <span class="wave" aria-hidden="true">{#each [0, 1, 2, 3] as i (i)}<i style:animation-delay="{i * -0.27}s"></i>{/each}</span>
      <span class="icon"><Icon name={data.playing ? 'pause' : 'play'} size={14} /></span>
    </button>
  </div>
{/if}

<style>
  /* 200×42, art 24 inset 9, so the art's radius is 14 − 9; the toggle's hover square is concentric too. */
  .mini {
    display: flex; align-items: center; width: 200px; height: 42px; padding: 0 6px 0 9px; gap: 4px;
    background: var(--player); border-radius: 14px; color: var(--text);
  }
  button { display: flex; align-items: center; padding: 0; color: inherit; background: none; border: 0; border-radius: 0; cursor: default; }
  button:hover { background: none; }

  .open { flex: 1; min-width: 0; gap: 9px; height: 100%; text-align: left; }
  .art { flex: none; width: 24px; height: 24px; border-radius: 5px; box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, 0.12); }
  .text { min-width: 0; display: flex; flex-direction: column; line-height: 1.15; }
  .title, .artist { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .title { font-size: 12px; font-weight: 600; }
  .artist { font-size: 11px; color: var(--muted); }

  .toggle { position: relative; flex: none; justify-content: center; width: 30px; height: 30px; border-radius: 9px; transition: background var(--dur-fast, 120ms); }
  .toggle:hover { background: color-mix(in srgb, var(--text) 10%, transparent); }

  /* The waveform and the play/pause icon share the spot: wave while playing, icon on hover or when paused. */
  .wave, .icon { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; transition: opacity 0.18s, transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1); }
  .wave { gap: 2px; }
  .wave i { width: 2.5px; height: 14px; border-radius: 2px; background: var(--tint); transform: scaleY(0.3); animation: level 0.9s ease-in-out infinite alternate; animation-play-state: paused; }
  .playing .wave i { animation-play-state: running; }
  /* Covers' highlights are pale: deepen the bars to read on the light pill. */
  :global([data-theme='light']) .wave i { background: color-mix(in srgb, var(--tint) 65%, black); }
  .icon { opacity: 0; transform: scale(0.7); }
  .mini:not(.playing) .wave, .toggle:hover .wave { opacity: 0; transform: scale(0.7); }
  .mini:not(.playing) .icon, .toggle:hover .icon { opacity: 1; transform: none; }

  @keyframes level {
    0% { transform: scaleY(0.25); }
    40% { transform: scaleY(0.9); }
    70% { transform: scaleY(0.45); }
    100% { transform: scaleY(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .wave i { animation: none; transform: scaleY(0.6); }
  }
</style>
