import { DEFAULT_AGENT_NAME } from '@stanley/app-sdk'
import { named } from './narrate'
import { ACTING, FIELDS, HEARING, IDENTITY, SCREEN } from './persona'
import { longDate, type QuickExample } from './think'

/**
 * The writer: a small model on this computer that writes the text of the step being taken, what
 * goes in a field or what to search the web for. It takes that turn as Stanley, like any other:
 * Stanley's own words (persona.ts), then the end of the conversation as Jev reads it, and the step.
 * It reads the conversation without the screen, so that it answers in under a second.
 */

/** What the writer writes when the user hasn't said yet what goes in the step. */
export const NOTHING = '(nothing)'

/** The step the writer writes for: typing into a field, which holds `value`, or searching the web. */
export type WriteStep = { kind: 'field'; field: string; value: string } | { kind: 'search' }

/** Stanley as the writer reads it: who it is and how it acts, without Jev's questions, then today. */
export function writerInstructions(opts: { name?: string; today: Date }): string {
  const text = [`# Stanley\n${IDENTITY}`, ACTING, HEARING, SCREEN, FIELDS, `Today is ${longDate(opts.today)}.`].join('\n\n')
  return named(text, opts.name ?? DEFAULT_AGENT_NAME)
}

/** What the writer reads for a step: the end of the conversation, then the step. */
export function writerInput(conversation: string, step: WriteStep): string {
  const ask =
    step.kind === 'field'
      ? `You type into [${step.field}] now, which ${step.value ? `holds "${step.value}"` : 'is empty'}. What do you type?`
      : 'You search the web now. What do you search for?'
  return `${conversation}\n\n${ask} Write only that, or ${NOTHING} if the user hasn't said yet.`
}

const FIELD_TURNS: { conversation: string[]; field: string; value?: string; text: string }[] = [
  { conversation: ['You opened [Grandma].', 'User: send grandma a text that says thanks for the sweater um it fits perfectly'], field: 'Messages › Grandma › Message', text: 'Thanks for the sweater, it fits perfectly.' },
  { conversation: ['You opened [Ravi Patel: Budget draft].', 'User (still speaking): write back to him and say'], field: '"Budget draft" › Reply to Ravi Patel', text: '' },
  { conversation: ['You opened Tasks.', 'User: add pick up the kids at three no at three thirty'], field: 'New task', text: 'Pick up the kids at 3:30' },
  { conversation: ['You opened [Ravi Patel: Budget draft].', 'User: also tell him the numbers are in the second tab'], field: '"Budget draft" › Reply to Ravi Patel', value: 'Looks good to me.', text: 'Looks good to me. The numbers are in the second tab.' },
  { conversation: ['You opened Notes.', 'You pressed [New note]: Opened a new note.', "User: write what's the capital of Peru question mark"], field: 'Notes › New note', text: "What's the capital of Peru?" },
  { conversation: ['You opened Store.', 'User: look for running shoes in size ten'], field: 'Store › Search', text: 'running shoes size 10' },
  { conversation: ['You opened [Ravi Patel: Budget draft].', "User: change that to I'll be twenty minutes late"], field: '"Budget draft" › Reply to Ravi Patel', value: "Can't make it tonight.", text: "I'll be 20 minutes late." },
  { conversation: ['You opened [Grandma].', "User: never mind that, just say I'll call you"], field: 'Messages › Grandma › Message', value: 'The report is', text: "I'll call you." },
  { conversation: ['You opened Notes.', 'You pressed [New note]: Opened a new note.', 'User: write we need chairs tables and the projector no not the projector the speakers for Friday'], field: 'Notes › New note', text: 'We need chairs, tables and the speakers for Friday.' },
  { conversation: ['You opened [Grandma].', 'User: say the party is in room four', 'You typed "The party is in room 4." into [Messages › Grandma › Message].', 'User (went on): no room five'], field: 'Messages › Grandma › Message', value: 'The party is in room 4.', text: 'The party is in room 5.' },
  { conversation: ['You opened Maps.', 'User: take me to two forty five Elm Avenue'], field: 'Maps › Search', text: '245 Elm Avenue' },
  { conversation: ['You opened [Ravi Patel: Budget draft].', 'User: reply okay so um quick reminder the office is closed Monday'], field: '"Budget draft" › Reply to Ravi Patel', text: 'Quick reminder: the office is closed Monday.' },
  { conversation: ['You opened [Grandma].', 'User: say see you at noon', 'You typed "See you at noon." into [Messages › Grandma › Message].', 'User: also say bring an umbrella'], field: 'Messages › Grandma › Message', value: 'See you at noon.', text: 'See you at noon. Bring an umbrella.' },
  { conversation: ['You opened [Ravi Patel: Budget draft].', 'User: reply the cafe is called Brio B R I O'], field: '"Budget draft" › Reply to Ravi Patel', text: 'The cafe is called Brio.' },
  { conversation: ['You opened [Grandma].', "User: tell her the dog's name is Max sorry Milo"], field: 'Messages › Grandma › Message', text: "The dog's name is Milo." },
]

/** Searches that find what is true now carry the month and year: `today`'s, so they agree with the instructions. */
const SEARCH_TURNS = (month: string): { conversation: string[]; text: string }[] => [
  { conversation: ['User: how high is Kilimanjaro'], text: 'Kilimanjaro height' },
  { conversation: ['User: who directed Oppenheimer', 'You said: "Christopher Nolan directed it."', 'User: what else has he made'], text: 'Christopher Nolan films' },
  { conversation: ['User: who coaches the Chicago Bulls'], text: `Chicago Bulls head coach ${month}` },
  { conversation: ['User: can you look up when the Louvre(?) closes on Fridays'], text: 'Louvre Friday opening hours' },
  { conversation: ['User: what is bitcoin at right now'], text: `bitcoin price ${month}` },
  { conversation: ['User: search for um'], text: '' },
  { conversation: ['User: find me a recipe for banana bread no actually for carrot cake'], text: 'carrot cake recipe' },
]

/**
 * The writer's earlier turns, on words and fields of their own: sent before every step, so the
 * model on this computer keeps them read and only reads the new step.
 */
export function writerExamples(today: Date): QuickExample[] {
  const month = today.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const conversation = (lines: string[]) => `## Conversation\n${lines.join('\n')}`
  return [
    ...FIELD_TURNS.map((e) => ({ input: writerInput(conversation(e.conversation), { kind: 'field', field: e.field, value: e.value ?? '' }), output: e.text || NOTHING })),
    ...SEARCH_TURNS(month).map((e) => ({ input: writerInput(conversation(e.conversation), { kind: 'search' }), output: e.text || NOTHING })),
  ]
}

/** The writer's reply as text for the step: without quotes around it, and '' for `NOTHING`. */
export function written(reply: string): string {
  const text = reply.trim().replace(/^["“](.*)["”]$/s, '$1').trim()
  return text === NOTHING ? '' : text
}

const tokens = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []

/**
 * Whether text typed into a field is Stanley's own words rather than the user's: less than half of
 * what it added to the field (`before`) is words the user said (`heard`). Numbers don't count either
 * way, since "three thirty" is typed "3:30". Nothing decides this but the words themselves.
 */
export function ownWords(text: string, heard: string, before = ''): boolean {
  const said = new Set(tokens(heard))
  const held = new Set(tokens(before))
  const added = tokens(text).filter((t) => !held.has(t) && !/^\d/.test(t))
  if (!added.length) return false
  return added.filter((t) => said.has(t)).length / added.length < 0.5
}
