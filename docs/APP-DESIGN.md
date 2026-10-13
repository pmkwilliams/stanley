# Built-in apps: design language

Stanley's built-in apps (Email, Lights, Music, Settings, To-do, Weather, Web) are one family. They should feel
like the first-party apps of a modern OS, with macOS Tahoe and iOS as the references: quiet and
content-first, with glass on the outside and calm surfaces inside. Familiar controls, few of them.

The kit that implements this is `@stanley/app-ui`: `kit.css`, which the shell loads globally, holds
tokens and `ui-*` classes, and `Icon.svelte` holds the icon set. Apps use the kit's classes and
tokens. They add scoped CSS only for what is specific to them, like Weather's big temperature or
Music's artwork. To see an app without the shell, use the gallery (`apps/desktop/gallery/README.md`).

## Principles

1. **Content first.** The window is glass, but what's inside it isn't decoration. Nothing goes on
   screen unless it carries information or an action. Don't add borders where spacing will do.
2. **One way to do each thing.** Lists are grouped rows, tabs are a segmented control, text entry is
   a field, and actions are capsule buttons. If two apps need the same thing, they solve it the same way.
3. **Stanley drives it too.** Every screen is also read by the agent as an accessibility tree
   (`nodes()` in each app's core). What the UI shows and what `nodes()` describes must match: the same
   elements, the same labels, the same selected state. Visible text *is* the label. Icon-only buttons
   need an `aria-label` that matches their node's label.
4. **Selection is shared.** Whatever is open or focused (the email being read, the to-do Stanley
   just selected) gets the same highlight (`--selected`, an accent tint) in every app. That way the
   user can always see where Stanley is.
5. **Calm motion.** Hover changes take 120 ms. State changes take 220 ms on `--ease`. Nothing bounces
   and nothing loops, except spinners while something is actually loading.
6. **Both themes, always.** Use only tokens for colour, and check every screen in dark and light. The
   only fixed colours allowed are content colours, like artwork or weather glyphs.

## Window

- The shell draws the glass (`.ui-window`: 22 px radius, blur, hairline border, shadow). Apps never
  draw their own window background, border, or shadow.
- The app root is `<section class="ui-app">`. It has a **fixed size**, so the window never jumps when
  content changes. Widths come in three sizes: `compact` 440 (Settings, Weather), regular 600 (To-do,
  Music), and `wide` 880 (Email: list + reader). Every app is 600 tall. Web is the exception: it
  fills the space the shell allows. The size is clamped to the screen automatically.
- Layout is a **bar** (`.ui-bar`) on top and a **body** (`.ui-body`) that scrolls under it. Split
  views use `.ui-split` with two `.ui-pane`s that each scroll on their own.
- The edge gutter is 20 px. Inside, spacing is on a 4 pt grid: 4, 8, 12, 16, 20, 24, 32.

## Bar

- On the left is the app's name, or the current place, as `.ui-title` (22/700, tight tracking).
  It's the window's only large text, except for hero numbers.
- Controls for the whole screen go on the right: a search field, a segmented control, or a primary
  action. Keep it to at most three items.
- The bar isn't a separate material. It sits directly on the glass, and content scrolls under it.

## Type

Inter, with tabular numerals for anything that counts or ticks (`.ui-num`).

| Token | Size | Use |
|---|---|---|
| `--fs-large` | 28 | Rare: the main heading inside a detail pane (an email subject) |
| `--fs-title` | 22 | Bar title |
| `--fs-headline` | 15 / 600 | Card and empty-state titles, now-playing title |
| `--fs-body` | 14 | Everything by default; row titles at 500 weight |
| 13 | 13 / 500 | Buttons, segmented controls |
| `--fs-footnote` | 12 | Row subtitles, section titles (600, muted), timestamps |
| `--fs-caption` | 11 | Badges only |

Hero numbers (a temperature, a clock) can be as large as they need to be at weight 200 to 300, with
negative tracking. Text uses three emphasis levels: `--text`, `--muted`, and `--tertiary`.
Don't use opacity to dim text.

## Lists

- The standard is the **inset grouped list**: `.ui-group` (a background tint with 14 px radius and
  4 px inset) holding `.ui-row`s (44 px minimum, 10 px radius). Rows are separated by hairlines that
  are inset to the text and disappear next to a hovered or selected row.
- Each row has up to three parts: `.ui-row-lead` (an icon, check, or artwork, 22 px or more),
  `.ui-row-main` (a `.ui-row-title`, plus a `.ui-row-sub` if needed), and `.ui-row-trail` (muted
  metadata like a time, count, or chevron).
- If a row is clickable, the row is a `<button class="ui-row">` (or contains one that fills it).
  Secondary row actions, like delete, are small plain icon buttons with `.ui-reveal`: they only show
  on hover or selection. They aren't hidden from the agent, because they're always in `nodes()`.
- Selected or open rows get `.selected` or `aria-selected` / `aria-current`.
- Use `.ui-section-title` above a group for a section name. Use `.ui-section-footer` below a group
  for a sentence of explanation.
- Unread state, as in Email, is a `.ui-dot` in the lead plus a 600-weight title. It isn't bold everywhere.

## Controls

- **Buttons** (`.ui-btn`) are capsules on a translucent fill. `.primary` (accent) is for the single
  action the screen exists for, like Send or Add, and there's at most one per screen. `.plain` is for
  low emphasis, `.danger` is for destructive text, and `.icon` makes a circular icon-only button
  (it needs an `aria-label`). Sizes are `.small` (26), the default (32), and `.large` (44, for media transport).
  Related actions sit together in a `.ui-btn-group`.
- **Segmented control** (`.ui-segmented`): use it for switching between views of one app, like
  Inbox / Sent / Archived or Dark / Light. The selected segment is a raised thumb.
- **Fields** (`.ui-field`): a `<label>` that wraps an optional leading icon and the `<input>`. Search
  fields add `.search` (capsule) and lead with the `search` icon. Multi-line fields (like a reply)
  use `.multiline`. Focus shows an accent ring. The placeholder says what to type ("Search for a
  city", "New to-do"). It doesn't explain the app.
- **Checks** (`.ui-check`) are round, like Reminders. **Switches** (`.ui-switch`) are for settings
  that take effect immediately.
- **Progress** (`.ui-progress` on `<progress>`): a thin capsule track.

## Icons

Use `<Icon name="…" />` from `@stanley/app-ui/Icon.svelte`. All icons are drawn on a 24-unit grid
with a 1.75 stroke and round joins. Media transport icons are solid. Sizes are 20 in bars and
buttons, 16 to 18 inside rows, and 32 to 40 in empty states. Never use emoji or Unicode symbols as
icons. If an icon is missing, add it to `icons.ts` in the same style.

## States

- **Empty** (`.ui-empty`): a tertiary-coloured icon, a one-line title, and a line saying what will
  fill this space or how to fill it. Mention Stanley where that's the natural way, e.g. "Ask Stanley
  to open a page."
- **Loading**: `.ui-spinner` next to a muted line, in the place where the content will appear. Don't
  blank the screen.
- **Error**: `.ui-notice`, inline and close to whatever failed. It says what happened, in plain words.

## Voice

Labels are short, use sentence case, and are written as verbs for actions ("Archive", "Send reply").
Counts appear as badges or trailing numbers, not in parentheses. If a label changes, the matching
`nodes()` label changes with it. Agent evals and tests may refer to it.
