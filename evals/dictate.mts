/**
 * What a quick model alone writes into a field from what the user said: `dictation()` sent as
 * `Thinker.quick` sends it, with no Jev and no agent. It passes when the field ends up holding what
 * the user meant (see `dictate/cases.mts`): by its checks, then against Sol's gold
 * (`dictate/gold.json`), word for word or, with `--judge`, by Sol deciding whether a text that
 * differs still gets the user what they meant.
 *
 *   pnpm eval:dictate --model <id>[@effort] [--model …] [--variant <name>] [--opts '<json>'] [--holdout]
 *                     [--runs N] [--concurrency N] [--judge] [--verbose] [name|kind…]
 *   pnpm eval:dictate --report [--holdout]
 *   pnpm eval:dictate --rescore
 *
 * `<id>` is an AI Gateway id (`openai/gpt-6-luna@none`), or `local/<label>` for a llama.cpp server
 * at DICTATE_LOCAL_URL (default http://127.0.0.1:8080), sent at temperature 0 with thinking off.
 * `--variant` puts the cases another way (`dictate/variants.mts`; `prod` is what the app sends), and
 * `--opts` adds to a local request (`{"temperature":0.3}`). `--holdout` runs the cases kept out of
 * tuning (`dictate/holdout.mts`). Each run's last result is kept in `.cache/dictate/`; `--report`
 * compares them, `--rescore` scores them again by the cases, gold and judge as they are now.
 *
 * Paid: one call per case and run for a gateway model. `--judge` has GPT-6.1 Sol, through the local
 * Codex CLI, judge each text that passes its checks but isn't a gold answer word for word, 15 to a
 * call (cached, so a text is judged once).
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateText } from 'ai'
import { cases as devCases, type DictateCase } from './dictate/cases.mts'
import { holdout } from './dictate/holdout.mts'
import { input } from './dictate/input.mts'
import { variants, type Message, type Variant } from './dictate/variants.mts'
import { flag, loadEnv, pool } from './harness.mts'

type Effort = 'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high'

interface Result {
  name: string
  kind: string
  run: number
  text: string
  ms: number
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  error?: string
  /** Checks the text failed. */
  failed: string[]
  /** A gold answer, ignoring only the kind of quote, dash and space. */
  exact: boolean
  /** Word error rate against the nearest gold answer, ignoring case and punctuation. */
  wer: number
  /** Sol's verdict on a text that passed its checks but isn't a gold answer. */
  judged?: { ok: boolean; why: string }
}

interface Saved {
  model: string
  effort: Effort
  /** How the cases were put (`variants.mts`) and what was added to a local request. */
  variant?: string
  opts?: string
  set?: 'dev' | 'holdout'
  at: string
  runs: number
  judged: boolean
  price?: { input: number; output: number }
  results: Result[]
}

const CACHE = join(import.meta.dirname, '.cache')
const RESULTS = join(CACHE, 'dictate')
const JUDGED = join(CACHE, 'dictate-judge.json')
const LOCAL_URL = process.env.DICTATE_LOCAL_URL ?? 'http://127.0.0.1:8080'

// ── Matching ──

