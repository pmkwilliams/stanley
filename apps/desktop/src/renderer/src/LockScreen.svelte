<script lang="ts">
  import { DEFAULT_AGENT_NAME } from '@stanley/app-sdk'
  import { Button } from '@stanley/app-ui/components/button'
  import { clock, date, time } from './clock.svelte'

  /** `name`: what the user calls the assistant; unlocking greets it. */
  let { name = DEFAULT_AGENT_NAME, onunlock }: { name?: string; onunlock: () => void } = $props()

  /**
   * Rims of light just inside the glyphs, as glass catches it: a glint along the top edges and a warmer rim along
   * the bottom, each lit by the fill it sits in. Hard-edged (offsets only, no blur), so the text stays sharp. Offsets
   * are px at the line's font size.
   */
  const FILTERS = [
    { id: 'glass-date', glint: 0.5, rim: 0.5 },
    { id: 'glass-time', glint: 1, rim: 1.25 },
  ]
  /** The fill's colors, most of the way to white: the light the rims catch. */
  const LIGHTEN = '0.35 0 0 0 0.65  0 0.35 0 0 0.65  0 0 0.35 0 0.65  0 0 0 0 1'
  const GLINT = '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.55 0'
  const RIM = '1 0 0 0 0  0 0.88 0 0 0  0 0 0.65 0 0  0 0 0 0.45 0'
</script>

<!--
  See-through: the shell's background and the assistant's aura show behind it.
  The window has no title bar: the lock screen is what you drag it by.
-->
<div class="fixed inset-0 z-10 flex flex-col items-center justify-between pt-[14vh] pb-14 select-none [-webkit-app-region:drag]">
  <svg class="absolute size-0" aria-hidden="true">
    {#each FILTERS as { id, glint, rim } (id)}
      <filter {id} color-interpolation-filters="sRGB">
        <!-- The glyphs as a solid mask: the fill itself is translucent. -->
        <feComponentTransfer in="SourceAlpha" result="glyph"><feFuncA type="linear" slope="1.4" /></feComponentTransfer>
        <feColorMatrix in="SourceGraphic" values={LIGHTEN} result="light" />

        <feOffset in="glyph" dy={glint} result="down" />
        <feComposite in="glyph" in2="down" operator="out" result="top" />
        <feComposite in="light" in2="top" operator="in" />
        <feColorMatrix values={GLINT} result="glint" />

        <feOffset in="glyph" dy={-rim} result="up" />
        <feComposite in="glyph" in2="up" operator="out" result="bottom" />
        <feComposite in="light" in2="bottom" operator="in" />
        <feColorMatrix values={RIM} result="rim" />

        <feMerge>
          <feMergeNode in="SourceGraphic" />
          <feMergeNode in="rim" />
          <feMergeNode in="glint" />
        </feMerge>
      </filter>
    {/each}
  </svg>
  <div class="flex flex-col items-center">
    <p class="glass bg-clip-text text-3xl leading-none font-semibold text-transparent" style="filter: url(#glass-date)">{date(clock.now)}</p>
    <p class="glass mt-1.5 bg-clip-text text-8xl leading-none font-bold tracking-tight text-transparent" style="filter: url(#glass-time)">{time(clock.now)}</p>
  </div>
  <!-- See-through text with a highlight that sweeps across it now and then: a 2.7s sweep, then a 0.6s rest. -->
  <Button
    variant="ghost"
    class="h-auto animate-[lock-shimmer_3.3s_ease-in-out_infinite] rounded-xl bg-linear-100 from-ink/65 from-40% via-ink/95 via-50% to-ink/65 to-60% bg-size-[300%_100%] bg-clip-text px-4 py-2 text-lg font-bold text-transparent [-webkit-app-region:no-drag] hover:bg-transparent hover:text-transparent dark:hover:bg-transparent"
    onclick={onunlock}>Hello, {name}</Button
  >
</div>

<style>
  /*
   * Glass catching the presence's light: tinted blue, amber and green in bands along its glass strips (52°), with
   * light falling on the tops of the glyphs and a streak where the glass catches it. See-through enough to read as
   * glass; the rims (FILTERS) give it its edges.
   */
  .glass {
    --tint: 74%;
    background-image:
      linear-gradient(180deg, rgb(255 255 255 / 0.22), transparent 55%),
      linear-gradient(52deg, transparent 34%, rgb(255 255 255 / 0.3) 41%, transparent 48%),
      linear-gradient(
        52deg,
        color-mix(in srgb, color-mix(in srgb, var(--ink), rgb(110 150 255) 25%) var(--tint), transparent) 5%,
        color-mix(in srgb, var(--ink) var(--tint), transparent) 25%,
        color-mix(in srgb, color-mix(in srgb, var(--ink), rgb(255 170 80) 36%) var(--tint), transparent) 42%,
        color-mix(in srgb, var(--ink) var(--tint), transparent) 58%,
        color-mix(in srgb, color-mix(in srgb, var(--ink), rgb(120 220 160) 20%) var(--tint), transparent) 72%,
        color-mix(in srgb, color-mix(in srgb, var(--ink), rgb(110 150 255) 25%) var(--tint), transparent) 92%
      );
  }
  @keyframes -global-lock-shimmer {
    0% { background-position: 100% 0; }
    82%, 100% { background-position: 0 0; }
  }
</style>
