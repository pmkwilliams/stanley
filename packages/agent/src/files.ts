import { SCRATCH_DIR } from '@stanley/app-sdk'
import { filesOf, type Entry } from './conversation'
import type { SkillScan } from './skills'

/** What a command printed, stdout and stderr together, how it exited, and what it changed in the folder. */
export interface BashResult {
  output: string
  exitCode: number
  changes?: FileChange[]
}

/** A file a command changed, by its path from the folder's top. */
export type FileChange = { kind: 'added' | 'changed' | 'deleted'; path: string } | { kind: 'moved'; from: string; path: string }

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

/** How a page Stanley makes should look and work, wherever it is made: it is shown at `page`, and `changes` says how a change of size is told. */
function pageLook(page: PageSize, changes = ''): string {
  return `- It is shown in a window ${pageSizeText(page)}${changes}, larger when the user makes it full screen: lay it out to fit without scrolling (an SVG with a viewBox that scales to the window does).
- A page in either folder takes Stanley's look, light or dark as the user's theme is: it sits on Stanley's frosted glass, and its text colour and font are set already. Give html and body no background, and don't set your own text colour or font; a picture, map, video or 3D scene that fills the window can have a background of its own. Colour it with these CSS variables: --foreground, --muted-foreground (secondary text), --card and --border (a panel that stands apart), --primary, --destructive, --warning, --success, and --chart-1 to --chart-6, in that order, for things that differ by kind (series, categories); text stays in the text colours, with the colour it names beside it. Also --radius, --font-sans and --font-mono.
- The page is the whole window: no card, border or title banner around all of it. A panel with its own background has at least 16px of padding inside and var(--radius) corners.
- A page can't reach the internet. Mermaid, Three.js, D3 and Chart.js load from their usual addresses (https://cdn.jsdelivr.net/npm/mermaid, …/three, …/d3, …/chart.js); a page can fetch the user's files by their path from the folder's top, starting with / (/budget.csv). Write everything else into the page itself.`
}

/**
 * For thinking, when the session has the user's files: pages are shown at `page`. With
 * `background`, new pages are made by background tasks (`delegate`), and thinking only changes them.
 */
export function filesPrompt(root: string, page: PageSize = PAGE_SIZE, background = false): string {
  const making = background
    ? `When the user asks you to make something to look at (a diagram, a chart, a timeline, a 3D model, a small app), it is a web page: one .html file in ${SCRATCH_DIR}/, named for what it shows. Making one is never immediate, so hand it to a background task with \`delegate\`: say in the task what the page should show and its path, and once it is done, put it on screen with \`open_page\`. Anything else they ask about is answered as before: from the screen, their files or a lookup.`
    : `When the user asks you to make something to look at (a diagram, a chart, a timeline, a small app), make it a web page: one .html file in ${SCRATCH_DIR}/, named for what it shows, written with \`write_file\`. Anything else they ask about is answered as before: from the screen, their files or a lookup.`
  const changing = background
    ? `- To change a page the user is looking at, use \`edit_file\` on just the part that changes: the page reloads where they were looking. A change that is more than a quick fix (something new on it, a different look, a rework) goes to a background task instead, with the page's path.
- A page you change comes on screen as it is written. Then you get what its console printed (errors, warnings, and anything it logs) and a picture of it. If something is broken (an error, something missing, overlapping or cut off), fix that part with \`edit_file\`; otherwise leave it as it is: the user is waiting.`
    : `- It comes on screen as you write it, and is drawn as it comes. Then you get what its console printed (errors, warnings, and anything it logs) and a picture of it. If something is broken (an error, something missing, overlapping or cut off), fix that part with \`edit_file\`; otherwise leave it as it is: the user is waiting.
- To change a page the user is looking at, use \`edit_file\` on just the part that changes: the page reloads where they were looking. Write the whole page again only when most of it changes.`
  const heard = background
    ? `- Pages are seen, not heard: once one is on screen, never describe it out loud.`
    : `- Pages are seen, not heard. The user waits while one is written, so it starts with a few words about what you'll make; once it is on screen, never describe it out loud.`
  return `## Files
The user's files are in a folder on their computer, ${root}. \`bash\` runs a command there, in the background: the folder is your working directory and your home, and the screen doesn't change. The user can't see what you do there, so say what you found or did, in spoken sentences, not the file's formatting.
- Look before you change anything. Only overwrite, move or delete the user's files when they asked for that; making new files is fine.
- Commands have no network access.
- Every change to the folder is kept. To see an earlier version of a file or bring it back: git --git-dir="$STANLEY_HISTORY" log -- <file>, then git --git-dir="$STANLEY_HISTORY" show <commit>:<file>.
- \`open_page\` puts a file from the folder on screen by its path, as a browser shows it: a web page, a PDF, a picture or a video. A web page from the folder can use files next to it, but nothing from the internet.
- \`write_file\` writes a file and \`edit_file\` changes part of one.
- What is in the folder, two levels down, comes in <files> the first time you're needed, and again when it changes. Look deeper with \`bash\`.

## Pages
${making}
- ${SCRATCH_DIR}/ is scratch: it is emptied when Stanley restarts and isn't kept in the folder's history. A page the user wants to keep goes in Pages/: write it there if they asked for one to keep, or move it there with \`mv\` when they say so.
${changing}
${pageLook(page, ' (a note says when that changes)')}
${heard}`
}

