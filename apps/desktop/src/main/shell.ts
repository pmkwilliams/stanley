import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describeScreen, sameSides, validSides, type AppEntry, type PageDraft, type PageLook, type PagePreview, type PreviewOptions, type Screen, type Sides, type StepResult, type World } from '@stanley/agent'
import { FULLSCREEN, type ActionArgs, type AgentNode, type AppContext, type AppModule, type Layout } from '@stanley/app-sdk'
import { fileUrl, inFolder, viewable } from './folder-pages'

const SEP = ':'

/**
 * What the desktop does with the Web app's page that the app itself doesn't: drawing a page as it
 * is written, a picture of it, and drawing one out of sight.
 */
export interface PageHost {
  /** Serves the page at `path` in the user's folder as it is written, from now until it ends. */
  draft(path: string): { write(content: string): void; end(content: string): void; cancel(): void }
  look(): Promise<PageLook>
  /** Draws the page at `url` in a window of its own, out of sight, and says how it came out. */
  preview?(url: string, opts: PreviewOptions): Promise<PagePreview>
}

export interface ShellOptions {
  /** The user's folder, whose files the app that shows web pages can show: its real path, and its name for people (`~/Wren`). */
  folder?: { root: string; shown: string }
  pages?: PageHost
}

/**
 * Owns surfaces and layout, and exposes them to the agent as one node tree. One surface per app
 * (surface id = app id); up to three of them on the screen at once (see `Sides`).
 */
export class Shell implements World {
  readonly surfaces = new Map<string, unknown>()
  /** What is in front of the user, left to right; none = home screen. */
  private shown: Sides = []
  /** Bumped by every change to `shown`, and by every `arrange` as it starts: one still opening apps is overtaken by any change after it. */
  private revision = 0
  /** Apps put in full screen: they fill the screen whenever they're shown alone and their screen can. */
  private full = new Set<string>()
  /** Surface the agent is working on; may be hidden. `null` = home screen. */
  focus: string | null = null
  /** Screens visited, as `appId:route` (`home` for the home screen), like a browser's history. */
  private history: string[] = ['home']
  /** Per-surface queue: each read-perform-write finishes before the next starts, so none is lost. */
  private queues = new Map<string, Promise<unknown>>()

  constructor(
    private apps: AppModule<any>[],
    private ctx: AppContext,
    private onChange: () => void,
    /** Goes to the lock screen, which ends the session. */
    private onLock?: () => void,
    private opts: ShellOptions = {},
  ) {}

  /** The surface Stanley is working on (which may be hidden): what it reads and its elements. */
  async screen(): Promise<Screen> {
    if (this.focus) await this.refresh(this.focus)
    return this.screenNow()
  }

  /**
   * Reads again an app whose screen changes without it (a live web page). A page reached from the
   * one Stanley is working on goes into the history, as a link would. Returns whether that happened.
   */
  async refresh(appId: string): Promise<boolean> {
    const app = this.app(appId)
    if (!app.refresh || !this.surfaces.has(appId)) return false
    return this.serial(appId, async () => {
      const state = this.surfaces.get(appId)
      const next = await app.refresh!(state, this.ctx)
      if (next === state) return false
      this.surfaces.set(appId, next)
      const moved = app.current(next) !== app.current(state)
      if (moved && this.focus === appId) this.navigate(appId)
      this.onChange()
      return moved
    })
  }

  /** `screen()`, synchronously, as last read: the shell's surfaces are in memory. */
  screenNow(): Screen {
    if (!this.focus) {
      const list = this.appList().map((a) => `- ${a.title}: ${a.description}`).join('\n')
      return { id: 'home', title: 'Home', visible: this.shown.length === 0, markdown: `# Home\n${list}`, elements: [] }
    }
    return this.screenOf(this.focus)
  }

  /** An app's surface as a screen, whether or not Stanley is working on it. */
  screenOf(appId: string): Screen {
    const app = this.app(appId)
    const state = this.surfaces.get(app.id)
    if (state === undefined) return { id: app.id, title: app.title, visible: false, markdown: '', elements: [] }
    return {
      id: `${app.id}${SEP}${app.current(state)}`,
      title: app.title,
      visible: this.shown.flat().includes(app.id),
      url: app.url?.(state),
      markdown: app.toMarkdown(state, this.ctx),
      elements: [...this.windowControls(app, state), ...prefix(app.id, app.nodes(state))],
    }
  }

  get layout(): Layout {
    const alone = this.shown.length === 1 ? this.shown[0]![0]! : null
    return { sides: this.sides(), fullscreen: this.filling(alone) }
  }

  /** What is on the screen, left to right. */
  sides(): Sides {
    return this.shown.map((side) => [...side])
  }

  /** The apps, and the one that shows web pages once it has a page to show. */
  placeable(): AppEntry[] {
    const showing = this.apps.filter((a) => a.openUrl && this.surfaces.has(a.id) && a.url?.(this.surfaces.get(a.id)))
    return [...this.appList(), ...showing.map(({ id, title, description }) => ({ id, title, description }))]
  }

