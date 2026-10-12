<script lang="ts">
  import { clock, date, time } from './clock.svelte'

  let { onunlock }: { onunlock: () => void } = $props()
</script>

<div class="lockscreen">
  <div class="when">
    <p class="date">{date(clock.now)}</p>
    <p class="time">{time(clock.now)}</p>
  </div>
  <button class="unlock" onclick={onunlock}>Press to unlock</button>
</div>

<style>
  /* See-through: the shell's wallpaper and Stanley's aura show behind it. */
  .lockscreen {
    /* The accent, lightened to read on the dark wallpaper. */
    --ink: color-mix(in srgb, var(--accent), white 80%);
    position: fixed; inset: 0; z-index: 10;
    display: flex; flex-direction: column; align-items: center; justify-content: space-between;
    padding: 14vh 0 56px;
    /* The window has no title bar: the lock screen is what you drag it by. */
    -webkit-app-region: drag; user-select: none;
  }
  .when { display: flex; flex-direction: column; align-items: center; color: color-mix(in srgb, var(--ink) 75%, transparent); }
  p { margin: 0; line-height: 1; font-weight: 600; }
  .date { font-size: 30px; }
  .time { margin-top: 6px; font-size: 96px; font-weight: 700; letter-spacing: -0.01em; }

  /* See-through text with a highlight that sweeps across it now and then. */
  .unlock {
    --dim: color-mix(in srgb, var(--ink) 50%, transparent);
    --glint: color-mix(in srgb, var(--ink) 75%, transparent);
    -webkit-app-region: no-drag;
    padding: 8px 16px; font-size: 18px; font-weight: 700; border: 0; border-radius: 10px;
    color: transparent; animation: shimmer 3.3s ease-in-out infinite;
  }
  /* Restated on hover: the global button:hover sets the background shorthand, which would clear it. */
  .unlock, .unlock:hover {
    background: linear-gradient(100deg, var(--dim) 40%, var(--glint) 50%, var(--dim) 60%) 100% 0 / 300% 100%;
    -webkit-background-clip: text; background-clip: text;
  }
  /* A 2.7s sweep, then a 0.6s rest. */
  @keyframes shimmer {
    0% { background-position: 100% 0; }
    82%, 100% { background-position: 0 0; }
  }
</style>
