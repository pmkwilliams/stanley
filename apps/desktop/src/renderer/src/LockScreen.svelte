<script lang="ts">
  import { DEFAULT_AGENT_NAME } from '@stanley/app-sdk'
  import { clock, date, time } from './clock.svelte'

  /** `name`: what the user calls the assistant; unlocking greets it. */
  let { name = DEFAULT_AGENT_NAME, onunlock }: { name?: string; onunlock: () => void } = $props()

  /**
   * Glass catching the colors the presence's glass throws when idle. The fill is tinted in bands along the glass
   * strips (see `p` below), and rims just inside the glyphs, so their edges stay sharp, catch the light of the fill
   * they sit in: along the bottom edges, glowing deeper in, and a fainter glint along the top. The light splits as it
   * bends, red staying at the edge while green and then blue bend further in, so every rim runs from orange and
   * yellow to blue. `scale` is the line's font size over 100px.
   */
  const FILTERS = [
    { id: 'glass-date', scale: 0.3 },
    { id: 'glass-time', scale: 1.04 },
  ]
  /**
   * Each rim: the glyphs less themselves moved by `shift` (up is the bottom edge), softened by `blur`, catching
   * `strength` of the fill's light, warmed or cooled by `tint` (per-channel gains); its light splits the same way, inward.
   */
  const RIMS = [
    { name: 'fringe', shift: -1.25, blur: 0.55, strength: 0.52, tint: [1.15, 0.85, 0.5] },
    { name: 'glow', shift: -4, blur: 1.8, strength: 0.165, tint: [1, 1, 1] },
    { name: 'glint', shift: 1.2, blur: 0.4, strength: 0.28, tint: [1, 1, 1] },
  ]
  /** How much further in each channel bends than the one before: well under the fringe, so neighbours overlap into yellow and cyan. */
  const SPLIT = 0.42
  const px = (n: number, scale: number) => Math.sign(n) * Math.max(0.6, Math.abs(n) * scale)
  /** Color matrices. The rims are built as opaque light on black, so channels can be moved and added. */
  const MASK_TO_GREY = '0 0 0 1 0  0 0 0 1 0  0 0 0 1 0  0 0 0 0 1'
  /** Keeps channel `c` alone, at `strength`. */
  const only = (c: number, strength: number) =>
    [0, 1, 2].map((n) => [0, 1, 2, 3, 4].map((k) => (k === n && n === c ? strength : 0)).join(' ')).join('  ') + '  0 0 0 0 1'
  /** Light back to see-through: as opaque as it is bright (sharpened, so faint light stays faint), so it lays over the glass. */
  const LIGHT_TO_GLASS = '2 0 0 0 0  0 2 0 0 0  0 0 2 0 0  0.6 0.6 0.6 0 0'
</script>

<div class="lockscreen">
  <svg class="defs" aria-hidden="true">
    {#each FILTERS as { id, scale } (id)}
      <filter {id} x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
        <!-- The glyphs as a solid mask: the fill itself is translucent. -->
        <feComponentTransfer in="SourceAlpha" result="glyph"><feFuncA type="linear" slope="4" /></feComponentTransfer>

        {#each RIMS as { name, shift, blur, strength, tint } (name)}
          <feOffset in="glyph" dy={px(shift, scale)} />
          <feComposite in="glyph" operator="out" />
          <feGaussianBlur stdDeviation={px(blur, scale)} />
          <feComposite in2="glyph" operator="in" />
          <feColorMatrix values={MASK_TO_GREY} result="{name}Mask" />
          <feComposite in="SourceGraphic" in2="{name}Mask" operator="arithmetic" k1="1" result="{name}Light" />
          {#each [0, 1, 2] as c (c)}
            <feOffset in="{name}Light" dy={Math.sign(shift) * c * px(SPLIT, scale)} />
            <feColorMatrix values={only(c, strength * tint[c]!)} result="{name}{c}" />
          {/each}
          <feComposite in="{name}0" in2="{name}1" operator="arithmetic" k2="1" k3="1" />
          <feComposite in2="{name}2" operator="arithmetic" k2="1" k3="1" result={name} />
        {/each}
        <feComposite in="fringe" in2="glow" operator="arithmetic" k2="1" k3="1" />
        <feComposite in2="glint" operator="arithmetic" k2="1" k3="1" />
        <feColorMatrix values={LIGHT_TO_GLASS} />
        <feComposite in2="glyph" operator="in" result="lit" />

        <feMerge>
          <feMergeNode in="SourceGraphic" />
          <feMergeNode in="lit" />
        </feMerge>
      </filter>
    {/each}
  </svg>
  <div class="when">
    <p class="date">{date(clock.now)}</p>
    <p class="time">{time(clock.now)}</p>
  </div>
  <button class="unlock" onclick={onunlock}>Hello, {name}</button>
</div>

<style>
  /* See-through: the shell's wallpaper and the assistant's aura show behind it. */
  .lockscreen {
    position: fixed; inset: 0; z-index: 10;
    display: flex; flex-direction: column; align-items: center; justify-content: space-between;
    padding: 14vh 0 56px;
    /* The window has no title bar: the lock screen is what you drag it by. */
    -webkit-app-region: drag; user-select: none;
  }
  .defs { position: absolute; width: 0; height: 0; }

  .when { display: flex; flex-direction: column; align-items: center; }
  /* Glass: tinted blue, amber and green in bands along the presence's glass strips (52°), clear between. */
  p {
    --tint: 70%;
    margin: 0; line-height: 1; font-weight: 600; color: transparent;
    background: linear-gradient(
      52deg,
      color-mix(in srgb, color-mix(in srgb, var(--ink), rgb(110 150 255) 25%) var(--tint), transparent) 5%,
      color-mix(in srgb, var(--ink) var(--tint), transparent) 25%,
      color-mix(in srgb, color-mix(in srgb, var(--ink), rgb(255 170 80) 36%) var(--tint), transparent) 42%,
      color-mix(in srgb, var(--ink) var(--tint), transparent) 58%,
      color-mix(in srgb, color-mix(in srgb, var(--ink), rgb(120 220 160) 20%) var(--tint), transparent) 72%,
      color-mix(in srgb, color-mix(in srgb, var(--ink), rgb(110 150 255) 25%) var(--tint), transparent) 92%
    );
    -webkit-background-clip: text; background-clip: text;
  }
  /* Font sizes are mirrored in FILTERS. */
  .date { font-size: 30px; filter: url(#glass-date); }
  .time { margin-top: 6px; font-size: 104px; font-weight: 700; letter-spacing: -0.01em; filter: url(#glass-time); }

  /* See-through text with a highlight that sweeps across it now and then. */
  .unlock {
    --dim: color-mix(in srgb, var(--ink) 65%, transparent);
    --glint: color-mix(in srgb, var(--ink) 95%, transparent);
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
