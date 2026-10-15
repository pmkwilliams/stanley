/**
 * What the screen shows once Stanley has done what the user asked, decided by Jev alone. Two
 * questions in one call: which apps are on the screen (every set of one to three, as one option
 * each), and which of them are on the left. Together they make one of the layouts: one app, two
 * side by side, or three with two stacked on one side. Each case passes when the arrangement is one
 * it accepts (`layout/cases.mts`).
 *
 *   pnpm eval:layout <filter...> | --all   [--runs N] [--concurrency N] [--verbose] [--model typesafe-ai/jev-1.14.0]
 *
 * Paid: one Jev call per case.
 */
import { longDate, SYSTEM_PROMPT } from '@stanley/agent'
import { createJevClient } from '@stanley/jev'
import { cases, type LayoutCase } from './layout/cases.mts'
import { countedJev, flag, loadEnv, median, pool, select, usage } from './harness.mts'

const selected = select(cases, (c) => c.name, 'pnpm eval:layout')
if (!selected) process.exit(0)
loadEnv()

const modelAt = process.argv.indexOf('--model')
const jev = countedJev(createJevClient({ model: modelAt === -1 ? undefined : process.argv[modelAt + 1] }))
const runs = flag('runs', 1)
const verbose = process.argv.includes('--verbose')

const APPS: Record<string, string> = {
  email: 'Email',
  tasks: 'Tasks',
  music: 'Music',
  weather: 'Weather',
  lights: 'Lights',
  settings: 'Settings',
  web: 'Web',
}

const SCREEN_PROMPT = `## The user's screen
Up to three apps fit on the screen at once: one alone fills it, two sit side by side, and with three, two are stacked on one side. When Stanley has done what the user asked, the screen shows what they asked to see, what they are in the middle of, and what Stanley did that they would want to look at. Work they don't need to see stays in the background.`

/** `email | tasks + weather` → sides of app ids. */
const parse = (arrangement: string): string[][] => arrangement.split('|').map((side) => side.split('+').map((a) => a.trim()))

/** Sides compared with stacking order left out. */
const key = (sides: string[][]) => sides.map((s) => [...s].sort().join(' + ')).join(' | ')

function describe(arrangement: string | null): string {
  if (!arrangement) return 'The home screen, listing the apps.'
  const sides = parse(arrangement)
  if (sides.length === 1) return `${APPS[sides[0]![0]!]}, filling the screen.`
  const at = (side: string[], where: string) => (side.length === 1 ? [`${APPS[side[0]!]} (${where})`] : side.map((a, i) => `${APPS[a]} (${i ? 'bottom' : 'top'} ${where})`))
  return `${[...at(sides[0]!, 'left'), ...at(sides[1]!, 'right')].join(', ')}.`
}

function state(c: LayoutCase): string {
  const lines = [SYSTEM_PROMPT, `Today is ${longDate(new Date('2026-10-15T12:00:00'))}.`, SCREEN_PROMPT, `Now on the screen: ${describe(c.on)}`, '## Conversation', ...c.conversation]
  if (c.worked) {
    const shown = c.on !== null && parse(c.on).flat().includes(c.worked.app)
    lines.push('', `## Screen: ${APPS[c.worked.app]} (${shown ? 'in front of the user' : "in the background, the user can't see it"})`, c.worked.markdown)
  }
  return lines.join('\n')
}

/** Every set of one to three apps. */
function sets(ids: string[]): string[][] {
  const out: string[][] = []
  const walk = (from: number, chosen: string[]) => {
    if (chosen.length) out.push(chosen)
    if (chosen.length === 3) return
    for (let i = from; i < ids.length; i++) walk(i + 1, [...chosen, ids[i]!])
  }
  walk(0, [])
  return out
}

/** Named as a person would: "Email", "Email and Tasks", "Email, Tasks and Weather". */
const names = (set: string[]) => {
  const t = set.map((a) => APPS[a]!)
  return t.length === 1 ? t[0]! : `${t.slice(0, -1).join(', ')} and ${t.at(-1)}`
}

async function arrange(c: LayoutCase): Promise<{ sides: string[][]; detail: string[] }> {
  const all = sets(Object.keys(APPS))
  const show = Object.fromEntries(all.map((set) => [names(set), set.length === 1 ? `${names(set)} fills the screen on its own` : `${names(set)} side by side`]))
  const left = Object.fromEntries(all.filter((set) => set.length <= 2).map((set) => [names(set), `${names(set)} on the left`]))
  const { answers } = await jev.decide({
    state: state(c),
    questions: {
      show: { instructions: 'When Stanley has done what the user asked, which apps are on the screen?', options: show },
      left: { instructions: 'When Stanley has done what the user asked, which apps are on the left side of the screen? (Ignored when one app fills it.)', options: left },
    },
  })
  const visible = all.find((set) => names(set) === answers.show!.choice)!
  let sides = [visible]
  if (visible.length > 1) {
    // The likeliest left side these apps can make: at least one app on each side, at most two.
    const p = (set: string[]) => answers.left!.probabilities[names(set)] ?? 0
    const fits = all.filter((l) => l.every((a) => visible.includes(a)) && l.length < visible.length && visible.length - l.length <= 2 && l.length <= 2)
    const best = fits.sort((a, b) => p(b) - p(a))[0]!
    sides = [best, visible.filter((a) => !best.includes(a))]
  }
  const top = (q: string) => Object.entries(answers[q]!.probabilities).sort(([, a], [, b]) => b - a).slice(0, 3).map(([k, p]) => `${k} ${p.toFixed(2)}`).join(', ')
  return { sides, detail: [`show: ${top('show')}`, `left: ${top('left')}`] }
}

const results = await pool(
  selected.flatMap((c) =>
    Array.from({ length: runs }, () => async () => {
      const started = performance.now()
      try {
        const { sides, detail } = await arrange(c)
        const got = key(sides)
        return { c, ok: c.want.some((w) => key(parse(w)) === got), got, detail, ms: performance.now() - started }
      } catch (e) {
        return { c, ok: false, got: `error: ${(e as Error).message.slice(0, 200)}`, detail: [] as string[], ms: performance.now() - started }
      }
    }),
  ),
  flag('concurrency', 4),
)

for (const { c, ok, got, detail, ms } of results) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.on ?? 'home'} → ${got}${ok ? '' : `  (want ${c.want.join(' or ')})`}  ${Math.round(ms)} ms`)
  if (verbose || !ok) for (const line of detail) console.log(`       ${line}`)
}

const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} passed`)
console.log(`Latency p50 ${median(results.map((r) => r.ms))}s · ${usage.jev} Jev calls, ${usage.jevInputTokens.toLocaleString()} input tokens`)
