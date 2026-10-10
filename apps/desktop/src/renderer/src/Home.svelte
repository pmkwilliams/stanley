<script lang="ts">
  let { apps }: { apps: { id: string; title: string; description: string }[] } = $props()
</script>

<section>
  {#each apps as app (app.id)}
    <button onclick={() => window.stanley.open(app.id)}>
      <strong>{app.title}</strong>
      <span>{app.description}</span>
    </button>
  {/each}
</section>

<style>
  section { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; padding: 24px; }
  button {
    display: flex; flex-direction: column; gap: 6px; align-items: flex-start; text-align: left;
    padding: 16px; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; cursor: pointer;
  }
  span { color: var(--muted); font-size: 12px; }
</style>
