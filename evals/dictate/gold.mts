/**
 * Writes `gold.json`: the right text for each case in `cases.mts` and `holdout.mts`, by GPT-6.1 Sol (high effort)
 * through the local Codex CLI, given the quick model's own instructions. Cases already in
 * `gold.json` are kept; `--redo` writes them all again. Review the result by hand.
 *
 *   pnpm --filter @stanley/evals exec tsx dictate/gold.mts [--redo] [name...]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DICTATE_PROMPT } from '@stanley/agent'
import { cases as dev } from './cases.mts'
import { holdout } from './holdout.mts'
import { input } from './input.mts'

const BATCH = 12
const cases = [...dev, ...holdout]
const file = join(import.meta.dirname, 'gold.json')
const gold: Record<string, string | string[]> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
const names = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const redo = process.argv.includes('--redo')
const todo = cases.filter((c) => (names.length ? names.includes(c.name) : true) && (redo || names.length || !(c.name in gold)))

const dir = mkdtempSync(join(tmpdir(), 'dictate-gold-'))
const schema = join(dir, 'schema.json')
writeFileSync(
  schema,
  JSON.stringify({
    type: 'object',
    properties: { answers: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, text: { type: 'string' } }, required: ['name', 'text'], additionalProperties: false } } },
    required: ['answers'],
    additionalProperties: false,
  }),
)

const brief = `You are writing the reference answers for an evaluation of a small model. Each case below is one call to that model: it is given the instructions below as its system prompt and the case's input as its message, and it must write what the field should hold now.

Write, for every case, the ideal output: exactly what a careful person following these instructions would write. Follow the instructions to the letter. Don't use any tools or read any files; answer from the text here.

# The model's instructions
${DICTATE_PROMPT}

# Notes
- The output replaces the field's whole content. Line breaks are allowed where the user asked for them (a new paragraph, a list).
- "Write nothing" means the empty string.
- Keep the user's own words and register: tidy, don't rewrite.
- What matters is what the field ends up holding: what the user meant it to (the message they meant to send, a title, a search that finds what they asked for).

Answer with one entry per case, by name.`

for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH)
  const prompt = `${brief}\n\n${batch.map((c) => `# Case: ${c.name}\n${input(c)}`).join('\n\n')}`
  const out = join(dir, `out-${i}.json`)
  console.log(`cases ${i + 1}–${i + batch.length} of ${todo.length}…`)
  execFileSync('codex', ['exec', '-m', 'gpt-6.1-sol', '-c', 'model_reasoning_effort="high"', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-C', dir, '--output-schema', schema, '-o', out, '-'], { input: prompt, stdio: ['pipe', 'ignore', 'inherit'] })
  const { answers } = JSON.parse(readFileSync(out, 'utf8')) as { answers: { name: string; text: string }[] }
  for (const a of answers) if (batch.some((c) => c.name === a.name)) gold[a.name] = a.text
  const missing = batch.filter((c) => !answers.some((a) => a.name === c.name)).map((c) => c.name)
  if (missing.length) console.log(`  missing: ${missing.join(', ')}`)
  writeFileSync(file, JSON.stringify(Object.fromEntries(cases.filter((c) => c.name in gold).map((c) => [c.name, gold[c.name]])), null, 2) + '\n')
}
console.log(`${Object.keys(gold).length}/${cases.length} cases have gold`)
