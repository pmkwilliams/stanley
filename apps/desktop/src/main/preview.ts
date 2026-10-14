import { PAGE_SIZE, type PagePreview, type PageSize } from '@stanley/agent'
import { BrowserWindow, nativeImage, type NativeImage, type WebContents } from 'electron'

/** How long a page may take to load before it is looked at as it is. */
const LOAD_MS = 15_000
/** After it loads, how long its scripts get to draw. */
const SETTLE_MS = 600
/** Lines of a page's console kept for looking at it. */
export const MAX_CONSOLE = 30
/** How wide a picture of a page is, at most. */
const PICTURE_WIDTH = 1280
/** The widths a page can be drawn at, in CSS pixels. */
const WIDTH = { min: 320, max: 2560 }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * A line a page printed to its console, as the agent reads it: `error (line 12): …`, `warning: …`,
 * `log: …`. An uncaught exception is an error. Null for Electron's own warnings to developers,
 * which aren't the page's.
 */
export function consoleLine(e: { level: string; message: string; lineNumber?: number }): string | null {
  if (e.message.startsWith('%cElectron Security Warning')) return null
  const level = e.level === 'info' ? 'log' : e.level
  const message = e.message.length > 300 ? `${e.message.slice(0, 299)}…` : e.message
  return `${level}${e.lineNumber ? ` (line ${e.lineNumber})` : ''}: ${message}`
}

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

/** A picture of a page as the user sees it, on what is behind it (`backdrop`), small enough to send to a model. */
export function picture(image: NativeImage | null, backdrop: string): { data: string; mediaType: string } | undefined {
  if (!image || image.isEmpty()) return undefined
  const small = onto(image.getSize().width > PICTURE_WIDTH ? image.resize({ width: PICTURE_WIDTH }) : image, backdrop)
  return { data: small.toJPEG(80).toString('base64'), mediaType: 'image/jpeg' }
}

/**
 * Draws pages from the user's folder out of sight, for background tasks to check the pages they
 * make: one window, never shown, rendered offscreen so a picture can be taken of it. Pages load as
 * the Web app loads them (`stanley://files/…`, in Stanley's look, with no network), at the size a
 * page is shown at now unless asked for another width, light or dark, and the picture is laid on
 * what the user sees behind a page (Stanley's glass, for a page it wrote). One page at a time.
 */
/** How to draw a page: light or dark, at `size` (or `width` wide), on `backdrop` (`#rrggbb`). */
export interface PreviewDraw {
  appearance: 'dark' | 'light'
  width?: number
  size: PageSize
  backdrop: string
}

export class Previewer {
  private win: BrowserWindow | null = null
  private queue: Promise<unknown> = Promise.resolve()
  /** What the page being drawn printed to its console. */
  private console: string[] = []
  /** The last frame drawn, in case a picture can't be taken. */
  private frame: NativeImage | null = null

  preview(url: string, opts: PreviewDraw): Promise<PagePreview> {
    const run = this.queue.then(async () => this.draw(await this.window(), url, opts))
    this.queue = run.catch(() => {})
    return run
  }

  close(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }

  private async window(): Promise<BrowserWindow> {
    if (this.win && !this.win.isDestroyed()) return this.win
    const win = new BrowserWindow({
      show: false,
      width: PAGE_SIZE.width,
      height: PAGE_SIZE.height,
      useContentSize: true,
      // Clear where the page has no background, as the Web app's view is: the picture is laid on the backdrop.
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    })
    const wc = win.webContents
    wc.setAudioMuted(true)
    // A page drawn here stays here: no new windows, no going anywhere but the user's folder.
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    wc.on('will-navigate', (e) => {
      if (!e.url.startsWith('stanley:')) e.preventDefault()
    })
    wc.on('console-message', (e) => {
      const line = consoleLine(e)
      if (line && this.console.length < MAX_CONSOLE) this.console.push(line)
    })
    wc.on('paint', (_e, _dirty, image) => (this.frame = image))
    // The debugger only answers once something has loaded: until then, setting the appearance hangs.
    await wc.loadURL('about:blank')
    this.win = win
    return win
  }

  private async draw(win: BrowserWindow, url: string, opts: PreviewDraw): Promise<PagePreview> {
    const wc = win.webContents
    const width = Math.round(Math.min(WIDTH.max, Math.max(WIDTH.min, opts.width ?? opts.size.width)))
    const height = Math.round(opts.size.height)
    win.setContentSize(width, height)
    await this.appearance(wc, opts.appearance)
    this.console = []
    this.frame = null
    const failed = await load(wc, url)
    if (failed) this.console.push(`error: the page didn't load (${failed})`)
    await sleep(SETTLE_MS)
    const contentHeight = await wc
      .executeJavaScript('Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0))', true)
      .then((h: unknown) => (typeof h === 'number' ? h : height))
      .catch(() => height)
    const image = picture(await wc.capturePage().catch(() => null), opts.backdrop) ?? picture(this.frame, opts.backdrop)
    return { console: [...this.console], ...(image && { image }), width, height, contentHeight, appearance: opts.appearance }
  }

  /** Light or dark, as `prefers-color-scheme` says to the page, whatever the user's theme is now. */
  private async appearance(wc: WebContents, appearance: 'dark' | 'light'): Promise<void> {
    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
      await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: appearance }] })
    } catch (err) {
      console.error('Preview: could not set the appearance', err)
    }
  }
}

/** Loads `url`, giving up waiting after `LOAD_MS`. Why it failed, or null. */
function load(wc: WebContents, url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), LOAD_MS)
    wc.loadURL(url).then(
      () => {
        clearTimeout(timer)
        resolve(null)
      },
      (err: Error & { code?: string }) => {
        clearTimeout(timer)
        resolve(err.code ?? err.message)
      },
    )
  })
}
