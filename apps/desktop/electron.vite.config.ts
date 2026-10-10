import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'electron-vite'

// Workspace packages ship TS source, so they must be bundled rather than externalized.
const bundled = [
  '@stanley/agent',
  '@stanley/app-sdk',
  '@stanley/jev',
  '@stanley/stt',
  '@stanley/app-todo',
  '@stanley/app-email',
  '@stanley/app-weather',
  '@stanley/app-music',
  '@stanley/app-web',
]

export default defineConfig({
  main: {
    build: { externalizeDeps: { exclude: bundled } },
  },
  preload: {
    build: { externalizeDeps: { exclude: bundled } },
  },
  renderer: {
    plugins: [svelte()],
  },
})
