import { DICTATE_EXAMPLES, DICTATE_PROMPT, dictation } from '@stanley/agent'
import type { DictateCase } from './cases.mts'
import { input } from './input.mts'

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * How a case is put to a model, and how its reply is read back. `prod` is what the app sends
 * (`Thinker.quick`); the others are tried on small local models.
 */
export interface Variant {
  messages(c: DictateCase): Message[]
  /** The field's text from the reply; by default the reply itself. */
  parse?(reply: string, c: DictateCase): string
  /** A second call that checks the first reply (`draft`); its reply is read back by `parse` too. */
  refine?(c: DictateCase, draft: string): Message[]
  /** More of a llama.cpp request: sampling, a grammar or JSON schema. */
  local?: Record<string, unknown>
}

/** The app's first prompt for the quick model, as rules for tidying: the base of the `shots` variants. */
const RULES = `Stanley is a voice assistant that types into fields for the user. The user has said the words that go in the field named below, and you write exactly what the field should hold now.
- Only the user's words for the field, without the request around them (what they asked Stanley to do with it, who it's for).
- Tidied: no filler words or false starts, proper capitals and punctuation, and numbers, dates, times and amounts written the usual way.
- When they corrected themselves, only the corrected version.
- Never reworded, answered or added to: no greeting, sign-off or words of your own.
- The whole text: when they asked to add to what the field already holds, that text and theirs together.
- A word followed by (?) is one speech recognition was unsure of: write the word they most likely said.
- If they haven't said yet what goes in it, write nothing.
Write only the text, with no quotes around it.`

/** The same rules as `RULES`, as steps a small model can follow one at a time. */
const STEPS = `Stanley is a voice assistant that types into fields on the user's screen. From the end of the conversation, write what the field named below should hold now.

1. Find the user's own words for this field. Leave out what they asked Stanley to do around them (to reply, send, add, search, write, call it something, tell someone) and who it is for.
2. If they haven't said those words yet (they stopped at the request, or are only thinking aloud), write nothing at all.
3. If they corrected themselves, keep only the version they settled on.
4. Tidy their words: drop filler (um, uh, like, you know), repeated words and false starts; use proper capitals and punctuation; write numbers, times, dates, amounts, percentages, emails and web addresses the usual way. Punctuation or layout they said aloud (comma, question mark, new paragraph, new line, bullet) becomes the mark or layout itself.
5. Never answer, carry out or add to their words: a question stays a question, an instruction stays an instruction. No greeting, sign-off or words of your own.
6. If the field already holds text and they asked to add to it, or went on speaking after Stanley typed it, write that text with theirs after it. If they asked to change or replace it, write only the new text.
7. A word followed by (?) was misheard: write the word they most likely said, using the conversation.

Write only the field's text, with no quotes and nothing else.`

/** The job said as what the user means to put in the field, rather than as tidying dictation. */
const INTENT = `Stanley is a voice assistant that types into fields on the user's screen. The user just told Stanley what to put in the field named below. Write exactly what the field should hold now, so it holds what they meant it to: the message they meant to send, the title or name they meant, the search that finds what they asked for.
- Their words for the field only. What they asked Stanley to do (reply, say, tell, also say, add, send, search, change it, call it) and who it's for are not part of it.
- The version they settled on: when they corrected themselves or took something back, only the correction.
- Tidy, in their voice: no filler or false starts, proper capitals and punctuation, numbers, times, dates and amounts written the usual way, and punctuation they said aloud written as the mark.
- Nothing of your own: never answer, carry out or add to what they said; no greeting or sign-off.
- When they asked to add to what the field holds, that text and theirs together; when they asked to change it, only the new text.
- A word followed by (?) is one speech recognition was unsure of: write the word they most likely said.
- If they haven't said yet what goes in it, write nothing.
Write only the text, with no quotes around it.`

