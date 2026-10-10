<script lang="ts">
  import { untrack } from 'svelte'
  import type { Snapshot } from '../../shared/ipc'
  import { mic, presence, Settler, STYLES, type Presence, type Style } from './presence'

  /** `docked` moves the wave from the centre of the screen to its bottom edge, under an open window. */
  let { snapshot, docked }: { snapshot: Snapshot; docked: boolean } = $props()

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
    /** One-shot effects, decaying from 1: `exhale` when a task is done, `wobble` when it didn't get that. */
    let exhale = 0, wobble = 0, typing = 0, nextKey = 0

    const resize = () => {
      W = canvas.width = canvas.clientWidth
      H = canvas.height = canvas.clientHeight
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const height = (i: number, u: number, p: Style) => {
      const envelope = Math.exp(-(((u - 0.5) / (p.width * 0.5)) ** 2) * 2.2)
      const phase = i * 1.9 * (1 - p.coherence)
      const t = time * p.speed
      const wave =
        0.55 * Math.sin(u * p.freq * 6.28 + t * (1 + i * 0.25) + phase - flow) +
        0.3 * Math.sin(u * p.freq * 1.7 * 6.28 - t * 0.7 + phase * 2) +
        0.15 * Math.sin(u * p.freq * 3.1 * 6.28 + t * 1.3 + i)
      let a = p.amp * (1 + 0.3 * p.breathe * Math.sin(time * 1.1))
      a += voice * p.voice * 0.09 * (0.65 + 0.35 * Math.sin(u * 13 + time * 9 + i * 1.3))
      a += p.scan * 0.07 * Math.exp(-(((u - scanAt()) / 0.07) ** 2))
      a += p.travel * 0.05 * (0.5 + 0.5 * Math.sin((u * 2.5 - time * 0.8) * 6.28)) ** 6
      a *= 1 + p.pulse * 0.6 * typing
      a += wobble * 0.07 * Math.sin(u * 10 - time * 16) * (u < 0.5 ? 1 : 0.35)
      a += exhale * 0.09
      return envelope * a * (0.6 + 0.4 * wave)
    }
    const scanAt = () => 0.5 + 0.36 * Math.sin(time * 1.7)
    const spot = (x: number, y: number, r: number, blur: number, color: string) => {
      ctx.filter = `blur(${blur}px)`
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
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
      exhale *= Math.exp(-dt * 2)
      wobble *= Math.exp(-dt * 1.6)
      if (time > nextKey) {
        typing = 1
        nextKey = time + 0.08 + Math.random() * 0.22
      }
      typing *= Math.exp(-dt * 14)

      const p = cur
      const base = H * (0.5 + 0.5 * dock)
      const scale = H * (1 + dock * 0.9)
      const mirror = 1 - dock
      const hue = (f: number) => (f < 0.5 ? p.h0 + (p.h1 - p.h0) * f * 2 : p.h1 + (p.h2 - p.h1) * (f - 0.5) * 2)

      ctx.clearRect(0, 0, W, H)
      ctx.globalCompositeOperation = 'lighter'
      for (let i = 4; i >= 0; i--) {
        const top: [number, number][] = []
        const bottom: [number, number][] = []
        for (let x = 0; x <= W + 6; x += 6) {
          const u = x / W
          top.push([x, base - height(i, u, p) * scale])
          bottom.push([x, base + height(i + 0.5, u, p) * scale * 0.7 * mirror])
        }
        const gradient = ctx.createLinearGradient(0, 0, W, 0)
        const alpha = p.alpha * (1 - i * 0.14)
        for (let f = 0; f <= 1; f += 0.125) gradient.addColorStop(f, `hsla(${hue(f) + i * 8},${p.sat}%,${p.lit}%,${alpha * Math.sin(f * Math.PI)})`)

        ctx.filter = `blur(${p.blur * (1 + i * 0.45)}px)`
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.moveTo(0, base)
        for (const [x, y] of top) ctx.lineTo(x, y)
        if (dock > 0.98) {
          ctx.lineTo(W, H + 40)
          ctx.lineTo(0, H + 40)
        } else for (let j = bottom.length - 1; j >= 0; j--) ctx.lineTo(...bottom[j]!)
        ctx.closePath()
        ctx.fill()

        if (i > 0) continue
        // A crisp rim on the front layer gives the glow an edge.
        ctx.filter = 'blur(1px)'
        ctx.strokeStyle = gradient
        ctx.lineWidth = 1.4
        ctx.beginPath()
        top.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
        ctx.stroke()
        if (p.shimmer > 0.05) {
          for (let k = 0; k < 4; k++) {
            const u = 0.2 + 0.6 * ((k * 0.27 + time * 0.09) % 1)
            const glint = Math.max(0, Math.sin(time * 2.3 + k * 2.1)) * p.shimmer
            spot(u * W, base - height(0, u, p) * scale, 5, 6, `hsla(${hue(u)},100%,85%,${glint * 0.8})`)
          }
        }
        if (p.scan > 0.05) {
          const u = scanAt()
          spot(u * W, base - height(0, u, p) * scale, 9, 10, `hsla(${hue(u)},100%,85%,${p.scan * 0.9})`)
        }
      }
      ctx.filter = 'none'
      ctx.globalCompositeOperation = 'source-over'
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
</script>

<canvas bind:this={canvas} data-presence={shown}></canvas>
<p class="caption" class:docked class:on={captioned}>{words}</p>

<style>
  canvas { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0; }
  .caption {
    position: fixed; left: 0; right: 0; top: 36%; z-index: 2; margin: 0; padding: 0 15%;
    text-align: center; font-size: 17px; color: rgba(255, 255, 255, 0.85); text-shadow: 0 1px 12px rgba(0, 0, 0, 0.6);
    pointer-events: none; opacity: 0; transition: opacity 0.4s, top 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), font-size 0.5s;
  }
  .caption.on { opacity: 1; }
  .caption.docked { top: calc(100% - 64px); font-size: 13px; }
</style>
