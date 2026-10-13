<script lang="ts">
  import { DEFAULT_AGENT_NAME, type AppUiProps } from '@stanley/app-sdk'
  import Icon from '@stanley/app-ui/Icon.svelte'
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

<section class="ui-app">
  <header class="ui-bar">
    <h1 class="ui-title">Music</h1>
    {#if data.search}
      <form class="find" onsubmit={search}>
        <label class="ui-field search">
          <Icon name="search" size={16} />
          <input
            name="q"
            placeholder={FIELD_LABEL}
            aria-label={FIELD_LABEL}
            autocomplete="off"
            spellcheck="false"
            value={data.box}
            onchange={(e) => perform('search', { text: e.currentTarget.value })}
          />
        </label>
      </form>
    {/if}
  </header>

  <div class="ui-body">
    <div class="hero" class:compact={data.search}>
      <div class="art" class:placeholder={!track} class:resting={!data.playing} style:background={track ? cover(track) : null}>
        {#if !track}<Icon name="music" size={64} weight={1.5} />{/if}
      </div>

      <div class="info">
        <div class="meta">
          {#if track}
            <h2 class="title">{track.title}</h2>
            <p class="artist">{track.artist}</p>
          {:else}
            <h2 class="title idle">Not playing</h2>
            <p class="artist">Choose a song, or ask {agentName} to play one.</p>
          {/if}
        </div>

        <div class="scrubber">
          <progress class="ui-progress" aria-label="Playback position" max={track?.durationSec ?? 1} value={elapsed}></progress>
          <div class="times ui-num">
            <span>{time(elapsed)}</span>
            <span>{track ? `−${time(track.durationSec - elapsed)}` : '0:00'}</span>
          </div>
        </div>

        <div class="transport">
          <button class="ui-btn plain icon skip" aria-label="Previous" onclick={() => perform('previous')}>
            <Icon name="backward" size={24} />
          </button>
          <button class="ui-btn large icon play" aria-label={data.playing ? 'Pause' : 'Play'} onclick={() => perform('toggle')}>
            <Icon name={data.playing ? 'pause' : 'play'} size={22} />
          </button>
          <button class="ui-btn plain icon skip" aria-label="Next" onclick={() => perform('next')}>
            <Icon name="forward" size={24} />
          </button>
        </div>

        <div class="volume">
          <button class="ui-btn plain small icon" aria-label="Volume down" onclick={() => perform('volume-down')}>
            <Icon name="speaker-low" size={16} />
          </button>
          <progress class="ui-progress level" aria-label="Volume" max="1" value={data.volume}></progress>
          <button class="ui-btn plain small icon" aria-label="Volume up" onclick={() => perform('volume-up')}>
            <Icon name="speaker-high" size={16} />
          </button>
        </div>
      </div>
    </div>

    {#if data.error}
      <p class="ui-notice" role="alert"><Icon name="exclamation" size={16} /><span>{data.error}</span></p>
    {/if}

    {#if busy}
      <p class="busy" role="status"><span class="ui-spinner"></span>Searching for “{data.box || data.query}”…</p>
    {:else if !data.tracks.length}
      <div class="ui-empty">
        <Icon name="search" size={40} />
        <p class="ui-empty-title">{noResultsTitle(data.query)}</p>
        <p class="ui-empty-text">{NO_RESULTS_TEXT}</p>
      </div>
    {:else}
      <section class="ui-section songs">
        <h3 class="ui-section-title">{listTitle(data)}</h3>
        <ul class="ui-group">
          {#each data.tracks as t (t.id)}
            {@const current = t.id === data.currentId}
            <li>
              <button class="ui-row" class:selected={current} aria-current={current} onclick={() => perform(`track/${t.id}`)}>
                <span class="ui-row-lead thumb" style:background={cover(t)}>
                  {#if current}
                    <span class="bars" class:live={data.playing} aria-hidden="true"><i></i><i></i><i></i></span>
                  {/if}
                </span>
                <span class="ui-row-main">
                  <span class="ui-row-title">{t.title}</span>
                  <span class="ui-row-sub">{t.artist}</span>
                </span>
                <span class="ui-row-trail">{time(t.durationSec)}</span>
              </button>
            </li>
          {/each}
        </ul>
        {#if data.listing !== 'songs'}<p class="ui-section-footer">{CREDIT}</p>{/if}
      </section>
    {/if}
  </div>
</section>

<style>
  /* A column, so the spinner and the no-results state fill the space under the hero. */
  .ui-body { display: flex; flex-direction: column; }

  /* ── Search ── */
  .find { flex: none; width: 220px; margin-left: auto; }

  /* ── Now playing ── */
  .hero { flex: none; display: flex; gap: 28px; padding: 8px 0 4px; }

  .art {
    flex: none; display: grid; place-items: center; width: 240px; height: 240px; border-radius: 12px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2), 0 12px 32px -8px rgba(0, 0, 0, 0.45);
    transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
  }
  /* Paused art settles back a little, as on iOS. */
  .art.resting { transform: scale(0.95); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.16), 0 6px 18px -8px rgba(0, 0, 0, 0.35); }
  /* With a catalogue to browse, the hero gives the list more room. */
  .hero.compact { gap: 24px; padding-top: 4px; }
  .hero.compact .art { width: 168px; height: 168px; border-radius: 10px; }
  .hero.compact .info { padding: 6px 0 0; }
  .art.placeholder { background: var(--fill); color: var(--tertiary); box-shadow: none; transform: none; }

  .info { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: space-between; padding: 12px 0 6px; }
  .meta { min-width: 0; }
  .title {
    margin: 0; font-size: var(--fs-headline); font-weight: 600; line-height: 1.3;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .title.idle { color: var(--muted); }
  .artist { margin: 2px 0 0; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .times { display: flex; justify-content: space-between; margin-top: 6px; font-size: var(--fs-footnote); color: var(--muted); }

  .transport { display: flex; align-items: center; justify-content: center; gap: 20px; }
  /* Skip glyphs read as primary controls, so full-strength text rather than plain's muted. */
  .skip { --control-h: 40px; color: var(--text); }

  /* The negative margin lines the speaker glyphs up with the scrubber's ends. */
  .volume { display: flex; align-items: center; gap: 6px; margin: 0 -5px; color: var(--muted); }
  .level { flex: 1; }

  /* ── Songs ── */
  .songs { flex: none; margin-top: 32px; }
  .compact ~ .songs { margin-top: 24px; }
  .ui-notice { flex: none; margin: 20px 0 0; }
  .ui-notice + .songs { margin-top: 16px; }
  .busy { display: flex; align-items: center; justify-content: center; gap: 10px; flex: 1; min-height: 160px; margin: 0; color: var(--muted); font-size: 13px; }
  .thumb { position: relative; width: 36px; height: 36px; border-radius: 6px; overflow: hidden; }

  /* The playing track's art dims behind three bars: moving while it plays, still while paused. */
  .bars { position: absolute; inset: 0; display: flex; align-items: flex-end; justify-content: center; gap: 2px; padding-bottom: 11px; background: rgba(0, 0, 0, 0.38); }
  .bars i { width: 3px; height: 14px; border-radius: 1.5px; background: #fff; transform-origin: bottom; transform: scaleY(0.4); }
  .bars i:nth-child(2) { transform: scaleY(0.75); }
  .bars i:nth-child(3) { transform: scaleY(0.55); }
  .bars.live i { animation: bar 0.9s var(--ease) infinite alternate; }
  .bars.live i:nth-child(2) { animation-duration: 0.7s; animation-delay: -0.3s; }
  .bars.live i:nth-child(3) { animation-duration: 1.1s; animation-delay: -0.6s; }
  @keyframes bar { from { transform: scaleY(0.3); } to { transform: scaleY(0.95); } }

  @media (prefers-reduced-motion: reduce) {
    .art { transition: none; }
    .bars.live i { animation: none; }
  }
</style>
