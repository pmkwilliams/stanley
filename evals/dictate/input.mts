import { writerInput } from '@stanley/agent'
import type { DictateCase } from './cases.mts'

/** What the writer is sent for a case, as `Agent.type` builds it. */
export function input(c: DictateCase): string {
  return writerInput(`## Conversation\n${c.conversation.join('\n')}`, { kind: 'field', field: c.field, value: c.value ?? '' })
}
