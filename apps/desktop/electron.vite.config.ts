import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'electron-vite'

// Workspace packages ship TS source, so they must be bundled rather than externalized.
const bundled = [
  '@stanley/agent',
  '@stanley/browser',
  '@stanley/app-sdk',
  '@stanley/jev',
  '@stanley/stt',
  '@stanley/tts',
  '@stanley/app-tasks',
  '@stanley/app-email',
  '@stanley/app-lights',
  '@stanley/app-weather',
  '@stanley/app-music',
  '@stanley/app-web',
  '@stanley/app-settings',
  '@stanley/app-ui',
  '@stanley/files',
]

/** The app kit's shadcn components import each other through `$ui`. */
const ui = fileURLToPath(new URL('../../packages/app-ui/src', import.meta.url))

export default defineConfig({
  main: {
    build: { externalizeDeps: { exclude: bundled } },
  },
  preload: {
    build: { externalizeDeps: { exclude: bundled } },
  },
  renderer: {
    plugins: [svelte(), tailwindcss()],
    resolve: { alias: { $ui: ui } },
  },
})
