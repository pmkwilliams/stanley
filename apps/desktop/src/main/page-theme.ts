import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { SCRATCH_DIR } from '@stanley/agent'

/**
 * Stanley's look for the pages it writes: the shell's design tokens as CSS variables on `:root`,
 * dark, or light as `theme.css` has them when the user's theme is (main sets it as the views'
 * `prefers-color-scheme`, so a page follows a change live), and the page's background, text
 * colour and font (Inter, as the shell's) set from them. It is all in a cascade layer, so
 * anything the page sets itself wins, wherever it is.
 */

/** Tokens only the shell uses. */
const SHELL_ONLY = new Set(['--pill', '--player', '--ink', '--halo', '--window-shadow'])

/** The custom properties a block of `theme.css` sets, as declarations. */
function tokens(theme: string, selector: string): string {
  const start = theme.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`theme.css has no ${selector} block`)
  const block = theme.slice(start, theme.indexOf('\n}', start))
  return [...block.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)]
    .filter(([, name]) => !SHELL_ONLY.has(name!))
    .map(([, name, value]) => `${name}:${value}`)
    .join(';')
}

const FONTS = "--font-sans:'Inter Variable',-apple-system,BlinkMacSystemFont,ui-sans-serif,system-ui,sans-serif;--font-mono:ui-monospace,SFMono-Regular,Menlo,monospace"

let style: string | undefined

/** The style put at the top of a page Stanley writes, made from `theme.css` the first time. */
export function pageStyle(): string {
  if (style) return style
  const theme = readFileSync(createRequire(import.meta.url).resolve('@stanley/app-ui/theme.css'), 'utf8')
  style = [
    // Inter, served with the libraries (`LIBS` in folder-pages.ts).
    '<style id="stanley-theme">@import url(stanley://lib/@fontsource-variable/inter/index.css) layer(stanley);@layer stanley{',
    `:root{${tokens(theme, ':root')};${FONTS};color-scheme:dark}`,
    `@media (prefers-color-scheme:light){:root{${tokens(theme, ":root[data-theme='light']")};color-scheme:light}}`,
    'body{margin:0;background:var(--background);color:var(--foreground);font-family:var(--font-sans)}',
    '}</style>',
  ].join('')
  return style
}

/** Pages Stanley writes, which take its look. The user's other pages look as they were written. */
export const themed = (path: string): boolean => /^Pages\/.+\.html?$/i.test(path) || (path.startsWith(`${SCRATCH_DIR}/`) && /\.html?$/i.test(path))

const DOCTYPE = '<!doctype'

/**
 * A page with `pageStyle()` in it: after its doctype and any comments before it, since anything
 * else before the doctype would put the page in quirks mode. A page still being written (`partial`)
 * may not have got that far: until it is clear where the style goes, it is held back (empty).
 */
export function withTheme(html: string, partial = false): string {
  let at = 0
  for (;;) {
    while (at < html.length && /\s/.test(html[at]!)) at++
    const rest = html.slice(at)
    if (rest.startsWith('<!--')) {
      const end = rest.indexOf('-->')
      if (end < 0) return partial ? '' : pageStyle() + html
      at += end + 3
      continue
    }
    const head = rest.slice(0, DOCTYPE.length).toLowerCase()
    if (head === DOCTYPE) {
      const end = rest.indexOf('>')
      if (end < 0) return partial ? '' : pageStyle() + html
      at += end + 1
      break
    }
    // Could still turn out to be a comment or a doctype.
    if (partial && rest.length < DOCTYPE.length && (DOCTYPE.startsWith(rest.toLowerCase()) || '<!--'.startsWith(rest))) return ''
    break
  }
  return html.slice(0, at) + pageStyle() + html.slice(at)
}
