import { watch, type FSWatcher } from 'node:fs'
import { basename, dirname } from 'node:path'
import { FILES_URL } from '@stanley/app-sdk'
import type { PageLook } from '@stanley/agent'
import { DROPDOWN, EXTRACT, type Extracted, type PageDriver } from '@stanley/browser'
import { nativeImage, type NativeImage, type WebContents } from 'electron'

/** How long a page may take to become readable before Stanley works with what is there. */
const LOAD_MS = 15_000
/** How long to wait for the Web app's view to appear in the window. */
const ATTACH_MS = 10_000
/** A script in the page that doesn't answer in this long has hung. */
const SCRIPT_MS = 5_000
/** Errors a page reported since it loaded, kept for looking at it. */
const MAX_ERRORS = 10
/** How wide a picture of the page is, at most. */
const LOOK_WIDTH = 1280

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * A picture of a view laid on `color` (`#rrggbb`), as the user sees it: where the page is clear, a
 * JPEG would otherwise be black. Its pixels are BGRA, with alpha premultiplied.
 */
function onto(image: NativeImage, color: string): NativeImage {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16))
  const px = image.toBitmap()
  for (let i = 0; i < px.length; i += 4) {
    const clear = 255 - px[i + 3]!
    if (!clear) continue
    px[i] = px[i]! + Math.round((b! * clear) / 255)
    px[i + 1] = px[i + 1]! + Math.round((g! * clear) / 255)
    px[i + 2] = px[i + 2]! + Math.round((r! * clear) / 255)
    px[i + 3] = 255
  }
  return nativeImage.createFromBitmap(px, image.getSize())
}

/** Where an element is, or why it can't be used: run in the page, after scrolling it into view. */
const LOCATE = String.raw`(function (id) {
  var el = document.querySelector('[data-stanley-id="' + id + '"]')
  if (!el) return { error: 'it is no longer on the page' }
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') return { error: 'it is disabled' }
  if (el.scrollIntoViewIfNeeded) el.scrollIntoViewIfNeeded(true); else el.scrollIntoView({ block: 'center' })
  var r = el.getBoundingClientRect()
  var x = r.left + r.width / 2, y = r.top + r.height / 2
  var hit = document.elementFromPoint(x, y)
  var label = hit && hit.closest('label')
  var ok = !hit || hit === el || el.contains(hit) || hit.contains(el) || (label && (label.control === el || label.contains(el)))
  if (!ok) return { error: 'something else is on top of it' }
  return { x: x, y: y }
})`

/** Puts the caret in a field with all of its text selected, so typing replaces it. */
const FOCUS = String.raw`(function (id) {
  var el = document.querySelector('[data-stanley-id="' + id + '"]')
  if (!el) return 'it is no longer on the page'
  el.focus()
  if (typeof el.select === 'function') el.select()
  else if (el.isContentEditable) { var r = document.createRange(); r.selectNodeContents(el); var s = getSelection(); s.removeAllRanges(); s.addRange(r) }
  return ''
})`

/**
 * Listens for the next real input event, to tell whether one reached the page: a hidden web view
 * gets none (Chromium drops mouse and key events for a view out of sight), though it can be read.
 */
const ARM = String.raw`(function () {
  var w = window, types = ['mousedown', 'keydown', 'wheel']
  if (w.__stanleyOff) w.__stanleyOff()
  w.__stanleyGot = false
  var heard = function (e) { if (e.isTrusted) w.__stanleyGot = true }
  types.forEach(function (t) { addEventListener(t, heard, true) })
  w.__stanleyOff = function () { types.forEach(function (t) { removeEventListener(t, heard, true) }); w.__stanleyOff = null }
})()`

const ARRIVED = String.raw`(function () {
  var got = !!window.__stanleyGot
  if (window.__stanleyOff) window.__stanleyOff()
  return got
})()`

/** A click from inside the page, for when real input can't reach it. Links and buttons do what they do. */
const CLICK = String.raw`(function (id) {
  var el = document.querySelector('[data-stanley-id="' + id + '"]')
  if (!el) return 'it is no longer on the page'
  el.click()
  return ''
})`

