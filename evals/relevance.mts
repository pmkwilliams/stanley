/**
 * Relevance on a large state: six big pages open, two in front of the user and four in the
 * background, over 4,000 elements between them. Each case asks for one element deep in one of
 * them, and checks that the agent's own ranking brings it into the steps on offer: Jev's, and
 * thinking's, and into what thinking reads next after it last read the screens for something else.
 * Calls no paid model: the embedding model runs on this computer.
 *
 * By default it ranks as the app does with its own relevance code: all the pages open at once, the
 * first decision ranks them for what the user said before, and every request comes `--after` ms
 * later (500). `--opened ms`: only the page asked about has just opened, the others have been open
 * long enough to be embedded. `--warm`: every element embedded first, to measure the ranking alone.
 *
 *   pnpm eval:relevance                 # every case
 *   pnpm eval:relevance mail shop       # cases whose name contains a filter
 *   pnpm eval:relevance --holdout       # the cases kept out of tuning
 *
 * Options: --after ms, --opened ms, --warm, --set key=value (as `pnpm eval`), --no-embed (words alone),
 * --verbose (each case's best-ranked steps).
 */
import { join } from 'node:path'
import { candidatesOf, candidateTexts, defaultConfig, EMBED_URL, llamaEmbed, rankingFor, Relevance, since, stepOptions, viewParts, type Candidate, type OptionSet, type ViewPart } from '@stanley/agent'
import { startEmbedModel } from '../apps/desktop/src/main/quick'
import { flag, overrides, sleep } from './harness.mts'
import { REAL_CASES, REAL_HOLDOUT, REAL_LAYOUT } from './real/cases.mts'
import { realContext } from './real/pages.mts'
import { SOURCES, TEST_SOURCES } from './real/sources.mts'
import { TEST_CASES, TEST_LAYOUT } from './real/test-cases.mts'
import { CASES, HOLDOUT } from './relevance/cases.mts'
import { arrange, context, extractAll, LAYOUT, SITES } from './relevance/state.mts'

/** A case: a request for an element of `site`, named exactly or matched (`target`, as an option without its app's). */
interface RelevanceCase {
  name: string
  site: string
  request: string
  target: string | RegExp
  before?: string
}

const filters = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !['--set', '--after', '--opened', '--before'].includes(all[i - 1]!))
const holdout = process.argv.includes('--holdout')
// `--real`: the saved real pages (real/), not the generated ones.
const real = process.argv.includes('--real')
// `--real --test`: the frozen test set, on pages no tuning has seen (real/test-cases.mts).
const test = real && process.argv.includes('--test')
const LAYOUT_USED = test ? TEST_LAYOUT : real ? REAL_LAYOUT : LAYOUT
const SITES_USED = test ? TEST_SOURCES : real ? SOURCES : SITES
const pool: RelevanceCase[] = test ? TEST_CASES : real ? (holdout ? REAL_HOLDOUT : REAL_CASES) : holdout ? HOLDOUT : CASES
const cases = filters.length ? pool.filter((c) => filters.some((f) => c.name.includes(f))) : pool
const config = overrides(defaultConfig)
const verbose = process.argv.includes('--verbose')
const warm = process.argv.includes('--warm')
const words = process.argv.includes('--no-embed')
const after = flag('after', 500)
const opened = process.argv.includes('--opened') ? flag('opened', 500) : undefined
/** What the user said before, when thinking last read the screens. */
const BEFORE = 'thanks'

const { screen, others } = arrange(await extractAll(SITES_USED, real ? realContext : context), LAYOUT_USED)
const candidates = candidatesOf(screen, others)
const apps = SITES_USED.map(({ id, title, description }) => ({ id, title, description }))
console.log(`${candidates.length} elements: ${[screen, ...others].map((s) => `${s.title} ${candidatesOf({ ...s, visible: true }).length}${s === screen ? ' (working on)' : s.visible ? ' (in front)' : ' (background)'}`).join(', ')}`)

