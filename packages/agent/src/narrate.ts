import type { Entry, LiveUtterance, LookupMeta, StepMeta, StepTarget, TaskMeta } from './conversation'
import type { FileMeta } from './files'
import type { OptionSet } from './options'
import { layoutLine } from './screen'
import { shortUrl } from './web'
import type { Screen } from './world'

export type { LiveUtterance } from './conversation'

/**
 * Our own prompt text with the assistant called `name`. The prompts are written calling it
 * Stanley; only text we wrote goes through here, never the user's words or what is on screen.
 */
export function named(text: string, name: string): string {
  return name === 'Stanley' ? text : text.replace(/\bStanley\b/g, () => name)
}

/** `named` for each of a question's options. */
export function namedOptions<K extends string>(options: Record<K, string>, name: string): Record<K, string> {
  return Object.fromEntries(Object.entries<string>(options).map(([k, v]) => [k, named(v, name)])) as Record<K, string>
}

/**
 * A step's result as the models read it: what it did, then what the screen shows, when the step
 * changed that. Arranging the screen is said by what it shows.
 */
export function stepResult(e: StepMeta): string {
  if (!e.layout || e.error) return e.summary
  return e.target.kind === 'arrange' ? layoutLine(e.layout) : `${e.summary}\n${layoutLine(e.layout)}`
}

/**
 * What Jev reads of the history, told to the assistant as its own ("You opened…"): what the user
 * said, as turns; what it did, as outcomes; what it found on the web and in the user's files; what
 * it said, as far as the user heard it; what the screen shows, each time it changed; then the
 * screen once (unless `screen` is null), then the steps on offer on it (`options`). Observations, reasoning and other notes are left out, and
 * so is which model took a step: it is one assistant. `entries` is `Conversation.view(live)`,
 * already in order (see `place`): a turn is split where a step changed something before the user
 * finished ("User: …", the step, "User (went on): …"), so a correction later in the sentence reads as one.
 */
export function narrate(entries: Entry[], screen: Screen | null, live?: LiveUtterance, maxTurns = 50, others: Screen[] = [], options?: OptionSet): string {
  const liveWords = live ? live.text.trim().split(/\s+/).filter(Boolean).length : 0
  // A skill reads in full where it was read last; before that, only that it was.
  const lastRead = new Map<string, FileMeta>()
  for (const e of entries) for (const r of e.meta.results ?? []) if (r.file?.kind === 'skill' && !r.file.error) lastRead.set(r.file.name, r.file)
  const lines: string[] = []
  /** Where each of the user's turns starts in `lines`. */
  const turns: number[] = []
  /** Where the screen's layout was last said in `lines`. */
  let layoutAt = -1
  for (const e of entries) {
    const m = e.meta
    if (m.kind === 'words' && m.span && typeof e.message?.content === 'string') {
      const [from, to] = m.span
      const speaking = !!live && live.utteranceId === m.utteranceId && !live.ended && to === liveWords
      const label = from === 0 ? (speaking ? 'User (still speaking)' : 'User') : speaking ? 'User (went on, still speaking)' : 'User (went on)'
      if (from === 0) turns.push(lines.length)
      lines.push(`${label}: ${e.message.content}`)
    } else if (m.kind === 'said' && m.said) {
      // What the user heard is what was said: the rest of the reply never reached them.
      const heard = m.said.heard?.trim()
      if (heard === undefined) lines.push(`You said: "${m.said.text}"`)
      else if (heard) lines.push(`You started to say: "${heard}" but the user cut in.`)
      else lines.push(`You were going to say: "${m.said.text}" but the user cut in before any of it.`)
    } else if (m.kind === 'event' && m.event === 'stuck') {
      lines.push(`You stopped: ${(m.detail ?? 'it got stuck').replace(/^it /, 'you ')}.`)
    } else if (m.layout) {
      layoutAt = lines.length
      lines.push(layoutLine(m.layout))
    } else {
      for (const r of m.results ?? []) {
        if (r.step?.layout) layoutAt = lines.length
        if (r.step) lines.push(describeStep(r.step))
        else if (r.lookup) lines.push(...describeLookup(r.lookup))
        else if (r.file) lines.push(describeFile(r.file, lastRead.get(r.file.kind === 'skill' ? r.file.name : '') === r.file))
        else if (r.task) lines.push(describeTask(r.task))
      }
    }
  }

  // A long session keeps only its recent turns, so what Jev reads stays small and fast. What the
  // screen shows stays, where it was last said.
  const from = turns.length > maxTurns ? turns[turns.length - maxTurns]! : 0
  const kept = from ? ['(earlier conversation left out)', ...(layoutAt !== -1 && layoutAt < from ? [lines[layoutAt]!] : []), ...lines.slice(from)] : lines
  const conversation = ['## Conversation', ...(kept.length ? kept : ['(nothing yet)'])]
  if (!screen) return conversation.join('\n')
  const where = screen.visible ? 'in front of the user' : "in the background, the user can't see it"
  const shown = others.filter((o) => o.visible).flatMap((o) => ['', `## Screen: ${o.title} (also in front of the user)`, o.markdown])
  const hidden = background(others)
  const steps = options ? ['', '## Steps on offer', optionList(options)] : []
  return [...conversation, '', `## Screen: ${screen.title} (${where})`, screen.markdown, ...shown, ...(hidden.length ? ['', '## In the background', ...hidden] : []), ...steps].join('\n')
}