/** For a background task (see background.ts), when the session has the user's files: as thinking's, without a screen. Pages are shown at `page`. */
export function taskFilesPrompt(root: string, page: PageSize = PAGE_SIZE): string {
  return `## Files
The user's files are in a folder on their computer, ${root}. \`bash\` runs a command there: the folder is your working directory and your home.
- Look before you change anything. Only overwrite, move or delete the user's files when the task says to; making new files is fine.
- Commands have no network access.
- \`write_file\` writes a file and \`edit_file\` changes part of one.

## Pages
When the task is to make something to look at (a diagram, a chart, a timeline, a small app), make it a web page: one .html file in ${SCRATCH_DIR}/ unless the task says where, named for what it shows, written with \`write_file\`.
- No one sees it while you work. \`preview_page\` draws it out of sight and gives you a picture of it, how tall it is, and everything its console printed: errors, warnings and what it logs (console.log is a good way to check your own work). Preview it once it is written, fix what is broken (an error, something missing, overlapping or cut off) with \`edit_file\`, and preview it again, until it is right. Check it in light as well as dark when its colours matter.
${pageLook(page)}`
}

/**
 * `before` with `old` replaced by `replacement`: once, where it is the only one, or everywhere
 * with `all`; or why it can't be.
 */
export function editText(before: string, path: string, old: string, replacement: string, all: boolean): { text: string } | { error: string } {
  const times = old ? before.split(old).length - 1 : 0
  if (!times) return { error: `That text isn't in ${path}. Copy it exactly as it is in the file (read it with cat), or write the whole file again.` }
  if (times > 1 && !all) return { error: `That text is in ${path} ${times} times: include more of what is around it so it is there once, or set all to change every one.` }
  return { text: all ? before.split(old).join(replacement) : before.replace(old, () => replacement) }
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

/** How many of a command's changes its tool result lists. */
const SHOWN_CHANGES = 20

/** What a command gives back as a tool result: its output, its exit code when it failed, and what it changed in the folder. */
export function bashText(result: BashResult): string {
  const printed = [result.output.trimEnd(), result.exitCode === 0 ? '' : `(exit code ${result.exitCode})`].filter(Boolean).join('\n')
  const changes = result.changes ?? []
  const line = (c: FileChange) => (c.kind === 'moved' ? `- moved ${c.from} to ${c.path}` : `- ${c.kind} ${c.path}`)
  const more = changes.length > SHOWN_CHANGES ? [`… and ${changes.length - SHOWN_CHANGES} more`] : []
  const changed = changes.length ? ['Changes to the folder:', ...changes.slice(0, SHOWN_CHANGES).map(line), ...more].join('\n') : ''
  return [printed, changed].filter(Boolean).join('\n\n') || '(no output)'
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