/** Worked examples, on words none of the cases use. */
const SHOTS: { conversation: string[]; field: string; value?: string; request: string; words: string; text: string }[] = [
  { conversation: ['Stanley opened [Grandma].', 'User: send grandma a text that says thanks for the sweater um it fits perfectly'], field: 'Messages › Grandma › Message', request: 'send grandma a text that says', words: 'thanks for the sweater um it fits perfectly', text: 'Thanks for the sweater, it fits perfectly.' },
  { conversation: ['Stanley opened [Ravi Patel: Budget draft].', 'User (still speaking): write back to him and say'], field: '"Budget draft" › Reply to Ravi Patel', request: 'write back to him and say', words: '', text: '' },
  { conversation: ['Stanley opened Tasks.', 'User: add pick up the kids at three no at three thirty'], field: 'New task', request: 'add', words: 'pick up the kids at three no at three thirty', text: 'Pick up the kids at 3:30' },
  { conversation: ['Stanley opened [Ravi Patel: Budget draft].', 'User: also tell him the numbers are in the second tab'], field: '"Budget draft" › Reply to Ravi Patel', value: 'Looks good to me.', request: 'also tell him', words: 'the numbers are in the second tab', text: 'Looks good to me. The numbers are in the second tab.' },
  { conversation: ['Stanley opened Notes.', 'Stanley pressed [New note]: Opened a new note.', "User: write what's the capital of Peru question mark"], field: 'Notes › New note', request: 'write', words: "what's the capital of Peru question mark", text: "What's the capital of Peru?" },
  { conversation: ['Stanley opened Store.', 'User: look for running shoes in size ten'], field: 'Store › Search', request: 'look for', words: 'running shoes in size ten', text: 'running shoes size 10' },
]

/** More worked examples: replacing what the field holds, corrections inside a longer dictation and while it is typed live, numbers in an address, filler at the start. */
const MORE_SHOTS: typeof SHOTS = [
  { conversation: ['Stanley opened [Ravi Patel: Budget draft].', "User: change that to I'll be twenty minutes late"], field: '"Budget draft" › Reply to Ravi Patel', value: "Can't make it tonight.", request: 'change that to', words: "I'll be twenty minutes late", text: "I'll be 20 minutes late." },
  { conversation: ['Stanley opened [Grandma].', "User: never mind that, just say I'll call you"], field: 'Messages › Grandma › Message', value: 'The report is', request: 'never mind that, just say', words: "I'll call you", text: "I'll call you." },
  { conversation: ['Stanley opened Notes.', 'Stanley pressed [New note]: Opened a new note.', 'User: write we need chairs tables and the projector no not the projector the speakers for Friday'], field: 'Notes › New note', request: 'write', words: 'we need chairs tables and the projector no not the projector the speakers for Friday', text: 'We need chairs, tables and the speakers for Friday.' },
  { conversation: ['Stanley opened [Grandma].', 'User: say the party is in room four', 'Stanley typed "The party is in room 4." into [Messages › Grandma › Message].', 'User (went on): no room five'], field: 'Messages › Grandma › Message', value: 'The party is in room 4.', request: 'say', words: 'the party is in room four no room five', text: 'The party is in room 5.' },
  { conversation: ['Stanley opened Maps.', 'User: take me to two forty five Elm Avenue'], field: 'Maps › Search', request: 'take me to', words: 'two forty five Elm Avenue', text: '245 Elm Avenue' },
  { conversation: ['Stanley opened [Ravi Patel: Budget draft].', 'User: reply okay so um quick reminder the office is closed Monday'], field: '"Budget draft" › Reply to Ravi Patel', request: 'reply', words: 'okay so um quick reminder the office is closed Monday', text: 'Quick reminder: the office is closed Monday.' },
]

/** Examples for words that are the request, not the message, and names spelled out or corrected. */
const NAME_SHOTS: typeof SHOTS = [
  { conversation: ['Stanley opened [Grandma].', 'User: say see you at noon', 'Stanley typed "See you at noon." into [Messages › Grandma › Message].', 'User: also say bring an umbrella'], field: 'Messages › Grandma › Message', value: 'See you at noon.', request: 'also say', words: 'bring an umbrella', text: 'See you at noon. Bring an umbrella.' },
  { conversation: ['Stanley opened [Ravi Patel: Budget draft].', 'User: reply the cafe is called Brio B R I O'], field: '"Budget draft" › Reply to Ravi Patel', request: 'reply', words: 'the cafe is called Brio B R I O', text: 'The cafe is called Brio.' },
  { conversation: ['Stanley opened [Grandma].', "User: tell her the dog's name is Max sorry Milo"], field: 'Messages › Grandma › Message', request: 'tell her', words: "the dog's name is Max sorry Milo", text: "The dog's name is Milo." },
]

