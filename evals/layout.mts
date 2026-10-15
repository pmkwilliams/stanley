/**
 * What the screen shows once Stanley has done what the user asked, decided by Jev alone. Two
 * questions in one call: which apps are on the screen (every set of one to three, as one option
 * each), and which of them are on the left. Together they make one of the layouts: one app, two
 * side by side, or three with two stacked on one side. Each case passes when the arrangement is one
 * it accepts (`layout/cases.mts`).
 *
 *   pnpm eval:layout <filter...> | --all   [--runs N] [--concurrency N] [--verbose] [--model …]
 *     --image     Jev also sees a picture of the screen as it is (jev-1.14.0 unless --model)
 *     --no-line   …and isn't told in words what is on it
 *     --check     instead: does Jev, shown the screen after (in words, or with --image as a picture),
 *                 accept the right arrangement and turn down wrong ones?
 *
 * Paid: one Jev call per case, three or so with --check.
 */
import { longDate, SYSTEM_PROMPT } from '@stanley/agent'
import { experimental_decide } from 'ai'
import { cases, type LayoutCase } from './layout/cases.mts'
import { APPS, markdown, screens, states } from './layout/scene.mts'
import { flag, loadEnv, median, pool, select, usage } from './harness.mts'

const selected = select(cases, (c) => c.name, 'pnpm eval:layout')
if (!selected) process.exit(0)
loadEnv()

const image = process.argv.includes('--image')
const line = !process.argv.includes('--no-line')
const check = process.argv.includes('--check')
const modelAt = process.argv.indexOf('--model')
const model = modelAt !== -1 ? process.argv[modelAt + 1]! : image ? 'typesafe-ai/jev-1.14.0' : 'typesafe-ai/jev'
const runs = flag('runs', 1)
const verbose = process.argv.includes('--verbose')
const shots = image ? await screens() : null

const title = (id: string) => APPS[id]!.title

const SCREEN_PROMPT = `## The user's screen
Up to three apps fit on the screen at once: one alone fills it, two sit side by side, and with three, two are stacked on one side. When Stanley has done what the user asked, the screen shows what they asked to see, what they are in the middle of, and what Stanley did that they would want to look at. Work they don't need to see stays in the background.`

/** `email | tasks + weather` → sides of app ids; `null` (home) → none. */
const parse = (arrangement: string | null): string[][] => (arrangement ? arrangement.split('|').map((side) => side.split('+').map((a) => a.trim())) : [])

/** Sides compared with stacking order left out. */
const key = (sides: string[][]) => sides.map((s) => [...s].sort().join(' + ')).join(' | ')

function describe(sides: string[][]): string {
  if (!sides.length) return 'The home screen, listing the apps.'
  if (sides.length === 1) return `${title(sides[0]![0]!)}, filling the screen.`
  const at = (side: string[], where: string) => (side.length === 1 ? [`${title(side[0]!)} (${where})`] : side.map((a, i) => `${title(a)} (${i ? 'bottom' : 'top'} ${where})`))
  return `${[...at(sides[0]!, 'left'), ...at(sides[1]!, 'right')].join(', ')}.`
}

/** What Jev reads: the prompt, what is on the screen (unless `--no-line`), the conversation, and the screen Stanley worked on. */
function state(c: LayoutCase, all: Record<string, unknown>, after?: { sides: string[][]; picture: boolean }): string {
  const lines = [SYSTEM_PROMPT, `Today is ${longDate(new Date('2026-10-15T12:00:00'))}.`, SCREEN_PROMPT]
  if (after || line) lines.push(`${after ? 'Before, on the screen' : 'Now on the screen'}: ${describe(parse(c.on))}${!after && image ? ' A picture of it follows.' : ''}`)
  else if (image) lines.push('A picture of the screen as it is now follows.')
  lines.push('## Conversation', ...c.conversation)
  if (c.worked) {
    const shown = parse(c.on).flat().includes(c.worked)
    lines.push('', `## Screen: ${title(c.worked)} (${shown ? 'in front of the user' : "in the background, the user can't see it"})`, markdown(c.worked, all[c.worked]))
  }
  if (after) lines.push('', after.picture ? 'Stanley has now arranged the screen. A picture of it follows.' : `Stanley has now arranged the screen. Now on the screen: ${describe(after.sides)}`)
  return lines.join('\n')
}

type Questions = Record<string, { instructions: string; options: Record<string, string> }>

/** How long each Jev call took, apart from drawing the screen. */
const jevMs: number[] = []

async function decide(text: string, picture: Buffer | undefined, questions: Questions) {
  const started = performance.now()
  const r = await experimental_decide({
    model,
    state: picture ? [{ type: 'text', text }, { type: 'file', data: picture, mediaType: 'image/png' }] : text,
    questions: Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, { type: 'choice' as const, instructions: q.instructions, criteria: q.options }])),
  })
  jevMs.push(performance.now() - started)
  usage.jev++
  usage.jevInputTokens += r.usage.inputTokens ?? 0
  return Object.fromEntries(Object.entries(r.answers).map(([id, a]) => [id, (a as { probabilities: Record<string, number> }).probabilities]))
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
  const t = set.map(title)
  return t.length === 1 ? t[0]! : `${t.slice(0, -1).join(', ')} and ${t.at(-1)}`
}

