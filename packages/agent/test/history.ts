import { Conversation, note, type Actor, type LookupMeta, type StepMeta, type StepTarget } from '../src/conversation'
import { describeStep, targetOf } from '../src/narrate'

/** Records what happened, in the order it happened, as the agent would. */
export function recorder(h = new Conversation()) {
  let n = 0
  return {
    h,
    /** A finalized segment of what the user said. */
    words: (utteranceId: number, text: string) => h.heard(utteranceId, text),
    /** A step Jev (or thinking, staged the same way) took. */
    step: (s: { target: StepTarget; summary?: string; by?: Actor; text?: string; wrote?: 'user' | 'stanley'; utteranceId?: number; heardWords?: number; error?: boolean }) => {
      const step: StepMeta = { id: `s${++n}`, by: 'jev', summary: 'done', ...s }
      const toolCallId = `jev_${step.id}`
      h.stagePair({ toolCallId, tool: 'act', input: { option: targetOf(s.target), ...(s.text !== undefined && { text: s.text }) }, by: step.by }, { type: step.error ? 'error-text' : 'text', value: step.summary }, { toolCallId, step })
    },
    /** The user clicked or typed in an app themselves. */
    userStep: (target: StepTarget, summary: string) => {
      const step: StepMeta = { id: `u${++n}`, by: 'user', target, summary }
      h.stage({ kind: 'note', by: 'user', results: [{ step }] }, note(`In the app, the user ${describeStep(step).replace(/^User /, '')}`))
    },
    lookup: (lookup: LookupMeta) => {
      const toolCallId = `look_${++n}`
      const input = lookup.kind === 'search' ? { query: lookup.query } : { url: lookup.url }
      h.stagePair({ toolCallId, tool: lookup.kind === 'search' ? 'search' : 'fetch', input, by: 'thinking' }, { type: 'json', value: JSON.parse(JSON.stringify(lookup)) }, { toolCallId, lookup })
    },
    said: (text: string, replyId = ++n) => h.said(replyId, text),
    event: (event: 'task-start' | 'task-end') => h.stage({ kind: 'event', event }),
  }
}
