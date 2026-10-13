# Built-in apps: design language

Stanley's built-in apps (Email, Lights, Music, Settings, To-do, Weather, Web) are one family. They should feel
like the first-party apps of a modern OS, with macOS Tahoe and iOS as the references: quiet and
content-first, with glass on the outside and calm surfaces inside. Familiar controls, few of them.

Everything is built with **Tailwind CSS v4** utilities and **shadcn-svelte** components, on default
Tailwind scales. The kit is `@stanley/app-ui`:

- `theme.css`: the design tokens (shadcn's semantic colours, radius, font). The shell imports it after Tailwind.
- `components/*`: shadcn-svelte components (`button`, `item`, `empty`, `tabs`, `switch`, `slider`, …)
  plus `app`, the window layout. Import them as `@stanley/app-ui/components/<name>`.
- `Icon.svelte`: the icon set.

To add a shadcn component, run `pnpm dlx shadcn-svelte@latest add <name> --skip-preflight` in
`packages/app-ui`. The copied files are ours: edit them rather than wrapping them. To see an app
without the shell, use the gallery (`apps/desktop/gallery/README.md`).

## Rules

1. **Tailwind utilities, default scales.** Spacing, sizes, type, radius and shadows come from Tailwind's
   defaults (`p-4`, `gap-3`, `text-sm`, `rounded-lg`, `w-150`). No `<style>` blocks, no arbitrary
   pixel values, unless something truly has no utility (an animation's keyframes, a canvas). Fixed
   colours are allowed only for content, like artwork or weather glyphs.
2. **Semantic colours only.** `bg-background`, `text-foreground`, `text-muted-foreground`, `bg-muted`,
   `bg-accent`, `bg-primary`, `text-destructive`, `border` … Both themes come for free; check every
   screen in dark and light anyway. Don't use opacity to dim text.
3. **shadcn first.** If shadcn has it, use it: `Button`, `Item`, `Empty`, `Tabs`, `ToggleGroup`,
   `Switch`, `Checkbox`, `Slider`, `Progress`, `Spinner`, `Badge`, `Alert`, `Input`, `InputGroup`,
   `Textarea`, `Kbd`, `Separator`, `Avatar`. Adjust with `class` when needed.
4. **Stanley drives it too.** Every screen is also read by the agent as an accessibility tree
   (`nodes()` in each app's core). What the UI shows and what `nodes()` describes must match: the same
   elements, the same labels, the same selected state. Icon-only buttons need an `aria-label` that
   matches their node's label.
5. **Selection is shared.** Whatever is open or focused, by the user or by Stanley, is highlighted the
   same way everywhere: `data-selected={true}` on an `Item` (a `bg-primary/20` tint).
6. **Calm motion.** Hovers use the default `transition-colors`; state changes `duration-200`. Nothing
   bounces and nothing loops, except spinners while something is actually loading.

## Shape

| Surface | Radius |
|---|---|
| Window (shell) | `rounded-3xl` (24) |
| Group, card | `rounded-xl` (12) |
| Row in a group | `rounded-lg` (8) |
| Buttons, fields | shadcn defaults (`rounded-lg` / `rounded-md`) |

A shape nested in another's corner is concentric: its radius is the outer one less the inset. Rows
sit 4px inside their group's corners (`p-1`), so they're 12 − 4 = 8. Groups don't sit in the
window's corners (the bar is above them and free space below), so that rule doesn't apply to them:
their radius is in proportion to the window's instead.

## Window

```svelte
<App.Root size="compact">            <!-- compact w-110 · default w-150 · wide w-220 · fill; all h-150 -->
  <App.Bar>
    <App.Title>Weather</App.Title>   <!-- text-xl bold; pushes the bar's controls right -->
    <Button>…</Button>               <!-- at most three controls -->
  </App.Bar>
  <App.Body>…</App.Body>             <!-- scrolls under the bar; px-4 -->
</App.Root>
```

- The shell draws the glass (`appWindow`: `rounded-3xl border bg-card/80 shadow-window backdrop-blur-2xl`).
  Apps never draw their own window background, border, or shadow.
- Sidebar views (Email): `<App.Sidebar>` (the view switcher on top, a list that scrolls) beside
  `<App.Main>`, with no `App.Bar`. The window then frosts lightly (`backdrop-blur-sm`, no tint) and the
  panes tint it: the sidebar `bg-card/50`, the main pane `bg-card/70`. The blur stays on the window, not
  the panes, because a pane can't blur through the window while it fades in.
- Apps have a **fixed size**, so the window never jumps when content changes. Web fills (`size="fill"`).

## Lists

- The standard is the **inset grouped list**: `<App.Group>` (`bg-muted rounded-xl p-1`, a `<ul>`)
  holding `<li>`s with an `<Item.Root size="row">` each. Hairlines between rows are automatic, inset to
  the text, and hide next to a hovered or selected row.
- A row: `Item.Media` (icon, check or artwork), `Item.Content` with `Item.Title` and optional
  `Item.Description`, and `Item.Actions` (muted metadata or small ghost buttons).
- Clickable rows: `<Item.Root size="row" class="hover:bg-accent">` rendering a button via
  `{#snippet child({ props })}<button {...props}>…</button>{/snippet}`, or with a button inside that
  fills it. Secondary actions (delete) are `Button variant="ghost" size="icon-sm"`, shown on
  `group-hover/item:opacity-100`. They're always in `nodes()`.
- `<App.Section title="…" footer="…">` names a group and explains it.
- Unread state (Email) is an `Avatar.Badge` (a small `bg-primary` dot) on the row's avatar plus a `font-semibold` title.

## Type

Inter; `tabular-nums` for anything that counts or ticks.

| Class | Use |
|---|---|
| `text-2xl font-bold` | Rare: the main heading inside a detail pane (an email subject) |
| `text-xl font-bold` | `App.Title` |
| `text-base font-semibold` | Card and empty-state titles, now-playing title |
| `text-sm` | Everything by default; row titles `font-medium` |
| `text-xs` | Row subtitles, section titles (`font-semibold text-muted-foreground`), timestamps |

Hero numbers (a temperature, a clock) can be as large as they need to be (`text-7xl font-extralight
tracking-tighter`).

## Controls

- **Buttons**: shadcn `Button`. `default` (primary) is for the single action the screen exists for,
  like Send or Add, at most one per screen; `secondary` for the rest; `ghost` for low emphasis;
  `destructive` for destructive actions. Icon-only buttons use `size="icon"` (or `icon-sm`, `icon-lg`)
  and need an `aria-label`. Related actions sit in a `ButtonGroup`.
- **Switching views** of one app (Inbox / Sent, Dark / Light): `Tabs.Root` + `Tabs.List` +
  `Tabs.Trigger`, driven by app state.
- **Fields**: `Input`, or `InputGroup` with an `InputGroupAddon` for a leading icon (search). Multi-line:
  `Textarea`. The placeholder says what to type ("Search for a city"). It doesn't explain the app.
- **Checks** are `Checkbox` (`rounded-full` for to-dos, like Reminders). **Switches** are for settings
  that take effect immediately. **Sliders** for levels. **Progress** for playback and loading.

## Icons

Use `<Icon name="…" />` from `@stanley/app-ui/Icon.svelte`: drawn on a 24-unit grid with a 1.75
stroke and round joins; media transport icons are solid. Sizes are 20 in bars and buttons, 16 to 18
inside rows, and 32 to 40 in empty states. Never use emoji or Unicode symbols as icons. If an icon is
missing, add it to `icons.ts` in the same style.

## States

- **Empty**: shadcn `Empty` with an icon in `Empty.Media`, a one-line `Empty.Title`, and an
  `Empty.Description` saying what will fill this space. Mention Stanley where that's the natural way,
  e.g. "Ask Stanley to open a page."
- **Loading**: `Spinner` next to a muted line, where the content will appear. Don't blank the screen.
- **Error**: `Alert variant="destructive"`, inline and close to whatever failed, in plain words.

## Voice

Labels are short, use sentence case, and are written as verbs for actions ("Archive", "Send reply").
Counts appear as badges or trailing numbers, not in parentheses. If a label changes, the matching
`nodes()` label changes with it. Agent evals and tests may refer to it.