/** Enter from inside the page: the keys go to the field, and a form the page didn't handle them for is sent. */
const ENTER = String.raw`(function (id) {
  var el = document.querySelector('[data-stanley-id="' + id + '"]')
  if (!el) return 'it is no longer on the page'
  var init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }
  var handled = !el.dispatchEvent(new KeyboardEvent('keydown', init))
  el.dispatchEvent(new KeyboardEvent('keypress', init))
  el.dispatchEvent(new KeyboardEvent('keyup', init))
  if (!handled && el.form) el.form.requestSubmit()
  return ''
})`

/** Typing from inside the page, for a field that didn't take the text: the value as the page's own scripts set it, then the events they listen for. */
const TYPE = String.raw`(function (id, text) {
  var el = document.querySelector('[data-stanley-id="' + id + '"]')
  if (!el) return 'it is no longer on the page'
  if (el.isContentEditable) el.textContent = text
  else {
    var setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    setter.call(el, text)
  }
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return ''
})`

const VALUE = String.raw`(function (id) {
  var el = document.querySelector('[data-stanley-id="' + id + '"]')
  return el ? (el.isContentEditable ? el.textContent : el.value) : null
})`

/** Chooses an option as a person's pick would: the value changes, and the page hears about it. */
const SELECT = String.raw`(function (id, label) {
  var el = document.querySelector('[data-stanley-id="' + id + '"]')
  var option = el && Array.from(el.options).find(function (o) { return (o.textContent || '').trim() === label })
  if (!option) return 'the option is gone'
  el.focus()
  el.value = option.value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return ''
})`

/**
 * The Web app's page: the `<webview>` in the main window, driven from here as Playwright drives a
 * browser. Reading runs the extractor in the page; clicks, typing and scrolling go in through the
 * DevTools protocol, so the page gets the same input events a person's would. The view stays in
 * the window while the Web app is hidden, so Stanley can work on a page in the background.
 */
export class WebviewPage implements PageDriver {
  private wc: WebContents | null = null
  private waiting: ((wc: WebContents) => void)[] = []
  /** What it was last sent to, reloaded into a new view (the renderer reloaded). */
  private url = 'about:blank'
  /** The current navigation's DOM is ready to read. */
  private domReady = true
  /** Inside a load or a step: a navigation now is Stanley's own, not the user's. */
  private steps = 0
  /** Navigations started in the page, to tell whether input led to one. */
  private navigations = 0
  /** Watches the file on screen, when it is one of the user's. */
  private watcher: { path: string; close(): void } | null = null
  /** A reload the watcher is about to make. */
  private reloading?: ReturnType<typeof setTimeout>
  /** Until then, the watcher leaves the page alone: Stanley has just loaded it itself. */
  private quietUntil = 0
  /** What the page reported going wrong since it started loading. */
  private errors: string[] = []
  private muted = false

  constructor(
    private events: {
      /** The page changed by itself or by the user's hand: another page, or a new title. */
      navigated(): void
      /** The file an address shows, when it is one of the user's. */
      fileOf(url: string): string | null
      /** The page at an address is still being written: it is served as it comes, so loading it ends when it is complete. */
      drafting(url: string): boolean
      /** Escape was pressed in the page, which has the keyboard: the window doesn't hear it. */
      escape(): void
      /** What the user sees behind a page at an address where it has no background of its own (the view is clear there). */
      backdrop(url: string): string
    },
  ) {}

  /** Stanley is loading the page or working it. */
  get busy(): boolean {
    return this.steps > 0
  }

  /** Out of sight, a page makes no sound. */
  mute(on: boolean): void {
    this.muted = on
    if (this.wc && !this.wc.isDestroyed()) this.wc.setAudioMuted(on)
  }

