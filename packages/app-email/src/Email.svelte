<script lang="ts">
  import { DEFAULT_AGENT_NAME, type AppUiProps } from '@stanley/app-sdk'
  import Icon from '@stanley/app-ui/Icon.svelte'
  import * as App from '@stanley/app-ui/components/app'
  import * as Avatar from '@stanley/app-ui/components/avatar'
  import { Badge } from '@stanley/app-ui/components/badge'
  import { Button } from '@stanley/app-ui/components/button'
  import { ButtonGroup } from '@stanley/app-ui/components/button-group'
  import * as Empty from '@stanley/app-ui/components/empty'
  import * as InputGroup from '@stanley/app-ui/components/input-group'
  import * as Item from '@stanley/app-ui/components/item'
  import * as Tabs from '@stanley/app-ui/components/tabs'
  import { avatarFor } from './avatars'
  import { formatDate, linkify, mailbox, openEmail, openSent, tabs, type EmailState } from './core'

  let { data, perform, agentName = DEFAULT_AGENT_NAME }: AppUiProps<EmailState> = $props()

  let views = $derived(tabs(data))
  let view = $derived(mailbox(data))
  let open = $derived(openEmail(data))
  let sent = $derived(openSent(data))

  /** Sent mail keeps only the recipient's name: their address is on the mail they sent. */
  const addressOf = (name: string) => data.emails.find((e) => e.from === name)?.address

  /** The sidebar's list: one shape for every mailbox, newest sent first. */
  let rows = $derived(
    view === 'sent'
      ? data.sent.toReversed().map((m) => ({ node: `sent/${m.id}`, who: m.to, address: addressOf(m.to), subject: m.subject, body: m.body, unread: false, selected: sent?.id === m.id }))
      : data.emails
          .filter((e) => e.archived === (view === 'archived'))
          .map((e) => ({ node: `email/${e.id}`, who: e.from, address: e.address, subject: e.subject, body: e.body, unread: !e.read, selected: open?.id === e.id })),
  )

  /** The body on one line, for the list's summary. */
  const summary = (body: string) => body.replace(/\s+/g, ' ').trim()


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
    void (open ?? sent)?.id
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

