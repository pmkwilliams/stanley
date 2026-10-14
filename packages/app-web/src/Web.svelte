<script lang="ts">
  import { DEFAULT_AGENT_NAME, FULLSCREEN, type AppUiProps } from '@stanley/app-sdk'
  import Icon from '@stanley/app-ui/Icon.svelte'
  import * as Alert from '@stanley/app-ui/components/alert'
  import * as App from '@stanley/app-ui/components/app'
  import { Button } from '@stanley/app-ui/components/button'
  import * as Empty from '@stanley/app-ui/components/empty'
  import { domainOf } from './parallel'
  import type { WebState } from './core'

  let { data, perform, agentName = DEFAULT_AGENT_NAME, fullscreen = false }: AppUiProps<WebState> = $props()

  let open = $derived(data.route.startsWith('page/') ? (data.pages[Number(data.route.slice(5))] ?? null) : null)
  let domain = $derived(open ? domainOf(open.url) : '')
  let secure = $derived(open?.url.startsWith('https:') ?? false)
  // A page Stanley couldn't read is titled with its domain; don't say it twice.
  let title = $derived(open && open.title !== domain ? open.title : '')
</script>

{#snippet notice(text: string, className: string)}
  <Alert.Root variant="destructive" class={className}>
    <Icon name="exclamation" size={16} />
    <Alert.Title>{text}</Alert.Title>
  </Alert.Root>
{/snippet}

{#if open}
  <!-- A page has no natural size, so take all the room the shell allows. -->
  <App.Root size="fill">
    <!-- Slim chrome, Safari-style: one centred, read-only address capsule on the glass, and the full screen toggle at the end. -->
    <header class="relative flex flex-none justify-center px-4 py-2.5">
      <div
        class="flex h-8 w-full max-w-140 cursor-default items-center justify-center gap-1.5 rounded-full bg-accent px-3.5 leading-none whitespace-nowrap"
        title={open.url}
      >
        <span class="flex-none text-muted-foreground"><Icon name={secure ? 'lock' : 'globe'} size={14} weight={2} /></span>
        <span class="max-w-3/5 flex-none truncate font-semibold">{domain}</span>
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
    {#if data.error}{@render notice(data.error, 'mx-4 mb-2.5 w-auto flex-none')}{/if}
    <!-- Edge to edge under the chrome, a hairline apart (a white page meets light glass); the bottom corners follow the window's (its radius less its 1px border), square in full screen. -->
    <webview class={['min-h-0 w-full flex-1 overflow-hidden border-t', !fullscreen && 'rounded-b-[calc(var(--radius-3xl)-1px)]']} src={open.url}></webview>
  </App.Root>
{:else}
  <App.Root>
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
  </App.Root>
{/if}
