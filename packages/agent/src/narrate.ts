import type { LogEntry, StepTarget } from './log'
import type { Screen } from './world'

/** The utterance being heard right now, including words not yet finalized. */
export interface LiveUtterance {
  utteranceId: number
  text: string
  ended: boolean
}

/**
 * The conversation every model reads: what the user said, as turns; what Stanley did, as
 * outcomes; what Stanley said; then the screen once. Decisions that changed nothing (listening,
 * finishing, discarded or gated guesses) and which model took a step are left out. Those are the
 * agent's mechanics and live in the debug trace.
 */
export function narrate(entries: LogEntry[], screen: Screen, live?: LiveUtterance): string {
  const words = new Map<number, string[]>()
  for (const e of entries) if (e.role === 'user') words.set(e.utteranceId, [...(words.get(e.utteranceId) ?? []), e.content])

  const lines: string[] = []
  const told = new Set<number>()
  const tell = (utteranceId: number | undefined) => {
    if (utteranceId === undefined || told.has(utteranceId)) return
    told.add(utteranceId)
    const isLive = live?.utteranceId === utteranceId
    const text = (isLive ? live.text : words.get(utteranceId)?.join(' '))?.trim()
    if (text) lines.push(`${isLive && !live.ended ? 'User (still speaking)' : 'User'}: ${text}`)
  }

  for (const e of entries) {
    if (e.role === 'user') tell(e.utteranceId)
    else if (e.role === 'step') {
      tell(e.utteranceId)
      lines.push(describeStep(e))
    } else if (e.role === 'said') lines.push(`Stanley said: "${e.content}"`)
    else if (e.role === 'event' && e.kind === 'stuck') lines.push(`Stanley stopped: ${e.detail ?? 'it got stuck'}.`)
  }
  if (live) tell(live.utteranceId)

  const where = screen.visible ? 'in front of the user' : "in the background, the user can't see it"
  return ['## Conversation', ...(lines.length ? lines : ['(nothing yet)']), '', `## Screen: ${screen.title} (${where})`, screen.markdown].join('\n')
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
  }
  if (t.nodeKind === 'input') {
    if (e.wrote === 'stanley') return `${who} wrote its own words into [${t.name}]${outcome}: "${e.text}"`
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
  return target.kind === 'element' ? target.name : target.kind === 'app' ? `open ${target.title}` : target.kind
}
