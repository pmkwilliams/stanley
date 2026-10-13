<script lang="ts">
  import { DEFAULT_AGENT_NAME, type AppUiProps } from '@stanley/app-sdk'
  import Icon from '@stanley/app-ui/Icon.svelte'
  import * as App from '@stanley/app-ui/components/app'
  import * as Item from '@stanley/app-ui/components/item'
  import { NAME_LABEL, THEMES, type SettingsState, type Theme } from './core'

  let { data, perform }: AppUiProps<SettingsState> = $props()

  /** Fixed colours on purpose: each miniature shows its own theme, whatever the current one is. */
  const look: Record<Theme, { wall: string; aurora: string; pill: string; win: string; title: string; row: string }> = {
    dark: {
      wall: 'bg-[#0a0a0b] bg-[radial-gradient(120%_70%_at_10%_-10%,rgba(255,255,255,0.08),transparent_60%)]',
      aurora: 'opacity-55',
      pill: 'bg-white/10',
      win: 'bg-[#1e1e21]/90 shadow-md shadow-black/50 inset-ring inset-ring-white/10',
      title: 'bg-zinc-200/75',
      row: 'bg-white/10',
    },
    light: {
      wall: 'bg-[#e9e9ed] bg-[radial-gradient(120%_70%_at_10%_-10%,rgba(255,255,255,0.9),transparent_60%)]',
      aurora: 'opacity-45',
      pill: 'bg-white/85 ring ring-black/5',
      win: 'bg-white/90 shadow-md shadow-black/10 ring ring-black/5',
      title: 'bg-zinc-900/75',
      row: 'bg-black/10',
    },
  }
</script>

<!-- Sized to its content: one section doesn't need a full-height window. -->
<App.Root size="compact" class="h-120">
  <App.Bar>
    <App.Title>Settings</App.Title>
  </App.Bar>

  <App.Body>
    <App.Section title="Assistant" footer="What the assistant answers to, and how the lock screen greets it.">
      <App.Group>
        <li>
          <Item.Root size="row" class="focus-within:bg-accent">
            {#snippet child({ props })}
              <label {...props}>
                <span>{NAME_LABEL}</span>
                <!-- Saved as typed; left blank, the assistant goes back to its default name. -->
                <input
                  name="agent-name"
                  class="h-7 min-w-0 flex-1 bg-transparent text-right outline-none placeholder:text-muted-foreground"
                  value={data.name}
                  placeholder={DEFAULT_AGENT_NAME}
                  autocomplete="off"
                  spellcheck="false"
                  oninput={(e) => perform('name', { text: e.currentTarget.value })}
                />
              </label>
            {/snippet}
          </Item.Root>
        </li>
      </App.Group>
    </App.Section>

    <App.Section title="Appearance" titleId="settings-appearance" footer="Changes the desktop, every window and the lock screen.">
      <div class="grid grid-cols-2 gap-4 rounded-xl bg-muted/30 p-4 pb-3.5 backdrop-blur-sm" role="radiogroup" aria-labelledby="settings-appearance">
        {#each THEMES as t (t.id)}
          {@const on = data.theme === t.id}
          {@const l = look[t.id]}
          <button class="group flex min-w-0 flex-col items-center gap-2 outline-none" role="radio" aria-checked={on} onclick={() => perform(`theme/${t.id}`)}>
            <!-- A miniature desktop in this theme: wallpaper, status pills, a window, the aurora.
                 Tahoe's selection ring: a primary outline set off by a gap. -->
            <span
              class={[
                'relative block aspect-16/10 w-full overflow-hidden rounded-lg inset-ring inset-ring-neutral-500/35',
                'outline-2 outline-offset-2 outline-transparent transition-[outline-color,filter] duration-200',
                'group-hover:brightness-105 group-aria-checked:outline-primary group-focus-visible:ring-3 group-focus-visible:ring-ring/50',
                l.wall,
              ]}
              aria-hidden="true"
            >
              <!-- Stanley's aurora, docked along the bottom edge behind the window. -->
              <span class={['absolute inset-x-1/16 -bottom-1/3 h-5/8 rounded-[50%] bg-linear-to-r from-[#4fd1a5] via-[#8a7cf0] via-55% to-[#e07cc8] blur-sm', l.aurora]}></span>
              <!-- The status bar's pills. -->
              <span class="absolute inset-x-1/16 top-1/16 flex justify-between">
                <i class={['block h-1 w-1/7 rounded-full', l.pill]}></i><i class={['block h-1 w-2/9 rounded-full', l.pill]}></i>
              </span>
              <!-- The window: glass, a title, two rows. -->
              <span class={['absolute inset-x-1/4 top-2/9 bottom-1/6 flex flex-col gap-1 rounded-md px-3.5 py-4', l.win]}>
                <i class={['mb-0.5 block h-1.5 w-5/12 rounded-full', l.title]}></i>
                <i class={['block h-1 w-full rounded-full', l.row]}></i>
                <i class={['block h-1 w-7/10 rounded-full', l.row]}></i>
              </span>
            </span>
            <span class="text-sm font-medium">{t.label}</span>
            <!-- iOS's round check under the label. -->
            <span
              class="grid size-5 place-items-center rounded-full border border-muted-foreground/60 text-primary-foreground transition-colors duration-200 group-hover:border-muted-foreground group-aria-checked:border-primary group-aria-checked:bg-primary"
              aria-hidden="true"
            >
              {#if on}<Icon name="check" size={12} weight={3} />{/if}
            </span>
          </button>
        {/each}
      </div>
    </App.Section>
  </App.Body>
</App.Root>