  /**
   * Lays the screen out: these apps, where `sides` puts them. Apps not open yet are opened; what
   * Stanley works on stays the same. Beside another app, none fills the screen. Left as it is when
   * the screen changes while apps open, or `fresh` says the request is stale by then.
   */
  async arrange(sides: Sides, fresh: () => boolean = () => true): Promise<StepResult> {
    if (!validSides(sides)) throw new Error(`The screen can't show ${JSON.stringify(sides)}`)
    const apps = sides.flat().map((id) => this.app(id))
    const mine = ++this.revision
    for (const app of apps) await this.serial(app.id, () => this.ensure(app))
    // Opening an app can take a while (a forecast is fetched): the screen may have changed since, or the request gone stale.
    if (mine !== this.revision || !fresh()) return { summary: 'The screen changed while the apps opened: left as it is' }
    const shown = describeScreen(sides, (id) => this.app(id).title)
    if (sameSides(sides, this.shown)) return { summary: `The screen already shows that: ${shown}` }
    this.show(sides)
    this.onChange()
    return { summary: `Now on the screen: ${shown}` }
  }

  private show(sides: Sides) {
    this.shown = sides.map((side) => [...side])
    this.revision++
  }

  /**
   * Apps Stanley can open. Not the one web pages open in: on its own it shows nothing, and the
   * pages Stanley found or opened are offered to open directly.
   */
  appList(): AppEntry[] {
    return this.apps.filter((a) => !a.openUrl).map(({ id, title, description }) => ({ id, title, description }))
  }

  /** Where the app that shows web pages shows a file from the user's folder, when it is there and can be shown. */
  fileUrl(written: string): string | undefined {
    const path = this.pagePath(written)
    return path && viewable(path) && existsSync(join(this.opts.folder!.root, path)) ? fileUrl(path) : undefined
  }

  /**
   * Puts a web page from the user's folder in front while it is still being written: the app that
   * shows web pages opens it, and it is drawn as it comes. Stopped, the page comes off again, unless
   * an earlier version of it is there to show.
   */
  async draft(written: string): Promise<PageDraft | undefined> {
    const path = this.pagePath(written)
    const { folder, pages } = this.opts
    if (!path || !pages || !/\.html?$/i.test(path)) return undefined
    const host = pages.draft(path)
    // Opened as it is written, not before: a page can't be read until some of it has come.
    const opening = this.openUrl(fileUrl(path), { fresh: true }).then(
      () => this.global('show'),
      () => host.cancel(),
    )
    return {
      write: (content) => host.write(content),
      end: (content) => host.end(content),
      cancel: () => {
        host.cancel()
        void opening.then(async () => {
          if (!existsSync(join(folder!.root, path))) await this.global('back')
        })
      },
    }
  }

  /** Pages the app that shows web pages keeps open, live, besides the one shown. */
  openPages(): { url: string; title: string }[] {
    const app = this.apps.find((a) => a.openUrl)
    return app?.openPages && this.surfaces.has(app.id) ? app.openPages(this.surfaces.get(app.id)) : []
  }

  /** How the web page on screen came out. */
  async look(): Promise<PageLook> {
    return this.opts.pages ? this.opts.pages.look() : { console: [] }
  }

  /** Draws a web page from the user's folder out of sight: the screen stays as it is. */
  async preview(written: string, opts: PreviewOptions = {}): Promise<PagePreview> {
    const path = this.pagePath(written)
    const preview = this.opts.pages?.preview
    if (!preview) throw new Error("Pages can't be drawn out of sight here.")
    if (!path || !/\.html?$/i.test(path) || !existsSync(join(this.opts.folder!.root, path))) throw new Error(`There is no web page "${written}" in the user's folder.`)
    return preview(fileUrl(path), opts)
  }

  /** A path in the user's folder as written, when there is an app to show it in. */
  private pagePath(written: string): string | null {
    const { folder } = this.opts
    if (!folder || !this.apps.some((a) => a.openUrl)) return null
    return inFolder(written, folder.root, folder.shown)
  }

  async perform(node: AgentNode, args: ActionArgs) {
    const sep = node.id.indexOf(SEP)
    return this.performIn(node.id.slice(0, sep), node.id.slice(sep + 1), args)
  }

  async global(option: 'show' | 'home' | 'back') {
    if (option === 'show') this.show(this.focus ? [[this.focus]] : [])
    if (option === 'home') this.navigate(null)
    if (option === 'back') await this.back()
    this.onChange()
  }

  async lock() {
    this.onLock?.()
  }

