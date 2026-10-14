import { SCRATCH_DIR } from '@stanley/app-sdk'
import { filesOf, type Entry } from './conversation'
import type { SkillScan } from './skills'

/** What a command printed, stdout and stderr together, and how it exited. */
export interface BashResult {
  output: string
  exitCode: number
}

/** The user's files: one folder, worked on through bash in the background. */
export interface FileTools {
  /** The folder, as the user would name it: `~/Wren`. */
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

export { SCRATCH_DIR }

/** The size a page Stanley writes is shown at, in CSS pixels. The Web app's own full screen gives it more. */
export interface PageSize {
  width: number
  height: number
}

/** A page's size when the host doesn't say: Stanley's window full screen on a 1920 by 1080 display. */
export const PAGE_SIZE: PageSize = { width: 1850, height: 885 }

/** A page's size as thinking is told it, to the nearest 10 pixels. */
export function pageSizeText(size: PageSize): string {
  const round = (n: number) => Math.round(n / 10) * 10
  return `about ${round(size.width)} by ${round(size.height)} pixels`
}

/** Whether a page's size has changed enough from what thinking was told to tell it again: a small change to the window isn't news. */
export function pageResized(told: PageSize, now: PageSize): boolean {
  return Math.abs(now.width - told.width) >= 50 || Math.abs(now.height - told.height) >= 50
}

/** For thinking, when the session has the user's files: pages are shown at `page`. */
export function filesPrompt(root: string, page: PageSize = PAGE_SIZE): string {
  return `## Files
The user's files are in a folder on their computer, ${root}. \`bash\` runs a command there, in the background: the folder is your working directory and your home, and the screen doesn't change. The user can't see what you do there, so say what you found or did, in spoken sentences, not the file's formatting.
- Look before you change anything. Only overwrite, move or delete the user's files when they asked for that; making new files is fine.
- Commands have no network access.
- Every change to the folder is kept. To see an earlier version of a file or bring it back: git --git-dir="$STANLEY_HISTORY" log -- <file>, then git --git-dir="$STANLEY_HISTORY" show <commit>:<file>.
- \`open_page\` puts a file from the folder on screen by its path, as a browser shows it: a web page, a PDF, a picture or a video. A web page from the folder can use files next to it, but nothing from the internet.
- \`write_file\` writes a file and \`edit_file\` changes part of one.
- What is in the folder, two levels down, comes in <files> the first time you're needed, and again when it changes. Look deeper with \`bash\`.

## Pages
When the user asks you to make something to look at (a diagram, a chart, a timeline, a small app), make it a web page: one .html file in ${SCRATCH_DIR}/, named for what it shows, written with \`write_file\`. Anything else they ask about is answered as before: from the screen, their files or a lookup.
- ${SCRATCH_DIR}/ is scratch: it is emptied when Stanley restarts and isn't kept in the folder's history. A page the user wants to keep goes in Pages/: write it there if they asked for one to keep, or move it there with \`mv\` when they say so.
- It comes on screen as you write it, and is drawn as it comes. Then you get the errors it reported and a picture of it. If something is broken (an error, something missing, overlapping or cut off), fix that part with \`edit_file\`; otherwise leave it as it is: the user is waiting.
- To change a page the user is looking at, use \`edit_file\` on just the part that changes: the page reloads where they were looking. Write the whole page again only when most of it changes.
- It is shown in a window ${pageSizeText(page)} (a note says when that changes), larger when the user makes it full screen: lay it out to fit without scrolling (an SVG with a viewBox that scales to the window does).
- A page in either folder takes Stanley's look, light or dark as the user's theme is: it sits on Stanley's frosted glass, and its text colour and font are set already. Give html and body no background, and don't set your own text colour or font; a picture, map, video or 3D scene that fills the window can have a background of its own. Colour it with these CSS variables: --foreground, --muted-foreground (secondary text), --card and --border (a panel that stands apart), --primary, --destructive, --warning, --success, and --chart-1 to --chart-6, in that order, for things that differ by kind (series, categories); text stays in the text colours, with the colour it names beside it. Also --radius, --font-sans and --font-mono.
- The page is the whole window: no card, border or title banner around all of it. A panel with its own background has at least 16px of padding inside and var(--radius) corners.
- A page can't reach the internet. Mermaid, Three.js, D3 and Chart.js load from their usual addresses (https://cdn.jsdelivr.net/npm/mermaid, …/three, …/d3, …/chart.js); a page can fetch the user's files by their path from the folder's top, starting with / (/budget.csv). Write everything else into the page itself.
- Pages are seen, not heard. Making one takes a while, so it starts with a few words about what you'll make; once it is on screen, never describe it out loud, and say nothing more about it.`
}

/** How many paths at the top of the folder thinking is shown. */
const TOP_FILES = 200

/**
 * The top two levels of the user's folder, as thinking is shown it, from `FileTools.paths`: those
 * nearest the top when there are too many.
 */
export function topFiles(paths: string[]): string {
  const depth = (path: string) => path.slice(0, -1).split('/').length
  const top = paths.filter((p) => depth(p) <= 2)
  const shown = new Set([...top.filter((p) => depth(p) === 1), ...top.filter((p) => depth(p) === 2)].slice(0, TOP_FILES))
  const more = top.length > shown.size ? [`… and ${top.length - shown.size} more`] : []
  return `<files>\n${[...top.filter((p) => shown.has(p)), ...more].join('\n') || '(empty)'}\n</files>`
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
