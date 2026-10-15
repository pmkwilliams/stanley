import { cubicOut } from 'svelte/easing'
import type { TransitionConfig } from 'svelte/transition'

/**
 * Windows move as a tiling window manager's do (Hyprland): when the layout changes, each window on
 * the screen glides from where it was to where it now is, growing or shrinking on the way, and
 * settles with a slight overshoot. A window that leaves shrinks away from where it was, out of the
 * new layout's way. The layout itself changes at once (the grid), and only the windows animate,
 * from a picture of where they were (FLIP: measure, change, invert, play).
 */

/** Hyprland's usual window curve: fast out, a touch past the mark, back. */
export const GLIDE = 'cubic-bezier(0.05, 0.9, 0.1, 1.05)'
export const GLIDE_MS = 450

/** The user asked for less motion: windows change place at once. */
export const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** Where a window is laid out, leaving out any transform it is drawn with (a glide or a pop under way). */
function layoutBox(node: HTMLElement): DOMRect {
  const parent = node.offsetParent as HTMLElement | null
  const at = parent?.getBoundingClientRect()
  const left = (at?.left ?? 0) + (parent?.clientLeft ?? 0) + node.offsetLeft
  const top = (at?.top ?? 0) + (parent?.clientTop ?? 0) + node.offsetTop
  return new DOMRect(left, top, node.offsetWidth, node.offsetHeight)
}

export class Motion {
  private nodes = new Map<string, HTMLElement>()
  private before = new Map<string, DOMRect>()
  /** Each window's glide under way, so a newer one replaces it. */
  private gliding = new Map<string, Animation>()

  /** An attachment for a window: where it is is known while it is in the page. */
  track = (id: string) => (node: HTMLElement) => {
    this.nodes.set(id, node)
    return () => {
      if (this.nodes.get(id) === node) this.nodes.delete(id)
    }
  }

  /** Where the windows on the screen are drawn, just before the layout changes: mid-glide, where they are now. */
  measure(shown: string[]): void {
    this.before = new Map(shown.flatMap((id) => (this.nodes.has(id) ? [[id, this.nodes.get(id)!.getBoundingClientRect()]] : [])))
  }

  /** Once it has changed: every window that was on the screen and still is glides to its new place. */
  play(shown: string[]): void {
    if (still()) return
    for (const id of shown) {
      const node = this.nodes.get(id)
      const from = this.before.get(id)
      if (!node || !from) continue
      // From where it is drawn to where it is laid out: a glide cut short starts again from where it got to.
      this.gliding.get(id)?.cancel()
      const to = layoutBox(node)
      if (!to.width || !to.height || (Math.abs(from.left - to.left) < 1 && Math.abs(from.top - to.top) < 1 && Math.abs(from.width - to.width) < 1 && Math.abs(from.height - to.height) < 1)) continue
      const start = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`
      this.gliding.set(id, node.animate([{ transformOrigin: 'top left', transform: start }, { transformOrigin: 'top left', transform: 'none' }], { duration: GLIDE_MS, easing: GLIDE }))
    }
  }

  /** Where a window was before the layout changed, for one on its way out. */
  was(id: string): DOMRect | undefined {
    return this.before.get(id)
  }
}

/**
 * A Svelte transition for a window leaving the screen: it stays where it was (out of the grid, so
 * the new layout doesn't make room for it) and shrinks and fades away.
 */
export function leave(node: HTMLElement, { from, duration = 320 }: { from?: DOMRect; duration?: number }): TransitionConfig {
  const parent = node.offsetParent?.getBoundingClientRect()
  if (from && parent) {
    // Out of its grid cell first: placed in one, an absolute window is offset from the cell, not the screen.
    Object.assign(node.style, { gridColumn: 'auto', gridRow: 'auto', position: 'absolute', left: `${from.left - parent.left}px`, top: `${from.top - parent.top}px`, width: `${from.width}px`, height: `${from.height}px`, maxWidth: 'none', maxHeight: 'none', margin: '0' })
  }
  // An outro runs t from 1 to 0: eased out, the window lingers, then falls away.
  return { duration: still() ? 0 : duration, easing: cubicOut, css: (t) => `transform: scale(${0.85 + 0.15 * t}); opacity: ${t}` }
}

/** A Svelte transition for a window coming onto the screen: it pops in from a little smaller. */
export function enter(_node: HTMLElement, { duration = 340 }: { duration?: number } = {}): TransitionConfig {
  return { duration: still() ? 0 : duration, easing: cubicOut, css: (t) => `transform: scale(${0.85 + 0.15 * t}); opacity: ${t}` }
}
