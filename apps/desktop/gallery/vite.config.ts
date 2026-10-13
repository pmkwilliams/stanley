import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

/** A browser-only stage for the built-in apps: each app's real UI, driven by its real core. See README.md. */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [svelte({ configFile: fileURLToPath(new URL('../svelte.config.js', import.meta.url)) }), tailwindcss()],
  resolve: { alias: { $ui: fileURLToPath(new URL('../../../packages/app-ui/src', import.meta.url)) } },
  server: { port: 5199 },
})