{#snippet avatar(name: string, address: string | undefined, size: 'default' | 'lg', unread = false)}
  {@const a = avatarFor(name, address)}
  <Avatar.Root {size} title={name}>
    {#if a.src}<Avatar.Image src={a.src} alt="" />{/if}
    <Avatar.Fallback class={['font-semibold', a.class]}>{a.letter}</Avatar.Fallback>
    {#if unread}<Avatar.Badge aria-label="Unread" />{/if}
  </Avatar.Root>
{/snippet}

<!-- A message's text, its web addresses links that open in Web. Kept on few lines: the paragraph keeps whitespace. -->
{#snippet body(message: string, text: string)}
  <p class="min-h-0 flex-1 overflow-auto px-6 py-5 leading-relaxed whitespace-pre-wrap">{#each linkify(text) as segment, i (i)}{#if segment.url}<a
          href={segment.url}
          class="font-medium wrap-anywhere text-primary underline underline-offset-4"
          onclick={(e) => {
            e.preventDefault()
            perform(`${message}/link/${segment.n}`)
          }}>{segment.text}</a
        >{:else}{segment.text}{/if}{/each}</p>
{/snippet}

{#snippet person(name: string, address: string | undefined, date: string)}
  <div class="mt-4 flex items-center gap-3">
    {@render avatar(name, address, 'lg')}
    <div class="flex min-w-0 flex-1 flex-col">
      <span class="font-semibold">{name}</span>
      <span class="truncate text-xs text-muted-foreground">{address}</span>
    </div>
    <span class="flex-none self-start text-xs text-muted-foreground tabular-nums">{date}</span>
  </div>
{/snippet}

<App.Root size="wide">
  <App.Sidebar>
    <Tabs.Root value={view} activationMode="manual" class="flex-none px-3 pt-3 pb-2">
      <Tabs.List aria-label="Mailbox" class="w-full">
        {#each views as t (t.id)}
          <Tabs.Trigger value={t.id} onclick={() => perform(t.id)}>
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

    <div bind:this={list} class="flex min-h-0 flex-1 flex-col overflow-auto px-3 pb-3">
      {#if rows.length}
        <ul class="flex flex-col gap-0.5">
          {#each rows as row (row.node)}
            <li>
              <Item.Root size="row" data-selected={row.selected} class="scroll-my-3 items-start py-2.5 text-left hover:bg-accent focus-visible:ring-inset">
                {#snippet child({ props })}
                  <button {...props} aria-current={row.selected} onclick={() => perform(row.node)}>
                    {@render avatar(row.who, row.address, 'default', row.unread)}
                    <Item.Content class="min-w-0 gap-px">
                      <Item.Title class={['block w-full truncate', row.unread && 'font-semibold']}>{row.subject}</Item.Title>
                      <span class="truncate text-xs text-muted-foreground">{summary(row.body)}</span>
                    </Item.Content>
                  </button>
                {/snippet}
              </Item.Root>
            </li>
          {/each}
        </ul>
      {:else if view === 'sent'}
        {@render empty('send', 'No sent mail', 'Replies you send will appear here.')}
      {:else if view === 'archived'}
        {@render empty('archive', 'Nothing archived', 'Archived messages will appear here.')}
      {:else}
        {@render empty('tray', 'No messages', 'New mail will appear here.')}
      {/if}
    </div>
  </App.Sidebar>

  <!-- A message: its header stays put, the body scrolls on its own, and the reply box stays at the bottom. -->
  <App.Main>
    {#if open}
      {#key open.id}
        <article class="flex min-h-0 flex-1 flex-col">
          <header class="flex-none border-b px-6 pt-5 pb-4">
            <div class="flex items-start gap-4">
              <h2 class="flex-1 text-2xl leading-tight font-bold tracking-tight text-balance wrap-anywhere">{open.subject}</h2>
              <ButtonGroup>
                <Button variant="secondary" size="icon" aria-label="Mark unread" title="Mark unread" onclick={() => act('unread')}><Icon name="envelope" size={18} /></Button>
                {#if open.archived}
                  <Button variant="secondary" size="icon" aria-label="Move to Inbox" title="Move to Inbox" onclick={() => act('restore')}><Icon name="tray" size={18} /></Button>
                {:else}
                  <Button variant="secondary" size="icon" aria-label="Archive" title="Archive" onclick={() => act('archive')}><Icon name="archive" size={18} /></Button>
                {/if}
                <Button variant="secondary" size="icon" aria-label="Delete" title="Delete" onclick={() => act('delete')}><Icon name="trash" size={18} /></Button>
              </ButtonGroup>
            </div>
            {@render person(open.from, open.address, formatDate(open.date))}
          </header>
          {@render body(`email/${open.id}`, open.body)}
          <form class="flex-none px-6 pt-1 pb-5" onsubmit={send}>
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
                <Button type="submit" size="sm" class="ml-auto"><Icon name="reply" size={16} />Send reply</Button>
              </InputGroup.Addon>
            </InputGroup.Root>
          </form>
        </article>
      {/key}
    {:else if sent}
      <article class="flex min-h-0 flex-1 flex-col">
        <header class="flex-none border-b px-6 pt-5 pb-4">
          <h2 class="text-2xl leading-tight font-bold tracking-tight text-balance wrap-anywhere">{sent.subject}</h2>
          {@render person(sent.to, addressOf(sent.to), formatDate(sent.date))}
        </header>
        {@render body(`sent/${sent.id}`, sent.body)}
      </article>
    {:else if rows.length}
      {@render empty('envelope-open', 'No message selected', `Choose one, or ask ${agentName} to open it.`)}
    {/if}
  </App.Main>
</App.Root>
