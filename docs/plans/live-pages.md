# Live pages: web pages Stanley works, and pages it writes

Plan for two things the user asked for: opening any HTML file in the Web app, and having Stanley
write an HTML page (a diagram, a small app), show it, and change it while it's on screen. They are
one mechanism: an HTML file in the user's folder, shown in the Web app, reloaded when it changes.
Writing a page is writing that file; changing it live is editing the file while it is on screen.

Status: all four stages implemented. See **Notes** under each stage for where the code differs from the plan.

## Decisions

- **The page is live.** The Web app's page is a real `<webview>`, read with `packages/browser`'s
  extractor and worked with real input, so Stanley can press, type and scroll on any page: a
  site, a file, a page it wrote. Without this it couldn't tell whether a page it wrote rendered,
  or use the controls on one.
- **Thinking writes pages itself, in its own turn,** so the HTML is in the history and a change
  ("make it blue") is a small edit. A long write isn't thrown away when the user speaks: a Jev
  judge decides whether new words stop thinking or wait for it (stage 3). A background delegate
  for long work can come later; the page tools stay the same.
- **Pages have no network.** A page can read files next to it in the folder but can't reach the
  internet, the same rule as the files sandbox: a prompt-injected page can't send the user's data
  out. Mermaid, Three.js, D3 and Chart.js are bundled, and the usual CDN addresses for them are
  served from the bundle, so pages written the habitual way work.
- **Any file the web view can show opens:** HTML, PDF, images, SVG, video, text.

## 1. Live pages

The Web app's `<webview>` stays in the window while the app is hidden (`kept` in the renderer's
`surfaces.ts`): out of sight (`invisible`, `inert`) but laid out at full size, so a page Stanley
works in the background is still a page, and comes back as it was left. Main drives it:

- `WebviewPage` (`apps/desktop/src/main/page.ts`) is a `PageDriver` over the view's
  `webContents`, which main gets from `did-attach-webview`. It reads by running `EXTRACT` with
  `executeJavaScript`, and clicks, types, presses Enter and scrolls through the DevTools protocol
  (`webContents.debugger`), so the page gets real input events.
- `packages/browser` holds what any driver shares: `PageDriver`, `pageNodes`, `stepOnPage` (a
  step and what visibly changed) and `livePage`, which turns a driver into the `LivePage` apps
  get. `PageWorld` (the website evals) runs on a Playwright driver through the same code.
- The Web app (`app-web/core.ts`) gets the page as `AppContext.page`. Its screen is the page's:
  `nodes` are the page's elements, `toMarkdown` its text. A link pressed, a form sent or a redirect
  that lands on another page becomes the next page in its history, so `back` works across them.
  Without a live page (tests, the demo evals) it reads pages through Parallel, as before.
- `AppModule.refresh` reads a live screen again: the shell calls it before every `screen()`, and
  main calls it when the page navigates or retitles by itself. A page the user went to themselves
  goes into the conversation as their own step.
- Pages Stanley or the user opened are known pages, offered as `open page: <title>` like pages a
  search found, so Stanley can go back to one from another app. (Offering the Web app itself,
  "open Web", misled Jev: in `show-from-a-page` it reopened the old page instead of finding the
  new one, 0/6.)

**Notes**
- Chromium drops mouse and key input for a view that is out of sight, though it can still be
  read. Each input checks whether a real event reached the page (a capture listener, or a
  navigation it started); when none did, the step is done from inside the page instead: `click()`,
  Enter as key events plus `requestSubmit()` when the page didn't handle them, scrolling with
  `scrollBy`. Typing works hidden (`Input.insertText`); a field that didn't take the text gets it
  through its value setter and `input` / `change` events.
- The view is hardened in `will-attach-webview`: no preload, no Node, context isolation, sandbox,
  and opaque, so a page with no background is white as in a browser. Links that open a new window
  open in the view instead.
- Verified in the built app against a local shop page: open by address, type a search and press
  Enter, go back, follow a link, press a button (its result read back), a link the user clicked
  themselves taken into the history, and a link followed while the Web app was hidden.

### Tabs (added after stage 4)

Pages stay live when Stanley opens another: each is a tab, its own `<webview>` in the Web window,
stacked, the one shown in sight and the rest running out of sight, muted. There is no tab bar and
nothing to click: a tab is known by its page's title (and its site or file path), and Stanley goes
back to one by opening its page again.

- **When a tab is made.** Stanley opening a page, writing one, or opening a file makes a new tab;
  following a link stays in the tab. Opening a page that a tab already shows switches to that tab,
  as it was left, with no reload. Opening the page shown again reloads it; so does opening a page
  `fresh` (`World.openUrl(url, { fresh: true })`), which a page just written or drawn asks for.
- **At most six** (`MAX_TABS`): opening one more closes the one shown longest ago. Its page stays
  a known page, and going back to it opens it in a new tab.
- **State.** `WebState.pages` each name their tab; `tabs` is the tabs kept, most recently shown last,
  with the page each shows; `ready` is the next tab's id. Its view is put in the window before it is
  needed, so a page can load at once, which a page being drawn needs.
