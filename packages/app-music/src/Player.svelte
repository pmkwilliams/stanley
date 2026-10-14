<script module lang="ts">
  /** Shared with the Music surface, which is only mounted while visible. */
  export const playback = $state({ elapsed: 0 })
</script>

<script lang="ts">
  import type { AppUiProps } from '@stanley/app-sdk'
  import { nowPlaying, type MusicState } from './core'
  import SoundCloud from './SoundCloud.svelte'

  let { data, perform, volume = 1 }: AppUiProps<MusicState> = $props()
  let audio: HTMLAudioElement | undefined = $state()

  let track = $derived(nowPlaying(data))
  /** Jamendo tracks play here; SoundCloud tracks play in SoundCloud's own player, below. */
  let src = $derived(track?.source === 'jamendo' ? track.audio : undefined)

  // Core only owns state; the <audio> element follows it.
  $effect(() => {
    if (!audio) return
    void src
    if (data.playing && src) audio.play().catch(() => {})
    else audio.pause()
  })

  $effect(() => {
    if (audio) audio.volume = volume
  })
</script>

<!-- Headless: the shell keeps this mounted while the music surface exists, so playback survives switching surfaces. -->
<audio bind:this={audio} {src} ontimeupdate={() => src && (playback.elapsed = audio?.currentTime ?? 0)} onended={() => perform('next')}></audio>
{#if track?.source === 'soundcloud'}
  <SoundCloud track={track.audio} playing={data.playing} {volume} onprogress={(sec) => (playback.elapsed = sec)} onfinish={() => perform('next')} />
{/if}
