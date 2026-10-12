<script lang="ts">
  import { untrack } from 'svelte'
  import type { Snapshot } from '../../shared/ipc'
  import { mic, presence, Settler, STYLES, voiceOut, type Presence, type Style } from './presence'

  /**
   * `docked` moves the wave from the centre of the screen to its bottom edge, under an open window.
   * Without `captions`, only the wave shows (the lock screen has the clock where they would be).
   */
  let { snapshot, docked, captions = true }: { snapshot: Snapshot; docked: boolean; captions?: boolean } = $props()

  let canvas: HTMLCanvasElement
  const raw = $derived(presence(snapshot))
  let shown = $state<Presence>('off')

  $effect(() => {
    const ctx = canvas.getContext('2d')!
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

    // The aurora is drawn per pixel into a coarse buffer, then scaled up: soft by construction, and cheap.
    const buffer = document.createElement('canvas')
    const bctx = buffer.getContext('2d')!
    let cell = 4, bw = 1, bh = 1, image = bctx.createImageData(1, 1)
    const resize = () => {
      W = canvas.width = canvas.clientWidth
      H = canvas.height = canvas.clientHeight
      cell = Math.max(3, Math.ceil(Math.sqrt((W * H) / 70000)))
      bw = buffer.width = Math.max(1, Math.ceil(W / cell))
      bh = buffer.height = Math.max(1, Math.ceil(H / cell))
      image = bctx.createImageData(bw, bh)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const envelope = (u: number, p: Style) => Math.exp(-(((u - 0.5) / (p.width * 0.5)) ** 2) * 2.2)
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
      a += p.travel * 0.05 * (0.5 + 0.5 * Math.sin((u * 2.5 - time * 0.8) * 6.28)) ** 6
      a *= 1 + p.pulse * 0.9 * talk
      a += wobble * 0.07 * Math.sin(u * 10 - time * 16) * (u < 0.5 ? 1 : 0.35)
      a += exhale * 0.09
      return envelope(u, p) * a * (0.6 + 0.4 * wave)
    }
    const scanAt = () => 0.5 + 0.36 * Math.sin(time * 1.7)

    /** Color by height up the curtain, as a fraction of its ray length: index `t * LUT_PER_UNIT`. */
    const LUT_PER_UNIT = 48, LUT_SIZE = LUT_PER_UNIT * 2
    const lut = new Uint8ClampedArray(LUT_SIZE * 3), stops = new Uint8ClampedArray(9)
    const hsl = (h: number, s: number, l: number, out: Uint8ClampedArray, o: number) => {
      h = ((h % 360) + 360) % 360
      s /= 100
      l /= 100
      const c = s * Math.min(l, 1 - l)
      const f = (n: number) => {
        const k = (n + h / 30) % 12
        return 255 * (l - c * Math.max(-1, Math.min(k - 3, 9 - k, 1)))
      }
      out[o] = f(0)
      out[o + 1] = f(8)
      out[o + 2] = f(4)
    }

    const draw = (now: number) => {
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
      hsl(p.h0, p.sat, Math.min(90, p.lit + 18), stops, 0)
      hsl(p.h1, p.sat, p.lit, stops, 3)
      hsl(p.h2, p.sat, p.lit + 8, stops, 6)
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
      bctx.putImageData(image, 0, 0)

      ctx.clearRect(0, 0, W, H)
      ctx.imageSmoothingQuality = 'high'
      ctx.filter = `blur(${1 + p.blur * 0.06}px)`
      ctx.drawImage(buffer, 0, 0, bw * cell, bh * cell)
      ctx.filter = 'none'
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  })

  const words = $derived([...snapshot.transcript.finalized, snapshot.transcript.partial].join(' ').trim())
  const captioned = $derived(!!words && (snapshot.utteranceOpen || shown === 'guessing' || shown === 'thinking'))

  /**
   * What Stanley said. A question stays until the user answers it (main clears it); a statement
   * fades once there has been time to read it.
   */
  let saidExpired = $state(false)
  $effect(() => {
    const said = snapshot.said
    saidExpired = false
    if (!said || said.text.trim().endsWith('?')) return
    const timer = setTimeout(() => (saidExpired = true), Math.max(6000, said.text.split(' ').length * 450))
    return () => clearTimeout(timer)
  })
  const saying = $derived(!!snapshot.said && !saidExpired)
</script>

<canvas bind:this={canvas} data-presence={shown}></canvas>
{#if captions}
  <p class="said" class:docked class:on={saying} aria-live="polite">{snapshot.said?.text ?? ''}</p>
  <p class="caption" class:docked class:on={captioned}>{words}</p>
{/if}

<style>
  canvas { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0; }
  .caption {
    position: fixed; left: 0; right: 0; top: 36%; z-index: 2; margin: 0; padding: 0 15%;
    text-align: center; font-size: 17px; color: rgba(255, 255, 255, 0.85); text-shadow: 0 1px 12px rgba(0, 0, 0, 0.6);
    pointer-events: none; opacity: 0; transition: opacity 0.4s, top 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), font-size 0.5s;
  }
  .caption.on { opacity: 1; }
  .said {
    position: fixed; left: 0; right: 0; top: 26%; z-index: 2; margin: 0; padding: 0 18%;
    text-align: center; font-size: 22px; font-weight: 500; line-height: 1.35; color: #fff; text-shadow: 0 1px 16px rgba(0, 0, 0, 0.7);
    pointer-events: none; opacity: 0; transform: translateY(6px);
    transition: opacity 0.4s, transform 0.4s, top 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), font-size 0.5s;
  }
  .said.on { opacity: 1; transform: none; }
  .said.docked { top: auto; bottom: 92px; font-size: 15px; padding: 10px 16px; margin: 0 auto; width: fit-content; max-width: 70%;
    background: rgba(20, 20, 24, 0.72); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; backdrop-filter: blur(20px); }
  .caption.docked { top: calc(100% - 64px); font-size: 13px; }
</style>
