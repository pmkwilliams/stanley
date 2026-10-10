/**
 * Contracts shared by the agent, the desktop shell, and every app package.
 *
 * Apps are headless: all state lives in plain serializable objects owned by the
 * main process, so the agent can drive a surface that is not on screen.
 */

export type NodeKind = 'location' | 'action' | 'input'

export interface AgentNode {
  /** Stable within the app, e.g. `inbox/msg-3/archive`. The shell prefixes it with the surface id. */
  id: string
  kind: NodeKind
  /** Short human-readable name. Jev sees this as the option name, so make it distinctive. */
  label: string
  /** Extra text that helps Jev tell this option apart from its neighbours. */
  description?: string
  children?: AgentNode[]
  /** Data-changing action that needs a higher confidence bar. */
  destructive?: boolean
  /** Input nodes only: what text_gen should write into the slot. */
  input?: { instructions: string; placeholder?: string }
}

export interface ActionArgs {
  /** Filled by text_gen (agent) or typed by the user (manual input) for input nodes. */
  text?: string
}

export interface ActionResult<S> {
  state: S
  /** Markdown observation appended to the log as a tool result. Omit for pure navigation. */
  observation?: string
  /** One-line summary used once the observation is collapsed out of context. */
  summary: string
}

export interface AppContext {
  env: Record<string, string | undefined>
  fetch: typeof fetch
}

export interface AppModule<S = unknown> {
  id: string
  title: string
  description: string
  init(ctx: AppContext): S | Promise<S>
  /** Children of the app's root node, rebuilt from state every tick. */
  nodes(state: S): AgentNode[]
  /** Id of the node the app is currently "at". */
  current(state: S): string
  perform(state: S, nodeId: string, args: ActionArgs, ctx: AppContext): Promise<ActionResult<S>>
  /** What the user would see, as markdown. Goes into Jev's "Now" block. */
  toMarkdown(state: S): string
}

export function defineApp<S>(app: AppModule<S>): AppModule<S> {
  return app
}

/** Props every app `./ui` Svelte component receives. */
export interface AppUiProps<S> {
  /** Named `data`, not `state`, to avoid clashing with the `$state` rune. */
  data: S
  perform: (nodeId: string, args?: ActionArgs) => void
}

export interface Surface<S = unknown> {
  id: string
  appId: string
  state: S
}

/** v1: a single visible slot. Later: splits, multiple windows. */
export interface Layout {
  visible: string | null
}

/** Flatten a tree depth-first. */
export function walk(nodes: AgentNode[], visit: (node: AgentNode, parent: AgentNode | null) => void, parent: AgentNode | null = null): void {
  for (const node of nodes) {
    visit(node, parent)
    if (node.children) walk(node.children, visit, node)
  }
}
