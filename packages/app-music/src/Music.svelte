<script lang="ts">
  import type { AppUiProps } from '@stanley/app-sdk'
  import type { MusicState } from './core'
  import { playback } from './Player.svelte'

  let { data, perform }: AppUiProps<MusicState> = $props()

  let track = $derived(data.tracks.find((t) => t.id === data.currentId))
  let elapsed = $derived(playback.elapsed)

  const time = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
</script>

<section class="app">
  <h1>Music</h1>

  {#if track}
    <div class="now">
      <div class="title">{track.title}</div>
      <div class="muted">{track.artist}</div>
      <progress max={track.durationSec} value={elapsed}></progress>
      <div class="muted small">{time(elapsed)} / {time(track.durationSec)}</div>
    </div>
  {/if}

  <div class="controls">
    <button aria-label="Previous" onclick={() => perform('previous')}>⏮</button>
    <button class="play" aria-label={data.playing ? 'Pause' : 'Play'} onclick={() => perform('toggle')}>{data.playing ? '⏸' : '▶'}</button>
    <button aria-label="Next" onclick={() => perform('next')}>⏭</button>
    <span class="volume">
      <button aria-label="Volume down" onclick={() => perform('volume-down')}>−</button>
      <span class="muted">{Math.round(data.volume * 100)}%</span>
      <button aria-label="Volume up" onclick={() => perform('volume-up')}>+</button>
    </span>
  </div>

  <ul>
    {#each data.tracks as t (t.id)}
      <li class:focused={t.id === data.currentId}>
        <button onclick={() => perform(`track/${t.id}`)}>
          <span class="name">{t.title}</span>
          <span class="muted">{t.artist}</span>
          <span class="muted small">{time(t.durationSec)}</span>
        </button>
      </li>
    {/each}
  </ul>
</section>

<style>
  .app { padding: 24px; max-width: 560px; }
  button { background: none; border: 0; color: inherit; font: inherit; cursor: pointer; }
  .now { margin-bottom: 12px; }
  .title { font-size: 1.4em; font-weight: 600; }
  progress { width: 100%; height: 4px; margin-top: 12px; accent-color: currentColor; }
  .controls { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; font-size: 20px; }
  .play { font-size: 28px; }
  .volume { margin-left: auto; display: flex; align-items: center; gap: 8px; font-size: 14px; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { border-radius: 8px; }
  li.focused { background: var(--focus); }
  li button { display: flex; width: 100%; gap: 12px; padding: 8px 10px; text-align: left; }
  .name { flex: 1; }
  .muted { opacity: 0.5; }
  .small { font-size: 0.85em; }
</style>
