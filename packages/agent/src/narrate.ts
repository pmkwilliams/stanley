import { DEFAULT_AGENT_NAME } from '@stanley/app-sdk'
import type { Entry, LiveUtterance, LookupMeta, StepMeta, StepTarget, TaskMeta } from './conversation'
import type { FileMeta } from './files'
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
 * What Jev reads of the history: what the user said, as turns; what Stanley did, as outcomes;
 * what it found on the web and in the user's files; what Stanley said, as far as the user heard it; then the screen once
 * (unless `screen` is null). Observations, reasoning and notes are left out, and so is which model
 * took a step. `entries` is `Conversation.view(live)`, already in order (see `place`): a turn is
 * split where a step changed something before the user finished ("User: …", the step, "User (went
 * on): …"), so a correction later in the sentence reads as one. `name` is what the assistant is called.
 */
export function narrate(entries: Entry[], screen: Screen | null, live?: LiveUtterance, maxTurns = 50, name = DEFAULT_AGENT_NAME): string {
  const liveWords = live ? live.text.trim().split(/\s+/).filter(Boolean).length : 0
  // A skill reads in full where it was read last; before that, only that it was.
  const lastRead = new Map<string, FileMeta>()
  for (const e of entries) for (const r of e.meta.results ?? []) if (r.file?.kind === 'skill' && !r.file.error) lastRead.set(r.file.name, r.file)
  const lines: string[] = []
  /** Where each of the user's turns starts in `lines`. */
  const turns: number[] = []
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
      if (heard === undefined) lines.push(`${name} said: "${m.said.text}"`)
      else if (heard) lines.push(`${name} started to say: "${heard}" but the user cut in.`)
      else lines.push(`${name} was going to say: "${m.said.text}" but the user cut in before any of it.`)
    } else if (m.kind === 'event' && m.event === 'stuck') {
      lines.push(`${name} stopped: ${m.detail ?? 'it got stuck'}.`)
    } else {
      for (const r of m.results ?? []) {
        if (r.step) lines.push(describeStep(r.step, name))
        else if (r.lookup) lines.push(...describeLookup(r.lookup, name))
        else if (r.file) lines.push(describeFile(r.file, name, lastRead.get(r.file.kind === 'skill' ? r.file.name : '') === r.file))
        else if (r.task) lines.push(describeTask(r.task, name))
      }
    }
  }

  // A long session keeps only its recent turns, so what Jev reads stays small and fast.
  const kept = turns.length > maxTurns ? ['(earlier conversation left out)', ...lines.slice(turns[turns.length - maxTurns])] : lines
  const conversation = ['## Conversation', ...(kept.length ? kept : ['(nothing yet)'])]
  if (!screen) return conversation.join('\n')
  const where = screen.visible ? 'in front of the user' : "in the background, the user can't see it"
  return [...conversation, '', `## Screen: ${screen.title} (${where})`, screen.markdown].join('\n')
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text)

/** A search lists what it found, so a page can be opened later; a read names the page. */
function describeLookup(l: LookupMeta, name: string): string[] {
  if (l.kind === 'read') return [`${name} read "${l.title}" (${shortUrl(l.url)})${l.error ? `: failed (${l.error})` : ''}.`]
  const head = `${name} searched the web for "${l.query}"`
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

/** A background task started, or how it ended: what it found or made is what Stanley tells the user. */
function describeTask(t: TaskMeta, name: string): string {
  const head = `${name}'s background task "${t.title}"`
  if (t.state === 'working') return `${name} started a background task: "${t.title}".`
  if (t.state === 'cancelled') return `${head} was stopped.`
  const summary = t.summary ? clip(t.summary.replace(/\s+/g, ' ').trim(), 300) : ''
  if (t.state === 'failed') return `${head} failed${summary ? ` (${summary})` : ''}.`
  return summary ? `${head} finished: ${summary}` : `${head} finished.`
}

/**
 * A listing names what is in the folder, so it can be opened next; a read gives how the file starts;
 * a skill says what to do, in `full` (indented, so its headings aren't the conversation's).
 */
function describeFile(f: FileMeta, name: string, full = false): string {
  if (f.kind === 'skill') {
    const head = `${name} read its skill "${f.name}"`
    if (f.error) return `${head}: failed (${f.error}).`
    if (!full) return `${head}.`
    return f.body ? `${head}:\n${f.body.replace(/^/gm, '  ')}` : `${head}: it says nothing to do.`
  }
  if (f.kind === 'bash') return `${name} ran \`${clip(f.command.replace(/\s+/g, ' ').trim(), 200)}\` on the user's files${f.exitCode ? `: failed (exit code ${f.exitCode})` : ''}.`
  if (f.kind === 'write') return `${name} ${f.edit ? 'changed' : 'wrote'} the file "${f.path}"${f.error ? `: failed (${f.error})` : ''}.`
  if (f.kind === 'read') {
    const head = `${name} read the file "${f.path}"`
    if (f.error) return `${head}: failed (${f.error}).`
    const excerpt = clip(f.excerpt.replace(/\s+/g, ' ').trim(), 200)
    return excerpt ? `${head}: ${excerpt}` : `${head}: it's empty.`
  }
  const head = f.path ? `${name} listed the folder "${f.path}"` : `${name} listed the user's files`
  if (f.error) return `${head}: failed (${f.error}).`
  if (!f.entries.length) return `${head}: it's empty.`
  const shown = f.entries.slice(0, 40).join(', ')
  return `${head}: ${shown}${f.entries.length > 40 ? `, and ${f.entries.length - 40} more` : ''}.`
}

export function describeStep(e: StepMeta, name = DEFAULT_AGENT_NAME): string {
  const who = e.by === 'user' ? 'User' : name
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
      return `${who} arranged the screen${outcome ? `${outcome}.` : `: ${t.shown}`}`
  }
  if (t.nodeKind === 'input') {
    if (e.wrote === 'stanley') return `${who} wrote its own words into [${t.name}]${outcome}: "${e.text}"`
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
