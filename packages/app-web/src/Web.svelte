<script lang="ts">
  import type { AppUiProps } from '@stanley/app-sdk'
  import type { WebState } from './core'

  let { data, perform }: AppUiProps<WebState> = $props()
  /** Local "in flight" flag: perform is fire-and-forget, so clear it when new state arrives. */
  let pending = $state(false)

  $effect(() => {
    void data
    pending = false
  })

  let open = $derived(data.route.startsWith('page/') ? data.page : null)

  /** The box's text lives in app state, shared with the agent. */
  function search(e: SubmitEvent) {
    e.preventDefault()
    const text = new FormData(e.currentTarget as HTMLFormElement).get('q')?.toString() ?? ''
    if (!text.trim()) return
    pending = true
    perform('box', { text })
    perform('search')
  }
</script>

<section class="app" class:browsing={!!open}>
  {#if open}
    <header>
      <button aria-label="Back to results" onclick={() => perform('results')}>←</button>
      <div class="titles">
        <div class="title">{open.title}</div>
        <div class="muted small">{open.url}</div>
      </div>
    </header>
    <webview src={open.url}></webview>
  {:else}
    <div class="search">
      <form onsubmit={search}>
        <input name="q" placeholder="Search the web" value={data.box} onchange={(e) => perform('box', { text: e.currentTarget.value })} />
      </form>
      {#if pending}
        <p class="muted">Searching…</p>
      {/if}
      {#if data.error}
        <p class="error">{data.error}</p>
      {/if}
      {#if data.route === 'results'}
        <ul>
          {#each data.results as r, i (i)}
            <li>
              <button onclick={() => perform(`page/${i}`)}>
                <div class="muted small">{r.domain}</div>
                <div class="title">{r.title}</div>
                <div class="excerpt">{r.excerpt}</div>
              </button>
            </li>
          {:else}
            <li class="muted">No results for "{data.query}"</li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</section>

<style>
  .app { display: flex; flex-direction: column; min-height: 0; }
  /* A page has no natural size, so take all the room the shell allows. */
  .app.browsing { width: var(--window-max-width, 100%); height: var(--window-max-height, 100%); }
  .search { padding: 24px; max-width: 680px; overflow-y: auto; }
  form input { width: 100%; padding: 10px 12px; margin-bottom: 12px; }
  button { background: none; border: 0; color: inherit; font: inherit; cursor: pointer; text-align: left; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { border-radius: 8px; }
  li button { display: block; width: 100%; padding: 10px 12px; }
  .title { font-weight: 600; }
  .excerpt { opacity: 0.7; font-size: 0.9em; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  header { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-bottom: 1px solid color-mix(in srgb, currentColor 20%, transparent); }
  header button { font-size: 18px; }
  .titles { min-width: 0; }
  .titles > div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  webview { flex: 1; min-height: 0; width: 100%; }
  .muted { opacity: 0.5; }
  .small { font-size: 0.85em; }
  .error { font-style: italic; opacity: 0.8; }
  li button:hover { background: var(--hover); border-radius: 8px; }
</style>
