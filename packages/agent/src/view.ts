import { background } from './narrate'
import { elementCount, type OptionSet } from './options'
import type { Screen } from './world'

/**
 * A part of what thinking reads of the screens: an app's screen with its options, the apps in the
 * background with what of theirs is on offer, or the steps that aren't on any app. A part is sent
 * again only when it changed (see `since`), so a change in one app doesn't send the others.
 */
export interface ViewPart {
  key: string
  /** What it shows apart from its options: the app's screen, or the background's lines. */
  head: string
  /** Its options, a line each, in the order they were listed, and their names in that order. */
  lines: string[]
  names: string[]
  /** The names of those options that clearly match what the user is asking. */
  clear: string[]
  /** How it reads when it is the same as when thinking last read it. */
  unchanged: string
}

/**
 * What thinking reads of the screens, a part at a time: the app Stanley works on, the other apps in
 * front of the user, each app in the background (a line, and what of it is on offer), then the steps
 * that aren't on any app. Two apps with the same title are told apart by their order.
 */
export function viewParts(screen: Screen, options: OptionSet, others: Screen[] = [], opts: { more?: boolean } = {}): ViewPart[] {
  const shown = others.filter((o) => o.visible)
  const hidden = others.filter((o) => !o.visible)
  const keys = new Map<Screen, string>()
  const seenTitles = new Map<string, number>()
  for (const s of [screen, ...shown, ...hidden]) {
    const n = (seenTitles.get(s.title) ?? 0) + 1
    seenTitles.set(s.title, n)
    keys.set(s, `${s === screen || s.visible ? 'screen' : 'background'}:${s.title}${n > 1 ? `#${n}` : ''}`)
  }
  /** Which part each option goes in: its app's, or the last one. */
  const partOf = (name: string) => {
    const target = options.targets.get(name)
    if (target?.kind !== 'element') return 'options'
    return keys.get(target.app ?? screen) ?? 'options'
  }
  const names = new Map<string, string[]>()
  for (const name of Object.keys(options.criteria)) {
    const key = partOf(name)
    names.set(key, [...(names.get(key) ?? []), name])
  }
  const part = (key: string, head: string, unchanged: string, app?: Screen): ViewPart => {
    const listed = names.get(key) ?? []
    const description = (name: string) => options.criteria[name]
    const lines = listed.map((n) => `- [${n}]${description(n) ? ` ${description(n)}` : ''}`)
    // `more`: what of the app isn't listed, which `find` searches.
    const left = app && opts.more ? elementCount(app) - listed.length : 0
    if (left > 0) lines.push(`- (${left} more of its elements not listed: \`find\` searches them)`)
    return { key, head, lines, names: listed, clear: listed.filter((n) => options.clear.has(n)), unchanged }
  }
  const where = screen.visible ? 'in front of the user' : 'in the background'
  return [
    part(keys.get(screen)!, `<screen title="${screen.title}" where="${where}">\n${screen.markdown}\n</screen>`, `<screen title="${screen.title}" unchanged/>`, screen),
    ...shown.map((o) => part(keys.get(o)!, `<screen title="${o.title}" where="also in front of the user">\n${o.markdown}\n</screen>`, `<screen title="${o.title}" unchanged/>`, o)),
    ...hidden.map((o) => part(keys.get(o)!, `<background title="${o.title}">\n${background([o])[0]}\n</background>`, `<background title="${o.title}" unchanged/>`, o)),
    part('options', '', '<options unchanged/>'),
  ]
}

/** A part in full: what it shows, then its options. */
function partText(p: ViewPart): string {
  const options = p.lines.length ? `<options>\n${p.lines.join('\n')}\n</options>` : ''
  return [p.head, options].filter(Boolean).join('\n')
}

/** Every part in full, as a step's result gives the screens. */
export function viewText(parts: ViewPart[]): string {
  return parts.map(partText).join('\n')
}

/**
 * Whether thinking, having read `last`, reads `now` as it is: the same thing shown, the same options,
 * and what clearly matches what the user asks, among the first `top` now, within the first `top` of
 * them as it read them. A new order alone isn't worth sending again; something the user asks for
 * left further down is. (Only the first: "archive it" clearly matches every Archive.)
 */
function stands(last: ViewPart, now: ViewPart, top: number): boolean {
  if (last.head !== now.head || last.lines.length !== now.lines.length) return false
  const lines = new Set(last.lines)
  if (!now.lines.every((l) => lines.has(l))) return false
  const clear = new Set(now.clear)
  return now.names.slice(0, top).filter((name) => clear.has(name)).every((name) => {
    const at = last.names.indexOf(name)
    return at !== -1 && at < top
  })
}

/**
 * The screens as thinking reads them next, having read `seen`: each part that changed in full, the
 * rest as unchanged, or `<screen unchanged/>` when none did. A part gone since sends them all.
 * Returns what thinking has then read, part by part.
 */
export function since(parts: ViewPart[], seen: Map<string, ViewPart>, top: number): { text: string; seen: Map<string, ViewPart> } {
  const keys = new Set(parts.map((p) => p.key))
  const gone = [...seen.keys()].some((k) => !keys.has(k))
  const read = parts.map((p) => {
    const last = seen.get(p.key)
    return !gone && last && stands(last, p, top) ? last : p
  })
  const next = new Map(read.map((p) => [p.key, p]))
  const kept = (p: ViewPart) => seen.get(p.key) === p
  if (read.every(kept)) return { text: '<screen unchanged/>', seen: next }
  return { text: read.map((p) => (kept(p) ? p.unchanged : partText(p))).join('\n'), seen: next }
}
