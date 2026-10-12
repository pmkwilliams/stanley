import type { LogEntry, StepTarget } from './log'
import { shortUrl } from './web'
import type { Screen } from './world'

/** The utterance being heard right now, including words not yet finalized. */
export interface LiveUtterance {
  utteranceId: number
  text: string
  ended: boolean
}

/**
 * The conversation every model reads: what the user said, as turns; what Stanley did, as
 * outcomes; what it found on the web; what Stanley said, as far as the user heard it; then the
 * screen once (unless `screen` is null). Decisions that changed nothing (listening,
 * finishing, discarded or gated guesses) and which model took a step are left out. Those are the
 * agent's mechanics and live in the debug trace.
 *
 * A turn's words come before the steps taken for it, even steps decided mid-sentence. The one
 * exception is a step that changed something before the user finished: the turn is split there
 * ("User: …", the step, "User (went on): …"), so a correction later in the sentence reads as one.
 */
export function narrate(entries: LogEntry[], screen: Screen | null, live?: LiveUtterance, maxTurns = 20): string {
  const segments = new Map<number, string[]>()
  for (const e of entries) if (e.role === 'user') segments.set(e.utteranceId, [...(segments.get(e.utteranceId) ?? []), e.content])
  const wordsOf = (utteranceId: number) => {
    const text = live?.utteranceId === utteranceId ? live.text : segments.get(utteranceId)?.join(' ')
    return (text ?? '').trim().split(/\s+/).filter(Boolean)
  }

  // Where each utterance splits: the words heard by each step that changed something early.
  const splits = new Map<number, number[]>()
  const last = new Map<number, number>()
  entries.forEach((e, i) => {
    const id = utteranceOf(e)
    if (id === undefined) return
    last.set(id, i)
    if (e.role !== 'step' || !changes(e) || e.heardWords === undefined) return
    const n = wordsOf(id).length
    if (e.heardWords > 0 && e.heardWords < n) splits.set(id, [...(splits.get(id) ?? []), e.heardWords])
  })

  const lines: string[] = []
  /** Where each reply Stanley said was told, so being cut off can amend it. */
  const said = new Map<number, { line: number; content: string }>()
  /** Where each of the user's turns starts in `lines`. */
  const turns: number[] = []
  const printed = new Map<number, number>()
  const tellUpTo = (utteranceId: number, upTo: number) => {
    const words = wordsOf(utteranceId)
    const from = printed.get(utteranceId) ?? 0
    const to = Math.min(upTo, words.length)
    if (to <= from) return
    printed.set(utteranceId, to)
    const speaking = live?.utteranceId === utteranceId && !live.ended && to === words.length
    const label = from === 0 ? (speaking ? 'User (still speaking)' : 'User') : speaking ? 'User (went on, still speaking)' : 'User (went on)'
    if (from === 0) turns.push(lines.length)
    lines.push(`${label}: ${words.slice(from, to).join(' ')}`)
  }
  /** Before anything else of an utterance: its words up to the first early change. */
  const firstPart = (utteranceId: number) => Math.min(...(splits.get(utteranceId) ?? []), Infinity)

  entries.forEach((e, i) => {
    if (e.role === 'user') {
      if (!printed.get(e.utteranceId)) tellUpTo(e.utteranceId, firstPart(e.utteranceId))
    } else if (e.role === 'step') {
      if (e.utteranceId !== undefined) {
        const early = changes(e) && e.heardWords !== undefined && e.heardWords > 0
        tellUpTo(e.utteranceId, early ? e.heardWords! : Math.max(printed.get(e.utteranceId) ?? 0, firstPart(e.utteranceId)))
      }
      lines.push(describeStep(e))
    } else if (e.role === 'search' || e.role === 'read') {
      if (e.utteranceId !== undefined) tellUpTo(e.utteranceId, Math.max(printed.get(e.utteranceId) ?? 0, firstPart(e.utteranceId)))
      lines.push(...describeLookup(e))
    } else if (e.role === 'said') {
      if (e.id !== undefined) said.set(e.id, { line: lines.length, content: e.content })
      lines.push(`Stanley said: "${e.content}"`)
    } else if (e.role === 'cut') {
      // What the user heard is what was said: the rest of the reply never reached them.
      const reply = said.get(e.id)
      const spoken = e.spoken.trim()
      if (reply) lines[reply.line] = spoken ? `Stanley started to say: "${spoken}" but the user cut in.` : `Stanley was going to say: "${reply.content}" but the user cut in before any of it.`
    }
    else if (e.role === 'event' && e.kind === 'stuck') lines.push(`Stanley stopped: ${e.detail ?? 'it got stuck'}.`)
    // The utterance's last entry: whatever the user said after the last step follows it.
    const id = utteranceOf(e)
    if (id !== undefined && last.get(id) === i && id !== live?.utteranceId) tellUpTo(id, Infinity)
  })
  if (live) tellUpTo(live.utteranceId, Infinity)

  // A long session keeps only its recent turns, so what the models read stays small and fast.
  const kept = turns.length > maxTurns ? ['(earlier conversation left out)', ...lines.slice(turns[turns.length - maxTurns])] : lines
  const conversation = ['## Conversation', ...(kept.length ? kept : ['(nothing yet)'])]
  if (!screen) return conversation.join('\n')
  const where = screen.visible ? 'in front of the user' : "in the background, the user can't see it"
  return [...conversation, '', `## Screen: ${screen.title} (${where})`, screen.markdown].join('\n')
}

