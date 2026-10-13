<script lang="ts">
  import { untrack } from 'svelte'
  import type { Snapshot } from '../../shared/ipc'
  import { glass } from './glass'
  import { hsl, mic, presence, Settler, STYLES, voiceOut, type Presence, type Style } from './presence'
  import { theme } from './theme.svelte'

  /**
   * `docked` moves the wave from the centre of the screen to its bottom edge, under an open window.
   * Without `captions`, only the wave shows (the lock screen has the clock where they would be).
   */
  let { snapshot, docked, captions = true }: { snapshot: Snapshot; docked: boolean; captions?: boolean } = $props()

  let canvas: HTMLCanvasElement
  const raw = $derived(presence(snapshot))
  let shown = $state<Presence>('off')

  $effect(() => {
    const pane = glass(canvas)
    const settler = new Settler()
    const cur: Style = { ...STYLES.off }
    let W = 0, H = 0
    let time = 0, last = performance.now(), frame = 0
    // Props are read per frame, so the loop is set up once rather than on every change.
    let dock = untrack(() => (docked ? 1 : 0)), voice = 0, flow = 0
    /** Wave phase, accumulated so easing `speed` between states never jumps it (`time * speed` would, more so the longer it runs). */
    let drift = 0
    /** One-shot effects, decaying from 1: `exhale` when a task is done, `wobble` when it didn't get that. */
    let exhale = 0, wobble = 0
    /** Stanley's voice, smoothed. */
    let talk = 0
    /** The theme, eased so switching fades the glass from one to the other. */
    let light = theme.current === 'light' ? 1 : 0

    // The aurora is drawn per pixel into a coarse buffer, then softened and seen through glass on the GPU:
    // soft by construction, and cheap.
    let cell = 4, bw = 1, bh = 1, dpr = 1, image = new ImageData(1, 1)
    const resize = () => {
      W = canvas.clientWidth
      H = canvas.clientHeight
      dpr = devicePixelRatio
      pane.resize(W, H, dpr)
      cell = Math.max(3, Math.ceil(Math.sqrt((W * H) / 70000)))
      bw = Math.max(1, Math.ceil(W / cell))
      bh = Math.max(1, Math.ceil(H / cell))
      image = new ImageData(bw, bh)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const envelope = (u: number, p: Style) => Math.exp(-(((u - 0.5) / (p.width * 0.6)) ** 2) * 2.2)
    const height = (i: number, u: number, p: Style) => {
      const phase = i * 1.9 * (1 - p.coherence)
      const t = drift
      const wave =
        0.55 * Math.sin(u * p.freq * 6.28 + t * (1 + i * 0.25) + phase - flow) +
        0.3 * Math.sin(u * p.freq * 1.7 * 6.28 - t * 0.7 + phase * 2) +
        0.15 * Math.sin(u * p.freq * 3.1 * 6.28 + t * 1.3 + i)
      let a = p.amp * (1 + 0.3 * p.breathe * Math.sin(time * 1.1))
      a += voice * p.voice * 0.09 * (0.65 + 0.35 * Math.sin(u * 13 + time * 9 + i * 1.3))
      a += p.scan * 0.07 * Math.exp(-(((u - scanAt()) / 0.07) ** 2))
      a += p.roll * 0.025 * rollAt(u)
      a += p.travel * 0.05 * (0.5 + 0.5 * Math.sin((u * 2.5 - time * 0.8) * 6.28)) ** 6
      a *= 1 + p.pulse * 0.9 * talk
      a += wobble * 0.07 * Math.sin(u * 10 - time * 16) * (u < 0.5 ? 1 : 0.35)
      a += exhale * 0.09
      return envelope(u, p) * a * (0.6 + 0.4 * wave)
    }
    const scanAt = () => 0.5 + 0.36 * Math.sin(time * 1.7)
    /** The idle roll at `u`: a swell crossing the screen in three seconds, then three seconds' rest offscreen. */
    const rollAt = (u: number) => Math.exp(-(((u - (time % 6) / 3 + 0.4) / 0.2) ** 2))

    /** Color by height up the curtain, as a fraction of its ray length: index `t * LUT_PER_UNIT`. */
    const LUT_PER_UNIT = 48, LUT_SIZE = LUT_PER_UNIT * 2
    /** Lightness taken off the aurora's colors on the light theme. */
    const LIGHT_DEEPEN = 14
    const lut = new Uint8ClampedArray(LUT_SIZE * 3), stops = new Uint8ClampedArray(9)

    const draw = (now: number) => {
      // Moving to a display with another pixel density doesn't resize the canvas, so it's checked here.
      if (devicePixelRatio !== dpr) resize()
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      time += dt
      const ease = (rate: number) => 1 - Math.exp(-dt * rate)

      const next = settler.update(raw, now)
      if (next !== shown) {
        if (next === 'done') exhale = 1
        if (next === 'didnt-get-that') wobble = 1
        shown = next
      }
      const target = STYLES[next]
      for (const k in target) cur[k as keyof Style] += (target[k as keyof Style] - cur[k as keyof Style]) * ease(3.2)
      dock += ((docked ? 1 : 0) - dock) * ease(3.5)
      light += ((theme.current === 'light' ? 1 : 0) - light) * ease(6)
      // Without a level (e.g. injected audio), the VAD alone still shows the wave hearing.
      const level = Math.max(mic.level, snapshot.speaking ? 0.35 : 0)
      voice += (level - voice) * ease(14)
      flow += dt * cur.travel * 3
      drift += dt * cur.speed
      exhale *= Math.exp(-dt * 2)
      wobble *= Math.exp(-dt * 1.6)
      // Quick to rise and a little slower to fall, like a level meter: syllables read as pulses.
      const out = voiceOut.level()
      talk += (out - talk) * ease(out > talk ? 30 : 10)

      const p = cur
      const base = H * (0.5 + 0.5 * dock)
      const scale = H * (1 + dock * 0.9)
      const mirror = 1 - dock
      // Bottom edge → middle → crown, like the green fringe under a red aurora.
      // Colors mix rather than hues sweeping, so green into red passes through a dim warm blend, not blue.
      // On the light theme they're deeper, so they read as color on the pale glass rather than washing out.
      const lit = p.lit - LIGHT_DEEPEN * light
      hsl(p.h0, p.sat, Math.min(90, lit + 18), stops, 0)
      hsl(p.h1, p.sat, lit, stops, 3)
      hsl(p.h2, p.sat, lit + 8, stops, 6)
      for (let j = 0; j < LUT_SIZE; j++) {
        // The bottom color holds only a short fringe; the crown color fills most of the curtain.
        const t = Math.min(1, j / LUT_PER_UNIT)
        const k = t < 0.25 ? 0 : 3, m = t < 0.25 ? t / 0.25 : (t - 0.25) / 0.75
        for (let n = 0; n < 3; n++) lut[j * 3 + n] = stops[k + n]! + (stops[k + 3 + n]! - stops[k + n]!) * m
      }

      const data = image.data
      data.fill(0)
      const drawn = Math.min(1, p.alpha * 1.9 * (1 + exhale * 0.8) * (1 + p.pulse * 0.5 * talk))
      for (let cx = 0; cx < bw; cx++) {
        const u = (cx + 0.5) / bw
        const env = envelope(u, p)
        if (env < 0.01) continue
        // Rays: fine striations wandering over coarse folds; `travel` sweeps them sideways.
        const sway = 1.8 * (1 - p.coherence * 0.5) * Math.sin(u * 6 + drift * 0.25)
        // Incommensurate frequencies, so the rays never settle into a comb.
        const fine = (0.5 + 0.25 * Math.sin(u * 97 + drift * 0.5 + sway * 3 - flow * 2) + 0.15 * Math.sin(u * 151 - drift * 0.35 + sway * 2) + 0.1 * Math.sin(u * 233 + time * 0.6)) ** 2
        const coarse = (0.5 + 0.5 * Math.sin(u * 29 - drift * 0.3 + 1.2 * Math.sin(u * 3 + time * 0.2) - flow)) ** 2
        const folds = 0.5 + 0.3 * Math.sin(u * 11 + drift * 0.2 + sway) + 0.2 * Math.sin(u * 23 - drift * 0.15)
        let rays = 0.35 + 0.65 * (0.6 * fine + 0.4 * coarse)
        rays *= 1 + p.shimmer * 1.4 * Math.max(0, Math.sin(u * 91 + time * 6 + 4 * Math.sin(u * 13 - time))) ** 10
        rays += p.scan * 0.8 * Math.exp(-(((u - scanAt()) / 0.05) ** 2))
        rays *= 1 + p.roll * 0.9 * rollAt(u)
        const bright = drawn * env * rays * (1 + voice * p.voice * 0.35)
        // A curtain, not a mountain: the envelope fades it sideways more than it shortens it.
        const length = Math.max(cell * 2, (height(0, u, p) / env) * scale * 4.2 * (1 - dock * 0.45) * (0.45 + 0.55 * env) * (0.55 + 0.6 * folds + 0.25 * coarse))
        const edge = base - height(2, u, p) * scale * 0.3 * (1 - dock * 0.7)
        const below = cell * 1.5 + mirror * 0.35 * length
        const y0 = Math.max(0, Math.floor((edge - length * 1.7) / cell))
        const y1 = Math.min(bh - 1, Math.ceil((edge + below * 3) / cell))
        for (let cy = y0; cy <= y1; cy++) {
          const d = edge - (cy + 0.5) * cell
          let v: number, j = 0
          if (d >= 0) {
            const t = d / length
            // A bright fringe at the bottom edge, then the tall curtain, fading out at the crown.
            v = 0.9 * Math.exp(-t * 8) + Math.exp(-(((t - 0.5) / 0.42) ** 2)) * (0.3 + 0.7 * rays)
            j = Math.min(LUT_SIZE - 1, (t * LUT_PER_UNIT) | 0)
          } else v = Math.exp(d / (cell * 1.5)) * 0.8 + mirror * 0.12 * Math.exp(d / below)
          const o = (cy * bw + cx) * 4
          data[o] = lut[j * 3]!
          data[o + 1] = lut[j * 3 + 1]!
          data[o + 2] = lut[j * 3 + 2]!
          data[o + 3] = 255 * v * bright
        }
      }
      pane.draw({ image, cell, time, dock, light, style: p, colors: stops })
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      pane.dispose()
    }
  })

  const words = $derived([...snapshot.transcript.finalized, snapshot.transcript.partial].join(' ').trim())
  const captioned = $derived(!!words && (snapshot.utteranceOpen || shown === 'guessing' || shown === 'thinking'))
</script>

<canvas bind:this={canvas} data-presence={shown} class="pointer-events-none fixed inset-0 z-0 size-full"></canvas>
{#if captions}
  <!-- The halo lifts the words off the presence behind them. -->
  <p
    class={[
      'pointer-events-none fixed inset-x-0 z-2 px-[15%] text-center text-foreground opacity-0 transition-[opacity,top,font-size] duration-500 ease-out [text-shadow:0_1px_12px_var(--halo)]',
      docked ? 'top-[calc(100%-4rem)] text-sm' : 'top-[36%] text-lg',
      captioned && 'opacity-100',
    ]}
  >{words}</p>
{/if}
