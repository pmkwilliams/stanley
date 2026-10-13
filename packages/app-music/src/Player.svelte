<script module lang="ts">
  /** Shared with the Music surface, which is only mounted while visible. */
  export const playback = $state({ elapsed: 0 })
</script>

<script lang="ts">
  import type { AppUiProps } from '@stanley/app-sdk'
  import { nowPlaying, type MusicState } from './core'

  let { data, perform, volume = 1 }: AppUiProps<MusicState> = $props()
  let audio: HTMLAudioElement | undefined = $state()

  let track = $derived(nowPlaying(data))
  let src = $derived(track?.audio)

  // Core only owns state; the <audio> element follows it.
  $effect(() => {
    if (!audio) return
    void src
    if (data.playing) audio.play().catch(() => {})
    else audio.pause()
  })

  $effect(() => {
    if (audio) audio.volume = volume
  })
</script>

<!-- Headless: the shell keeps this mounted while the music surface exists, so playback survives switching surfaces. -->
<audio bind:this={audio} {src} ontimeupdate={() => (playback.elapsed = audio?.currentTime ?? 0)} onended={() => perform('next')}></audio>