const top = (p: Record<string, number>) => Object.entries(p).sort(([, a], [, b]) => b - a).slice(0, 3).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')

async function arrange(c: LayoutCase): Promise<{ sides: string[][]; detail: string[] }> {
  const all = await states(c.steps)
  const picture = shots ? await shots.shoot(parse(c.on), all) : undefined
  const every = sets(Object.keys(APPS))
  const show = Object.fromEntries(every.map((set) => [names(set), set.length === 1 ? `${names(set)} fills the screen on its own` : `${names(set)} side by side`]))
  const left = Object.fromEntries(every.filter((set) => set.length <= 2).map((set) => [names(set), `${names(set)} on the left`]))
  const p = await decide(state(c, all), picture, {
    show: { instructions: 'When Stanley has done what the user asked, which apps are on the screen?', options: show },
    left: { instructions: 'When Stanley has done what the user asked, which apps are on the left side of the screen? (Ignored when one app fills it.)', options: left },
  })
  const visible = every.reduce((a, b) => ((p.show![names(b)] ?? 0) > (p.show![names(a)] ?? 0) ? b : a))
  let sides = [visible]
  if (visible.length > 1) {
    // The likeliest left side these apps can make: at least one app on each side, at most two.
    const pl = (set: string[]) => p.left![names(set)] ?? 0
    const fits = every.filter((l) => l.every((a) => visible.includes(a)) && l.length < visible.length && visible.length - l.length <= 2 && l.length <= 2)
    const best = fits.sort((a, b) => pl(b) - pl(a))[0]!
    sides = [best, visible.filter((a) => !best.includes(a))]
  }
  return { sides, detail: [`show: ${top(p.show!)}`, `left: ${top(p.left!)}`] }
}

/** The arrangements a check is tried on: the right one, and the likely wrong ones (the screen left as it was, the app worked on alone, the sides swapped). */
function candidates(c: LayoutCase): { sides: string[][]; right: boolean }[] {
  const ok = new Set(c.want.map((w) => key(parse(w))))
  const right = parse(c.want[0]!)
  const wrong = [parse(c.on), c.worked ? [[c.worked]] : [], right.length === 2 ? [right[1]!, right[0]!] : []].filter((s) => s.length && !ok.has(key(s)))
  const seen = new Set<string>()
  return [{ sides: right, right: true }, ...wrong.map((sides) => ({ sides, right: false }))].filter((x) => !seen.has(key(x.sides)) && seen.add(key(x.sides)))
}

const VERDICT = {
  yes: 'The screen shows what the user would want to see now: what they asked to see, what they are in the middle of, or what Stanley did that they would want to look at.',
  no: 'It does not: something the user wants to see is missing or on the wrong side, or it shows something they asked to hide or have no need to see.',
}

async function judge(c: LayoutCase) {
  const all = await states(c.steps)
  return Promise.all(
    candidates(c).map(async ({ sides, right }) => {
      const picture = shots ? await shots.shoot(sides, all) : undefined
      const p = await decide(state(c, all, { sides, picture: !!picture }), picture, { ok: { instructions: 'Does the screen now show what the user would want to see?', options: VERDICT } })
      const yes = p.ok!.yes ?? 0
      return { sides, right, yes, correct: right ? yes >= 0.5 : yes < 0.5 }
    }),
  )
}

try {
  if (check) {
    const results = await pool(selected.flatMap((c) => Array.from({ length: runs }, () => async () => ({ c, verdicts: await judge(c) }))), flag('concurrency', 4))
    for (const { c, verdicts } of results) {
      for (const v of verdicts) console.log(`${v.correct ? 'ok  ' : 'FAIL'} ${c.name}: ${key(v.sides)} [${v.right ? 'right' : 'wrong'}] P(yes) ${v.yes.toFixed(2)}`)
    }
    const all = results.flatMap((r) => r.verdicts)
    const rights = all.filter((v) => v.right)
    const wrongs = all.filter((v) => !v.right)
    const mean = (xs: number[]) => (xs.reduce((a, b) => a + b, 0) / (xs.length || 1)).toFixed(2)
    console.log(`\n${model}, after shown ${image ? 'as a picture' : 'in words'}`)
    console.log(`Right accepted ${rights.filter((v) => v.correct).length}/${rights.length} (mean P(yes) ${mean(rights.map((v) => v.yes))}) · wrong turned down ${wrongs.filter((v) => v.correct).length}/${wrongs.length} (mean P(yes) ${mean(wrongs.map((v) => v.yes))})`)
  } else {
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
      if (verbose || !ok) for (const d of detail) console.log(`       ${d}`)
    }
    console.log(`\n${model}${image ? `, with a picture${line ? ' and in words' : ', not in words'}` : ''}`)
    console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`)
  }
  console.log(`${usage.jev} Jev calls, ${usage.jevInputTokens.toLocaleString()} input tokens, Jev p50 ${median(jevMs)}s`)
} finally {
  await shots?.close()
}
