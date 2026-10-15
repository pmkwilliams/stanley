import { dictation } from '@stanley/agent'
import type { DictateCase } from './cases.mts'

/** What the quick model is sent for a case, as `Agent.dictate` builds it. */
export function input(c: DictateCase): string {
  return dictation(`## Conversation\n${c.conversation.join('\n')}`, c.field, c.value ?? '')
}