- **Views and drivers.** The renderer lays out a view per tab plus the ready one, in the order they
  were made (moving a `<webview>` in the page reloads it). A view starts at `about:blank#tab=<id>`,
  which `WebviewTabs` (main) reads to give it its tab's `WebviewPage`. `AppContext.pages.tab(id)` is
  that tab's live page. Main mutes every tab but the one shown, and looks at the one shown.
- **For the agent.** Pages kept open (`World.openPages`) are offered as `open page: <title>`,
  described as "kept open", with the pages Stanley found or opened; files come as `open file:`.
- Verified in the built app, driving the shell directly (the AI Gateway was out of credits, so no
  model run): text typed into a page's field was still there after opening two other pages and
  going back to it, with no reload; tabs out of sight were muted; `back` switched tabs; a page drawn
  as it was written opened in a new tab and left the others live.

## 2. Local files

A protocol, `stanley://files/<path>`, serves the user's folder and nothing else, with a policy
header (CSP) that lets a page load what is in the folder and the bundled libraries but nothing
from the network, and navigation out of the folder blocked. `stanley://lib/…` serves the bundled
libraries; requests to their usual CDN addresses are answered from the bundle.

- Jev gets `open file: <path>` next to `read file:` for files the web view can show. It is
  navigation, so it can run while the user is still talking.
- Thinking's `open_page` takes a path in the folder as well as an address.
- Main watches the file on screen; when it changes (Stanley, bash, or the user's own editor), the
  view reloads, keeping its scroll position.

**Notes**
- `folder-pages.ts` serves both hosts. Files are served from their real path, so a symlink out of
  the folder, a hidden file or `..` gets a 404. A folder shows its `index.html`, or a list of what
  is in it. Media files answer range requests, so video seeks.
- The policy (`PAGE_CSP`) is sent with HTML and SVG: `default-src stanley: data: blob:`, inline
  and eval'd scripts allowed, forms only to the folder. Leaving the folder is stopped in the view:
  `will-navigate`, and a new window from a folder page, to anything but `stanley:` is refused.
- CDN addresses are rewritten in the files the page loads from the folder (HTML, JS, SVG), not
  intercepted on the network: jsDelivr and unpkg (any version, any path, `+esm`), esm.sh, cdnjs and
  d3js.org, for `mermaid`, `three` (with `three/addons/` as `examples/jsm/`), `d3` and `chart.js`.
  The served version is the bundled one whatever version the address names. D3 and Chart.js have
  no browser ES module of their own, so `+esm` is a module made from the classic build.
- Jev's `open file:` is a `page` target (`World.fileUrl` gives the address), so it runs, reads and
  is recorded as opening a page does. `open_page` takes a path the way a person or a model writes
  one: relative, `./`, `~/Stanley/…` or absolute.
- A PDF shows in Chromium's viewer (`plugins` on the view), but the extractor can't read inside it:
  Stanley sees an empty page.
- Not covered by the policy: WebRTC can still reach a STUN server.
- Verified in the built app: a page loading all four libraries by CDN address and a CSV beside it
  (all rendered), the page reloading when its file changed on disk, a page's fetch, image and
  redirect out all blocked, and a PDF opened by Jev from "show me the quarterly report pdf".

## 3. Stop or hold

Today any new words abort thinking (`agent.ts`, `request`). Instead, a Jev question judges words
said while thinking works, like the barge-in judge does for words said while Stanley talks:

- **stop**: they take back or change what thinking is doing ("stop", "don't", "no, the other
  one"): abort, and re-decide with everything they said.
- **hold**: they add to it or ask something else ("and make it blue"): thinking finishes, then
  Jev handles the words with its result in the history.
- **elsewhere**: not said to Stanley: ignored.

Thinking keeps going until the judge is sure, with thresholds like `BargeInConfig`'s.

**Notes**
- Only whole turns (`run`) are judged. A single step thinking decides (what to type, whether to
  press Send) depends on exactly the user's words, so new words still drop it at once.
- The question gets the conversation, what thinking is doing right now (its latest step: a
  search, a command, a page being written) and the words said since the decision it is working
  on. P(stop) at `config.working.stop` (0.5) aborts the turn; below, it finishes first and the
  deferred tick decides on the words. Verdicts come back in about 250 ms and are decisive, so
  there is no unsure band. If Jev fails, the turn stops.
- `hold` and `elsewhere` act the same: either way Jev decides on the words afterwards, and can
  decide nothing.
- A turn whose answer hadn't been released (the user paused but hadn't finished) still loses its
  answer to new words, as before: it is said only if the words don't change the turn.
- `pnpm eval:working`: 15 interjections (stop, wait, a correction, a clarification, "and make it
  blue", another question, talking to someone else), 15/15.

## 4. Writing pages

Thinking gets `write_file(path, content)` and `edit_file(path, old, new)` (exact string
replacement), on the user's folder through `FileTools`, so every change is kept and undoable.

- **Streaming.** A page is thousands of tokens: as `write_file`'s input streams, its `content`
  so far is written into the view (`document.write`), so the page draws as it is written. The
  page comes to the front when writing starts; when the call ends the file is saved and loaded.
- **Seeing the result.** After a write or an edit, the page's console errors and a screenshot go
  back to thinking with the tool result, so it can see a diagram that didn't render and fix it.

**Notes**
- Drawing doesn't use `document.write`: the page is served at its own address as a streaming
  response (`drafts.ts`) that the web view parses as it arrives, the way a browser draws a page
  coming slowly over the network. Relative links and the libraries work while it draws, and the
  policy applies. Text is sent up to where an address in it can't still be growing (a closing
  quote, `>` or a space), so CDN addresses are rewritten whole.
- `think.ts` reads `write_file`'s input as it streams (`tool-input-delta`, `parsePartialJson`,
  ten times a second) and hands it to `onDraft`. The agent asks the world for a draft on the first
  piece of an `.html` file (`World.draft`), which comes to the front at once; when the call runs,
  the file is written through `FileTools.write` (kept in the folder's history), the draft ends, and
  the page is opened as written.
- Opening the page on screen again reloads it, where it was scrolled to (`WebviewPage.goto`), and
  the file watcher stays quiet for a second so it doesn't reload it twice.
- `World.look` waits for the page to load and its scripts to draw (600 ms more), then gives the
  console errors since it loaded (uncaught exceptions and blocked requests come through as errors)
  and a JPEG of the view, at most 1280 wide. The result goes to the model as text plus an image
  part (`toModelOutput`).
- `edit_file` replaces `old` once, or everywhere with `all`; text that isn't there, or is there
  more than once without `all`, is an error the model can act on.
- A write cut short (the turn stopped, or the call never ran) takes the page off the screen again,
  unless an earlier version of the file is there.
- Fixed on the way: Electron's `webContents.executeJavaScript` waits for a page to finish loading,
  which a page being written never does until the end, so scripts run through the main frame; a
  new view isn't driven until it has loaded the blank page it starts with, which would otherwise
  cut off the first page sent to it; the extractor handles a document with nothing in it yet; the
  file on screen isn't offered to read or open (Jev kept reading the page's file instead of handing
  "make it blue" to thinking).
