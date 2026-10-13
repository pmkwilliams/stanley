import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Plain text extraction: importing scenarios.mts would pull in the whole app graph.
const root = join(import.meta.dirname, '..')
const scenarioFiles = ['scenarios.mts', 'web/scenarios.mts'].map((f) => readFileSync(join(import.meta.dirname, f), 'utf8')).join('\n')
const utterances = [...scenarioFiles.matchAll(/utterances: \[([^\]]*)\]/g)].flatMap((m) =>
  [...m[1]!.matchAll(/(['"])((?:(?!\1).)*)\1/g)].map((q) => q[2]!),
)

const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean)
const grams = (t: string, n: number) => {
  const w = words(t)
  return w.length < n ? [] : w.slice(0, w.length - n + 1).map((_, i) => w.slice(i, i + n).join(' '))
}

/** Every file that holds prompt text, option descriptions or field instructions. */
const sources = [
  ...readdirSync(join(root, 'packages/agent/src')).map((f) => join(root, 'packages/agent/src', f)),
  ...readdirSync(join(root, 'packages')).filter((d) => d.startsWith('app-') && d !== 'app-sdk' && d !== 'app-ui').map((d) => join(root, 'packages', d, 'src/core.ts')),
  ...readdirSync(join(root, 'packages/browser/src')).map((f) => join(root, 'packages/browser/src', f)),
]
const prompts = words(sources.map((f) => readFileSync(f, 'utf8')).join('\n')).join(' ')

describe('eval utterances', () => {
  it('are found', () => expect(utterances.length).toBeGreaterThan(20))

  it('never appear in prompts (no shared 4-word run)', () => {
    const leaks = utterances.flatMap((u) => grams(u, 4).filter((g) => prompts.includes(g)).map((g) => `"${g}" from "${u}"`))
    expect(leaks).toEqual([])
  })
})
