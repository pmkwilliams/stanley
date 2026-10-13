import { filesOf, type Entry } from './conversation'

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
}

/** A command that ran on the user's files, as the history keeps it. */
export type FileMeta =
  /** Jev listed a folder (`''` is the whole folder). `entries` are names, folders ending in `/`. */
  | { kind: 'list'; path: string; entries: string[]; error?: string; utteranceId?: number }
  /** Jev read a file. `excerpt` is how it starts. */
  | { kind: 'read'; path: string; excerpt: string; error?: string; utteranceId?: number }
  /** Thinking ran a command. */
  | { kind: 'bash'; command: string; exitCode: number; utteranceId?: number }

/** A file or folder Stanley has seen, which Jev can read or list. */
export interface KnownFile {
  /** From the folder's top, folders ending in `/`. */
  path: string
  /** From the latest listing or read, so the likeliest to be meant by "that". */
  latest: boolean
}

/** For thinking, when the session has the user's files. */
export function filesPrompt(root: string): string {
  return `## Files
The user's files are in a folder on their computer, ${root}. \`bash\` runs a command there, in the background: the folder is your working directory and your home, and the screen doesn't change. The user can't see what you do there, so say what you found or did, in spoken sentences, not the file's formatting.
- Look before you change anything. Only overwrite, move or delete the user's files when they asked for that; making new files is fine.
- Commands have no network access.
- Every change to the folder is kept. To see an earlier version of a file or bring it back: git --git-dir="$STANLEY_HISTORY" log -- <file>, then git --git-dir="$STANLEY_HISTORY" show <commit>:<file>.`
}

/** For Jev, when the session has the user's files. */
export const JEV_FILES = `The user's files are in a folder Stanley can look into in the background: "list files" lists it, and its folders and files each have a step to list or read them. Looking at files shows nothing on screen. Finding something in them, answering from them, or changing them is for \`think\`.`

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
    if (f.kind === 'bash' || f.error) continue
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