  /** The renderer put this tab's view in the window, and it has loaded the blank page it starts with (see `WebviewTabs`). */
  attach(wc: WebContents): void {
    // A link that opens a new window opens here instead, as one tab would.
    wc.setWindowOpenHandler(({ url }) => {
      if (!leaves(wc.getURL(), url)) void wc.loadURL(url)
      return { action: 'deny' }
    })
    // A page from the user's folder can't take what it holds anywhere: it stays among their files.
    wc.on('will-navigate', (e) => {
      if (leaves(wc.getURL(), e.url)) e.preventDefault()
    })
    wc.on('did-start-navigation', (e) => {
      if (!e.isMainFrame) return
      this.navigations++
      if (e.isSameDocument) return
      this.domReady = false
      this.errors = []
    })
    wc.on('before-input-event', (_, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') this.events.escape()
    })
    wc.on('console-message', (e) => {
      if (e.level === 'error' && this.errors.length < MAX_ERRORS) this.errors.push(e.message.length > 300 ? `${e.message.slice(0, 299)}…` : e.message)
    })
    wc.on('dom-ready', () => (this.domReady = true))
    wc.on('did-navigate', () => {
      this.watch(wc)
      this.navigated()
    })
    wc.on('did-navigate-in-page', (_, __, isMainFrame) => isMainFrame && this.navigated())
    wc.on('page-title-updated', () => this.navigated())
    wc.once('destroyed', () => {
      if (this.wc !== wc) return
      this.wc = null
      this.watcher?.close()
      this.watcher = null
    })
    this.wc = wc
    wc.setAudioMuted(this.muted)
    // A view that came back (the renderer reloaded) shows what it showed.
    if (this.url !== 'about:blank') void wc.loadURL(this.url).catch(() => {})
    for (const resolve of this.waiting.splice(0)) resolve(wc)
  }

  /**
   * Goes to `url` and waits until the page can be read. The page already there is reloaded, where
   * it was scrolled to. A page still being written is drawn as it comes, so this returns as soon as
   * it has started.
   */
  async goto(url: string): Promise<void> {
    await this.step(async (wc) => {
      this.url = url
      // Stanley loads it now: the watcher's reload for the same change would only draw it twice.
      clearTimeout(this.reloading)
      this.quietUntil = Date.now() + 1000
      this.domReady = false
      const drafting = this.events.drafting(url)
      const reload = !drafting && wc.getURL() === url
      const failed = await new Promise<Error | null>((resolve) => {
        // A page still being written can be read once it has started: its DOM is ready only at the end.
        const event = drafting ? ('did-navigate' as const) : ('dom-ready' as const)
        const done = (result: Error | null) => {
          clearTimeout(timer)
          wc.off(event as 'dom-ready', ready)
          resolve(result)
        }
        // Not the blank page a view that has just come into the window is still loading.
        const ready = () => (wc.getURL() === 'about:blank' && url !== 'about:blank' ? undefined : done(null))
        const timer = setTimeout(() => done(null), LOAD_MS)
        wc.on(event as 'dom-ready', ready)
        if (reload) return wc.reload()
        // Aborted means another navigation took over (a redirect): that one is the page.
        wc.loadURL(url).then(
          () => done(null),
          (err: Error & { code?: string }) => done(err.code === 'ERR_ABORTED' ? null : err),
        )
      })
      if (failed) throw new Error((failed as Error & { code?: string }).code ?? failed.message)
    })
  }

  /**
   * How the page came out: once it has loaded and its scripts have had a moment to draw, what it
   * reported going wrong and a picture of it. A view out of sight gives no picture.
   */
  async look(): Promise<PageLook> {
    const wc = await this.contents()
    await this.settle()
    const deadline = Date.now() + LOAD_MS
    while (wc.isLoading() && Date.now() < deadline) await sleep(50)
    await sleep(600)
    const errors = [...this.errors]
    const image = await wc.capturePage().catch(() => null)
    if (!image || image.isEmpty()) return { errors }
    const small = onto(image.getSize().width > LOOK_WIDTH ? image.resize({ width: LOOK_WIDTH }) : image, this.events.backdrop(wc.getURL()))
    return { errors, image: { data: small.toJPEG(80).toString('base64'), mediaType: 'image/jpeg' } }
  }

  extract(maxText: number): Promise<Extracted> {
    return this.script(`${EXTRACT}(${JSON.stringify({ maxText })})`)
  }

