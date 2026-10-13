import type { Theme } from '@stanley/app-settings/core'

/** The theme on screen. Main owns it (it's set in the Settings app); this follows the snapshot. */
export const theme = $state({ current: 'dark' as Theme })

/** Sets `data-theme` on the root, which app.css keys its colors on. */
export function setTheme(t: Theme) {
  theme.current = t
  document.documentElement.dataset.theme = t
}
