import type { AppEntry, Screen, StepResult, World } from '@stanley/agent'
import { FULLSCREEN, type ActionArgs, type AgentNode, type AppContext, type AppModule, type Layout } from '@stanley/app-sdk'

const SEP = ':'

/**
 * Owns surfaces and layout, and exposes them to the agent as one node tree.
 * v1: one surface per app (surface id = app id) and a single visible slot.
 */
export class Shell implements World {
  readonly surfaces = new Map<string, unknown>()
  /** The app in front of the user; `null` = home screen. */
  private shown: string | null = null
  /** Apps put in full screen: they fill the screen whenever they're shown and their screen can. */
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
  ) {}

  /** The surface Stanley is working on (which may be hidden): what it reads and its elements. */
  async screen(): Promise<Screen> {
    return this.screenNow()
  }

  /** `screen()`, synchronously: the shell's surfaces are in memory. */
  screenNow(): Screen {
    if (!this.focus) {
      const list = this.appList().map((a) => `- ${a.title}: ${a.description}`).join('\n')
      return { id: 'home', title: 'Home', visible: this.shown === null, markdown: `# Home\n${list}`, elements: [] }
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
      visible: this.shown === app.id,
      url: app.url?.(state),
      markdown: app.toMarkdown(state, this.ctx),
      elements: [...this.windowControls(app, state), ...prefix(app.id, app.nodes(state))],
    }
  }

  get layout(): Layout {
    return { visible: this.shown, fullscreen: this.filling(this.shown) }
  }

  /**
   * Apps Stanley can open. Not the one web pages open in: on its own it shows nothing, and the
   * pages Stanley found are offered to open directly.
   */
  appList(): AppEntry[] {
    return this.apps.filter((a) => !a.openUrl).map(({ id, title, description }) => ({ id, title, description }))
  }

  async perform(node: AgentNode, args: ActionArgs) {
    const sep = node.id.indexOf(SEP)
    return this.performIn(node.id.slice(0, sep), node.id.slice(sep + 1), args)
  }

  async global(option: 'show' | 'home' | 'back') {
    if (option === 'show') this.shown = this.focus
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
      return { summary: 'Went home' }
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
  async openUrl(url: string): Promise<StepResult> {
    const app = this.apps.find((a) => a.openUrl)
    if (!app) throw new Error('No app opens web pages')
    return this.serial(app.id, async () => {
      await this.ensure(app)
      const result = await app.openUrl!(this.surfaces.get(app.id), url, this.ctx)
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

  /** Window controls, ahead of the app's own elements as a title bar is: Full screen, for an app that can fill the screen. */
  private windowControls(app: AppModule<any>, state: unknown): AgentNode[] {
    if (!app.fullscreen?.(state)) return []
    const label = this.full.has(app.id) ? 'Exit full screen' : 'Full screen'
    return [{ id: `${app.id}${SEP}${FULLSCREEN}`, kind: 'action', role: 'button', label }]
  }

  private toggleFullscreen(app: AppModule<any>): StepResult {
    const on = !this.full.delete(app.id)
    if (on) this.full.add(app.id)
    this.navigate(app.id)
    this.onChange()
    return { summary: on ? `${app.title} is full screen` : `${app.title} left full screen` }
  }

  private filling(appId: string | null): boolean {
    return appId !== null && this.full.has(appId) && !!this.app(appId).fullscreen?.(this.surfaces.get(appId))
  }

  private async ensure(app: AppModule<any>) {
    if (!this.surfaces.has(app.id)) this.surfaces.set(app.id, await app.init(this.ctx))
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