  /** Open (or switch to) an app's surface. `null` = home. */
  async open(appId: string | null): Promise<StepResult> {
    if (appId === null) {
      this.navigate(null)
      this.onChange()
      return { summary: 'Went to the home screen' }
    }
    const app = this.app(appId)
    return this.serial(appId, async () => {
      await this.ensure(app)
      this.navigate(appId)
      this.onChange()
      return { summary: `Opened ${app.title}`, observation: app.toMarkdown(this.surfaces.get(appId), this.ctx) }
    })
  }

  /** Opens a web page in the app that shows them. */
  async openUrl(url: string, opts?: { fresh?: boolean }): Promise<StepResult> {
    const app = this.apps.find((a) => a.openUrl)
    if (!app) throw new Error('No app opens web pages')
    return this.serial(app.id, async () => {
      await this.ensure(app)
      const result = await app.openUrl!(this.surfaces.get(app.id), url, this.ctx, opts)
      this.surfaces.set(app.id, result.state)
      this.navigate(app.id)
      this.onChange()
      return { summary: result.summary, observation: result.observation, title: result.title }
    })
  }

  async performIn(appId: string, nodeId: string, args: ActionArgs) {
    const app = this.app(appId)
    if (nodeId === FULLSCREEN) return this.toggleFullscreen(app)
    const result = await this.serial(appId, async () => {
      await this.ensure(app)
      const result = await app.perform(this.surfaces.get(appId), nodeId, args, this.ctx)
      this.surfaces.set(appId, result.state)
      this.navigate(appId)
      this.onChange()
      return result
    })
    // A link: the page opens in the app that shows them, as a link in a mail app opens the browser.
    if (result.openUrl && this.apps.some((a) => a.openUrl)) return this.openUrl(result.openUrl)
    return { summary: result.summary, observation: result.observation }
  }

  /**
   * Window controls, ahead of the app's own elements as a title bar is: Full screen, for an app
   * that can fill the screen. It reads as the screen is now: beside another app, nothing fills it.
   */
  private windowControls(app: AppModule<any>, state: unknown): AgentNode[] {
    if (!app.fullscreen?.(state)) return []
    const label = this.filling(app.id) ? 'Exit full screen' : 'Full screen'
    return [{ id: `${app.id}${SEP}${FULLSCREEN}`, kind: 'action', role: 'button', label }]
  }

  /** Full screen shows the app alone, filling the screen; leaving it keeps it alone. */
  private toggleFullscreen(app: AppModule<any>): StepResult {
    const on = !this.filling(app.id)
    if (on) {
      this.full.add(app.id)
      this.show([[app.id]])
    } else this.full.delete(app.id)
    this.navigate(app.id)
    this.onChange()
    return { summary: on ? `${app.title} is full screen` : `${app.title} left full screen` }
  }

  /** The app fills the screen: it is shown alone, put in full screen, and its screen can fill it. */
  private filling(appId: string | null): boolean {
    const alone = this.shown.length === 1 && this.shown[0]![0] === appId
    return appId !== null && alone && this.full.has(appId) && !!this.app(appId).fullscreen?.(this.surfaces.get(appId))
  }

  /** The app's surface exists. A new one is shown to the renderer at once: a live page needs its view in place before it can load. */
  private async ensure(app: AppModule<any>) {
    if (this.surfaces.has(app.id)) return
    this.surfaces.set(app.id, await app.init(this.ctx))
    this.onChange()
  }

  private serial<T>(appId: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(appId) ?? Promise.resolve()).then(fn)
    this.queues.set(appId, run.catch(() => {}))
    return run
  }

  /** Records the screen now in focus, unless it is the one already on top. */
  private navigate(appId: string | null) {
    this.focus = appId
    const here = this.here()
    if (this.history.at(-1) !== here) this.history.push(here)
  }

  private here(): string {
    if (!this.focus) return 'home'
    const app = this.app(this.focus)
    return `${app.id}${SEP}${app.current(this.surfaces.get(app.id))}`
  }

  /**
   * The previous screen, as a browser's back button would go. Within an app it goes back by
   * opening the earlier route (a route is a location node id), so the app's state stays intact.
   */
  private async back() {
    if (this.history.length < 2) return
    this.history.pop()
    const target = this.history.at(-1)!
    if (target === 'home') {
      this.focus = null
      return
    }
    const sep = target.indexOf(SEP)
    const appId = target.slice(0, sep)
    const route = target.slice(sep + 1)
    const app = this.app(appId)
    this.focus = appId
    if (app.current(this.surfaces.get(appId)) !== route) {
      await this.serial(appId, async () => {
        const result = await app.perform(this.surfaces.get(appId), route, {}, this.ctx)
        this.surfaces.set(appId, result.state)
      })
    }
  }

  private app(id: string): AppModule<any> {
    const app = this.apps.find((a) => a.id === id)
    if (!app) throw new Error(`Unknown app ${id}`)
    return app
  }
}

function prefix(appId: string, nodes: AgentNode[]): AgentNode[] {
  return nodes.map((n) => ({ ...n, id: `${appId}${SEP}${n.id}`, children: n.children && prefix(appId, n.children) }))
}
