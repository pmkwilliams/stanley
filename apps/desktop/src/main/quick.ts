import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { QUICK_URL } from '@stanley/agent'

/** The quick model's weights and llama.cpp's server, in ./models (`pnpm models`). */
export const QUICK_GGUF = 'gemma-4-E4B-it-Q4_K_M.gguf'
const SERVER = join('llama.cpp', 'llama-server')

/**
 * Starts the quick model's server at `QUICK_URL`, unless one is already serving there (left by a
 * reload) or the files aren't downloaded. Until it answers, thinking's stand-in writes for it.
 * Returns how to stop it, or null when it isn't downloaded.
 */
export async function startQuickModel(modelsDir: string): Promise<(() => void) | null> {
  const server = join(modelsDir, SERVER)
  const gguf = join(modelsDir, QUICK_GGUF)
  if (!existsSync(server) || !existsSync(gguf)) {
    console.warn(`Quick model missing (${SERVER}, ${QUICK_GGUF} in ${modelsDir}): run pnpm models. Dictation uses the gateway until then.`)
    return null
  }
  if (await fetch(`${QUICK_URL}/health`).then((r) => r.ok, () => false)) return () => {}
  const port = new URL(QUICK_URL).port
  // Thinking off, the context its examples and a dictation need, and one request at a time.
  const child: ChildProcess = spawn(server, ['-m', gguf, '--host', '127.0.0.1', '--port', port, '-ngl', '99', '-c', '8192', '--jinja', '--reasoning-budget', '0', '-np', '1'], { stdio: ['ignore', 'ignore', 'pipe'] })
  let log = ''
  child.stderr?.on('data', (chunk: Buffer) => (log = (log + chunk.toString()).slice(-4000)))
  child.on('exit', (code, signal) => {
    if (code) console.error(`Quick model server exited with ${code}:\n${log}`)
    else if (signal && signal !== 'SIGTERM') console.error(`Quick model server stopped by ${signal}`)
  })
  const stop = () => {
    if (child.exitCode === null) child.kill()
  }
  process.on('exit', stop)
  return stop
}
