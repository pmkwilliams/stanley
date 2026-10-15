<script module lang="ts">
  /** Shared with the Music surface, which is only mounted while visible. */
  export const playback = $state({ elapsed: 0 })
</script>

<script lang="ts">
  import type { AppUiProps } from '@stanley/app-sdk'
  import { gain, nowPlaying, type MusicState } from './core'
  import SoundCloud from './SoundCloud.svelte'

  let { data, perform, volume = 1 }: AppUiProps<MusicState> = $props()

  let track = $derived(nowPlaying(data))
</script>

<!-- Headless: the shell keeps this mounted while the music surface exists, so playback survives switching surfaces. Core only owns state; the player follows it. -->
{#if track}
  <SoundCloud track={track.audio} playing={data.playing} volume={volume * gain(data.volume)} onprogress={(sec) => (playback.elapsed = sec)} onfinish={() => perform('next')} />
{/if}