- Adding `write_file` and `edit_file` changed what thinking does when Jev picks the wrong field:
  in `files-add-a-line` ("put sunscreen on the Lisbon list", Jev opens Tasks and picks New task)
  thinking stopped looking in the files and asked instead (about 20%, against about 60% on main).
  The write note now says that what the user named may be one of their files (10/12). The tool
  descriptions are short; what a page write does is in the instructions' Pages section, which
  is only for when the user asks for something to look at (the broader first wording made
  `files-answer` worse). `pnpm eval` on the files, web and turn-taking scenarios: as on main or
  better; `files-answer` and `navigate-and-ask` fail on main as often.
- Sonnet often reworks a page after seeing its picture: one rewrite or a few edits, 10 to 20 s
  more. The instructions ask it to fix only what is broken.
- Verified in the built app with real models: "draw me a diagram of the water cycle" draws on screen
  from about 4 s in; Sonnet looked at the picture, fixed oversized arrowheads and overlaps, and was
  done in about 27 s. "And make the arrows blue", said while it drew, was held, then done with one
  `edit_file` (`all`) in about 4 s.

### Stanley's look (added after stage 4)

Pages Stanley writes used to pick their own colours and showed white with no background of their
own. Adapted from T3 Code's guidance for pages it shows in a thread (`HTML_RENDER_THEME_GUIDE` and
`HTML_RENDER_LAYOUT_GUIDE` in pingdotgg/t3code):

- **Tokens.** An `.html` page in `Pages/` is served (and drawn as it is written) with a `<style>`
  holding the shell's tokens from `theme.css` (less the shell-only ones), fonts, and the body's
  background, colour, font and no margin. The font is Inter, as in the shell: its fontsource
  package is served with the libraries and imported into the same layer. Dark is the base and light the `prefers-color-scheme`
  override, which main already sets from the theme, so a page follows a change without reloading.
  It is all in `@layer stanley`, so what the page sets wins wherever it is. The file on disk stays
  as written. Other HTML in the folder is served as it is.
- **Where it goes.** After the doctype and any comments before it: a style before the doctype
  would put the page in quirks mode. While a page streams, the style waits until that is clear.
- **Charts.** `--chart-1…6` replaced the taupe ramp (unused in the shell) with a categorical
  palette: the dataviz skill's reference hues, validated on Stanley's backgrounds (worst adjacent
  CVD ΔE 9.1 light / 8.4 dark). Three light slots are under 3:1 on white, so series are labelled.
- **Instructions.** The Pages section lists the variables and the layout rules kept from T3's: no
  card, border or banner around the whole page; a panel with its own background has 16px of
  padding and `var(--radius)` corners. T3's rules for a frame that grows to its content (fixed
  chart heights, no `100vh`) don't apply to a window of fixed size.