const norm = (t: string) => t.replace(/[‘’ʼ`]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim()
const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Without the punctuation between words: "hi mom" is in "Hi, Mom." */
const loose = (t: string) => t.replace(/[,;!?"()]/g, ' ').replace(/[.:](?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim()

/** `entry` in `text` as whole words, ignoring case, and punctuation unless the entry has some. */
function contains(text: string, entry: string): boolean {
  let e = norm(entry).toLowerCase()
  let t = norm(text).toLowerCase()
  if (!/[^\p{L}\p{N}\s']/u.test(e)) [e, t] = [loose(e), loose(t)]
  const start = /^[\p{L}\p{N}]/u.test(e) ? '(?<![\\p{L}\\p{N}])' : ''
  const end = /[\p{L}\p{N}]$/u.test(e) ? '(?![\\p{L}\\p{N}])' : ''
  return new RegExp(`${start}${escape(e)}${end}`, 'u').test(t)
}

function check(c: DictateCase, text: string): string[] {
  const failed: string[] = []
  if (c.empty) {
    if (text && norm(text) !== norm(c.value ?? '')) failed.push('should be empty')
    return failed
  }
  if (!text) return ['empty']
  for (const h of c.has ?? []) {
    const any = Array.isArray(h) ? h : [h]
    if (!any.some((e) => contains(text, e))) failed.push(`missing "${any.join('" or "')}"`)
  }
  for (const n of c.notHas ?? []) if (contains(text, n)) failed.push(`has "${n}"`)
  return failed
}

const words = (t: string) => norm(t).toLowerCase().split(' ').map((w) => w.replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}%]+$/gu, '')).filter(Boolean)

/** Word-level edit distance over the gold's length. */
function wer(text: string, gold: string): number {
  const a = words(text)
  const b = words(gold)
  if (!b.length) return a.length ? 1 : 0
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = row
  }
  return prev[b.length]! / b.length
}

// ── Models ──

interface Call {
  text: string
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
}

/** As `Thinker.quick` sends it: the gateway serves each model from its own maker first. */
async function gateway(model: string, effort: Effort, messages: Message[]): Promise<Call> {
  // `reasoning` doesn't reach Gemini 3's thinking level through the gateway (it still thinks for
  // hundreds of tokens); Google's own option does.
  const google = /^google\/gemini-3/.test(model) && (effort === 'none' || effort === 'minimal') ? { google: { thinkingConfig: { thinkingLevel: 'minimal' } } } : {}
  const result = await generateText({
    model,
    instructions: messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n'),
    messages: messages.filter((m) => m.role !== 'system') as { role: 'user' | 'assistant'; content: string }[],
    reasoning: effort,
    providerOptions: { gateway: { order: [model.split('/')[0]!] }, ...google },
  })
  return { text: result.text.trim(), inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, reasoningTokens: result.usage.outputTokenDetails?.reasoningTokens }
}

async function local(messages: Message[], extra: Record<string, unknown>): Promise<Call> {
  const res = await fetch(`${LOCAL_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, temperature: 0, max_tokens: 1024, chat_template_kwargs: { enable_thinking: false }, ...extra }),
  })
  if (!res.ok) throw new Error(`local server: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { choices: { message: { content: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number } }
  const text = body.choices[0]!.message.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  return { text, inputTokens: body.usage?.prompt_tokens, outputTokens: body.usage?.completion_tokens }
}

/** The quick model's reply as `Agent.dictate` takes it: trimmed, without quotes around it. */
const unquote = (t: string) => t.trim().replace(/^["“](.*)["”]$/s, '$1')

async function prices(): Promise<Record<string, { input: number; output: number }>> {
  try {
    const res = await fetch('https://ai-gateway.vercel.sh/v1/models')
    const { data } = (await res.json()) as { data: { id: string; pricing?: { input?: string; output?: string } }[] }
    return Object.fromEntries(data.filter((m) => m.pricing?.input && m.pricing.output).map((m) => [m.id, { input: Number(m.pricing!.input), output: Number(m.pricing!.output) }]))
  } catch {
    return {}
  }
}

// ── Judging ──

const JUDGE = `A voice assistant types into a field on the user's screen: from the end of the conversation, a small model writes what the field should hold now. You decide whether what it wrote gets the user what they meant. You get the input it read, one or more right answers (any of them is right, and others can be too), and what it wrote.

Right: the field ends up holding what they meant it to: the message they meant to send, the title or name they meant, a search that finds what they asked for. It can differ from the answers in form: capitals and punctuation, how a number, time or amount is written, a list written as a list, a word or two said another way with the same meaning, words about the person a message is to said to them, details that belong in another field left out of this one. While they are still speaking, the words so far are fine.

Wrong: it says something they didn't mean (a correction not applied, who does what reversed, a fact, name or number changed or lost, a question made a statement), it drops something they said that matters, it adds words of its own (even "Sure" or "Hey", a greeting, a sign-off, an answer, an explanation), it keeps their request to the assistant, filler, false starts or punctuation they said aloud, what the field held is lost or garbled when they asked to add to it, or it writes something when they haven't said yet what goes there.

Answer "right" or "wrong: <what they would get that they didn't mean>" on one line, and nothing else.`
/** Cached verdicts are kept per judge prompt: changing it judges every text again. */
const JUDGE_VERSION = 4

function judgePrompt(c: DictateCase, golds: string[], text: string): string {
  const answers = golds.map((g) => `- ${g ? JSON.stringify(g) : '(empty: nothing goes in yet)'}`).join('\n')
  return `# Input\n${input(c)}\n\n# Right answers\n${answers}\n\n# What it wrote\n${text ? JSON.stringify(text) : '(empty)'}`
}

// ── Report ──

