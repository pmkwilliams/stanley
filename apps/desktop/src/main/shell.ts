import type { AppEntry, Screen, StepResult, World } from '@stanley/agent'
import type { ActionArgs, AgentNode, AppContext, AppModule, Layout } from '@stanley/app-sdk'

const SEP = ':'

/**
 * Owns surfaces and layout, and exposes them to the agent as one node tree.
 * v1: one surface per app (surface id = app id) and a single visible slot.
 */
export class Shell implements World {
  readonly surfaces = new Map<string, unknown>()
  layout: Layout = { visible: null }
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
  ) {}

  /** The surface Stanley is working on (which may be hidden): what it reads and its elements. */
  async screen(): Promise<Screen> {
    return this.screenNow()
  }

  /** `screen()`, synchronously: the shell's surfaces are in memory. */
  screenNow(): Screen {
    if (!this.focus) {
      const list = this.apps.map((a) => `- ${a.title}: ${a.description}`).join('\n')
      return { id: 'home', title: 'Home', visible: this.layout.visible === null, markdown: `# Home\n${list}`, elements: [] }
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
      visible: this.layout.visible === app.id,
      markdown: app.toMarkdown(state),
      elements: prefix(app.id, app.nodes(state)),
    }
  }

  appList(): AppEntry[] {
    return this.apps.map(({ id, title, description }) => ({ id, title, description }))
  }

  async perform(node: AgentNode, args: ActionArgs) {
    const sep = node.id.indexOf(SEP)
    return this.performIn(node.id.slice(0, sep), node.id.slice(sep + 1), args)
  }

  async global(option: 'show' | 'home' | 'back') {
    if (option === 'show') this.layout = { visible: this.focus }
    if (option === 'home') this.navigate(null)
    if (option === 'back') await this.back()
    this.onChange()
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
      return { summary: `Opened ${app.title}`, observation: app.toMarkdown(this.surfaces.get(appId)) }
    })
  }

  async performIn(appId: string, nodeId: string, args: ActionArgs) {
    const app = this.app(appId)
    return this.serial(appId, async () => {
      await this.ensure(app)
      const result = await app.perform(this.surfaces.get(appId), nodeId, args, this.ctx)
      this.surfaces.set(appId, result.state)
      this.navigate(appId)
      this.onChange()
      return { summary: result.summary, observation: result.observation }
    })
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
