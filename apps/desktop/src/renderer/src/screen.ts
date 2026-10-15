/**
 * Where windows sit on the screen (`Layout.sides`). One app is centred, as it always was; two sides
 * are two columns, and a side with one app beside a side with two spans both rows. Side by side,
 * windows fill their cells, 1rem apart and 1rem from the screen's edges: half the width, and half
 * the height when stacked. The screen's own size comes from `--bar-height` and `--caption-height`
 * on an ancestor.
 */

/**
 * The main area's grid and padding for these sides, as classes: it keeps the captions' strip clear,
 * and side by side, 1rem all round, so each tile is exactly as big as the most it may take.
 */
export function screenGrid(sides: string[][]): string {
  if (sides.length < 2) return 'pb-(--caption-height)'
  const grid = sides.flat().length === 3 ? 'grid-cols-2 grid-rows-2' : 'grid-cols-2'
  return `${grid} gap-4 px-4 pt-4 pb-[calc(var(--caption-height)+1rem)]`
}

/**
 * Classes for a shown window: beside others it is a tile and fills its cell, its app with it, so
 * windows sit 1rem apart; alone it keeps its own size.
 */
export function windowTile(sides: string[][]): string {
  return sides.length < 2 ? '' : 'place-self-stretch *:size-full!'
}

/** A shown window's cell and the most it may take, as a style; `''` for one app alone. */
export function windowPlace(sides: string[][], id: string): string {
  const s = sides.findIndex((side) => side.includes(id))
  if (sides.length < 2 || s === -1) return ''
  const side = sides[s]!
  const three = sides.flat().length === 3
  const row = side.length === 2 ? `${side.indexOf(id) + 1}` : three ? '1 / span 2' : '1'
  const height = side.length === 2 ? 'calc((100vh - var(--bar-height) - var(--caption-height) - 3rem) / 2)' : 'calc(100vh - var(--bar-height) - var(--caption-height) - 2rem)'
  return `grid-column: ${s + 1}; grid-row: ${row}; --window-max-width: calc((100vw - 3rem) / 2); --window-max-height: ${height};`
}
