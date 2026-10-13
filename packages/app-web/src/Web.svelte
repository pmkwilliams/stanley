<script lang="ts">
  import { DEFAULT_AGENT_NAME, type AppUiProps } from '@stanley/app-sdk'
  import Icon from '@stanley/app-ui/Icon.svelte'
  import { domainOf } from './parallel'
  import type { WebState } from './core'

  let { data, agentName = DEFAULT_AGENT_NAME }: AppUiProps<WebState> = $props()

  let open = $derived(data.route.startsWith('page/') ? (data.pages[Number(data.route.slice(5))] ?? null) : null)
  let domain = $derived(open ? domainOf(open.url) : '')
  let secure = $derived(open?.url.startsWith('https:') ?? false)
  // A page Stanley couldn't read is titled with its domain; don't say it twice.
  let title = $derived(open && open.title !== domain ? open.title : '')
</script>

{#snippet notice(text: string)}
  <p class="ui-notice notice" role="alert">
    <Icon name="exclamation" size={16} />
    <span>{text}</span>
  </p>
{/snippet}

{#if open}
  <!-- A page has no natural size, so take all the room the shell allows. -->
  <section class="ui-app browsing">
    <header class="chrome">
      <div class="address" title={open.url}>
        <span class="glyph"><Icon name={secure ? 'lock' : 'globe'} size={13} weight={2} /></span>
        <span class="domain">{domain}</span>
        {#if title}<span class="page-title">{title}</span>{/if}
      </div>
    </header>
    {#if data.error}{@render notice(data.error)}{/if}
    <webview src={open.url}></webview>
  </section>
{:else}
  <section class="ui-app">
    <header class="ui-bar"><h1 class="ui-title">Web</h1></header>
    {#if data.error}{@render notice(data.error)}{/if}
    <div class="ui-empty">
      <Icon name="globe" size={40} weight={1.5} />
      <p class="ui-empty-title">No page open</p>
      <p class="ui-empty-text">Ask {agentName} to open a page.</p>
    </div>
  </section>
{/if}

<style>
  .browsing { --app-w: var(--window-max-width, 100vw); --app-h: var(--window-max-height, 100vh); }

  /* Slim chrome, Safari-style: one centred, read-only address capsule on the glass. */
  .chrome { flex: none; display: flex; justify-content: center; padding: 10px var(--gutter); }
  .address {
    display: flex; align-items: center; justify-content: center; gap: 6px;
    width: min(560px, 100%); height: 32px; padding: 0 14px; border-radius: var(--r-capsule);
    background: var(--fill); font-size: 13px; line-height: 1; white-space: nowrap; cursor: default;
  }
  .glyph { flex: none; display: grid; color: var(--muted); }
  .domain { flex: none; max-width: 60%; overflow: hidden; text-overflow: ellipsis; font-weight: 600; color: var(--text); }
  .page-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--muted); }
  .page-title::before { content: '·'; margin-right: 6px; color: var(--tertiary); }

  .notice { flex: none; margin: 0 var(--gutter) 10px; }
  .notice > span { min-width: 0; }

  /* Edge to edge under the chrome, a hairline apart (a white page meets light glass); the bottom corners follow the window's (its radius less its 1px border). */
  webview { flex: 1; min-height: 0; width: 100%; border-top: 1px solid var(--separator); border-radius: 0 0 calc(var(--r-window) - 1px) calc(var(--r-window) - 1px); overflow: hidden; }
</style>
