/**
 * Answering from the page with Jev alone (packages/agent/src/answer.ts): no thinking calls. Each
 * case is a question about a saved page (`answer/pages`); it passes when Stanley says a right
 * answer, or declines where it should. Speaking a wrong answer is the failure that matters most.
 *
 *   pnpm eval:answer <filter...> | --all   [--runs N] [--concurrency N] [--verbose] [--background] [--set answer.speak=0.5]
 *
 * Paid: one to three Jev calls per case.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { answer, defaultConfig, longDate, type AnswerReport } from '@stanley/agent'
import { createDecisionClient } from '@stanley/jev'
import { cases, type AnswerCase } from './answer/cases.mts'
import { countedJev, flag, loadEnv, median, overrides, pool, select, usage } from './harness.mts'

const selected = select(cases, (c) => c.name, 'pnpm eval:answer')
if (!selected) process.exit(0)
loadEnv()

const config = overrides(defaultConfig).answer
const jev = countedJev(createDecisionClient())
const runs = flag('runs', 1)
const verbose = process.argv.includes('--verbose')
// `--background`: as if the page were found in the background, so answers say where they are from.
const onScreen = !process.argv.includes('--background')
// The day the pages were saved, so "next" and "this year" mean what they did then.
const today = longDate(new Date('2026-10-15T12:00:00'))

function page(name: string): { title: string; text: string } {
  const raw = readFileSync(join(import.meta.dirname, 'answer', 'pages', `${name}.md`), 'utf8')
  const [, meta = '', text = raw] = /^<!--(.*?)-->\n([\s\S]*)$/.exec(raw) ?? []
  // "<url> · <date> · <title>", or "contrived: <why> · <title>"; a title may hold "·" itself.
  const parts = meta.trim().split(' · ')
  return { title: parts.slice(meta.trim().startsWith('contrived') ? 1 : 2).join(' · '), text: text.trimEnd() }
}

function conversation(c: AnswerCase): string {
  const lines = c.utterances.map((u) => `User: ${u}`)
  if (c.said) lines.splice(-1, 0, `Stanley said: "${c.said}"`)
  return `## Conversation\n${lines.join('\n')}`
}

const norm = (t: string) => t.toLowerCase().replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ')

type Verdict = 'right' | 'wrong' | 'missed' | 'declined' | 'error'

function judge(c: AnswerCase, r: AnswerReport): { verdict: Verdict; why?: string } {
  if (r.outcome === 'decline') return { verdict: c.want === 'speak' ? 'missed' : 'declined' }
  if (c.want === 'decline') return { verdict: 'wrong', why: 'should have declined' }
  const said = norm(r.text!)
  const missing = (c.says ?? []).filter((s) => !(Array.isArray(s) ? s : [s]).some((alt) => said.includes(norm(alt))))
  if (missing.length) return { verdict: 'wrong', why: `missing ${missing.map((m) => JSON.stringify(m)).join(', ')}` }
  const bad = (c.notSays ?? []).filter((s) => said.includes(norm(s)))
  if (bad.length) return { verdict: 'wrong', why: `says ${bad.map((b) => JSON.stringify(b)).join(', ')}` }
  return { verdict: 'right' }
}

const results = await pool(
  selected.flatMap((c) =>
    Array.from({ length: runs }, () => async () => {
      const { title, text } = page(c.page)
      try {
        const r = await answer({ jev, text, title, onScreen, conversation: conversation(c), today, config })
        return { c, r, ...judge(c, r) }
      } catch (e) {
        const r: AnswerReport = { outcome: 'decline', mass: 0, notHere: 0, runs: [], passes: [], calls: 0, latencyMs: 0, inputTokens: 0 }
        return { c, r, verdict: 'error' as const, why: (e as Error).message.slice(0, 200) }
      }
    }),
  ),
  flag('concurrency', 4),
)

const MARK: Record<Verdict, string> = { right: 'ok  ', declined: 'ok  ', missed: 'MISS', wrong: 'WRONG', error: 'ERROR' }
for (const { c, r, verdict, why } of results) {
  const what = r.outcome === 'speak' ? `said "${r.say}"` : `declined (${r.reason})`
  const nums = `mass ${r.mass.toFixed(2)}, not here ${r.notHere.toFixed(2)}${r.answers === undefined ? '' : `, answers ${r.answers.toFixed(2)}, when ${r.when!.toFixed(2)}`}${r.agreed ? `, agree ${r.agreed.map((a) => (a ? 'same' : 'diff')).join('/')}` : ''}, ${r.passes.map((p) => (p.windows > 1 ? `${p.chunks}/${p.windows}` : p.chunks)).join('→')} passages, ${r.calls} calls, ${Math.round(r.latencyMs)} ms`
  console.log(`${MARK[verdict]} ${c.name} [${c.want}]: ${what}${why ? ` — ${why}` : ''}\n       ${nums}`)
  if (verbose || verdict === 'wrong' || verdict === 'missed') {
    for (const [i, pass] of r.passes.entries()) {
      console.log(`       pass ${i + 1}:`)
      for (const t of pass.top) console.log(`         ${t.p.toFixed(2)}  ${t.chunk.slice(0, 140)}`)
    }
    for (const run of r.runs.slice(0, 3)) console.log(`       run ${run.mass.toFixed(2)}: ${run.text.slice(0, 160)}`)
  }
}

const count = (v: Verdict) => results.filter((x) => x.verdict === v).length
const spoken = count('right') + count('wrong')
const answerable = results.filter((x) => x.c.want === 'speak').length
const speakRight = results.filter((x) => x.c.want === 'speak' && x.verdict === 'right').length
console.log(`\n${count('right') + count('declined')}/${results.length} passed · ${count('wrong')} wrong answers spoken · ${count('missed')} answerable declined${count('error') ? ` · ${count('error')} errors` : ''}`)
console.log(`Spoken: ${spoken}, ${spoken ? Math.round((count('right') / spoken) * 100) : 0}% right · answered ${speakRight}/${answerable} of those it should`)
console.log(`Latency p50 ${median(results.map((x) => x.r.latencyMs))}s · ${usage.jev} Jev calls, ${usage.jevInputTokens.toLocaleString()} input tokens`)
