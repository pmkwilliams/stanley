import type { AgentNode } from '@stanley/app-sdk'
import type { KnownFile } from './files'
import type { Sides } from './screen'
import type { Skill } from './skills'
import { domainOf, sameUrl, type KnownPage } from './web'
import type { AppEntry, Screen } from './world'

/** What a step does when chosen. */
export type Target =
  /** `app`: the screen of the app it is in, when that isn't the one Stanley works on. */
  | { kind: 'element'; node: AgentNode; role: string; app?: Screen }
  | { kind: 'app'; app: AppEntry }
  | { kind: 'back' }
  | { kind: 'home' }
  | { kind: 'lock' }
  | { kind: 'page'; url: string; title: string }
  /** Looked at in the background: a folder of the user's files is listed (`''` is the whole folder), a file read. */
  | { kind: 'folder'; path: string }
  | { kind: 'file'; path: string }
  /** Read in the background, so what it says to do is in the conversation. */
  | { kind: 'skill'; skill: Skill }
  /**
   * The screen laid out as Jev's `show` and `left` answers say (see screen.ts): Jev's alone.
   * Offered without `sides`; run with them, and `fresh` to drop it if it goes stale while apps open.
   */
  | { kind: 'arrange'; sides?: Sides; fresh?: () => boolean }
  /** A web search in the background, its query written from what the user said: Jev's alone. */
  | { kind: 'search' }
  /** Saying something to the user, which thinking writes: Jev's alone, since thinking's text is what it says. */
  | { kind: 'respond' }

export interface OptionSet {
  /** Option name → description, sent to Jev as one question's options. */
  criteria: Record<string, string | null>
  targets: Map<string, Target>
}

export const NAVIGATION = {
  back: 'Go back to the previous screen.',
  home: 'Go to the home screen, which lists the apps.',
  lock: 'Lock the computer: go to the lock screen.',
  files: "List the user's files, in the background.",
  arrange: 'Move, show or hide the windows on the screen.',
  search: 'Search the web for what the user asked, in the background.',
  respond: 'Say something to the user: the answer to what they asked, a question for them, or what is ready before it is sent.',
} as const

export function roleOf(node: AgentNode): string {
  return node.role ?? { location: 'link', action: 'button', input: 'field', group: 'group' }[node.kind]
}

/**
 * Navigation is cheap to undo, so it may run while the user is still speaking, and so may looking at
 * files and reading a skill. Locking isn't: it waits until they finish. Nor are searching and
 * responding: what to search for or say hinges on all their words.
 */
export function navigates(target: Target): boolean {
  if (target.kind === 'element') return target.node.kind === 'location'
  return target.kind !== 'lock' && target.kind !== 'search' && target.kind !== 'respond'
}

/** How an option reads to Jev: its role, then whatever the screen shows about it. */
function describe(node: AgentNode): string {
  const parts = [roleOf(node)]
  if (node.kind === 'input') parts.push(node.value ? `containing "${node.value}"` : 'empty')
  if (node.description) parts.push(node.description)
  if (node.offscreen) parts.push('out of view')
  return parts.join(', ')
}

const STOP = new Set('a an and are as at be but by can could do for from get go have i in is it its let me my of on or please so the then this to up us want we what with would you your'.split(' '))
const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}']+/gu)?.filter((w) => !STOP.has(w)) ?? [])

/** How the steps on offer are ranked when there are more than fit, or ordered by relevance (see relevance.ts). */
export interface Ranking {
  /** Candidate text (`candidateText`) → similarity to what the user is asking, when the embedding model answered. */
  meaning?: Map<string, number>
  weights: RankWeights
  /** Steps in the order the screens list them, or the most relevant first. */
  order: 'screen' | 'relevance'
}

/**
 * What a candidate's relevance adds up from: its similarity in meaning, each of the user's words it
 * has, where it is (the app Stanley works on, another on screen, one in the background), and being
 * in view (or found last).
 */
export interface RankWeights {
  meaning: number
  word: number
  tier: Record<Tier, number>
  near: number
}

/** Where a candidate is: in the app Stanley works on, in another app on the screen, or in one in the background. */
export type Tier = 'focused' | 'visible' | 'background'

/** Without a ranking: what matches the user's words, then what is in view, as before there were embeddings. */
const WORDS_ONLY: Ranking = { weights: { meaning: 0, word: 2, tier: { focused: 0, visible: 0, background: 0 }, near: 1 }, order: 'screen' }