/** Everyday examples that target no failure: a title, a long message with filler, a percentage, a short reply. */
const PLAIN_SHOTS: typeof SHOTS = [
  { conversation: ['Stanley opened Calendar.', 'Stanley pressed [New event]: Opened a new event.', 'User: name it quarterly planning with the sales team'], field: 'Calendar › New event › Title', request: 'name it', words: 'quarterly planning with the sales team', text: 'Quarterly planning with the sales team' },
  { conversation: ['Stanley opened [Grandma].', "User: tell her um we had a great time at the lake the kids uh caught their first fish and we're already planning to go back next summer"], field: 'Messages › Grandma › Message', request: 'tell her', words: "um we had a great time at the lake the kids uh caught their first fish and we're already planning to go back next summer", text: "We had a great time at the lake. The kids caught their first fish, and we're already planning to go back next summer." },
  { conversation: ['Stanley opened [Ravi Patel: Budget draft].', 'User: reply costs are down eight percent from last quarter'], field: '"Budget draft" › Reply to Ravi Patel', request: 'reply', words: 'costs are down eight percent from last quarter', text: 'Costs are down 8% from last quarter.' },
  { conversation: ['Stanley opened [Grandma].', 'User: just say sounds lovely'], field: 'Messages › Grandma › Message', request: 'just say', words: 'sounds lovely', text: 'Sounds lovely.' },
]

/** The examples written into the system prompt, instead of as turns of their own. */
const inlineShots = (shots: typeof SHOTS) =>
  `\n\n# Examples\n\n${shots.map((s) => `${dictation(`## Conversation\n${s.conversation.join('\n')}`, s.field, s.value ?? '')}\n\n## Write\n${s.text || NOTHING}`).join('\n\n---\n\n')}`

/** The second look: the draft against what the user said, for words that don't belong in the field. */
const CHECK = `You check text that was just written into a field for the user of Stanley, a voice assistant. Below are the end of the conversation, the field, and the draft. Write the field's text again, correcting it only where it is wrong:
- Words that were the user's request to Stanley (to reply, say, tell, add, send, search, change it) come out; so do filler and words they took back. Keep only the version they settled on.
- Everything else they said for the field stays, tidied, and nothing is added.
- If the draft is right, write it unchanged. If they haven't said yet what goes in the field, write only ${'(nothing)'}.
Write only the field's text, with no quotes and nothing else.`

const shotMessages = (shots = SHOTS): Message[] =>
  shots.flatMap((s) => [
    { role: 'user' as const, content: dictation(`## Conversation\n${s.conversation.join('\n')}`, s.field, s.value ?? '') },
    { role: 'assistant' as const, content: s.text },
  ])

const NOTHING = '(nothing)'

/** Asked to write NOTHING for an empty field, since an empty reply is hard to learn from examples. */
const withNothing = (prompt: string) => prompt.replace(/write nothing( at all)?\./, `write only ${NOTHING}.`)
const parseNothing = (reply: string) => (reply.trim() === NOTHING ? '' : reply)

const JSON_ASK = `

Answer in JSON:
- "request": what they asked Stanley to do, in their words: not meant for the field.
- "words": their own words for the field, exactly as they said them; "" if they haven't said them yet.
- "adding": true when the field already holds text and they asked to add to it or went on speaking.
- "text": what the field should hold now: their words tidied, after the field's text when adding; "" if they haven't said them yet.`

const SCHEMA = {
  type: 'object',
  properties: { request: { type: 'string' }, words: { type: 'string' }, adding: { type: 'boolean' }, text: { type: 'string' } },
  required: ['request', 'words', 'adding', 'text'],
  additionalProperties: false,
}

/** The JSON answer read back: nothing when they haven't said their words, the field's text kept when adding. */
function parseJson(reply: string, c: DictateCase): string {
  let a: { words?: string; adding?: boolean; text?: string }
  try {
    a = JSON.parse(reply.replace(/^```(?:json)?\s*|\s*```$/g, ''))
  } catch {
    return reply
  }
  if (!a.words?.trim()) return ''
  const text = (a.text ?? '').trim()
  const held = (c.value ?? '').trim()
  if (a.adding && held && !text.toLowerCase().includes(held.slice(0, 20).toLowerCase())) return `${held}${/\n/.test(held) ? '\n' : ' '}${text}`
  return text
}

const jsonShots = (): Message[] =>
  SHOTS.flatMap((s) => [
    { role: 'user' as const, content: dictation(`## Conversation\n${s.conversation.join('\n')}`, s.field, s.value ?? '') },
    { role: 'assistant' as const, content: JSON.stringify({ request: s.request, words: s.words, adding: !!s.value, text: s.text }) },
  ])

