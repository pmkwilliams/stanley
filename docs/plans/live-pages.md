# Live pages: web pages Stanley works, and pages it writes

Plan for two things the user asked for: opening any HTML file in the Web app, and having Stanley
write an HTML page (a diagram, a small app), show it, and change it while it's on screen. They are
one mechanism: an HTML file in the user's folder, shown in the Web app, reloaded when it changes.
Writing a page is writing that file; changing it live is editing the file while it is on screen.

Status: stage 1 implemented. See **Notes** under each stage for where the code differs from the plan.

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
- Once the Web app has a page, it is offered as an app ("open Web"), so Stanley can go back to the
  page from another app.

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

## 3. Stop or hold

Today any new words abort thinking (`agent.ts`, `request`). Instead, a Jev question judges words
said while thinking works, like the barge-in judge does for words said while Stanley talks:

- **stop**: they take back or change what thinking is doing ("stop", "don't", "no, the other
  one"): abort, and re-decide with everything they said.
- **hold**: they add to it or ask something else ("and make it blue"): thinking finishes, then
  Jev handles the words with its result in the history.
- **elsewhere**: not said to Stanley: ignored.

Thinking keeps going until the judge is sure, with thresholds like `BargeInConfig`'s.

## 4. Writing pages

Thinking gets `write_file(path, content)` and `edit_file(path, old, new)` (exact string
replacement), on the user's folder through `FileTools`, so every change is kept and undoable.

- **Streaming.** A page is thousands of tokens: as `write_file`'s input streams, its `content`
  so far is written into the view (`document.write`), so the page draws as it is written. The
  page comes to the front when writing starts; when the call ends the file is saved and loaded.
- **Seeing the result.** After a write or an edit, the page's console errors and a screenshot go
  back to thinking with the tool result, so it can see a diagram that didn't render and fix it.
