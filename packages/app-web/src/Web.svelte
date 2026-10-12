<script lang="ts">
  import type { AppUiProps } from '@stanley/app-sdk'
  import type { WebState } from './core'

  let { data }: AppUiProps<WebState> = $props()

  let open = $derived(data.route.startsWith('page/') ? (data.pages[Number(data.route.slice(5))] ?? null) : null)
</script>

<section class="app" class:browsing={!!open}>
  {#if open}
    <header>
      <div class="titles">
        <div class="title">{open.title}</div>
        <div class="muted small">{open.url}</div>
      </div>
    </header>
    <webview src={open.url}></webview>
  {:else}
    <p class="empty muted">No page open. Ask Stanley to show you something.</p>
  {/if}
  {#if data.error}
    <p class="error">{data.error}</p>
  {/if}
</section>

<style>
  .app { display: flex; flex-direction: column; min-height: 0; }
  /* A page has no natural size, so take all the room the shell allows. */
  .app.browsing { width: var(--window-max-width, 100%); height: var(--window-max-height, 100%); }
  .empty { padding: 24px; }
  header { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-bottom: 1px solid color-mix(in srgb, currentColor 20%, transparent); }
  .title { font-weight: 600; }
  .titles { min-width: 0; }
  .titles > div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  webview { flex: 1; min-height: 0; width: 100%; }
  .muted { opacity: 0.5; }
  .small { font-size: 0.85em; }
  .error { font-style: italic; opacity: 0.8; padding: 0 12px; }
</style>
