import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BashResult, FileTools } from '@stanley/agent'

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
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'stanley-files-')))
  const home = realpathSync(homedir())
  const params = { ROOT: root, TMP: tmp, HOME: home, HISTORY: history }

  const git = (...args: string[]) =>
    new Promise<{ code: number; stdout: string }>((resolve) => {
      execFile('git', ['--git-dir', history, '--work-tree', root, '-c', 'core.quotepath=off', ...args], { env: { PATH, HOME: home }, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) =>
        resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout }),
      )
    })

  /** Commits the folder as it is, if anything changed. One at a time. */
  let snapshots = Promise.resolve()
  const snapshot = (message: string) =>
    (snapshots = snapshots.then(async () => {
      if (!existsSync(join(history, 'HEAD'))) {
        await git('init', '-q')
        for (const [key, value] of [['user.name', 'Stanley'], ['user.email', 'stanley@localhost'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) await git('config', key!, value!)
        writeFileSync(join(history, 'info', 'exclude'), '.DS_Store\n')
      }
      if (!(await git('status', '--porcelain')).stdout.trim()) return
      await git('add', '-A')
      await git('commit', '-q', '--no-verify', '-m', message)
    }))

  return {
    root: root.startsWith(`${home}/`) ? `~${root.slice(home.length)}` : root,
    async bash(command, signal) {
      signal?.throwIfAborted()
      // What changed since the last command is the user's own, kept apart from what Stanley does.
      await snapshot('Changes made outside Stanley')
      try {
        return await run(command, signal)
      } finally {
        await snapshot(`Stanley ran: ${command}`)
      }
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
      return paths.sort().slice(0, maxPaths)
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
