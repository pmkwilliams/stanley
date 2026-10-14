<script lang="ts">
  /**
   * "Comet Trail" from Dot Matrix (https://dotmatrix.zzzzshawn.cloud, dotm-3x3-14), ported to Svelte
   * for the status bar; used under its license, which allows use in a product but not redistributing it
   * as a component. A bright dot with a two-dot tail runs clockwise around a 3×3 grid while the centre
   * softly breathes. 6px dots 1px apart make it 20px, the size of the bar's icons.
   */
  import { onMount } from 'svelte'

  let { label }: { label: string } = $props()

  /** The outer ring, clockwise from the top left, as row-major cell indexes. */
  const RING = [0, 1, 2, 5, 8, 7, 6, 3]
  const BASE = 0.06
  const TAIL = [0.92, 0.52, 0.24]
  /** Once round the ring every 1150 ms at speed 1.6, a cell at a time. */
  const STEP_MS = 1150 / 1.6 / RING.length

  let head = $state(0)
  let still = $state(false)

  /** The original's opacity curve: faint values are pulled down so the ring's rest is barely there. */
  function remap(o: number): number {
    if (o <= 0.08) return (o / 0.08) * BASE
    if (o <= 0.34) return BASE + ((o - 0.08) / 0.26) * (0.34 - BASE)
    return o
  }

  function opacity(cell: number): number {
    if (cell === 4) return remap(still ? 0.18 : 0.1 + (head % 2) * 0.08)
    const trail = (head - RING.indexOf(cell) + RING.length) % RING.length
    return remap(trail < TAIL.length ? BASE + TAIL[trail]! * 0.82 : BASE)
  }

  onMount(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)')
    let timer: ReturnType<typeof setInterval> | undefined
    const start = () => {
      clearInterval(timer)
      still = reduce.matches
      head = 0
      if (!still) timer = setInterval(() => (head = (head + 1) % RING.length), STEP_MS)
    }
    start()
    reduce.addEventListener('change', start)
    return () => {
      clearInterval(timer)
      reduce.removeEventListener('change', start)
    }
  })
</script>

<span class="grid size-5 grid-cols-3 gap-px" role="status" aria-label={label} title={label}>
  {#each { length: 9 } as _, cell (cell)}
    <span class="size-1.5 rounded-full bg-current" style:opacity={opacity(cell)}></span>
  {/each}
</span>
