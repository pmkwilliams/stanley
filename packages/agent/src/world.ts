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

/** A page being written, drawn on screen as it comes. */
export interface PageDraft {
  /** All of the page written so far: what is new is drawn. */
  write(content: string): void
  /** The whole page: the rest is drawn, and the page is complete. */
  end(content: string): void
  /** Writing stopped: the page is taken off the screen. */
  cancel(): void
}

/**
 * What a page printed to its console since it loaded, a line each with its level: `error: …`,
 * `warning: …`, `log: …`. An uncaught exception is an error, with the line it was on.
 */
export type ConsoleLines = string[]

/** How the page on screen came out: what its console printed since it loaded, and a picture of it. */
export interface PageLook {
  console: ConsoleLines
  image?: { data: string; mediaType: string }
}

/** How a page came out drawn out of sight (`World.preview`): its console, a picture of it, and its size. */
export interface PagePreview {
  console: ConsoleLines
  image?: { data: string; mediaType: string }
  /** The window it was drawn in, in CSS pixels. */
  width: number
  height: number
  /** The height the page needs at that width: more than `height` means it scrolls. */
  contentHeight: number
  appearance: 'dark' | 'light'
}

export interface PreviewOptions {
  /** Light or dark: the user's theme when not given. */
  appearance?: 'dark' | 'light'
  /** The window's width in CSS pixels: as wide as a page is shown when not given. */
  width?: number
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
  /**
   * Opens a web page by its address, as typing it into a browser would. A page kept open comes back
   * as it was left, unless `fresh` asks for it as it is now. Without it, pages Stanley found can't be opened.
   */
  openUrl?(url: string, opts?: { fresh?: boolean }): Promise<StepResult>
  /** Pages kept open, live, besides the one on screen: going back to one is instant, and it is as it was left. */
  openPages?(): { url: string; title: string }[]
  /**
   * The address `openUrl` shows a file from the user's folder at, written as a path from its top
   * (or as a person would write it), when it is there and the screen can show it.
   */
  fileUrl?(path: string): string | undefined
  /**
   * Puts a web page from the user's folder on screen while it is still being written, drawn as
   * it comes. Undefined when it can't be shown.
   */
  draft?(path: string): Promise<PageDraft | undefined>
  /** How the web page on screen came out, once it has loaded and drawn. */
  look?(): Promise<PageLook>
  /**
   * Draws a web page from the user's folder (its path, as `fileUrl` takes one) out of sight, in a
   * window of its own, and says how it came out. Nothing on screen changes. Throws when it isn't a
   * web page in the folder.
   */
  preview?(path: string, opts?: PreviewOptions): Promise<PagePreview>
  global(option: 'show' | 'home' | 'back'): Promise<void>
  /** Goes to the lock screen, ending the session. Without it, the agent can't lock. */
  lock?(): Promise<void>
}