const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : '—')
const quantile = (all: number[], q: number) => {
  const s = [...all].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : NaN
}
const label = (s: Saved) => `${s.model}${s.effort === 'provider-default' ? '' : `@${s.effort}`}${s.variant && s.variant !== 'prod' ? ` +${s.variant}` : ''}${s.opts ? ` ${s.opts}` : ''}`

/** A text passes when its checks pass and it is a gold answer, or (judged) Sol says it is right. */
const passed = (r: Result, judged: boolean) => !r.error && !r.failed.length && (r.exact || (judged ? !!r.judged?.ok : r.wer === 0))

function summarize(all: Saved[]) {
  const rows = all.map((s) => {
    const ok = s.results.filter((r) => !r.error)
    const ms = ok.map((r) => r.ms)
    const cost = s.price && ok.length ? (ok.reduce((sum, r) => sum + (r.inputTokens ?? 0) * s.price!.input + (r.outputTokens ?? 0) * s.price!.output, 0) / ok.length) * 1000 : NaN
    const reasoning = ok.reduce((sum, r) => sum + (r.reasoningTokens ?? 0), 0) / (ok.length || 1)
    return {
      s,
      pass: s.results.filter((r) => passed(r, s.judged)).length / s.results.length,
      row: [
        label(s),
        pct(s.results.filter((r) => passed(r, s.judged)).length, s.results.length) + (s.judged ? '' : '*'),
        pct(s.results.filter((r) => !r.error && !r.failed.length).length, s.results.length),
        pct(s.results.filter((r) => r.exact).length, s.results.length),
        (ok.reduce((sum, r) => sum + r.wer, 0) / (ok.length || 1)).toFixed(3),
        (quantile(ms, 0.5) / 1000).toFixed(2),
        (quantile(ms, 0.95) / 1000).toFixed(2),
        reasoning ? reasoning.toFixed(0) : '0',
        Number.isNaN(cost) ? '—' : `$${cost.toFixed(3)}`,
        String(s.results.filter((r) => r.error).length || ''),
      ],
    }
  })
  rows.sort((a, b) => b.pass - a.pass)
  const head = ['model', 'pass', 'checks', 'exact', 'WER', 'p50 s', 'p95 s', 'reason tok', '$/1k calls', 'errors']
  const width = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r.row[i]!.length)))
  const line = (cells: string[]) => cells.map((c, i) => (i ? c.padStart(width[i]!) : c.padEnd(width[i]!))).join('  ')
  console.log(`\n${line(head)}`)
  for (const r of rows) console.log(line(r.row))
  if (rows.some((r) => !r.s.judged)) console.log('* not judged: passes only word for word with a gold answer')

  // Pass rate by kind of case, in the same order.
  const kinds = [...new Set(all.flatMap((s) => s.results.map((r) => r.kind)))]
  const kw = Math.max(...kinds.map((k) => k.length))
  console.log(`\n${'kind'.padEnd(kw)}  ${rows.map((_, i) => `#${i + 1}`.padStart(5)).join('')}`)
  for (const k of kinds) {
    const cells = rows.map(({ s }) => {
      const of = s.results.filter((r) => r.kind === k)
      return pct(of.filter((r) => passed(r, s.judged)).length, of.length).padStart(5)
    })
    console.log(`${k.padEnd(kw)}  ${cells.join('')}`)
  }
  console.log(rows.map((r, i) => `#${i + 1} ${label(r.s)}`).join('  '))
}

const setDir = (set: 'dev' | 'holdout') => (set === 'holdout' ? join(RESULTS, 'holdout') : RESULTS)

function saved(set: 'dev' | 'holdout'): Saved[] {
  const dir = setDir(set)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Saved)
}

// ── Scoring ──

const goldFile = join(import.meta.dirname, 'dictate', 'gold.json')
const goldRaw: Record<string, string | string[]> = existsSync(goldFile) ? JSON.parse(readFileSync(goldFile, 'utf8')) : {}
/** Every right answer for a case, the preferred one first. */
const gold = (name: string): string[] | undefined => (name in goldRaw ? [goldRaw[name]!].flat() : undefined)
const judgeCache: Record<string, { ok: boolean; why: string }> = existsSync(JUDGED) ? JSON.parse(readFileSync(JUDGED, 'utf8')) : {}
const allCases = [...devCases, ...holdout]

