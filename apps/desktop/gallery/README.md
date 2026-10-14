# App gallery

A browser-only stage for the built-in apps: each app's real Svelte UI, driven by its real core, on the
shell's wallpaper and window glass. For designing and checking apps without the Electron shell.

```sh
pnpm --filter @stanley/desktop gallery                      # http://localhost:5199
node apps/desktop/gallery/shot.mjs /tmp/shots "app=tasks&theme=dark" "app=tasks&theme=light"
```

Query parameters:

- `app` — `email`, `lights`, `music`, `settings`, `tasks`, `weather`, `web`
- `theme` — `dark` (default) or `light`
- `do` — a node id to perform before showing, repeatable, in order: `do=item/t1`, `do=title|Buy bread`
  (`|` separates the text argument)
- `fixture` — start from a canned state in `fixtures.ts` instead of `init` (e.g. `app=weather&fixture=denver`)
- `log` — show each action's summary in the corner
