import type { LogEntry } from './log'

export interface NowBlock {
  surfaceTitle: string
  surfaceMarkdown: string
  visible: boolean
  liveUtterance: string
  utteranceFinal: boolean
}

/**
 * Jev `state`: stable content first, volatile content last. Tool results from
 * earlier tasks collapse to their summary to keep state small.
 */
export function toJevState(system: string, entries: LogEntry[], now: NowBlock): string {
  const lastTaskStart = entries.findLastIndex((e) => e.role === 'event' && e.kind === 'task-start')
  const lines: string[] = [system, '', '## History']
  entries.forEach((e, i) => {
    const old = i < lastTaskStart
    switch (e.role) {
      case 'user':
        lines.push(`User: ${e.content}`)
        break
      case 'assistant':
        lines.push(`${e.origin === 'user' ? 'User clicked' : 'Agent chose'}: ${e.toolCall.option}${e.toolCall.args?.text ? ` ("${e.toolCall.args.text}")` : ''}`)
        break
      case 'tool':
        lines.push(old ? `Result: ${e.summary}` : `Result:\n${e.content}`)
        break
      case 'event':
        if (e.kind === 'task-end') lines.push('— task complete —')
        break
    }
  })
  lines.push(
    '',
    '## Now',
    `Screen: ${now.surfaceTitle} (${now.visible ? 'visible to user' : 'hidden, working in background'})`,
    now.surfaceMarkdown,
    '',
    `User is saying${now.utteranceFinal ? ' (finished)' : ' (still speaking)'}: ${now.liveUtterance || '—'}`,
  )
  return lines.join('\n')
}
