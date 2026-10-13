<script lang="ts">
  import { DEFAULT_AGENT_NAME, type AppUiProps } from '@stanley/app-sdk'
  import Icon from '@stanley/app-ui/Icon.svelte'
  import { NAME_LABEL, THEMES, type SettingsState } from './core'

  let { data, perform }: AppUiProps<SettingsState> = $props()
</script>

<!-- Sized to its content: one section doesn't need a full-height window. -->
<section class="ui-app compact settings">
  <header class="ui-bar">
    <h1 class="ui-title">Settings</h1>
  </header>

  <div class="ui-body">
    <section class="ui-section">
      <h2 class="ui-section-title">Assistant</h2>
      <div class="ui-card">
        <label class="ui-field">
          <span class="field-label">{NAME_LABEL}</span>
          <!-- Saved as typed; left blank, the assistant goes back to its default name. -->
          <input
            name="agent-name"
            value={data.name}
            placeholder={DEFAULT_AGENT_NAME}
            autocomplete="off"
            spellcheck="false"
            oninput={(e) => perform('name', { text: e.currentTarget.value })}
          />
        </label>
      </div>
      <p class="ui-section-footer">What the assistant answers to, and how the lock screen greets it.</p>
    </section>

    <section class="ui-section">
      <h2 class="ui-section-title" id="settings-appearance">Appearance</h2>
      <div class="ui-card themes" role="radiogroup" aria-labelledby="settings-appearance">
        {#each THEMES as t (t.id)}
          {@const on = data.theme === t.id}
          <button class="theme" role="radio" aria-checked={on} onclick={() => perform(`theme/${t.id}`)}>
            <!-- A miniature desktop in this theme: wallpaper, status pills, a window, the aurora. -->
            <span class="preview {t.id}" aria-hidden="true">
              <span class="aurora"></span>
              <span class="pills"><i></i><i></i></span>
              <span class="win"><i class="title"></i><i class="row"></i><i class="row short"></i></span>
            </span>
            <span class="label">{t.label}</span>
            <span class="tick" aria-hidden="true">{#if on}<Icon name="check" size={12} weight={3} />{/if}</span>
          </button>
        {/each}
      </div>
      <p class="ui-section-footer">Changes the desktop, every window and the lock screen.</p>
    </section>
  </div>
</section>

<style>
  .settings { --app-h: 470px; }

  .field-label { color: var(--text); font-size: var(--fs-body); }
  .ui-field input { text-align: right; }

  .themes { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 16px 16px 14px; }

  .theme {
    display: flex; flex-direction: column; align-items: center; gap: 8px; min-width: 0; padding: 0;
    font: inherit; color: var(--text); background: none; border: 0; cursor: default;
  }
  .theme:focus-visible { outline: none; }
  .label { font-size: 13px; font-weight: 500; }

  /* The miniature, with Tahoe's selection ring: an accent outline set off by a gap. */
  .preview {
    position: relative; display: block; width: 100%; aspect-ratio: 16 / 10; overflow: hidden; border-radius: 8px;
    box-shadow: inset 0 0 0 0.5px rgba(127, 127, 127, 0.35);
    outline: 2.5px solid transparent; outline-offset: 2.5px;
    transition: outline-color var(--dur) var(--ease), filter var(--dur-fast);
  }
  .theme:hover .preview { filter: brightness(1.06); }
  .theme[aria-checked='true'] .preview { outline-color: var(--accent); }
  .theme:focus-visible .preview { box-shadow: var(--focus-ring); }

  /* Fixed colours on purpose: each miniature shows its own theme, whatever the current one is. */
  .preview.dark {
    background:
      radial-gradient(120% 70% at 10% -10%, rgba(255, 255, 255, 0.08), transparent 60%),
      #0a0a0b;
  }
  .preview.light {
    background:
      radial-gradient(120% 70% at 10% -10%, rgba(255, 255, 255, 0.9), transparent 60%),
      #e9e9ed;
  }

  /* Stanley's aurora, docked along the bottom edge behind the window. */
  .aurora {
    position: absolute; left: 6%; right: 6%; bottom: -34%; height: 62%; border-radius: 50%; filter: blur(9px);
    background: linear-gradient(90deg, #4fd1a5, #8a7cf0 55%, #e07cc8);
  }
  .dark .aurora { opacity: 0.55; }
  .light .aurora { opacity: 0.45; }

  /* The status bar's pills. */
  .pills { position: absolute; top: 7%; left: 6%; right: 6%; display: flex; justify-content: space-between; }
  .pills i { display: block; width: 14%; height: 5px; border-radius: 3px; }
  .pills i:last-child { width: 22%; }
  .dark .pills i { background: rgba(255, 255, 255, 0.1); }
  .light .pills i { background: rgba(255, 255, 255, 0.85); box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.06); }

  /* The window: glass, a title, two rows. */
  .win {
    position: absolute; left: 25%; right: 25%; top: 22%; bottom: 18%; border-radius: 6px;
    display: flex; flex-direction: column; gap: 5px; padding: 9% 8%;
  }
  .dark .win { background: rgba(30, 30, 33, 0.88); box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, 0.12), 0 4px 12px rgba(0, 0, 0, 0.5); }
  .light .win { background: rgba(255, 255, 255, 0.92); box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.1); }
  .win i { display: block; height: 5px; border-radius: 3px; }
  .win .title { width: 42%; height: 7px; margin-bottom: 3px; }
  .win .row { width: 100%; }
  .win .row.short { width: 70%; }
  .dark .win .title { background: rgba(236, 236, 238, 0.75); }
  .dark .win .row { background: rgba(255, 255, 255, 0.12); }
  .light .win .title { background: rgba(28, 28, 30, 0.75); }
  .light .win .row { background: rgba(0, 0, 0, 0.08); }

  /* iOS's round check under the label. */
  .tick {
    display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%;
    border: 1.5px solid var(--tertiary); color: var(--on-accent);
    transition: background var(--dur-fast), border-color var(--dur-fast);
  }
  .theme:hover .tick { border-color: var(--muted); }
  .theme[aria-checked='true'] .tick { background: var(--accent); border-color: var(--accent); }
</style>
