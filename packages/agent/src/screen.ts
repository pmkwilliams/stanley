import type { Answer, Question } from '@stanley/jev'
import type { AppEntry } from './world'

/**
 * What is on the screen, left to right: no sides is the home screen; one side of one app fills
 * the screen; two sides sit side by side, with up to two apps stacked on a side, three at most.
 */
export type Sides = string[][]

/** Apps Jev chooses among: every set of up to three of 11 is 231 options, and home makes 232, under Jev's 255. */
const MAX_CANDIDATES = 11

/**
 * The home screen, named apart from how it reads on the screen (`describeScreen`): an option
 * echoing that drew answers to it (eval:layout).
 */
export const HOME_OPTION = 'No apps'

/**
 * How the screen works, for both models, when Stanley can lay it out. What is on it is in the
 * conversation, where it changed (`layoutLine`), so both read it in the same place and thinking's
 * history keeps its cache. Jev, told it after the conversation, kept to the screen as it was (eval:layout).
 */
export const SCREEN_PROMPT = `## The user's screen
Up to three apps fit on the screen at once: one alone fills it, two sit side by side, and with three, two are stacked on one side. When you have done what the user asked, the screen shows what they asked to see, what they are in the middle of, and what you did that they would want to look at. Work they don't need to see stays in the background. On the home screen the user is in the middle of nothing, so what you did comes into view. Each time what is on the screen changes, the conversation says so ("On the screen now: …").`

/** The two questions, and what their options name: frozen with them, so the answers map back to apps. */
export interface ScreenAsk {
  show: Question
  left: Question
  /** `show` option → the apps it puts on the screen (none for home). */
  sets: Map<string, string[]>
  /** `left` option → the apps it puts on the left. */
  lefts: Map<string, string[]>
  /** What was on the screen when they were asked. */
  before: Sides
}

/** The screen Jev's answers make, and how sure it was of them. */
export interface ScreenChoice {
  sides: Sides
  /** P of the chosen `show` option. */
  confidence: number
  /** P of the chosen left side, or null when there is one side or none. */
  left: number | null
}

export const sidesKey = (sides: Sides) => sides.map((side) => side.join(' + ')).join(' | ')

export const sameSides = (a: Sides, b: Sides) => sidesKey(a) === sidesKey(b)

/** A screen the shell can show: home, one app, or two sides of one or two apps, three at most, none twice. */
export function validSides(sides: Sides): boolean {
  const apps = sides.flat()
  if (new Set(apps).size !== apps.length || sides.some((side) => !side.length)) return false
  if (sides.length === 0) return true
  if (sides.length === 1) return sides[0]!.length === 1
  return sides.length === 2 && apps.length <= 3 && sides.every((side) => side.length <= 2)
}

/** What is on the screen, where it changed in the conversation, as both models read it. */
export const layoutLine = (shown: string) => `On the screen now: ${shown}`

/** How the screen reads in Jev's state: `Email (left), Tasks (top right), Weather (bottom right).` */
export function describeScreen(sides: Sides, title: (id: string) => string): string {
  if (!sides.length) return 'The home screen.'
  if (sides.length === 1) return `${title(sides[0]![0]!)}, filling the screen.`
  const at = (side: string[], where: string) => (side.length === 1 ? [`${title(side[0]!)} (${where})`] : side.map((id, i) => `${title(id)} (${i ? 'bottom' : 'top'} ${where})`))
  return `${[...at(sides[0]!, 'left'), ...at(sides[1]!, 'right')].join(', ')}.`
}

/**
 * The questions for what the screen shows once Stanley has done what the user asked: which apps
 * (every set of up to three, or none), and which of them are on the left. `apps` are those that
 * can be shown; the ones on the screen and `focus` come first when there are too many.
 */
