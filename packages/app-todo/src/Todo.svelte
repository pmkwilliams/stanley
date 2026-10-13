<script lang="ts">
  import { DEFAULT_AGENT_NAME, type AppUiProps } from '@stanley/app-sdk'
  import Icon from '@stanley/app-ui/Icon.svelte'
  import { cubicOut } from 'svelte/easing'
  import { slide } from 'svelte/transition'
  import { FIELD, remaining, sections, type Todo, type TodoState } from './core'

  let { data, perform, agentName = DEFAULT_AGENT_NAME }: AppUiProps<TodoState> = $props()

  const lists = $derived(sections(data.todos))
  const count = $derived(remaining(data.todos))

  let body: HTMLElement
  /** Whoever selects a to-do, the user or Stanley, it's brought into view. */
  $effect(() => {
    if (!data.route.startsWith('item/')) return
    const t = setTimeout(() => body?.querySelector('.selected')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 240)
    return () => clearTimeout(t)
  })

  /** The box's text lives in app state, shared with the agent. */
  function add(e: SubmitEvent) {
    e.preventDefault()
    const form = e.currentTarget as HTMLFormElement
    const text = new FormData(form).get('title')?.toString() ?? ''
    if (!text.trim()) return
    perform('title', { text })
    perform('add')
    form.reset()
  }

  /** Rows fold open and closed as they're added, checked off, or deleted. */
  function fold(node: Element) {
    const s = slide(node, { duration: 220, easing: cubicOut })
    return { ...s, css: (t: number, u: number) => `${s.css?.(t, u) ?? ''};opacity:${t}` }
  }
</script>

{#snippet row(todo: Todo)}
  {@const selected = data.route === `item/${todo.id}`}
  <li transition:fold>
    <div class="ui-row interactive" class:selected class:done={todo.done}>
      <span class="ui-row-lead">
        <input type="checkbox" class="ui-check" aria-label="checkbox" checked={todo.done} onchange={() => perform(`item/${todo.id}/toggle`)} />
      </span>
      <button class="ui-row-main open" aria-current={selected} onclick={() => perform(`item/${todo.id}`)}>
        <span class="ui-row-title">{todo.title}</span>
      </button>
      <button class="ui-btn plain small icon ui-reveal" aria-label="Delete" onclick={() => perform(`item/${todo.id}/delete`)}>
        <Icon name="xmark" size={14} weight={2} />
      </button>
    </div>
  </li>
{/snippet}

<section class="ui-app todo">
  <header class="ui-bar">
    <h1 class="ui-title">To-do</h1>
    <span class="ui-spacer"></span>
    {#if count}<span class="count ui-num">{count}</span>{/if}
  </header>

  <div class="ui-body" bind:this={body}>
    <ul class="ui-group">
      <li>
        <form class="ui-row add" onsubmit={add}>
          <label class="ui-row-lead plus" for="todo-new"><Icon name="plus" size={18} weight={2.25} /></label>
          <input
            id="todo-new"
            name="title"
            placeholder={FIELD}
            aria-label={FIELD}
            autocomplete="off"
            value={data.newTitle}
            onchange={(e) => perform('title', { text: e.currentTarget.value })}
          />
        </form>
      </li>
      {#each lists.open as todo (todo.id)}{@render row(todo)}{/each}
    </ul>

    {#if lists.done.length}
      <section class="ui-section completed" transition:fold>
        <h2 class="ui-section-title">Completed</h2>
        <ul class="ui-group">
          {#each lists.done as todo (todo.id)}{@render row(todo)}{/each}
        </ul>
      </section>
    {/if}

    {#if !data.todos.length}
      <div class="ui-empty" transition:fold>
        <Icon name="checklist" size={36} />
        <p class="ui-empty-title">No to-dos</p>
        <p class="ui-empty-text">Type one above, or ask {agentName} to add it.</p>
      </div>
    {/if}
  </div>
</section>

<style>
  .count { color: var(--muted); font-size: 13px; font-weight: 500; }

  /* The add row: a field that sits in the list as its first row, like Reminders' "New Reminder". */
  .add { gap: 12px; }
  .add:focus-within { background: var(--fill); }
  .plus { color: var(--accent); cursor: text; }
  .add input {
    flex: 1; min-width: 0; height: 28px; padding: 0; color: var(--text); font: inherit; font-size: var(--fs-body);
    background: none; border: 0; border-radius: 0; outline: none;
  }
  .add input::placeholder { color: var(--muted); }

  /* The title fills the row and opens (selects) the to-do; the check and delete sit either side. */
  .open {
    align-self: stretch; justify-content: center; margin: -8px 0; padding: 8px 0;
    color: inherit; text-align: left; background: none; border: 0; border-radius: 0; cursor: default;
  }
  .open:hover { background: none; }
  .open:focus-visible { outline: none; }
  .ui-row:has(.open:focus-visible) { box-shadow: var(--focus-ring); }
  .ui-row-title { transition: color var(--dur) var(--ease); }
  .done .ui-row-title { color: var(--muted); }
  .ui-reveal { margin-right: -6px; }
  .ui-reveal:hover { color: var(--text); }

  .completed { margin-top: 24px; }
  .ui-empty { min-height: 320px; }
</style>
