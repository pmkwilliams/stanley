<script lang="ts">
  import type { AppUiProps } from '@stanley/app-sdk'
  import type { TodoState } from './core'

  let { data, perform }: AppUiProps<TodoState> = $props()
  let draft = $state('')

  function add(e: SubmitEvent) {
    e.preventDefault()
    if (!draft.trim()) return
    perform('add', { text: draft })
    draft = ''
  }
</script>

<section class="app">
  <h1>To-do</h1>
  <form onsubmit={add}>
    <input placeholder="Add a task" bind:value={draft} />
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
</style>
