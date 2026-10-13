<script lang="ts">
  import { DEFAULT_AGENT_NAME, type AppUiProps } from '@stanley/app-sdk'
  import Icon from '@stanley/app-ui/Icon.svelte'
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
  let list = $state<HTMLElement>()
  $effect(() => {
    void open?.id
    list?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' })
  })
</script>

<section class="ui-app wide">
  <header class="ui-bar">
    <h1 class="ui-title">{view.label}</h1>
    <span class="ui-spacer"></span>
    <div class="ui-segmented" role="tablist" aria-label="Mailbox">
      {#each views as t (t.id)}
        <button role="tab" aria-selected={t.selected} onclick={() => perform(t.id)}>
          {t.label}
          {#if t.count}
            {@const n = t.count.split(' ')[0]}
            {#if t.id === 'inbox'}
              <span class="ui-badge" aria-label={t.count}>{n}</span>
            {:else}
              <span class="count ui-num" aria-label={t.count}>{n}</span>
            {/if}
          {/if}
        </button>
      {/each}
    </div>
  </header>

  {#if view.id === 'sent'}
    <div class="ui-body">
      {#if data.sent.length}
        <ul class="ui-group">
          {#each data.sent.toReversed() as m (m.id)}
            <li class="ui-row sent">
              <div class="ui-row-main">
                <div class="line">
                  <span class="ui-row-title">To {m.to}</span>
                  <span class="date ui-num">{formatDate(m.date)}</span>
                </div>
                <span class="subject">{m.subject}</span>
                <p class="sent-body">{m.body}</p>
              </div>
            </li>
          {/each}
        </ul>
      {:else}
        <div class="ui-empty">
          <Icon name="send" size={36} />
          <p class="ui-empty-title">No sent mail</p>
          <p class="ui-empty-text">Replies you send will appear here.</p>
        </div>
      {/if}
    </div>
  {:else if view.id === 'archived'}
    <div class="ui-body">
      {#if archived.length}
        <ul class="ui-group">
          {#each archived as email (email.id)}
            <li class="ui-row">
              <div class="ui-row-main">
                <span class="ui-row-title">{email.from}</span>
                <span class="ui-row-sub">{email.subject}</span>
              </div>
              <div class="ui-row-trail">
                <span>{formatDate(email.date)}</span>
                <button class="ui-btn small" onclick={() => perform(`email/${email.id}/restore`)}>Move to Inbox</button>
              </div>
            </li>
          {/each}
        </ul>
      {:else}
        <div class="ui-empty">
          <Icon name="archive" size={36} />
          <p class="ui-empty-title">Nothing archived</p>
          <p class="ui-empty-text">Archived messages will appear here.</p>
        </div>
      {/if}
    </div>
  {:else if !inbox.length}
    <div class="ui-body">
      <div class="ui-empty">
        <Icon name="tray" size={36} />
        <p class="ui-empty-title">No messages</p>
        <p class="ui-empty-text">New mail will appear here.</p>
      </div>
    </div>
  {:else}
    <div class="ui-split">
      <div class="ui-pane" bind:this={list}>
        <ul class="ui-group">
          {#each inbox as email (email.id)}
            <li>
              <button
                class="ui-row message"
                class:selected={open?.id === email.id}
                class:unread={!email.read}
                aria-current={open?.id === email.id}
                onclick={() => perform(`email/${email.id}`)}
              >
                <span class="ui-row-lead">{#if !email.read}<span class="ui-dot" aria-label="Unread"></span>{/if}</span>
                <span class="ui-row-main">
                  <span class="line">
                    <span class="ui-row-title">{email.from}</span>
                    <span class="date ui-num">{formatDay(email.date)}</span>
                  </span>
                  <span class="subject">{email.subject}</span>
                  <span class="ui-row-sub">{preview(email.body)}</span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      </div>

      <div class="ui-pane reader">
        {#if open}
          {#key open.id}
            <article class="message-view">
              <header>
                <div class="subject-line">
                  <h2>{open.subject}</h2>
                  <div class="ui-btn-group">
                    <button class="ui-btn icon" aria-label="Mark unread" title="Mark unread" onclick={() => act('unread')}><Icon name="envelope" size={18} /></button>
                    <button class="ui-btn icon" aria-label="Archive" title="Archive" onclick={() => act('archive')}><Icon name="archive" size={18} /></button>
                    <button class="ui-btn icon" aria-label="Delete" title="Delete" onclick={() => act('delete')}><Icon name="trash" size={18} /></button>
                  </div>
                </div>
                <div class="sender">
                  <span class="avatar" aria-hidden="true">{initials(open.from)}</span>
                  <div class="who">
                    <span class="name">{open.from}</span>
                    <span class="address">{open.address}</span>
                  </div>
                  <span class="date ui-num">{formatDate(open.date)}</span>
                </div>
              </header>
              <p class="body">{open.body}</p>
            </article>
            <form class="composer" onsubmit={send}>
              <label class="ui-field multiline">
                <textarea name="reply" rows="3" placeholder="Reply to {open.from}" value={data.drafts[open.id] ?? ''} onchange={saveDraft} onkeydown={sendKey}></textarea>
              </label>
              <div class="composer-actions">
                <button class="ui-btn primary" type="submit"><Icon name="send" size={16} />Send reply</button>
              </div>
            </form>
          {/key}
        {:else}
          <div class="ui-empty">
            <Icon name="envelope-open" size={36} />
            <p class="ui-empty-title">No message selected</p>
            <p class="ui-empty-text">Choose one, or ask {agentName} to open it.</p>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</section>

<style>
  /* Segment counts: unread is an accent badge; totals are a quiet number. */
  .count { color: var(--tertiary); font-size: var(--fs-footnote); }
  [aria-selected='true'] > .count { color: var(--muted); }

  /* Empty states fill the body, so they sit in its middle. */

  /* Message rows: sender and date on one line, then subject, then a line of the body. */
  .message { align-items: flex-start; gap: 10px; padding: 10px 12px 10px 10px; scroll-margin-block: 12px; }
  .message .ui-row-lead { min-width: 8px; height: 20px; }
  .message .ui-row-main { gap: 1px; }
  .line { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .line .ui-row-title { flex: 1; min-width: 0; }
  .date { flex: none; color: var(--muted); font-size: var(--fs-footnote); }
  .subject { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .message.unread .ui-row-title { font-weight: 600; }

  /* Sent: the reply in full. */
  .sent { align-items: flex-start; padding: 12px; }
  .sent .ui-row-main { gap: 2px; }
  .sent-body { margin: 4px 0 0; color: var(--muted); white-space: pre-wrap; }

  /* Reader: the message scrolls; the reply box stays at the bottom. */
  .reader { display: flex; flex-direction: column; padding: 0; overflow: hidden; }
  .message-view { flex: 1; min-height: 0; overflow: auto; padding: 4px var(--gutter) 0; }
  .subject-line { display: flex; align-items: flex-start; gap: 16px; }
  h2 { flex: 1; margin: 0; font-size: var(--fs-large); font-weight: 700; line-height: 1.2; letter-spacing: -0.02em; text-wrap: balance; overflow-wrap: anywhere; }
  .subject-line .ui-btn-group { margin-top: 1px; }
  .sender { display: flex; align-items: center; gap: 12px; margin-top: 16px; }
  .avatar {
    flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%;
    font-size: 13px; font-weight: 600; letter-spacing: 0.02em; color: var(--muted); background: var(--fill-hover);
  }
  .who { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .name { font-weight: 600; }
  .address { color: var(--muted); font-size: var(--fs-footnote); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sender .date { align-self: flex-start; margin-top: 2px; }
  .body { margin: 20px 0 0; padding-bottom: var(--gutter); white-space: pre-wrap; line-height: 1.6; }

  .composer { flex: none; display: flex; flex-direction: column; gap: 10px; padding: 12px var(--gutter) var(--gutter); }
  .composer textarea { min-height: calc(3 * 1.45em); }
  .composer-actions { display: flex; justify-content: flex-end; }
</style>
