/**
 * Where windows sit on the screen (`Layout.sides`). One app is centred, as it always was; two sides
 * are two columns, and a side with one app beside a side with two spans both rows. Each window may
 * grow to its cell: half the width, and half the height when stacked. The screen's own size comes
 * from `--bar-height` and `--caption-height` on an ancestor.
 */

/** The main area's grid for these sides, as classes. */
export function screenGrid(sides: string[][]): string {
  if (sides.length < 2) return ''
  return sides.flat().length === 3 ? 'grid-cols-2 grid-rows-2 gap-6 px-8' : 'grid-cols-2 gap-6 px-8'
}

/** A shown window's cell and the most it may take, as a style; `''` for one app alone. */
export function windowPlace(sides: string[][], id: string): string {
  const s = sides.findIndex((side) => side.includes(id))
  if (sides.length < 2 || s === -1) return ''
  const side = sides[s]!
  const three = sides.flat().length === 3
  const row = side.length === 2 ? `${side.indexOf(id) + 1}` : three ? '1 / span 2' : '1'
  const height = side.length === 2 ? 'calc((100vh - var(--bar-height) - var(--caption-height) - 88px) / 2)' : 'calc(100vh - var(--bar-height) - var(--caption-height) - 64px)'
  return `grid-column: ${s + 1}; grid-row: ${row}; --window-max-width: calc((100vw - 88px) / 2); --window-max-height: ${height};`
}
