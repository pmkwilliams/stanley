import { filesOf, type Entry } from './conversation'
import type { SkillScan } from './skills'

/** What a command printed, stdout and stderr together, and how it exited. */
export interface BashResult {
  output: string
  exitCode: number
}

/** The user's files: one folder, worked on through bash in the background. */
export interface FileTools {
  /** The folder, as the user would name it: `~/Stanley`. */
  root: string
  /** Runs a command in the folder. Throws only when it couldn't run at all, or `signal` aborted it. */
  bash(command: string, signal?: AbortSignal): Promise<BashResult>
  /** What is in the folder, all the way down: paths from its top, folders ending in `/`, no hidden ones. */
  paths(): Promise<string[]>
  /**
   * Writes a file (`path` from the folder's top, or as a person writes one), making the folders it
   * goes in. Kept like a command's changes. Throws for a path outside the folder.
   */
  write?(path: string, content: string): Promise<void>
  /** A file's text. Throws when it isn't there. */
  read?(path: string): Promise<string>
  /** The skills in the folder (see skills.ts), read from disk each time. */
  skills?(): Promise<SkillScan>
}

/** A command that ran on the user's files, as the history keeps it. */
export type FileMeta =
  /** Jev listed a folder (`''` is the whole folder). `entries` are names, folders ending in `/`. */
  | { kind: 'list'; path: string; entries: string[]; error?: string; utteranceId?: number }
  /** Jev read a file. `excerpt` is how it starts. */
  | { kind: 'read'; path: string; excerpt: string; error?: string; utteranceId?: number }
  /** Thinking ran a command. */
  | { kind: 'bash'; command: string; exitCode: number; utteranceId?: number }
  /** Thinking wrote a file, or changed part of one (`edit`). */
  | { kind: 'write'; path: string; edit: boolean; error?: string; utteranceId?: number }
  /** Jev read a skill. `body` is what it says to do. */
  | { kind: 'skill'; name: string; path: string; body: string; error?: string; utteranceId?: number }

/** A file or folder Stanley has seen, which Jev can read or list. */
export interface KnownFile {
  /** From the folder's top, folders ending in `/`. */
  path: string
  /** From the latest listing or read, so the likeliest to be meant by "that". */
  latest: boolean
  /** Where the screen shows it, for a file it can show (a web page, a PDF, a picture). */
  url?: string
}

/** For thinking, when the session has the user's files. */
export function filesPrompt(root: string): string {
  return `## Files
The user's files are in a folder on their computer, ${root}. \`bash\` runs a command there, in the background: the folder is your working directory and your home, and the screen doesn't change. The user can't see what you do there, so say what you found or did, in spoken sentences, not the file's formatting.
- Look before you change anything. Only overwrite, move or delete the user's files when they asked for that; making new files is fine.
- Commands have no network access.
- Every change to the folder is kept. To see an earlier version of a file or bring it back: git --git-dir="$STANLEY_HISTORY" log -- <file>, then git --git-dir="$STANLEY_HISTORY" show <commit>:<file>.
- \`open_page\` puts a file from the folder on screen by its path, as a browser shows it: a web page, a PDF, a picture or a video. A web page from the folder can use files next to it, but nothing from the internet.
- \`write_file\` writes a file and \`edit_file\` changes part of one.

## Pages
When the user asks you to make something to look at (a diagram, a chart, a timeline, a small app), make it a web page: one .html file in Pages/, named for what it shows, written with \`write_file\`. Anything else they ask about is answered as before: from the screen, their files or a lookup.
- It comes on screen as you write it, and is drawn as it comes. Then you get the errors it reported and a picture of it. If something is broken (an error, something missing, overlapping or cut off), fix that part with \`edit_file\`; otherwise leave it as it is: the user is waiting.
- To change a page the user is looking at, use \`edit_file\` on just the part that changes: the page reloads where they were looking. Write the whole page again only when most of it changes.
- Every line takes time to write while the user waits, so keep a page as short as it can be and still be good. It fills a large window, about 1200 by 560: lay it out to fit without scrolling (an SVG with a viewBox that scales to the window does), with text large enough to read from a little way off.
- A page in Pages/ takes Stanley's look, light or dark as the user's theme is: its background, text colour and font are set already, so don't set your own. Colour it with these CSS variables: --foreground, --muted-foreground (secondary text), --card and --border (a panel that stands apart), --primary, --destructive, --warning, --success, and --chart-1 to --chart-6, in that order, for things that differ by kind (series, categories); text stays in the text colours, with the colour it names beside it. Also --radius, --font-sans and --font-mono.
- The page is the whole window: no card, border or title banner around all of it. A panel with its own background has at least 16px of padding inside and var(--radius) corners.
- A page can't reach the internet. Mermaid, Three.js, D3 and Chart.js load from their usual addresses (https://cdn.jsdelivr.net/npm/mermaid, …/three, …/d3, …/chart.js); a page can fetch files next to it in the folder. Write everything else into the page itself.
- Pages are seen, not heard: never describe one out loud. Say at most a few words about it, or nothing.`
}

/** For Jev, when the session has the user's files. */
export const JEV_FILES = `The user's files are in a folder Stanley can look into in the background: "list files" lists it, and its folders and files each have a step to list or read them. Looking at files shows nothing on screen. Files the screen can show (web pages, PDFs, pictures, videos) also have an "open file" step, which puts them on screen as a browser would. Finding something in them, answering from them, or changing them is for \`think\`.`

/** `'it'\''s'`: a word bash reads back exactly. */
export function quote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`
}

/** Lists a folder: names, folders marked with `/`, without hidden files. */
export function listCommand(path: string): string {
  return path ? `ls -p -- ${quote(path)}` : 'ls -p'
}

export function readCommand(path: string): string {
  return `cat -- ${quote(path)}`
}

/** What a command gives back as a tool result: its output, and its exit code when it failed. */
export function bashText(result: BashResult): string {
  const output = result.output.trimEnd()
  if (result.exitCode === 0) return output || '(no output)'
  return `${output ? `${output}\n` : ''}(exit code ${result.exitCode})`
}

/**
 * Folders and files Jev can list or read: what it listed and read, while it still reads about it,
 * most recent first, a listing's in its order; then the rest of what is in the folder (`paths`).
 */
export function knownFiles(entries: Entry[], paths: string[] = []): KnownFile[] {
  const files: KnownFile[] = []
  let latest = true
  for (const f of filesOf(entries).reverse()) {
    if (f.kind === 'bash' || f.kind === 'skill' || f.error) continue
    const found = f.kind === 'list' ? f.entries.map((name) => join(f.path, name)) : [f.path]
    for (const path of found) if (!files.some((k) => k.path === path)) files.push({ path, latest })
    latest = false
  }
  const seen = new Set(files.map((f) => f.path))
  for (const path of paths) if (!seen.has(path)) files.push({ path, latest: false })
  return files
}

function join(folder: string, name: string): string {
  return folder ? `${folder.replace(/\/?$/, '/')}${name}` : name
}