const options = async (relevance: Relevance | undefined, request: string, limit: number, before = ''): Promise<OptionSet> =>
  stepOptions(screen, apps, limit, request, [], false, undefined, [], false, false, false, { others, ranking: await rankingFor(relevance, config.ranking, request, candidates, limit, before) })
/** `--before "…"`: what the user asked before every case that doesn't say, to see what an unrelated one costs. */
const beforeAll = process.argv.find((a, i) => process.argv[i - 1] === '--before') ?? ''
const texts = candidates.flatMap(candidateTexts)
const siteOf = (c: Candidate) => ('flat' in c ? (c.app ?? screen).id.split(':')[0]! : '')

/** Where a case's element is: the app Stanley works on, another in front of the user, or one in the background. */
const whereOf = (c: RelevanceCase) => (c.site === LAYOUT_USED.focused ? 'working on' : LAYOUT_USED.shown.includes(c.site) ? 'in front' : 'background')
const titleOf = (site: string) => [screen, ...others].find((s) => s.id.startsWith(`${site}:`))!.title

const all = stepOptions(screen, apps, Infinity, '', [], false, undefined, [], false, false, false, { others })
/** The option names of every element a case means: on its site, named as `target` says. */
const meant = new Map(
  cases.map((c) => {
    const prefix = c.site === LAYOUT_USED.focused ? '' : `${titleOf(c.site)} › `
    const names = Object.keys(all.criteria).filter((n) => {
      const t = all.targets.get(n)
      if (t?.kind !== 'element' || (t.app ? !t.app.id.startsWith(`${c.site}:`) : c.site !== LAYOUT_USED.focused) || !n.startsWith(prefix)) return false
      const own = n.slice(prefix.length).replace(/ \(\d+\)$/, '')
      return typeof c.target === 'string' ? own === c.target : c.target.test(own)
    })
    if (!names.length) throw new Error(`${c.name}: no element ${c.target} on ${c.site}`)
    return [c, names] as const
  }),
)
/** Where the first of `names` is among the elements on offer, from 1; null when none is. */
const rankIn = (o: OptionSet, names: string[]) => {
  const elements = Object.keys(o.criteria).filter((n) => o.targets.get(n)?.kind === 'element')
  const at = elements.findIndex((n) => names.includes(n))
  return at === -1 ? null : at + 1
}

/**
 * Ranks `c` as it would be `ms` after its page opened: the first decision then ranks the screens
 * for what the user said before, and thinking reads them so; then the request. One case at a
 * time, as the app makes one decision at a time, and what is still being embedded is let finish
 * before the next, so none is ranked with another's work in the way.
 */
async function rankCase(relevance: Relevance | undefined, c: RelevanceCase, ms: number) {
  // The page is there from now; the request comes `ms` after, however long the first decision took.
  const openedAt = performance.now()
  const before = since(viewParts(screen, await options(relevance, BEFORE, config.thinkingElements), others), new Map(), config.thinkingTop).seen
  const wait = openedAt + ms - performance.now()
  if (wait > 0) await sleep(wait)
  const embedded = relevance?.embedded(texts) ?? 0
  // One ranking, as one decision makes: Jev's steps and thinking's are the first of it.
  const ranking = await rankingFor(relevance, config.ranking, c.request, candidates, config.thinkingElements, c.before ?? beforeAll)
  const offer = (limit: number) => stepOptions(screen, apps, limit, c.request, [], false, undefined, [], false, false, false, { others, ranking })
  const jev = offer(config.maxElements)
  const thinking = offer(config.thinkingElements)
  await relevance?.idle()
  return { c, before, jev, thinking, embedded }
}

