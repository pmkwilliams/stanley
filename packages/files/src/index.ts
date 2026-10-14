import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync, type Stats } from 'node:fs'
import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { parseSkill, SCRATCH_DIR, skillPath, SKILLS_DIR, type BashResult, type FileChange, type FileTools, type SkillScan } from '@stanley/agent'

export interface LocalFilesOptions {
  /** The user's folder. Made if it isn't there. */
  root: string
  /** Where every version of the folder is kept: a git directory outside it, which commands can read but not change. */
  history: string
  /** A command running longer than this is stopped. */
  timeoutMs?: number
  /** Characters of output kept: the start and the end of anything longer. */
  maxOutput?: number
  /** Paths `paths()` gives at most. */
  maxPaths?: number
}

/**
 * The sandbox every command runs in (macOS `sandbox-exec`): it can write only in the folder and a
 * temporary directory, can't read the rest of the user's home, has no network, and can't reach
 * other apps or processes.
 */
const PROFILE = `(version 1)
(deny default)
(allow process-exec)
(allow process-fork)
(allow signal (target same-sandbox))
(allow process-info* (target same-sandbox))
(allow sysctl-read)
(allow user-preference-read)
(allow file-read*)
(deny file-read-data (subpath (param "HOME")))
(allow file-read-data (subpath (param "ROOT")) (subpath (param "HISTORY")))
(allow file-write* (subpath (param "ROOT")) (subpath (param "TMP")))
(allow file-write-data file-ioctl (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty") (regex #"^/dev/fd/"))
(allow mach-lookup (global-name "com.apple.system.opendirectoryd.libinfo") (global-name "com.apple.system.notification_center") (global-name "com.apple.system.logger") (global-name "com.apple.SystemConfiguration.configd"))
(allow ipc-posix-shm-read-data ipc-posix-shm-read-metadata (ipc-posix-name-regex #"^apple\\.shm\\.notification_center"))`

const PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'

/** Git's tree with nothing in it: what the folder's first commit is compared with. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/**
 * The user's files as one real folder. Commands run with bash inside it, sandboxed, and every
 * change is kept: the folder is committed to a git directory of its own before and after each
 * command, so anything Stanley did can be undone, and so can anything done since.
 */
