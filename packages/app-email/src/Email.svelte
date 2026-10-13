<script lang="ts">
  import { DEFAULT_AGENT_NAME, type AppUiProps } from '@stanley/app-sdk'
  import Icon from '@stanley/app-ui/Icon.svelte'
  import * as App from '@stanley/app-ui/components/app'
  import { Badge } from '@stanley/app-ui/components/badge'
  import { Button } from '@stanley/app-ui/components/button'
  import { ButtonGroup } from '@stanley/app-ui/components/button-group'
  import * as Empty from '@stanley/app-ui/components/empty'
  import * as InputGroup from '@stanley/app-ui/components/input-group'
  import * as Item from '@stanley/app-ui/components/item'
  import * as Tabs from '@stanley/app-ui/components/tabs'
  import { formatDate, formatDay, tabs, type EmailState } from './core'

  let { data, perform, agentName = DEFAULT_AGENT_NAME }: AppUiProps<EmailState> = $props()

  let inbox = $derived(data.emails.filter((e) => !e.archived))
  let archived = $derived(data.emails.filter((e) => e.archived))
  let open = $derived(inbox.find((e) => `email/${e.id}` === data.route))
  let views = $derived(tabs(data))
  let view = $derived(views.find((t) => t.selected)!)

  /** The body on one line, for the list's preview. */
  const preview = (body: string) => body.replace(/\s+/g, ' ').trim()
  /** First and last initials, as in Contacts: "Delta Air Lines" → "DL". */
  const initials = (name: string) => {
    const words = name.split(/\s+/).filter(Boolean)
    return [words[0], words.length > 1 ? words.at(-1) : undefined].map((w) => w?.[0]?.toUpperCase() ?? '').join('')
  }

  function act(verb: string) {
    if (open) perform(`email/${open.id}/${verb}`)
  }

  /** The draft lives in app state, shared with the agent: typing saves it, and only Send sends it. */
  function saveDraft(e: Event) {
    if (open) perform(`email/${open.id}/reply`, { text: (e.currentTarget as HTMLTextAreaElement).value })
  }

  function send(e: SubmitEvent) {
    e.preventDefault()
    if (!open) return
    const text = new FormData(e.currentTarget as HTMLFormElement).get('reply')?.toString() ?? ''
    if (!text.trim()) return
    // Save first, in case the last keystrokes have not been saved yet; the surface queue keeps the order.
    perform(`email/${open.id}/reply`, { text })
    perform(`email/${open.id}/send`)
  }

  /** ⌘↩ sends, as in Mail. */
  function sendKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      ;(e.currentTarget as HTMLTextAreaElement).form?.requestSubmit()
    }
  }

  /** Keep the open message's row in view, whoever opened it. */
  let list = $state<HTMLElement | null>(null)
  $effect(() => {
    void open?.id
    list?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' })
  })
</script>