  async click(id: string): Promise<void> {
    await this.step(async () => {
      const { x, y } = await this.locate(id)
      const reached = await this.real(async () => {
        await this.input('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
        await this.input('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
        await this.input('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
      })
      if (!reached) await this.inPage(CLICK, id)
    })
  }

  async fill(id: string, text: string): Promise<void> {
    await this.step(async () => {
      await this.locate(id)
      await this.inPage(FOCUS, id)
      // Typing over a selection replaces it; with nothing to type, the selection is deleted.
      if (text) await this.input('Input.insertText', { text })
      else await this.script(`document.execCommand('delete')`)
      if ((await this.script<string | null>(`${VALUE}(${JSON.stringify(id)})`)) !== text) await this.inPage(TYPE, id, text)
    })
  }

  async press(id: string, key: 'Enter'): Promise<void> {
    await this.step(async () => {
      await this.locate(id)
      await this.script(`document.querySelector('[data-stanley-id="${id}"]').focus()`)
      const reached = await this.real(() => this.key(key, 13, '\r'))
      if (!reached) await this.inPage(ENTER, id)
    })
  }

  dropdown(id: string): Promise<string[] | null> {
    return this.script(`${DROPDOWN}(${JSON.stringify(id)})`)
  }

  async select(id: string, label: string): Promise<void> {
    await this.step(() => this.inPage(SELECT, id, label))
  }

  async scroll(direction: 'up' | 'down'): Promise<void> {
    await this.step(async () => {
      const { width, height } = await this.script<{ width: number; height: number }>('({ width: innerWidth, height: innerHeight })')
      const by = (direction === 'up' ? -0.8 : 0.8) * height
      const reached = await this.real(() => this.input('Input.dispatchMouseEvent', { type: 'mouseWheel', x: width / 2, y: height / 2, deltaX: 0, deltaY: by }))
      if (!reached) return void (await this.script(`window.scrollBy(0, ${by})`))
      // Wheel scrolling animates.
      await sleep(300)
    })
  }

  /** Waits for what a step started: a page it opened can be read once its DOM is ready. */
  async settle(): Promise<void> {
    await this.step(async () => {
      await sleep(120)
      const deadline = Date.now() + LOAD_MS
      while (!this.domReady && this.wc && Date.now() < deadline) await sleep(50)
    })
  }

  /** Runs `fn` as Stanley's own: navigation it causes isn't the user's. */
  private async step<T>(fn: (wc: WebContents) => Promise<T>): Promise<T> {
    this.steps++
    try {
      return await fn(await this.contents())
    } finally {
      // Navigation events from the step can arrive just after it.
      setTimeout(() => this.steps--, 250)
    }
  }

  /**
   * Sends real input, and tells whether it reached the page. A hidden view gets none; input that
   * started a navigation reached it, though the page that heard it is gone.
   */
  private async real(send: () => Promise<void>): Promise<boolean> {
    const navigations = this.navigations
    await this.script(ARM)
    await send()
    if (this.navigations !== navigations) return true
    return (await this.script<boolean>(ARRIVED).catch(() => true)) || this.navigations !== navigations
  }

  /** Runs one of the scripts above on an element; it answers with why it couldn't, if it couldn't. */
  private async inPage(script: string, ...args: string[]): Promise<void> {
    const error = await this.script<string>(`${script}(${args.map((a) => JSON.stringify(a)).join(', ')})`)
    if (error) throw new Error(`Can't use it: ${error}`)
  }

  private async locate(id: string): Promise<{ x: number; y: number }> {
    const where = await this.script<{ x: number; y: number } | { error: string }>(`${LOCATE}(${JSON.stringify(id)})`)
    if ('error' in where) throw new Error(`Can't use it: ${where.error}`)
    return where
  }

  private async key(key: string, code: number, text?: string): Promise<void> {
    const base = { key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code }
    await this.input('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text && { text, unmodifiedText: text }) })
    await this.input('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }

  private async input(method: string, params: Record<string, unknown>): Promise<void> {
    const wc = await this.contents()
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
    await wc.debugger.sendCommand(method, params)
  }

  private async script<T>(code: string): Promise<T> {
    const wc = await this.contents()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("The page didn't answer")), SCRIPT_MS)))
    try {
      // The frame's own: the web contents' waits for a page to finish loading, and a page being written loads until it is complete.
      return (await Promise.race([wc.mainFrame.executeJavaScript(code, true), timeout])) as T
    } finally {
      clearTimeout(timer)
    }
  }

  /** The view, once the renderer has put it in the window. */
  private contents(): Promise<WebContents> {
    if (this.wc && !this.wc.isDestroyed()) return Promise.resolve(this.wc)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting = this.waiting.filter((w) => w !== got)
        reject(new Error("The Web app's page view isn't in the window"))
      }, ATTACH_MS)
      const got = (wc: WebContents) => {
        clearTimeout(timer)
        resolve(wc)
      }
      this.waiting.push(got)
    })
  }

  private navigated(): void {
    if (!this.busy) this.events.navigated()
  }

  /**
   * While a file of the user's is on screen, it is shown as it is now: changed by Stanley, by a
   * command, or in the user's own editor, it reloads, where it was scrolled to. Editors save by
   * replacing the file, so its folder is watched.
   */
  private watch(wc: WebContents): void {
    const path = this.events.fileOf(wc.getURL())
    if (path === this.watcher?.path) return
    this.watcher?.close()
    this.watcher = null
    if (!path) return
    let watcher: FSWatcher
    try {
      watcher = watch(dirname(path), (_, name) => {
        if (name !== basename(path) || Date.now() < this.quietUntil) return
        clearTimeout(this.reloading)
        this.reloading = setTimeout(() => !wc.isDestroyed() && wc.reload(), 150)
      })
    } catch {
      return
    }
    this.watcher = {
      path,
      close: () => {
        clearTimeout(this.reloading)
        watcher.close()
      },
    }
  }
}