/**
 * The candidates to offer, at most `limit`: the most relevant to what the user is asking (`focus`)
 * when there are more, so a long page doesn't bury what they asked for under menus and banners, and
 * a control in another app is there when they ask for it. In screen order, or the most relevant
 * first (`ranking.order`).
 */
function rank<T>(items: T[], limit: number, focus: string, text: (t: T) => string, meaningText: (t: T) => string, near: (t: T) => boolean, tier: (t: T) => Tier, ranking: Ranking): T[] {
  const byRelevance = ranking.order === 'relevance'
  if (items.length <= limit && !byRelevance) return items
  const want = words(focus)
  const w = ranking.weights
  const score = (t: T) => {
    const have = words(text(t))
    let overlap = 0
    for (const word of want) if (have.has(word)) overlap++
    return w.meaning * (ranking.meaning?.get(meaningText(t)) ?? 0) + w.word * overlap + w.tier[tier(t)] + (near(t) ? w.near : 0)
  }
  const ranked = items.map((t, i) => ({ t, i, s: score(t) })).sort((a, b) => b.s - a.s || a.i - b.i)
  const kept = ranked.slice(0, limit)
  return (byRelevance ? kept : kept.sort((a, b) => a.i - b.i)).map((r) => r.t)
}

interface Flat {
  node: AgentNode
  /** Labels of the containers it sits in, outermost first. */
  path: string[]
}

function flatten(nodes: AgentNode[], path: string[] = [], out: Flat[] = []): Flat[] {
  for (const node of nodes) {
    if (node.kind !== 'group') out.push({ node, path })
    if (node.children) flatten(node.children, [...path, node.label], out)
  }
  return out
}

/** `"Lunch Friday?" › Archive`: the element's label after the containers that tell it apart. */
export function elementName(path: string[], node: AgentNode): string {
  return [...path, node.label].join(' › ')
}

/** Finds an element on a screen by node id, with the name it has as an option. */
export function findElement(screen: Screen, nodeId: string): { node: AgentNode; name: string } | undefined {
  const hit = flatten(screen.elements).find((f) => f.node.id === nodeId)
  return hit && { node: hit.node, name: elementName(hit.path, hit.node) }
}

/** A step that could be offered, before ranking: an element (of `app` when it isn't the screen Stanley works on), a page, or a file. */
export type Candidate = { flat: Flat; app?: Screen } | { page: KnownPage } | { file: KnownFile }

/**
 * Everything that could be offered: the screen's elements, those of the other apps on the screen
 * and in the background (`others`), the pages Stanley knows and the files it has seen, in that order.
 */
export function candidatesOf(screen: Screen, others: Screen[] = [], pages: KnownPage[] = [], files?: KnownFile[]): Candidate[] {
  const shown = others.filter((o) => o.visible)
  const hidden = others.filter((o) => !o.visible)
  return [
    ...flatten(screen.elements).map((flat) => ({ flat })),
    ...[...shown, ...hidden].flatMap((app) => flatten(app.elements).map((flat) => ({ flat, app }))),
    ...pages.filter((p) => !screen.url || !sameUrl(p.url, screen.url)).map((page) => ({ page })),
    // The file on screen is what the screen shows: reading or opening it again tells nothing new.
    ...(files ?? []).filter((f) => !(f.url && screen.url && sameUrl(f.url, screen.url))).map((file) => ({ file })),
  ]
}

/** Where a candidate is (see `Tier`): pages and files go with the app Stanley works on. */
const tierOf = (c: Candidate): Tier => ('flat' in c && c.app ? (c.app.visible ? 'visible' : 'background') : 'focused')

/** An element's option name: in another app, after that app's title. */
const nameOf = (c: { flat: Flat; app?: Screen }) => (c.app ? `${c.app.title} › ` : '') + elementName(c.flat.path, c.flat.node)

/** What a candidate is, as the embedding model reads it: its name and how it reads to Jev, where it is included. */
export function candidateText(c: Candidate): string {
  if ('flat' in c) return `${nameOf(c)}, ${describeIn(c)}`
  if ('page' in c) return `open page: ${c.page.title}, web page on ${domainOf(c.page.url)}`
  return `${c.file.path.endsWith('/') ? 'folder' : 'file'} in the user's files: ${c.file.path}`
}

