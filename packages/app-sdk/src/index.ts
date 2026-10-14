/**
 * Contracts shared by the agent, the desktop shell, and every app package.
 *
 * Apps are headless: all state lives in plain serializable objects owned by the
 * main process, so the agent can drive a surface that is not on screen.
 */

/**
 * How an element behaves. `location` navigates (a link), `action` does something (a button),
 * `input` is a text field, and `group` is a container that only gives its children context.
 */
export type NodeKind = 'location' | 'action' | 'input' | 'group'

/**
 * One element of what is on screen, as an accessibility tree would describe it. Apps must describe
 * their screens the way any app or web page would be seen: the role and the name a person sees,
 * never hints written for the agent. The agent has to work the same way on screens it has never seen.
 */
export interface AgentNode {
  /** Stable within the app, e.g. `email/m3/archive`. The shell prefixes it with the surface id. */
  id: string
  kind: NodeKind
  /** The visible name: button text, aria-label, a field's label or placeholder, a row's text. */
  label: string
  /** What a screen reader calls it: link, button, checkbox, tab, field, row… Defaults from `kind`. */
  role?: string
  /** Secondary visible text or state: a sender and date, "unread", "checked". */
  description?: string
  /** Input nodes: the text currently in the field. */
  value?: string
  /** Scrolled out of view: on the page, but a person would have to scroll to see it. */
  offscreen?: boolean
  /** Elements inside this one, on the same screen. */
  children?: AgentNode[]
  /**
   * Optional hint that pressing this deletes data or reaches other people. The agent judges every
   * button's effect itself, because real apps and web pages never label them; a hint only makes it
   * stricter. The demo apps deliberately leave it unset.
   */
  destructive?: boolean
}

export interface ActionArgs {
  /** For input nodes: the text to put in the field. */
  text?: string
}

export interface ActionResult<S> {
  state: S
  /** Markdown observation appended to the log as a tool result. Omit for pure navigation. */
  observation?: string
  /** One-line summary used once the observation is collapsed out of context. */
  summary: string
  /** `openUrl`: the title of the page that opened. */
  title?: string
  /** A link pressed: the shell opens this address in the app that shows web pages. */
  openUrl?: string
}

/** Values that outlast a session and the app quitting, e.g. settings. */
export interface AppStore {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

/** What the assistant is called until the user names it otherwise (in Settings). */
export const DEFAULT_AGENT_NAME = 'Stanley'

export interface AppContext {
  env: Record<string, string | undefined>
  fetch: typeof fetch
  /** Without one (e.g. in tests), what an app saves lasts only as long as its state. */
  store?: AppStore
  /** What the user calls the assistant. Defaults to `DEFAULT_AGENT_NAME`. */
  agentName?: string
}

export interface AppModule<S = unknown> {
  id: string
  title: string
  description: string
  init(ctx: AppContext): S | Promise<S>
  /** The interactive elements on the app's current screen, rebuilt from state every tick. Only what is visible. */
  nodes(state: S): AgentNode[]
  /** Id of the screen the app is on, e.g. `inbox` or `email/m3`. */
  current(state: S): string
  perform(state: S, nodeId: string, args: ActionArgs, ctx: AppContext): Promise<ActionResult<S>>
  /** What the user would read on the current screen, as markdown. */
  toMarkdown(state: S, ctx?: AppContext): string
  /** Apps that show web pages: the address of the page on screen, if any. */
  url?(state: S): string | undefined
  /** Apps that show web pages: open one by its address. The shell sends every page Stanley opens here. */
  openUrl?(state: S, url: string, ctx: AppContext): Promise<ActionResult<S>>
  /**
   * Whether the current screen can fill the whole screen, over the status bar (e.g. a web page).
   * The shell then gives it a Full screen button, as a window's title bar would.
   */
  fullscreen?(state: S): boolean
}

export function defineApp<S>(app: AppModule<S>): AppModule<S> {
  return app
}

/** Props every app `./ui` Svelte component receives. */
export interface AppUiProps<S> {
  /** Named `data`, not `state`, to avoid clashing with the `$state` rune. */
  data: S
  perform: (nodeId: string, args?: ActionArgs) => void
  /** How loud the app's own sound may be, 0–1: lowered while the assistant talks. */
  volume?: number
  /** What the user calls the assistant. Defaults to `DEFAULT_AGENT_NAME`. */
  agentName?: string
  /** Apps that can fill the screen: whether this one does now. Pressing `FULLSCREEN` toggles it. */
  fullscreen?: boolean
}

/** The node id of the Full screen button the shell adds to apps that can fill the screen. */
export const FULLSCREEN = '@fullscreen'

export interface Surface<S = unknown> {
  id: string
  appId: string
  state: S
}

/** v1: a single visible slot. Later: splits, multiple windows. */
export interface Layout {
  visible: string | null
  /** The visible app fills the whole screen, over the status bar. */
  fullscreen?: boolean
}

/** Flatten a tree depth-first. */
export function walk(nodes: AgentNode[], visit: (node: AgentNode, parent: AgentNode | null) => void, parent: AgentNode | null = null): void {
  for (const node of nodes) {
    visit(node, parent)
    if (node.children) walk(node.children, visit, node)
  }
}
