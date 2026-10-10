<script lang="ts">
  import type { AppUiProps } from '@stanley/app-sdk'
  import { formatDate, type EmailState } from './core'

  let { data, perform }: AppUiProps<EmailState> = $props()
  let draft = $state('')

  let inbox = $derived(data.emails.filter((e) => !e.archived))
  let open = $derived(data.emails.find((e) => `email/${e.id}` === data.route))

  function act(verb: string) {
    if (open) perform(`email/${open.id}/${verb}`)
  }

  function reply(e: SubmitEvent) {
    e.preventDefault()
    if (!open || !draft.trim()) return
    perform(`email/${open.id}/reply`, { text: draft })
    draft = ''
  }
</script>

<section class="app">
  <nav>
    <button class:active={data.route !== 'sent'} onclick={() => perform('inbox')}>
      Inbox ({inbox.filter((e) => !e.read).length})
    </button>
    <button class:active={data.route === 'sent'} onclick={() => perform('sent')}>Sent ({data.sent.length})</button>
  </nav>

  {#if data.route === 'sent'}
    <ul>
      {#each data.sent as m (m.id)}
        <li class="sent">
          <div class="row"><span class="from">To {m.to}</span><span class="date">{formatDate(m.date)}</span></div>
          <div class="subject">{m.subject}</div>
          <p>{m.body}</p>
        </li>
      {:else}
        <li class="empty">No sent mail</li>
      {/each}
    </ul>
  {:else}
    <ul>
      {#each inbox as email (email.id)}
        <li class:unread={!email.read} class:focused={open?.id === email.id}>
          <button class="item" onclick={() => perform(`email/${email.id}`)}>
            <div class="row"><span class="from">{email.from}</span><span class="date">{formatDate(email.date)}</span></div>
            <div class="subject">{email.subject}</div>
          </button>
        </li>
      {:else}
        <li class="empty">Inbox zero</li>
      {/each}
    </ul>

    {#if open}
      <article>
        <h2>{open.subject}</h2>
        <div class="meta">{open.from} &lt;{open.address}&gt; · {formatDate(open.date)}</div>
        <p class="body">{open.body}</p>
        <div class="actions">
          <button onclick={() => act('unread')}>Mark unread</button>
          <button onclick={() => act('archive')}>Archive</button>
          <button onclick={() => act('delete')}>Delete</button>
        </div>
        <form onsubmit={reply}>
          <textarea rows="3" placeholder="Reply to {open.from}" bind:value={draft}></textarea>
          <button type="submit">Send reply</button>
        </form>
      </article>
    {/if}
  {/if}
</section>

<style>
  .app { padding: 24px; max-width: 640px; }
  nav { display: flex; gap: 8px; margin-bottom: 12px; }
  nav button { background: none; border: 0; color: inherit; font: inherit; opacity: 0.5; cursor: pointer; padding: 4px 0; margin-right: 12px; }
  nav button.active { opacity: 1; font-weight: 600; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { border-radius: 8px; }
  li.focused { background: var(--focus); }
  li.empty { opacity: 0.5; padding: 8px 10px; }
  li.sent { padding: 8px 10px; }
  li.sent p { margin: 4px 0 0; opacity: 0.8; }
  .item { display: block; width: 100%; text-align: left; background: none; border: 0; color: inherit; font: inherit; cursor: pointer; padding: 8px 10px; }
  .row { display: flex; justify-content: space-between; gap: 12px; }
  .date { opacity: 0.5; font-size: 0.85em; }
  .subject { opacity: 0.7; }
  li.unread .from, li.unread .subject { font-weight: 600; opacity: 1; }
  article { margin-top: 16px; padding-top: 16px; border-top: 1px solid color-mix(in srgb, currentColor 20%, transparent); }
  h2 { margin: 0 0 4px; font-size: 1.2em; }
  .meta { opacity: 0.6; font-size: 0.9em; }
  .body { white-space: pre-wrap; line-height: 1.5; }
  .actions { display: flex; gap: 8px; margin-bottom: 12px; }
  textarea { width: 100%; padding: 10px 12px; margin-bottom: 8px; font: inherit; }
</style>