/** How an element reads to Jev: in another app, which app and whether the user can see it. */
function describeIn(c: { flat: Flat; app?: Screen }): string {
  const own = describe(c.flat.node)
  return c.app ? `${own}, in ${c.app.title}, ${c.app.visible ? 'on screen' : 'in the background'}` : own
}

/**
 * What Stanley can do next: the screen's elements in screen order, the pages it found or read on
 * the web and the files it has seen, and the elements of the other apps open (`more.others`), up to
 * `limit` together (see `rank`), then the user's `skills`, the
 * apps, back / home (and lock, when `lock`), listing the user's files (when there are `files`),
 * laying the screen out (when `arrange`), searching the web (when `search`), and saying something
 * to the user (when `respond`). A file the screen can show can also be opened; the one on
 * screen isn't offered. Names are unique; a clash gets a counter. `focus` is what the user is asking
 * for, used with `more.ranking` to choose when there are too many. The page already on screen isn't offered: opening it
 * again does nothing.
 */
export function stepOptions(screen: Screen, apps: AppEntry[], limit: number, focus = '', pages: KnownPage[] = [], lock = false, files?: KnownFile[], skills: Skill[] = [], arrange = false, search = false, respond = false, more: { others?: Screen[]; ranking?: Ranking } = {}): OptionSet {
  const criteria: Record<string, string | null> = {}
  const targets = new Map<string, Target>()
  const add = (name: string, description: string, target: Target) => {
    let unique = name
    for (let n = 2; unique in criteria; n++) unique = `${name} (${n})`
    criteria[unique] = description
    targets.set(unique, target)
  }
  const candidates = candidatesOf(screen, more.others, pages, files)
  const text = (c: Candidate) => ('flat' in c ? [...(c.app ? [c.app.title] : []), ...c.flat.path, c.flat.node.label].join(' ') : 'page' in c ? `${c.page.title} ${domainOf(c.page.url)}` : c.file.path.replace(/[/._-]+/g, ' '))
  const near = (c: Candidate) => ('flat' in c ? !c.flat.node.offscreen : 'page' in c ? c.page.latest : c.file.latest)
  const chosen = rank(candidates, limit, focus, text, candidateText, near, tierOf, more.ranking ?? WORDS_ONLY)
  // Two pages with the same title are told apart by their site.
  const titles = new Map<string, number>()
  for (const c of chosen) if ('page' in c) titles.set(c.page.title, (titles.get(c.page.title) ?? 0) + 1)
  for (const c of chosen) {
    if ('flat' in c) {
      const { node } = c.flat
      add(nameOf(c), describeIn(c), { kind: 'element', node, role: roleOf(node), ...(c.app && { app: c.app }) })
    } else if ('file' in c) {
      const { path } = c.file
      const folder = path.endsWith('/')
      if (folder) add(`list folder: ${path.slice(0, -1)}`, "folder in the user's files", { kind: 'folder', path: path.slice(0, -1) })
      else {
        if (!c.file.read) add(`read file: ${path}`, "file in the user's files", { kind: 'file', path })
        const { url } = c.file
        if (url) add(`open file: ${path}`, "file in the user's files, put on screen", { kind: 'page', url, title: path.split('/').at(-1)! })
      }
    } else {
      const { url, title } = c.page
      const domain = domainOf(url)
      add(`open page: ${title}${titles.get(title)! > 1 ? ` (${domain})` : ''}`, `web page on ${domain}${c.page.open ? ', kept open' : ''}`, { kind: 'page', url, title })
    }
  }
  for (const skill of skills) add(`use skill: ${skill.name}`, `skill: ${skill.description}`, { kind: 'skill', skill })
  for (const app of apps) add(`open ${app.title}`, `app: ${app.description}`, { kind: 'app', app })
  add('back', NAVIGATION.back, { kind: 'back' })
  add('home screen', NAVIGATION.home, { kind: 'home' })
  if (arrange) add('arrange the screen', NAVIGATION.arrange, { kind: 'arrange' })
  if (lock) add('lock', NAVIGATION.lock, { kind: 'lock' })
  if (files) add('list files', NAVIGATION.files, { kind: 'folder', path: '' })
  if (search) add('search the web', NAVIGATION.search, { kind: 'search' })
  if (respond) add('respond', NAVIGATION.respond, { kind: 'respond' })
  return { criteria, targets }
}
