<script lang="ts">
  /**
   * SoundCloud's embedded player, hidden, playing one track. It is driven over postMessage, the same
   * protocol as SoundCloud's Widget API script (w.soundcloud.com/player/api.js), without loading it.
   */
  const ORIGIN = 'https://w.soundcloud.com'

  let {
    track,
    playing,
    volume,
    onprogress,
    onfinish,
  }: { track: string; playing: boolean; volume: number; onprogress: (sec: number) => void; onfinish: () => void } = $props()

  let frame: HTMLIFrameElement | undefined = $state()
  /** Set when the player for the current track says it's ready; until then, messages to it are lost. */
  let ready = $state(false)

  let src = $derived(`${ORIGIN}/player/?${new URLSearchParams({ url: track, auto_play: 'false', visual: 'false', show_artwork: 'false' })}`)

  const send = (method: string, value?: unknown) => frame?.contentWindow?.postMessage(JSON.stringify({ method, value }), ORIGIN)

  // A new track reloads the player, which says it's ready again.
  $effect.pre(() => {
    void src
    ready = false
    onprogress(0)
  })

  $effect(() => {
    if (ready) send(playing ? 'play' : 'pause')
  })

  $effect(() => {
    if (ready) send('setVolume', Math.round(volume * 100))
  })

  function onmessage(e: MessageEvent) {
    if (e.origin !== ORIGIN || !frame || e.source !== frame.contentWindow) return
    let message: { method?: string; value?: { currentPosition?: number } }
    try {
      message = JSON.parse(e.data)
    } catch {
      return
    }
    if (message.method === 'ready') {
      for (const event of ['playProgress', 'finish']) send('addEventListener', event)
      ready = true
    } else if (message.method === 'playProgress') onprogress((message.value?.currentPosition ?? 0) / 1000)
    else if (message.method === 'finish') onfinish()
  }
</script>

<svelte:window {onmessage} />

<!-- Out of sight but laid out, so the player runs as it would on a page. -->
<iframe bind:this={frame} {src} title="SoundCloud player" allow="autoplay; encrypted-media" tabindex="-1" aria-hidden="true" class="pointer-events-none fixed top-0 -left-[9999px] size-px opacity-0"></iframe>