await startEmbedder()
const ranked: { c: RelevanceCase; before: Map<string, ViewPart>; jev: OptionSet; thinking: OptionSet; embedded: number }[] = []
const unique = new Set(texts).size
if (words) {
  console.log('Ranked by words alone.')
  for (const c of cases) ranked.push(await rankCase(undefined, c, 0))
} else if (warm) {
  const relevance = new Relevance(llamaEmbed())
  relevance.prepare(texts)
  await relevance.idle()
  console.log('Ranked with every element embedded.')
  for (const c of cases) ranked.push(await rankCase(relevance, c, 0))
} else if (opened !== undefined) {
  // Only the page asked about has just opened; the others have been open long enough to be embedded.
  console.log(`Ranked by the app's relevance, ${opened} ms after the page asked about opened, the others embedded.`)
  for (const c of cases) {
    const relevance = new Relevance(llamaEmbed())
    relevance.prepare(candidates.filter((x) => siteOf(x) !== c.site).flatMap(candidateTexts))
    await relevance.idle()
    ranked.push(await rankCase(relevance, c, opened))
  }
} else {
  console.log(`Ranked by the app's relevance, ${after} ms after all the pages opened at once.`)
  for (const c of cases) ranked.push(await rankCase(new Relevance(llamaEmbed()), c, after))
}
if (!words) console.log(`Elements embedded when asked: ${Math.round(ranked.reduce((n, r) => n + r.embedded, 0) / ranked.length)} of ${unique} on average.`)
const rows = ranked.map(({ c, before, jev, thinking }) => {
  const names = meant.get(c)!
  const name = names[0]!
  // Thinking read the screens when the user said something else; what does it read now?
  const next = since(viewParts(screen, thinking, others), before, config.thinkingTop)
  const lines = next.text.split('\n')
  const sent = names.some((n) => lines.some((l) => l.startsWith(`- [${n}] `) || l === `- [${n}]`))
  const stood = !sent && [...before.values()].some((p) => names.some((n) => p.names.indexOf(n) !== -1 && p.names.indexOf(n) < config.thinkingTop) && next.seen.get(p.key) === p)
  const read = sent ? 'sent' : stood ? 'already read' : 'not read'
  const r = { c, jev: rankIn(jev, names), thinking: rankIn(thinking, names), read, ok: false }
  r.ok = r.jev !== null && r.thinking !== null && read !== 'not read'
  if (verbose || !r.ok) {
    console.log(`\n${r.ok ? '✓' : '✗'} ${c.name}: "${c.request}" → [${name}]`)
    console.log(`   Jev's best: ${Object.keys(jev.criteria).filter((n) => jev.targets.get(n)?.kind === 'element').slice(0, 5).map((n) => `[${n}]`).join(', ')}`)
  }
  return r
})

console.log(`\ncase                          where        Jev (of ${config.maxElements})  thinking (of ${config.thinkingElements})  thinking reads it`)
for (const r of rows) console.log(`${r.ok ? ' ' : '✗'} ${r.c.name.padEnd(28)} ${whereOf(r.c).padEnd(12)} ${String(r.jev ?? '—').padEnd(14)} ${String(r.thinking ?? '—').padEnd(19)} ${r.read}`)
for (const where of ['working on', 'in front', 'background']) {
  const mine = rows.filter((r) => whereOf(r.c) === where)
  if (mine.length) console.log(`  ${where}: ${mine.filter((r) => r.ok).length}/${mine.length}`)
}
const inTop = (k: number) => rows.filter((r) => r.jev !== null && r.jev <= k).length
// How high the element is among Jev's steps: 1 when first, ½ when second, 0 when not offered.
const mrr = (rs: typeof rows) => (rs.reduce((n, r) => n + (r.jev ? 1 / r.jev : 0), 0) / rs.length).toFixed(3)
const paraphrased = rows.filter((r) => r.c.name.includes('other-words'))
console.log(`\n${rows.filter((r) => r.ok).length}/${rows.length} cases passed; Jev's first 10: ${inTop(10)}, first 30: ${inTop(30)}; mean reciprocal rank ${mrr(rows)} (own words ${mrr(rows.filter((r) => !paraphrased.includes(r)))}, other words ${mrr(paraphrased)})`)
// The embedding model's server, started for this run, would keep it open.
process.exit(0)

/** The embedding model's server, as the app starts it. */
async function startEmbedder(): Promise<void> {
  if (words) return
  await startEmbedModel(join(import.meta.dirname, '..', 'models'))
  for (let i = 0; i < 120 && !(await fetch(`${EMBED_URL}/health`).then((r) => r.ok, () => false)); i++) await sleep(250)
}