type PageEvents = ConstructorParameters<typeof WebviewPage>[0]

/**
 * The Web app's tabs: a `<webview>` each in its window, each driven by a `WebviewPage` of its own.
 * A view says which tab it is by the address it starts at, `about:blank#tab=<id>`. Only the tab
 * shown is heard; the others keep running, muted.
 */
export class WebviewTabs {
  private pages = new Map<number, WebviewPage>()
  private shown: number | null = null

  constructor(private events: Omit<PageEvents, 'navigated'> & { navigated(tab: number): void }) {}

  /** The driver of tab `id`, made the first time it is asked for: before its view is in the window, it waits for it. */
  page(id: number): WebviewPage {
    let page = this.pages.get(id)
    if (!page) {
      page = new WebviewPage({ ...this.events, navigated: () => this.events.navigated(id) })
      page.mute(id !== this.shown)
      this.pages.set(id, page)
    }
    return page
  }

  /**
   * The renderer put a tab's view in the window. It is driven once it has loaded the blank page it
   * starts with, which names its tab: a page sent to it before then would be cut off by that load.
   */
  attach(wc: WebContents): void {
    const deadline = Date.now() + ATTACH_MS
    const start = () => {
      if (wc.isDestroyed()) return
      const id = Number(/#tab=(\d+)$/.exec(wc.getURL())?.[1])
      if (id && !wc.isLoading()) return this.page(id).attach(wc)
      if (Date.now() < deadline) setTimeout(start, 50)
    }
    start()
  }

  /** The tab now shown: the others are muted. */
  show(id: number | null): void {
    this.shown = id
    for (const [tab, page] of this.pages) page.mute(tab !== id)
  }

  /** How the page in the tab shown came out. */
  look(): Promise<PageLook> {
    return this.shown === null ? Promise.resolve({ errors: [] }) : this.page(this.shown).look()
  }

  /** A new session: its tabs start over. */
  reset(): void {
    this.pages.clear()
    this.shown = null
  }
}

/** Going from a page of the user's files to anywhere else. */
function leaves(from: string, to: string): boolean {
  return from.startsWith(FILES_URL) && !to.startsWith('stanley:')
}