/**
 * The entries `narrate` keeps for a long session: from the first words of its last `maxTurns`
 * utterances on. What the models no longer read, Stanley no longer offers (see `knownPages`).
 */
export function recentEntries(entries: LogEntry[], maxTurns = 20): LogEntry[] {
  const starts: number[] = []
  const seen = new Set<number>()
  entries.forEach((e, i) => {
    if (e.role !== 'user' || seen.has(e.utteranceId)) return
    seen.add(e.utteranceId)
    starts.push(i)
  })
  return starts.length > maxTurns ? entries.slice(starts[starts.length - maxTurns]) : entries
}

function utteranceOf(e: LogEntry): number | undefined {
  return e.role === 'user' || e.role === 'step' || e.role === 'search' || e.role === 'read' ? e.utteranceId : undefined
}

/** A search lists what it found, so a page can be opened later; a read names the page. */
function describeLookup(e: Extract<LogEntry, { role: 'search' | 'read' }>): string[] {
  if (e.role === 'read') return [`Stanley read "${e.title}" (${shortUrl(e.url)})${e.error ? `: failed (${e.error})` : ''}.`]
  const head = `Stanley searched the web for "${e.query}"`
  if (e.error) return [`${head}: failed (${e.error}).`]
  if (!e.results.length) return [`${head}: nothing found.`]
  return [`${head}:`, ...e.results.map((r) => `- "${r.title}" (${shortUrl(r.url)})${r.summary ? `: ${r.summary}` : ''}`)]
}

/** A step that changed something: typing, or pressing a button. Opening things only looks. */
function changes(e: Extract<LogEntry, { role: 'step' }>): boolean {
  return e.target.kind === 'element' && (e.target.nodeKind === 'action' || e.target.nodeKind === 'input')
}

function describeStep(e: Extract<LogEntry, { role: 'step' }>): string {
  const who = e.by === 'user' ? 'User' : 'Stanley'
  const t = e.target
  const outcome = e.result.error ? `: failed (${e.result.summary})` : ''
  switch (t.kind) {
    case 'app':
      return `${who} opened ${t.title}${outcome}.`
    case 'back':
      return `${who} went back${outcome}.`
    case 'home':
      return `${who} went home${outcome}.`
    case 'page':
      return `${who} opened the page "${t.title}" (${shortUrl(t.url)})${outcome}.`
  }
  if (t.nodeKind === 'input') {
    if (e.wrote === 'stanley') return `${who} wrote its own words into [${t.name}]${outcome}: "${e.text}"`
    if (t.role === 'combobox') return `${who} chose "${e.text}" in [${t.name}]${outcome}.`
    return `${who} typed ${e.text ? `"${e.text}"` : 'nothing'} into [${t.name}]${outcome}.`
  }
  if (t.nodeKind === 'location') return `${who} opened [${t.name}]${outcome}.`
  // Buttons report what they did: that is the part a person watching would notice.
  const result = e.result.error ? outcome : `: ${e.result.summary.replace(/\.$/, '')}`
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
  return target.kind
}