/** Checks, gold and word error rate for a text, by the cases and gold as they are now. */
function score(r: Result): Result {
  const c = allCases.find((x) => x.name === r.name)
  if (!c || r.error) return r
  const g = gold(c.name)
  const failed = check(c, r.text)
  const exact = g ? g.some((a) => norm(r.text) === norm(a)) || (!!c.empty && !failed.length) : false
  return { ...r, kind: c.kind, failed, exact, wer: g ? Math.min(...g.map((a) => wer(r.text, a))) : NaN, judged: undefined }
}

/** Sol's verdict on each text that passed its checks but isn't a gold answer. */
async function judgeAll(results: Result[]) {
  const key = (r: Result) => `${JUDGE_VERSION}\u0000${r.name}\u0000${r.text}`
  const toJudge = results.filter((r) => !r.error && !r.failed.length && !r.exact && gold(r.name))
  // Each text once: runs often write the same one.
  const fresh = [...new Map(toJudge.filter((r) => !judgeCache[key(r)]).map((r) => [key(r), r])).values()]
  const batches = Array.from({ length: Math.ceil(fresh.length / JUDGE_BATCH) }, (_, i) => fresh.slice(i * JUDGE_BATCH, (i + 1) * JUDGE_BATCH))
  await pool(
    batches.map((batch) => async () => {
      const verdicts = await codexJudge(batch.map((r) => judgePrompt(allCases.find((x) => x.name === r.name)!, gold(r.name)!, r.text)))
      batch.forEach((r, i) => verdicts[i] && (judgeCache[key(r)] = verdicts[i]!))
      writeFileSync(JUDGED, JSON.stringify(judgeCache, null, 1))
    }),
    4,
  )
  for (const r of toJudge) r.judged = judgeCache[key(r)]
}

/** Texts judged per Codex call. */
const JUDGE_BATCH = 15
const JUDGE_SCHEMA = {
  type: 'object',
  properties: { verdicts: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, right: { type: 'boolean' }, why: { type: 'string' } }, required: ['id', 'right', 'why'], additionalProperties: false } } },
  required: ['verdicts'],
  additionalProperties: false,
}

/** Sol (GPT-6.1, low effort) through the local Codex CLI judges several texts in one call: a verdict for each, in order. */
async function codexJudge(items: string[]): Promise<({ ok: boolean; why: string } | undefined)[]> {
  const dir = mkdtempSync(join(tmpdir(), 'dictate-judge-'))
  const schema = join(dir, 'schema.json')
  const out = join(dir, 'out.json')
  writeFileSync(schema, JSON.stringify(JUDGE_SCHEMA))
  const prompt = `${JUDGE.replace(/Answer "right" or[^\n]*$/, '')}\nJudge each item below on its own. Don't use any tools or read any files. For each, give its id, right (true or false), and why: for a wrong one, what they would get that they didn't mean; for a right one, "right".\n\n${items.map((t, i) => `# Item ${i}\n${t}`).join('\n\n')}`
  await new Promise<void>((resolve, reject) => {
    const p = spawn('codex', ['exec', '-m', 'gpt-6.1-sol', '-c', 'model_reasoning_effort="low"', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-C', dir, '--output-schema', schema, '-o', out, '-'], { stdio: ['pipe', 'ignore', 'ignore'] })
    p.on('error', reject)
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`codex exited with ${code}`))))
    p.stdin.end(prompt)
  })
  const { verdicts } = JSON.parse(readFileSync(out, 'utf8')) as { verdicts: { id: number; right: boolean; why: string }[] }
  return items.map((_, i) => {
    const v = verdicts.find((x) => x.id === i)
    return v && { ok: v.right, why: v.right ? '' : v.why }
  })
}

// ── Run ──

const set = process.argv.includes('--holdout') ? 'holdout' : 'dev'
const cases = set === 'holdout' ? holdout : devCases

if (process.argv.includes('--report')) {
  summarize(saved(set))
  process.exit(0)
}

// `--rescore`: the saved runs of both sets scored again by the cases, gold and judge as they are now, without calling the models.
if (process.argv.includes('--rescore')) {
  loadEnv()
  for (const dir of [setDir('dev'), setDir('holdout')].filter((d) => existsSync(d))) {
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const s = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Saved
      s.results = s.results.map(score)
      if (s.judged) await judgeAll(s.results)
      writeFileSync(join(dir, f), JSON.stringify(s, null, 1))
    }
  }
  summarize(saved(set))
  process.exit(0)
}

