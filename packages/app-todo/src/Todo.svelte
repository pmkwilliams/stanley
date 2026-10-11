<script lang="ts">
  import type { AppUiProps } from '@stanley/app-sdk'
  import type { TodoState } from './core'

  let { data, perform }: AppUiProps<TodoState> = $props()

  /** The box's text lives in app state, shared with the agent. */
  function add(e: SubmitEvent) {
    e.preventDefault()
    const text = new FormData(e.currentTarget as HTMLFormElement).get('title')?.toString() ?? ''
    if (!text.trim()) return
    perform('title', { text })
    perform('add')
  }
</script>

<section class="app">
  <h1>To-do</h1>
  <form onsubmit={add}>
    <input name="title" placeholder="Add a task" value={data.newTitle} onchange={(e) => perform('title', { text: e.currentTarget.value })} />
  </form>
  <ul>
    {#each data.todos as todo (todo.id)}
      <li class:done={todo.done} class:focused={data.route === `item/${todo.id}`}>
        <input type="checkbox" checked={todo.done} onchange={() => perform(`item/${todo.id}/toggle`)} />
        <button class="title" onclick={() => perform(`item/${todo.id}`)}>{todo.title}</button>
        <button class="delete" aria-label="Delete" onclick={() => perform(`item/${todo.id}/delete`)}>×</button>
      </li>
    {/each}
  </ul>
</section>

<style>
  .app { padding: 24px; max-width: 560px; }
  form input { width: 100%; padding: 10px 12px; margin-bottom: 12px; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; }
  li.focused { background: var(--focus); }
  li.done .title { text-decoration: line-through; opacity: 0.5; }
  .title { flex: 1; text-align: left; background: none; border: 0; color: inherit; font: inherit; cursor: pointer; }
  .delete { background: none; border: 0; color: inherit; opacity: 0.4; cursor: pointer; font-size: 18px; }
  li:hover { background: var(--hover); }
</style>