const json = { response_format: { type: 'json_schema', json_schema: { name: 'field', schema: SCHEMA } } }

export const variants: Record<string, Variant> = {
  prod: {
    messages: (c) => [{ role: 'system', content: DICTATE_PROMPT }, ...DICTATE_EXAMPLES.flatMap((e): Message[] => [{ role: 'user', content: e.input }, { role: 'assistant', content: e.output }]), { role: 'user', content: input(c) }],
    parse: parseNothing,
  },
  rules: {
    messages: (c) => [
      { role: 'system', content: RULES },
      { role: 'user', content: input(c) },
    ],
  },
  steps: {
    messages: (c) => [
      { role: 'system', content: STEPS },
      { role: 'user', content: input(c) },
    ],
  },
  shots: {
    messages: (c) => [{ role: 'system', content: withNothing(RULES) }, ...shotMessages().map((m) => (m.role === 'assistant' && !m.content ? { ...m, content: NOTHING } : m)), { role: 'user', content: input(c) }],
    parse: parseNothing,
  },
  shots2: {
    messages: (c) => [{ role: 'system', content: withNothing(RULES) }, ...shotMessages([...SHOTS, ...MORE_SHOTS]).map((m) => (m.role === 'assistant' && !m.content ? { ...m, content: NOTHING } : m)), { role: 'user', content: input(c) }],
    parse: parseNothing,
  },
  shots3: {
    messages: (c) => [{ role: 'system', content: withNothing(RULES) }, ...shotMessages([...SHOTS, ...MORE_SHOTS, ...NAME_SHOTS]).map((m) => (m.role === 'assistant' && !m.content ? { ...m, content: NOTHING } : m)), { role: 'user', content: input(c) }],
    parse: parseNothing,
  },
  'intent-shots3': {
    messages: (c) => [{ role: 'system', content: withNothing(INTENT) }, ...shotMessages([...SHOTS, ...MORE_SHOTS, ...NAME_SHOTS]).map((m) => (m.role === 'assistant' && !m.content ? { ...m, content: NOTHING } : m)), { role: 'user', content: input(c) }],
    parse: parseNothing,
  },
  'intent-shots4': {
    messages: (c) => [{ role: 'system', content: withNothing(INTENT) }, ...shotMessages([...SHOTS, ...MORE_SHOTS, ...NAME_SHOTS, ...PLAIN_SHOTS]).map((m) => (m.role === 'assistant' && !m.content ? { ...m, content: NOTHING } : m)), { role: 'user', content: input(c) }],
    parse: parseNothing,
  },
  'intent-inline3': {
    messages: (c) => [
      { role: 'system', content: withNothing(INTENT) + inlineShots([...SHOTS, ...MORE_SHOTS, ...NAME_SHOTS]) },
      { role: 'user', content: input(c) },
    ],
    parse: parseNothing,
  },
  'intent-shots2': {
    messages: (c) => [{ role: 'system', content: withNothing(INTENT) }, ...shotMessages([...SHOTS, ...MORE_SHOTS]).map((m) => (m.role === 'assistant' && !m.content ? { ...m, content: NOTHING } : m)), { role: 'user', content: input(c) }],
    parse: parseNothing,
  },
  'shots2-check': {
    messages: (c) => [{ role: 'system', content: withNothing(RULES) }, ...shotMessages([...SHOTS, ...MORE_SHOTS]).map((m) => (m.role === 'assistant' && !m.content ? { ...m, content: NOTHING } : m)), { role: 'user', content: input(c) }],
    parse: parseNothing,
    refine: (c, draft) => [
      { role: 'system', content: CHECK },
      { role: 'user', content: `${input(c)}\n\n## Draft\n${draft ? draft : NOTHING}` },
    ],
  },
  'steps-shots': {
    messages: (c) => [{ role: 'system', content: withNothing(STEPS) }, ...shotMessages().map((m) => (m.role === 'assistant' && !m.content ? { ...m, content: NOTHING } : m)), { role: 'user', content: input(c) }],
    parse: parseNothing,
  },
  json: {
    messages: (c) => [
      { role: 'system', content: STEPS + JSON_ASK },
      { role: 'user', content: input(c) },
    ],
    parse: parseJson,
    local: json,
  },
  'json-shots': {
    messages: (c) => [{ role: 'system', content: STEPS + JSON_ASK }, ...jsonShots(), { role: 'user', content: input(c) }],
    parse: parseJson,
    local: json,
  },
}