{#snippet empty(icon: 'send' | 'archive' | 'tray' | 'envelope-open', title: string, text: string)}
  <Empty.Root>
    <Empty.Header>
      <Empty.Media class="text-muted-foreground"><Icon name={icon} size={36} /></Empty.Media>
      <Empty.Title class="text-base font-semibold">{title}</Empty.Title>
      <Empty.Description>{text}</Empty.Description>
    </Empty.Header>
  </Empty.Root>
{/snippet}

<App.Root size="wide">
  <App.Bar>
    <App.Title>{view.label}</App.Title>
    <Tabs.Root value={view.id} activationMode="manual">
      <Tabs.List aria-label="Mailbox">
        {#each views as t (t.id)}
          <Tabs.Trigger
            value={t.id}
            class="px-3"
            onclick={() => perform(t.id)}>
            {t.label}
            {#if t.count}
              {@const n = t.count.split(' ')[0]}
              {#if t.id === 'inbox'}
                <Badge class="h-4.5 min-w-4.5 px-1.5 tabular-nums" aria-label={t.count}>{n}</Badge>
              {:else}
                <span class="text-xs text-muted-foreground tabular-nums" aria-label={t.count}>{n}</span>
              {/if}
            {/if}
          </Tabs.Trigger>
        {/each}
      </Tabs.List>
    </Tabs.Root>
  </App.Bar>

  {#if view.id === 'sent'}
    <App.Body>
      {#if data.sent.length}
        <App.Group>
          {#each data.sent.toReversed() as m (m.id)}
            <li>
              <Item.Root size="row" class="items-start py-3">
                <Item.Content class="min-w-0 gap-0.5">
                  <div class="flex min-w-0 items-baseline gap-2">
                    <Item.Title class="w-auto min-w-0 flex-1">To {m.to}</Item.Title>
                    <span class="flex-none text-xs text-muted-foreground tabular-nums">{formatDate(m.date)}</span>
                  </div>
                  <span class="truncate">{m.subject}</span>
                  <p class="mt-1 whitespace-pre-wrap text-muted-foreground">{m.body}</p>
                </Item.Content>
              </Item.Root>
            </li>
          {/each}
        </App.Group>
      {:else}
        {@render empty('send', 'No sent mail', 'Replies you send will appear here.')}
      {/if}
    </App.Body>
  {:else if view.id === 'archived'}
    <App.Body>
      {#if archived.length}
        <App.Group>
          {#each archived as email (email.id)}
            <li>
              <Item.Root size="row">
                <Item.Content class="min-w-0 gap-0.5">
                  <Item.Title>{email.from}</Item.Title>
                  <Item.Description class="line-clamp-1 text-xs">{email.subject}</Item.Description>
                </Item.Content>
                <Item.Actions class="text-xs text-muted-foreground tabular-nums">
                  <span>{formatDate(email.date)}</span>
                  <Button variant="secondary" size="sm" onclick={() => perform(`email/${email.id}/restore`)}>Move to Inbox</Button>
                </Item.Actions>
              </Item.Root>
            </li>
          {/each}
        </App.Group>
      {:else}
        {@render empty('archive', 'Nothing archived', 'Archived messages will appear here.')}
      {/if}
    </App.Body>
  {:else if !inbox.length}
    <App.Body>
      {@render empty('tray', 'No messages', 'New mail will appear here.')}
    </App.Body>
  {:else}
    <App.Split>
      <App.Body bind:ref={list}>
        <App.Group>
          {#each inbox as email (email.id)}
            {@const selected = open?.id === email.id}
            <li>
              <Item.Root size="row" data-selected={selected} class="scroll-my-3 items-start gap-2.5 py-2.5 pl-2.5 text-left hover:bg-accent focus-visible:ring-inset">
                {#snippet child({ props })}
                  <button {...props} aria-current={selected} onclick={() => perform(`email/${email.id}`)}>
                    <Item.Media class="h-5 w-2">
                      {#if !email.read}<span class="size-2 rounded-full bg-primary" aria-label="Unread"></span>{/if}
                    </Item.Media>
                    <Item.Content class="min-w-0 gap-px">
                      <span class="flex min-w-0 items-baseline gap-2">
                        <Item.Title class={['w-auto min-w-0 flex-1', !email.read && 'font-semibold']}>{email.from}</Item.Title>
                        <span class="flex-none text-xs text-muted-foreground tabular-nums">{formatDay(email.date)}</span>
                      </span>
                      <span class="truncate">{email.subject}</span>
                      <span class="truncate text-xs text-muted-foreground">{preview(email.body)}</span>
                    </Item.Content>
                  </button>
                {/snippet}
              </Item.Root>
            </li>
          {/each}
        </App.Group>
      </App.Body>

      <!-- The reader: the message scrolls; the reply box stays at the bottom. -->
      <App.Body class="overflow-hidden px-0 pb-0">
        {#if open}
          {#key open.id}
            <article class="min-h-0 flex-1 overflow-auto px-4 pt-1">
              <header>
                <div class="flex items-start gap-4">
                  <h2 class="flex-1 text-2xl leading-tight font-bold tracking-tight text-balance wrap-anywhere">{open.subject}</h2>
                  <ButtonGroup>
                    <Button variant="secondary" size="icon" aria-label="Mark unread" title="Mark unread" onclick={() => act('unread')}><Icon name="envelope" size={18} /></Button>
                    <Button variant="secondary" size="icon" aria-label="Archive" title="Archive" onclick={() => act('archive')}><Icon name="archive" size={18} /></Button>
                    <Button variant="secondary" size="icon" aria-label="Delete" title="Delete" onclick={() => act('delete')}><Icon name="trash" size={18} /></Button>
                  </ButtonGroup>
                </div>
                <div class="mt-4 flex items-center gap-3">
                  <span class="grid size-9 flex-none place-items-center rounded-full bg-accent text-xs font-semibold tracking-wide text-muted-foreground" aria-hidden="true">{initials(open.from)}</span>
                  <div class="flex min-w-0 flex-1 flex-col">
                    <span class="font-semibold">{open.from}</span>
                    <span class="truncate text-xs text-muted-foreground">{open.address}</span>
                  </div>
                  <span class="mt-0.5 flex-none self-start text-xs text-muted-foreground tabular-nums">{formatDate(open.date)}</span>
                </div>
              </header>
              <p class="mt-5 pb-4 leading-relaxed whitespace-pre-wrap">{open.body}</p>
            </article>
            <form class="flex-none px-4 pt-3 pb-4" onsubmit={send}>
              <InputGroup.Root>
                <InputGroup.Textarea
                  name="reply"
                  rows={3}
                  class="max-h-40 min-h-16"
                  placeholder="Reply to {open.from}"
                  aria-label="Reply to {open.from}"
                  value={data.drafts[open.id] ?? ''}
                  onchange={saveDraft}
                  onkeydown={sendKey}
                />
                <InputGroup.Addon align="block-end">
                  <Button type="submit" size="sm" class="ml-auto"><Icon name="send" size={16} />Send reply</Button>
                </InputGroup.Addon>
              </InputGroup.Root>
            </form>
          {/key}
        {:else}
          {@render empty('envelope-open', 'No message selected', `Choose one, or ask ${agentName} to open it.`)}
        {/if}
      </App.Body>
    </App.Split>
  {/if}
</App.Root>