const value = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}
const models = process.argv.flatMap((a, i) => (process.argv[i - 1] === '--model' ? [a] : []))
const filters = process.argv.slice(2).filter((a, i, args) => !a.startsWith('-') && !/^--(model|runs|concurrency|variant|opts)$/.test(args[i - 1] ?? ''))
const selected = cases.filter((c) => !filters.length || filters.some((f) => c.kind === f || c.name.includes(f)))
if (!models.length) {
  console.log(`${selected.length} ${set} cases (${[...new Set(selected.map((c) => c.kind))].join(', ')}). Name at least one --model to run them; --report compares the last runs.`)
  process.exit(0)
}

const variantName = value('variant') ?? 'prod'
const variant: Variant | undefined = variants[variantName]
if (!variant) throw new Error(`no variant "${variantName}": ${Object.keys(variants).join(', ')}`)
const opts = value('opts')
const runs = flag('runs', 1)
const judging = process.argv.includes('--judge')
const verbose = process.argv.includes('--verbose')
const needsGateway = models.some((m) => !m.startsWith('local/'))
if (needsGateway) loadEnv()
const priced = needsGateway ? await prices() : {}
mkdirSync(setDir(set), { recursive: true })
const missingGold = selected.filter((c) => !gold(c.name))
if (missingGold.length) console.log(`no gold yet for ${missingGold.length} cases: they count by their checks alone`)

const results: Saved[] = []
for (const spec of models) {
  const [model, effort = 'provider-default'] = spec.split('@') as [string, Effort]
  const isLocal = model.startsWith('local/')
  const extra = { ...variant.local, ...(opts ? JSON.parse(opts) : {}) }
  const send = (messages: Message[]) => (isLocal ? local(messages, extra) : gateway(model, effort, messages))
  // A variant with `refine` takes a second call: the first reply read back, then checked.
  const call = async (c: DictateCase): Promise<Call> => {
    const first = await send(variant.messages(c))
    if (!variant.refine) return first
    const draft = variant.parse ? variant.parse(first.text, c) : first.text
    const second = await send(variant.refine(c, draft))
    return { ...second, inputTokens: (first.inputTokens ?? 0) + (second.inputTokens ?? 0), outputTokens: (first.outputTokens ?? 0) + (second.outputTokens ?? 0) }
  }
  // One call first, so a cold connection or model load isn't counted.
  await call(selected[0]!).catch(() => {})
  const started = Date.now()
  const tasks = selected.flatMap((c) =>
    Array.from({ length: runs }, (_, run) => async (): Promise<Result> => {
      const t = performance.now()
      try {
        const out = await call(c)
        const ms = performance.now() - t
        const text = unquote(variant.parse ? variant.parse(out.text, c) : out.text)
        return score({ name: c.name, kind: c.kind, run, text, ms, inputTokens: out.inputTokens, outputTokens: out.outputTokens, reasoningTokens: out.reasoningTokens, failed: [], exact: false, wer: NaN })
      } catch (err) {
        return { name: c.name, kind: c.kind, run, text: '', ms: performance.now() - t, error: String(err).slice(0, 300), failed: ['error'], exact: false, wer: 1 }
      }
    }),
  )
  const out = await pool(tasks, flag('concurrency', isLocal ? 1 : 4))

  if (judging) await judgeAll(out)

  const s: Saved = { model, effort, variant: variantName, opts, set, at: new Date().toISOString(), runs, judged: judging, price: priced[model], results: out }
  // A filtered run is a look, not a result: only a full run replaces the saved one.
  if (!filters.length) writeFileSync(join(setDir(set), `${label(s).replace(/[^\w.@+-]+/g, '_')}.json`), JSON.stringify(s, null, 1))
  results.push(s)

  const wrong = out.filter((r) => !passed(r, judging))
  console.log(`\n${label(s)}: ${out.length - wrong.length}/${out.length} passed in ${((Date.now() - started) / 1000).toFixed(0)}s`)
  for (const r of verbose ? out : wrong) {
    const why = r.error ?? (r.failed.length ? r.failed.join('; ') : r.judged ? r.judged.why : `WER ${r.wer.toFixed(2)}`)
    console.log(`  ${passed(r, judging) ? '✓' : '✗'} ${r.name}${runs > 1 ? ` #${r.run + 1}` : ''}: ${JSON.stringify(r.text)}${passed(r, judging) ? '' : `  — ${why}`}`)
    if (!passed(r, judging) && gold(r.name)) console.log(`      gold: ${JSON.stringify(gold(r.name)![0])}`)
  }
}
summarize(results)