/** The steps on offer, a line each, as both models read them. */
export function optionList(options: OptionSet): string {
  return Object.entries(options.criteria)
    .map(([name, description]) => `- [${name}]${description ? ` ${description}` : ''}`)
    .join('\n')
}

/** How many lines of an app in the background are read: the top of its screen, where an app says what it is doing. */
const GLANCE_LINES = 3

/**
 * The apps open in the background, a line each: the top of what its screen reads, where an app
 * says what it is doing ("Playing: …"). The same for both models.
 */
export function background(others: Screen[]): string[] {
  return others
    .filter((o) => !o.visible)
    .map((o) => {
      const top = o.markdown.split(/\n\s*\n/)[0]!.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).filter(Boolean)
      const lines = top[0] === o.title ? top.slice(1) : top
      const glance = clip(lines.slice(0, GLANCE_LINES).join('; '), 200)
      return `- ${o.title}${glance ? `: ${glance}` : ''}`
    })
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text)

/** A search lists what it found, so a page can be opened later; a read names the page. */
function describeLookup(l: LookupMeta): string[] {
  if (l.kind === 'read') return [`You read "${l.title}" (${shortUrl(l.url)})${l.error ? `: failed (${l.error})` : ''}.`]
  const head = `You searched the web for "${l.query}"`
  if (l.error) return [`${head}: failed (${l.error}).`]
  if (!l.results.length) return [`${head}: nothing found.`]
  return [
    `${head}:`,
    ...l.results.map((r) => {
      const excerpt = clip(r.excerpt.replace(/\s+/g, ' ').trim(), 100)
      return `- "${r.title}" (${shortUrl(r.url)})${excerpt ? `: ${excerpt}` : ''}`
    }),
  ]
}

/** A background task started, or how it ended: what it found or made is what the assistant tells the user. */
function describeTask(t: TaskMeta): string {
  const head = `Your background task "${t.title}"`
  if (t.state === 'working') return `You started a background task: "${t.title}".`
  if (t.state === 'cancelled') return `${head} was stopped.`
  const summary = t.summary ? clip(t.summary.replace(/\s+/g, ' ').trim(), 300) : ''
  if (t.state === 'failed') return `${head} failed${summary ? ` (${summary})` : ''}.`
  return summary ? `${head} finished: ${summary}` : `${head} finished.`
}

