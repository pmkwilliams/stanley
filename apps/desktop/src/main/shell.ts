import type { World } from '@stanley/agent'
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
  private history: string[] = []

  constructor(
    private apps: AppModule<any>[],
    private ctx: AppContext,
    private onChange: () => void,
  ) {}

  tree(): AgentNode {
    return {
      id: 'home',
      kind: 'location',
      label: 'home',
      children: this.apps.map((app) => {
        const state = this.surfaces.get(app.id)
        return {
          id: app.id,
          kind: 'location',
          label: app.title,
          description: `Open the ${app.description}`,
          children: state === undefined ? [] : prefix(app.id, app.nodes(state)),
        }
      }),
    }
  }

  currentNodeId(): string {
    if (!this.focus) return 'home'
    const app = this.app(this.focus)
    return `${app.id}${SEP}${app.current(this.surfaces.get(app.id))}`
  }

  now() {
    if (!this.focus) {
      const list = this.apps.map((a) => `- ${a.title}: ${a.description}`).join('\n')
      return { surfaceTitle: 'Home', surfaceMarkdown: `# Home\n${list}`, visible: this.layout.visible === null }
    }
    const app = this.app(this.focus)
    return {
      surfaceTitle: app.title,
      surfaceMarkdown: app.toMarkdown(this.surfaces.get(app.id)),
      visible: this.layout.visible === this.focus,
    }
  }

  async perform(node: AgentNode, args: ActionArgs) {
    const sep = node.id.indexOf(SEP)
    if (sep === -1) return this.open(node.id)
    return this.performIn(node.id.slice(0, sep), node.id.slice(sep + 1), args)
  }

  async global(option: 'show' | 'home' | 'back') {
    if (option === 'show') this.layout = { visible: this.focus }
    if (option === 'home') this.navigate(null)
    if (option === 'back') {
      this.history.pop()
      this.focus = this.history.at(-1) ?? null
    }
    this.onChange()
  }

  /** Open (or switch to) an app's surface. `null` = home. */
  async open(appId: string | null) {
    if (appId === null) {
      this.navigate(null)
      this.onChange()
      return { summary: 'Went home' }
    }
    const app = this.app(appId)
    if (!this.surfaces.has(appId)) this.surfaces.set(appId, await app.init(this.ctx))
    this.navigate(appId)
    this.onChange()
    return { summary: `Opened ${app.title}`, observation: app.toMarkdown(this.surfaces.get(appId)) }
  }

  async performIn(appId: string, nodeId: string, args: ActionArgs) {
    if (!this.surfaces.has(appId)) await this.open(appId)
    const app = this.app(appId)
    const result = await app.perform(this.surfaces.get(appId), nodeId, args, this.ctx)
    this.surfaces.set(appId, result.state)
    this.navigate(appId)
    this.onChange()
    return { summary: result.summary, observation: result.observation }
  }

  private navigate(appId: string | null) {
    this.focus = appId
    if (appId && this.history.at(-1) !== appId) this.history.push(appId)
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