export function localFiles(opts: LocalFilesOptions): FileTools {
  if (process.platform !== 'darwin') throw new Error('The files sandbox needs macOS (sandbox-exec)')
  const timeoutMs = opts.timeoutMs ?? 30_000
  const maxOutput = opts.maxOutput ?? 16_000
  const maxPaths = opts.maxPaths ?? 2000
  mkdirSync(opts.root, { recursive: true })
  mkdirSync(opts.history, { recursive: true })
  const root = realpathSync(opts.root)
  const history = realpathSync(opts.history)
  // Scratch lasts until Stanley restarts.
  rmSync(join(root, SCRATCH_DIR), { recursive: true, force: true })
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'stanley-files-')))
  const home = realpathSync(homedir())
  const params = { ROOT: root, TMP: tmp, HOME: home, HISTORY: history }

  const git = (...args: string[]) =>
    new Promise<{ code: number; stdout: string }>((resolve) => {
      execFile('git', ['--git-dir', history, '--work-tree', root, '-c', 'core.quotepath=off', ...args], { env: { PATH, HOME: home }, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) =>
        resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout }),
      )
    })

  /** Commits the folder as it is, if anything changed, and gives the commit it is now (`''` before there is one). One at a time. */
  let snapshots = Promise.resolve('')
  let excluded = false
  const snapshot = (message: string): Promise<string> =>
    (snapshots = snapshots.then(async () => {
      if (!existsSync(join(history, 'HEAD'))) {
        await git('init', '-q')
        for (const [key, value] of [['user.name', 'Stanley'], ['user.email', 'stanley@localhost'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) await git('config', key!, value!)
      }
      // Each start, so a history made before there was scratch leaves it out too.
      if (!excluded) {
        mkdirSync(join(history, 'info'), { recursive: true })
        writeFileSync(join(history, 'info', 'exclude'), `.DS_Store\n/${SCRATCH_DIR}/\n`)
        excluded = true
      }
      if ((await git('status', '--porcelain')).stdout.trim()) {
        await git('add', '-A')
        await git('commit', '-q', '--no-verify', '-m', message)
      }
      return (await git('rev-parse', '-q', '--verify', 'HEAD')).stdout.trim()
    }))

  /** The files in scratch, which the history leaves out, by path from the folder's top. */
  const scratchFiles = async (): Promise<Map<string, Stats>> => {
    const files = new Map<string, Stats>()
    const entries = await readdir(join(root, SCRATCH_DIR), { recursive: true, withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (!e.isFile() || e.name === '.DS_Store') continue
      const path = join(e.parentPath, e.name).slice(root.length + 1)
      const s = await stat(join(root, path)).catch(() => null)
      if (s) files.set(path, s)
    }
    return files
  }

  /**
   * What changed in the folder from commit `before` to `after`, and in scratch since it was
   * `scratch`. A file that left scratch is moved when one with its inode arrived, as `mv` keeps it.
   */
  const changed = async (before: string, after: string, scratch: Map<string, Stats>): Promise<FileChange[]> => {
    const changes: FileChange[] = []
    if (after && after !== before) {
      const fields = (await git('diff-tree', '-r', '-M', '-z', '--name-status', before || EMPTY_TREE, after)).stdout.split('\0')
      for (let i = 0; fields[i]; ) {
        const status = fields[i++]!
        if (status.startsWith('R')) changes.push({ kind: 'moved', from: fields[i++]!, path: fields[i++]! })
        else changes.push({ kind: status === 'A' ? 'added' : status === 'D' ? 'deleted' : 'changed', path: fields[i++]! })
      }
    }
    const now = await scratchFiles()
    for (const [path, s] of now) {
      const was = scratch.get(path)
      if (!was) changes.push({ kind: 'added', path })
      else if (was.ino !== s.ino || was.size !== s.size || was.mtimeMs !== s.mtimeMs) changes.push({ kind: 'changed', path })
    }
    for (const [from, was] of scratch) {
      if (now.has(from)) continue
      const i = changes.findIndex((c) => c.kind === 'added' && (now.get(c.path) ?? statSync(join(root, c.path), { throwIfNoEntry: false }))?.ino === was.ino)
      if (i < 0) changes.push({ kind: 'deleted', path: from })
      else changes[i] = { kind: 'moved', from, path: changes[i]!.path }
    }
    return changes
  }

  const shown = root.startsWith(`${home}/`) ? `~${root.slice(home.length)}` : root

  /**
   * A path as written (from the top, `./…`, `~/Wren/…` or absolute) as a real path in the folder.
   * `~/…` is in the folder too: it is home to commands.
   */
  const inside = async (written: string): Promise<string> => {
    let path = written.trim()
    for (const top of [`${shown}/`, `${root}/`, '~/']) if (path.startsWith(top)) path = path.slice(top.length)
    const full = resolve(root, path.replace(/^(\.\/)+/, ''))
    if (!full.startsWith(root + sep)) throw new Error(`${written} isn't in the user's folder`)
    // Through a link, a path inside can lead outside.
    const parent = await realpath(dirname(full)).catch(() => null)
    if (parent && parent !== root && !parent.startsWith(root + sep)) throw new Error(`${written} isn't in the user's folder`)
    return full
  }

  return {
    root: shown,
    async bash(command, signal) {
      signal?.throwIfAborted()
      // What changed since the last command is the user's own, kept apart from what Stanley does.
      const before = await snapshot('Changes made outside Stanley')
      const scratch = await scratchFiles()
      let result: BashResult
      let after = before
      try {
        result = await run(command, signal)
      } finally {
        after = await snapshot(`Stanley ran: ${command}`)
      }
      const changes = await changed(before, after, scratch)
      return changes.length ? { ...result, changes } : result
    },
    async paths() {
      // Read directly, not through bash: it's asked for on every decision, and changes nothing.
      const entries = await readdir(root, { recursive: true, withFileTypes: true })
      const paths: string[] = []
      for (const e of entries) {
        const path = join(e.parentPath, e.name).slice(root.length + 1)
        if (path.split('/').some((part) => part.startsWith('.'))) continue
        if (e.isDirectory()) paths.push(`${path}/`)
        else if (e.isFile()) paths.push(path)
      }
      // When there are too many, the ones nearest the top are kept.
      const depth = (path: string) => path.slice(0, -1).split('/').length
      return paths
        .sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : 1))
        .slice(0, maxPaths)
        .sort()
    },
    async write(path, content) {
      const full = await inside(path)
      await snapshot('Changes made outside Stanley')
      try {
        await mkdir(dirname(full), { recursive: true })
        await writeFile(full, content)
      } finally {
        await snapshot(`Stanley wrote ${full.slice(root.length + 1)}`)
      }
    },
    async read(path) {
      return readFile(await inside(path), 'utf8')
    },
    async skills() {
      const scan: SkillScan = { skills: [], broken: [] }
      const folders = await readdir(join(root, SKILLS_DIR), { withFileTypes: true }).catch(() => [])
      for (const folder of folders.filter((f) => f.isDirectory() && !f.name.startsWith('.')).map((f) => f.name).sort()) {
        const text = await readFile(join(root, skillPath(folder)), 'utf8').catch(() => null)
        const skill = text === null ? { path: skillPath(folder), error: 'it has no SKILL.md' } : parseSkill(folder, text)
        if ('error' in skill) scan.broken.push(skill)
        else scan.skills.push(skill)
      }
      return scan
    },
  }

  function run(command: string, signal?: AbortSignal): Promise<BashResult> {
    const args = ['-p', PROFILE, ...Object.entries(params).flatMap(([k, v]) => ['-D', `${k}=${v}`]), '/bin/bash', '--noprofile', '--norc', '-c', command]
    const env = { HOME: root, PATH, TMPDIR: tmp, LANG: 'en_US.UTF-8', TERM: 'dumb', PAGER: 'cat', GIT_PAGER: 'cat', STANLEY_HISTORY: history }
    return new Promise((resolve, reject) => {
      // Its own process group, so stopping it stops everything it started.
      const child = spawn('/usr/bin/sandbox-exec', args, { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
      const output = new Output(maxOutput)
      child.stdout.on('data', (b: Buffer) => output.add(b))
      child.stderr.on('data', (b: Buffer) => output.add(b))
      const kill = () => {
        try {
          process.kill(-child.pid!, 'SIGKILL')
        } catch {
          // Already gone.
        }
      }
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        kill()
      }, timeoutMs)
      const abort = () => kill()
      signal?.addEventListener('abort', abort, { once: true })
      child.on('error', (err) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        reject(err)
      })
      child.on('close', (code, sig) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        if (signal?.aborted) return reject(signal.reason)
        const text = output.text()
        if (timedOut) return resolve({ output: `${text.trimEnd()}${text.trim() ? '\n' : ''}(stopped: it ran longer than ${timeoutMs / 1000} s)`, exitCode: 124 })
        resolve({ output: text, exitCode: code ?? (sig ? 128 : 1) })
      })
    })
  }
}

/** What a command printed: its start and its end when there is too much, and no binary. */
class Output {
  private head: Buffer[] = []
  private headBytes = 0
  private tail: Buffer[] = []
  private tailBytes = 0
  private total = 0

  constructor(private max: number) {}

  add(b: Buffer): void {
    this.total += b.length
    // Bytes, not characters, so keep twice what is shown: decoding can only make it shorter.
    if (this.headBytes < this.max * 2) {
      this.head.push(b)
      this.headBytes += b.length
      return
    }
    this.tail.push(b)
    this.tailBytes += b.length
    while (this.tailBytes - this.tail[0]!.length > this.max * 2) this.tailBytes -= this.tail.shift()!.length
  }

  text(): string {
    const head = Buffer.concat(this.head)
    if (head.includes(0)) return `(binary output, ${this.total} bytes)`
    const all = this.tail.length ? `${head.toString('utf8')}${Buffer.concat(this.tail).toString('utf8')}` : head.toString('utf8')
    if (all.length <= this.max && !this.tail.length) return all
    const half = Math.floor(this.max / 2)
    return `${all.slice(0, half)}\n… (the middle was left out: ${this.total} bytes in all) …\n${all.slice(-half)}`
  }
}
