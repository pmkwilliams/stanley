import { appendFileSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { DebugEvent, DebugSession } from '../shared/ipc'

type Unstamped<E> = E extends unknown ? Omit<E, 'seq' | 'at'> : never
type Payload = Unstamped<DebugEvent>

const SUFFIX = '.debug.jsonl'
const MAX_IN_MEMORY = 5000

/**
 * Records the debug stream for one app session: appended to
 * `<sessions>/<session>.debug.jsonl`, kept in memory for the debug window,
 * and forwarded to it live.
 */
export class DebugRecorder {
  readonly events: DebugEvent[] = []
  readonly file: string
  private seq = 0

  constructor(
    private dir: string,
    session: string,
    private forward: (e: DebugEvent) => void,
  ) {
    this.file = `${session}${SUFFIX}`
  }

  record(payload: Payload): void {
    const e = { ...payload, seq: ++this.seq, at: Date.now() } as DebugEvent
    this.events.push(e)
    // The history's records stay: the debug window rebuilds what thinking was sent from all of them.
    if (this.events.length > MAX_IN_MEMORY) {
      const i = this.events.findIndex((x) => x.source !== 'history')
      if (i !== -1) this.events.splice(i, 1)
    }
    appendFileSync(join(this.dir, this.file), JSON.stringify(e) + '\n')
    this.forward(e)
  }

  sessions(): DebugSession[] {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(SUFFIX))
      .map((file) => {
        const { size, mtimeMs } = statSync(join(this.dir, file))
        return { file, current: file === this.file, bytes: size, modified: mtimeMs }
      })
      .sort((a, b) => b.modified - a.modified)
  }

  load(file: string): DebugEvent[] {
    if (basename(file) !== file || !file.endsWith(SUFFIX)) throw new Error(`Not a debug session: ${file}`)
    return readFileSync(join(this.dir, file), 'utf8')
      .split('\n')
      .flatMap((line) => {
        try {
          return line ? [JSON.parse(line) as DebugEvent] : []
        } catch {
          // A crash can leave a truncated last line.
          return []
        }
      })
  }
}
