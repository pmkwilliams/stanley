<script lang="ts">
  import { DEFAULT_AGENT_NAME, FILES_URL, FULLSCREEN, type AppUiProps } from '@stanley/app-sdk'
  import Icon from '@stanley/app-ui/Icon.svelte'
  import * as Alert from '@stanley/app-ui/components/alert'
  import * as App from '@stanley/app-ui/components/app'
  import { Button } from '@stanley/app-ui/components/button'
  import * as Empty from '@stanley/app-ui/components/empty'
  import { domainOf } from './parallel'
  import type { WebState } from './core'

  let { data, perform, agentName = DEFAULT_AGENT_NAME, fullscreen = false }: AppUiProps<WebState> = $props()

  let open = $derived(data.route.startsWith('page/') ? (data.pages[Number(data.route.slice(5))] ?? null) : null)
  /** Every tab's view, the ready one too, in the order they were made: a view moved in the page would reload. */
  let views = $derived([...data.tabs.map((t) => t.id), data.ready].sort((a, b) => a - b))
  /** A file of the user's is named by its path in their folder, a page by its site. */
  let file = $derived(open?.url.startsWith(FILES_URL) ? decodeURIComponent(open.url.slice(FILES_URL.length)) : null)
  let place = $derived(open ? (file ?? domainOf(open.url)) : '')
  let icon = $derived<'folder' | 'lock' | 'globe'>(file !== null ? 'folder' : open?.url.startsWith('https:') ? 'lock' : 'globe')
  // A page Stanley couldn't read is titled with its domain, a file without a title with its name; don't say it twice.
  let title = $derived(open && open.title !== place && open.title !== place.split('/').at(-1) ? open.title : '')
</script>

{#snippet notice(text: string, className: string)}
  <Alert.Root variant="destructive" class={className}>
    <Icon name="exclamation" size={16} />
    <Alert.Title>{text}</Alert.Title>
  </Alert.Root>
{/snippet}

<!--
  One window whatever is open, so the page's view is never taken out: main loads and works the page
  in it, even while the window is hidden. A page has no natural size, so take all the room the shell allows.
-->
<App.Root size="fill">
  {#if open}
    <!--
      Slim chrome, Safari-style: one centred, read-only address capsule on the glass, and the full screen toggle at the end.
      In full screen the page has the whole screen: the chrome waits above it and slides down over the page while the pointer is
      at the top edge, held by a thin strip over the page (which takes the pointer's events itself), or while it has the keyboard.
    -->
    <div class={fullscreen ? 'group/chrome absolute inset-x-0 top-0 z-10 h-1.5' : 'contents'}>
      <header
        class={[
          'relative flex flex-none justify-center px-4 py-2.5',
          fullscreen &&
            '-translate-y-full border-b bg-card/80 backdrop-blur-md backdrop-saturate-150 transition-transform delay-300 group-focus-within/chrome:translate-y-0 group-focus-within/chrome:delay-0 group-hover/chrome:translate-y-0 group-hover/chrome:delay-0',
        ]}
      >
        <div
          class="flex h-8 w-full max-w-140 cursor-default items-center justify-center gap-1.5 rounded-full bg-accent px-3.5 leading-none whitespace-nowrap"
          title={open.url}
        >
          <span class="flex-none text-muted-foreground"><Icon name={icon} size={14} weight={2} /></span>
          <span class="max-w-3/5 flex-none truncate font-semibold">{place}</span>
          {#if title}
            <span class="min-w-0 truncate text-muted-foreground before:mr-1.5 before:text-muted-foreground/60 before:content-['·']">{title}</span>
          {/if}
        </div>
        <Button
          variant="ghost"
          size="icon"
          class="absolute top-2.5 right-3 size-8 rounded-full text-muted-foreground"
          aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
          onclick={() => perform(FULLSCREEN)}
        >
          <Icon name={fullscreen ? 'fullscreen-exit' : 'fullscreen-enter'} size={16} weight={2} />
        </Button>
      </header>
    </div>
    {#if data.error}{@render notice(data.error, fullscreen ? 'mx-4 my-2.5 w-auto flex-none' : 'mx-4 mb-2.5 w-auto flex-none')}{/if}
  {:else}
    <App.Bar><App.Title>Web</App.Title></App.Bar>
    <App.Body>
      {#if data.error}{@render notice(data.error, 'flex-none')}{/if}
      <Empty.Root>
        <Empty.Header>
          <Empty.Media class="text-muted-foreground/60"><Icon name="globe" size={40} weight={1.5} /></Empty.Media>
          <Empty.Title>No page open</Empty.Title>
          <Empty.Description>Ask {agentName} to open a page.</Empty.Description>
        </Empty.Header>
      </Empty.Root>
    </App.Body>
  {/if}
  <!--
    Edge to edge under the chrome, a hairline apart (a white page meets light glass); the bottom corners follow the window's (its radius less its 1px border).
    In full screen, square and with no hairline: the page meets the screen's edges.
    A view per tab, stacked: the tab shown is the one in sight, and the others go on running out of sight, full size, as the ready one waits.
    With no page open they are all behind the empty state, so a page loads at the size it is seen at.
  -->
  <div class={['relative min-h-0 w-full flex-1 overflow-hidden', !fullscreen && 'rounded-b-[calc(var(--radius-3xl)-1px)] border-t', !open && 'invisible absolute inset-0']}>
    {#each views as id (id)}
      <webview class={['absolute inset-0 size-full', id !== open?.tab && 'invisible']} src={`about:blank#tab=${id}`} allowpopups></webview>
    {/each}
  </div>
</App.Root>
