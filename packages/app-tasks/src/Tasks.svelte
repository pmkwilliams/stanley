<script lang="ts">
  import { DEFAULT_AGENT_NAME, type AppUiProps } from '@stanley/app-sdk'
  import Icon from '@stanley/app-ui/Icon.svelte'
  import * as App from '@stanley/app-ui/components/app'
  import { Badge } from '@stanley/app-ui/components/badge'
  import { Button } from '@stanley/app-ui/components/button'
  import { Checkbox } from '@stanley/app-ui/components/checkbox'
  import * as Empty from '@stanley/app-ui/components/empty'
  import * as Item from '@stanley/app-ui/components/item'
  import { cubicOut } from 'svelte/easing'
  import { slide } from 'svelte/transition'
  import { FIELD, remaining, sections, type Task, type TasksState } from './core'

  let { data, perform, agentName = DEFAULT_AGENT_NAME }: AppUiProps<TasksState> = $props()

  const lists = $derived(sections(data.tasks))
  const count = $derived(remaining(data.tasks))

  let body = $state<HTMLElement | null>(null)
  /** Whoever selects a task, the user or Stanley, it's brought into view. */
  $effect(() => {
    if (!data.route.startsWith('item/')) return
    const t = setTimeout(() => body?.querySelector('[data-selected=true]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 240)
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

{#snippet row(task: Task)}
  {@const selected = data.route === `item/${task.id}`}
  <li transition:fold>
    <Item.Root size="row" data-selected={selected} class="hover:bg-accent has-[.open:focus-visible]:ring-3 has-[.open:focus-visible]:ring-ring/50">
      <Item.Media>
        <Checkbox class="size-5 rounded-full" aria-label="checkbox" checked={task.done} onCheckedChange={() => perform(`item/${task.id}/toggle`)} />
      </Item.Media>
      <button class="open flex min-w-0 flex-1 self-stretch text-left outline-none" aria-current={selected} onclick={() => perform(`item/${task.id}`)}>
        <Item.Content class="justify-center">
          <Item.Title class={["transition-colors duration-200", task.done && "text-muted-foreground"]}>{task.title}</Item.Title>
        </Item.Content>
      </button>
      <Item.Actions class="-mr-1.5 opacity-0 transition-opacity group-hover/item:opacity-100 group-focus-within/item:opacity-100 group-data-[selected=true]/item:opacity-100">
        <Button variant="ghost" size="icon-sm" class="text-muted-foreground hover:text-foreground" aria-label="Delete" onclick={() => perform(`item/${task.id}/delete`)}>
          <Icon name="xmark" size={14} weight={2} />
        </Button>
      </Item.Actions>
    </Item.Root>
  </li>
{/snippet}

<App.Root class="w-130">
  <App.Bar>
    <App.Title>Tasks</App.Title>
    {#if count}<Badge class="h-6 min-w-6 px-2 text-sm tabular-nums">{count}</Badge>{/if}
  </App.Bar>

  <App.Body bind:ref={body}>
    <App.Group>
      {#each lists.open as task (task.id)}{@render row(task)}{/each}
      <li>
        <!-- The add row: a field that sits in the list as its last row, like Reminders' "New Reminder". -->
        <form class="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 focus-within:bg-accent" onsubmit={add}>
          <label class="flex w-5 cursor-text justify-center text-primary" for="tasks-new"><Icon name="plus" size={18} weight={2.25} /></label>
          <input
            id="tasks-new"
            name="title"
            class="h-7 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
            placeholder={FIELD}
            aria-label={FIELD}
            autocomplete="off"
            value={data.newTitle}
            onchange={(e) => perform('title', { text: e.currentTarget.value })}
          />
        </form>
      </li>
    </App.Group>

    {#if lists.done.length}
      <div class="mt-6" transition:fold><App.Section title="Completed">
        <App.Group>
          {#each lists.done as task (task.id)}{@render row(task)}{/each}
        </App.Group>
      </App.Section></div>
    {/if}

    {#if !data.tasks.length}
      <div class="flex flex-1" transition:fold>
        <Empty.Root>
          <Empty.Header>
            <Empty.Media class="text-muted-foreground/60"><Icon name="checklist" size={36} /></Empty.Media>
            <Empty.Title>No tasks</Empty.Title>
            <Empty.Description>Type one above, or ask {agentName} to add it.</Empty.Description>
          </Empty.Header>
        </Empty.Root>
      </div>
    {/if}
  </App.Body>
</App.Root>
