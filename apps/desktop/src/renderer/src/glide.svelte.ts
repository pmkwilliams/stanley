import { untrack } from 'svelte'
import { Motion } from './motion'

/**
 * Windows glide when the layout changes (motion.ts), for a component laying them out: `layout`
 * says what is on the screen (`key` changes with the layout). Where the windows are is measured
 * before a change reaches the page, and each moves from there once it has. Call it while the
 * component is set up; the windows attach the motion's `track`.
 */
export function glide(layout: () => { key: string; shown: string[] }): Motion {
  const motion = new Motion()
  let was: string[] = []
  $effect.pre(() => {
    void layout().key
    untrack(() => motion.measure(was))
  })
  $effect(() => {
    const { shown } = layout()
    untrack(() => {
      motion.play(shown)
      was = shown
    })
  })
  return motion
}