/**
 * A listing names what is in the folder, so it can be opened next; a read gives how the file starts;
 * a skill says what to do, in `full` (indented, so its headings aren't the conversation's).
 */
function describeFile(f: FileMeta, full = false): string {
  if (f.kind === 'skill') {
    const head = `You read your skill "${f.name}"`
    if (f.error) return `${head}: failed (${f.error}).`
    if (!full) return `${head}.`
    return f.body ? `${head}:\n${f.body.replace(/^/gm, '  ')}` : `${head}: it says nothing to do.`
  }
  if (f.kind === 'bash') return `You ran \`${clip(f.command.replace(/\s+/g, ' ').trim(), 200)}\` on the user's files${f.exitCode ? `: failed (exit code ${f.exitCode})` : ''}.`
  if (f.kind === 'write') return `You ${f.edit ? 'changed' : 'wrote'} the file "${f.path}"${f.error ? `: failed (${f.error})` : ''}.`
  if (f.kind === 'read') {
    const head = `You read the file "${f.path}"`
    if (f.error) return `${head}: failed (${f.error}).`
    const excerpt = clip(f.excerpt.replace(/\s+/g, ' ').trim(), 200)
    return excerpt ? `${head}: ${excerpt}` : `${head}: it's empty.`
  }
  const head = f.path ? `You listed the folder "${f.path}"` : `You listed the user's files`
  if (f.error) return `${head}: failed (${f.error}).`
  if (!f.entries.length) return `${head}: it's empty.`
  const shown = f.entries.slice(0, 40).join(', ')
  return `${head}: ${shown}${f.entries.length > 40 ? `, and ${f.entries.length - 40} more` : ''}.`
}

export function describeStep(e: StepMeta): string {
  const text = stepText(e, e.by === 'user' ? 'User' : 'You')
  // A step that changed what the screen shows says what it shows then, as thinking's result does.
  return e.layout ? `${text} ${layoutLine(e.layout)}` : text
}

function stepText(e: StepMeta, who: string): string {
  const t = e.target
  const outcome = e.error ? `: failed (${e.summary})` : ''
  switch (t.kind) {
    case 'app':
      return `${who} opened ${t.title}${outcome}.`
    case 'back':
      return `${who} went back${outcome}.`
    case 'home':
      return `${who} went to the home screen${outcome}.`
    case 'lock':
      return `${who} locked the computer${outcome}.`
    case 'page':
      return `${who} opened the page "${t.title}" (${shortUrl(t.url)})${outcome}.`
    case 'arrange':
      // What it shows then is the layout said after it (older steps: the summary).
      return `${who} arranged the screen${outcome || (e.layout ? '' : `: ${e.summary.replace(/\.$/, '')}`)}.`
  }
  if (t.nodeKind === 'input') {
    if (e.wrote === 'you') return `${who} wrote your own words into [${t.name}]${outcome}: "${e.text}"`
    if (t.role === 'combobox') return `${who} chose "${e.text}" in [${t.name}]${outcome}.`
    return `${who} typed ${e.text ? `"${e.text}"` : 'nothing'} into [${t.name}]${outcome}.`
  }
  if (t.nodeKind === 'location') return `${who} opened [${t.name}]${outcome}.`
  // Buttons report what they did: that is the part a person watching would notice.
  const result = e.error ? outcome : `: ${e.summary.replace(/\.$/, '')}`
  if (t.role === 'key') {
    const field = t.name.split(' › ').slice(0, -1).join(' › ')
    return `${who} ${t.name.split(' › ').at(-1)!.replace(/^press /, 'pressed ')}${field ? ` in [${field}]` : ''}${result}.`
  }
  return `${who} pressed [${t.name}]${result}.`
}

export function targetOf(target: StepTarget): string {
  if (target.kind === 'element') return target.name
  if (target.kind === 'app') return `open ${target.title}`
  if (target.kind === 'page') return `open page: ${target.title}`
  if (target.kind === 'arrange') return 'arrange the screen'
  return target.kind
}