export function screenQuestions(apps: AppEntry[], before: Sides, focus: string | null): ScreenAsk {
  const shown = before.flat()
  const first = (a: AppEntry) => (shown.includes(a.id) ? 0 : a.id === focus ? 1 : 2)
  const unique = [...new Map(apps.map((a) => [a.id, a])).values()]
  const candidates = unique
    .map((a, i) => ({ a, i }))
    .sort((x, y) => first(x.a) - first(y.a) || x.i - y.i)
    .slice(0, MAX_CANDIDATES)
    .sort((x, y) => x.i - y.i)
    .map((x) => x.a)
  // An app is named by its title; two with the same title are told apart by their ids.
  const counts = new Map<string, number>()
  for (const a of candidates) counts.set(a.title, (counts.get(a.title) ?? 0) + 1)
  const label = new Map(candidates.map((a) => [a.id, counts.get(a.title)! > 1 ? `${a.title} (${a.id})` : a.title]))
  const names = (set: string[]) => {
    const t = set.map((id) => label.get(id)!)
    return t.length === 1 ? t[0]! : `${t.slice(0, -1).join(', ')} and ${t.at(-1)}`
  }

  const sets = new Map<string, string[]>()
  const walk = (from: number, chosen: string[]) => {
    if (chosen.length) sets.set(names(chosen), chosen)
    if (chosen.length === 3) return
    for (let i = from; i < candidates.length; i++) walk(i + 1, [...chosen, candidates[i]!.id])
  }
  walk(0, [])
  // Last: first, it drew answers toward the screen as it is (eval:layout).
  sets.set(HOME_OPTION, [])
  const lefts = new Map([...sets].filter(([, set]) => set.length >= 1 && set.length <= 2))
  const show = Object.fromEntries([...sets].map(([name, set]) => [name, !set.length ? 'No app is on the screen' : set.length === 1 ? `${name} fills the screen on its own` : `${name} side by side`]))
  const left = Object.fromEntries([...lefts].map(([name]) => [name, `${name} on the left`]))
  return {
    show: { instructions: 'When you have done what the user asked, which apps are on the screen?', options: show },
    left: { instructions: 'When you have done what the user asked, which apps are on the left side of the screen? (Ignored when one app or none is on it.)', options: left },
    sets,
    lefts,
    before,
  }
}

/**
 * The screen the answers make: the apps `show` chose, and of the ways they can sit (at least one on
 * each side, at most two), the one `left` makes likeliest. Below `minLeft`, apps already on the
 * screen keep their sides. Within a side, apps keep the order they had; new ones go after.
 */
export function chooseScreen(ask: ScreenAsk, answers: { show: Answer; left: Answer }, minLeft: number): ScreenChoice {
  const p = (q: Answer, name: string) => q.probabilities[name] ?? (q.choice === name ? q.confidence : 0)
  const [showName, visible] = [...ask.sets].reduce((best, entry) => (p(answers.show, entry[0]) > p(answers.show, best[0]) ? entry : best))
  const confidence = p(answers.show, showName)
  if (visible.length <= 1) return { sides: visible.length ? [visible] : [], confidence, left: null }

  const order = (side: string[]) => {
    const was = ask.before.flat()
    return [...side].sort((a, b) => (was.includes(a) ? was.indexOf(a) : 99) - (was.includes(b) ? was.indexOf(b) : 99) || visible.indexOf(a) - visible.indexOf(b))
  }
  const fits = [...ask.lefts].filter(([, l]) => l.every((id) => visible.includes(id)) && l.length < visible.length && visible.length - l.length <= 2)
  const [leftName, leftSide] = fits.reduce((best, entry) => (p(answers.left, entry[0]) > p(answers.left, best[0]) ? entry : best))
  const left = p(answers.left, leftName)
  const before = ask.before
  const sameApps = before.length === 2 && before.flat().length === visible.length && visible.every((id) => before.flat().includes(id))
  if (left < minLeft && sameApps) return { sides: before.map((side) => [...side]), confidence, left }
  return { sides: [order(leftSide), order(visible.filter((id) => !leftSide.includes(id)))], confidence, left }
}
