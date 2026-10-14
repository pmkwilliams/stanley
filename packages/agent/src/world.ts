import type { ActionArgs, AgentNode } from '@stanley/app-sdk'

/** The surface Stanley is working on, which may be hidden from the user. */
export interface Screen {
  /** Identifies the screen, e.g. `email:email/m1`; `home` for the home screen. */
  id: string
  title: string
  /** In front of the user, or being worked on in the background. */
  visible: boolean
  /** The address of the web page it shows, if it shows one. */
  url?: string
  /** What a person would read on it. */
  markdown: string
  /** Its interactive elements, as an accessibility tree would describe them. */
  elements: AgentNode[]
}

export interface AppEntry {
  id: string
  title: string
  description: string
}

export interface StepResult {
  /** One line on what happened, written by the app. */
  summary: string
  /** Fuller content the step produced, for the debug window. The models read the screen instead. */
  observation?: string
  /** `openUrl`: the title of the page that opened. */
  title?: string
}

/** What the agent can see and do. Implemented by the desktop shell (and, later, by browser and OS adapters). */
export interface World {
  screen(): Promise<Screen>
  /** Apps Stanley can open from anywhere. */
  appList(): AppEntry[]
  open(appId: string): Promise<StepResult>
  perform(node: AgentNode, args: ActionArgs): Promise<StepResult>
  /** Opens a web page by its address, as typing it into a browser would. Without it, pages Stanley found can't be opened. */
  openUrl?(url: string): Promise<StepResult>
  /**
   * The address `openUrl` shows a file from the user's folder at, written as a path from its top
   * (or as a person would write it), when it is there and the screen can show it.
   */
  fileUrl?(path: string): string | undefined
  global(option: 'show' | 'home' | 'back'): Promise<void>
  /** Goes to the lock screen, ending the session. Without it, the agent can't lock. */
  lock?(): Promise<void>
}
