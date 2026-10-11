import { targetOf, type Agent } from '@stanley/agent'
import type { Shell } from '../apps/desktop/src/main/shell'

/** Returns a failure message, or nothing when the check passes. */
export type Check = (shell: Shell, agent: Agent) => string | void

export interface Scenario {
  name: string
  utterances: string[]
  checks: Check[]
}

const visible = (appId: string | null): Check => (shell) =>
  shell.layout.visible === appId ? undefined : `expected ${appId} visible, got ${shell.layout.visible}`

const route = (appId: string, pattern: RegExp): Check => (shell) => {
  const state = shell.surfaces.get(appId) as { route?: string } | undefined
  return state?.route && pattern.test(state.route) ? undefined : `expected ${appId} route ~ ${pattern}, got ${state?.route}`
}

const state = (appId: string, test: (s: any) => boolean, what: string): Check => (shell) =>
  test(shell.surfaces.get(appId)) ? undefined : `expected ${what}`

const stanleySteps = (agent: Agent) => agent.log.entries.flatMap((e) => (e.role === 'step' && e.by !== 'user' ? [e] : []))

/** Stanley took no steps at all: it only listened, or said something. */
const changedNothing: Check = (_, agent) => {
  const steps = stanleySteps(agent)
  return steps.length === 0 ? undefined : `expected no steps, got ${steps.map((e) => targetOf(e.target)).join(', ')}`
}

/** Passes when any of the checks passes. */
const either = (...checks: Check[]): Check => (shell, agent) => {
  const failures = checks.map((c) => c(shell, agent))
  return failures.some((f) => !f) ? undefined : failures.join(' / ')
}

const said = (pattern = /\S/): Check => (_, agent) =>
  agent.log.entries.some((e) => e.role === 'said' && pattern.test(e.content)) ? undefined : `expected Stanley to say something matching ${pattern}`

const samsEmail = (s: any) => s?.emails?.find((e: any) => e.id === 'm1')
const sentCount = (n: number): Check => (shell) => {
  const sent = (shell.surfaces.get('email') as any)?.sent?.length ?? 0
  return sent === n ? undefined : `expected ${n} sent, got ${sent}`
}
const draft = (test: (text: string | undefined) => boolean, what: string) => state('email', (s) => test(s?.drafts?.[samsEmail(s)?.id]), what)

/** Stanley read the drafted reply back to the user. */
const saidDraft: Check = (shell, agent) => {
  const text = (shell.surfaces.get('email') as any)?.drafts?.m1 as string | undefined
  const words = normalizeWords(text ?? '')
  const heard = agent.log.entries.some((e) => e.role === 'said' && words.length > 0 && words.every((w) => normalizeWords(e.content).includes(w)))
  return heard ? undefined : `expected Stanley to read back the draft "${text}"`
}
const normalizeWords = (t: string) => t.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []

const actions = (max: number): Check => (_, agent) => {
  const n = stanleySteps(agent).length
  return n <= max ? undefined : `expected ≤ ${max} steps, got ${n}`
}

const todos = (s: any) => (s?.todos ?? []) as { title: string; done: boolean }[]
const emails = (s: any) => (s?.emails ?? []) as { id: string; from: string; archived?: boolean }[]
const inboxCount = (shell: Shell) => emails(shell.surfaces.get('email')).filter((e) => !e.archived).length

/** No email was deleted or archived. Email that was never opened counts as untouched. */
const inboxIntact: Check = (shell) => {
  const s = shell.surfaces.get('email')
  return !s || inboxCount(shell) === 8 ? undefined : `expected all 8 emails still in the inbox, got ${inboxCount(shell)}`
}

/**
 * Utterances here must never appear in a prompt, an option description or an app's field
 * instructions (evals/leak.test.ts checks), or a pass shows only that the prompt was fitted to it.
 */
export const scenarios: Scenario[] = [
  {
    name: 'weather-denver',
    utterances: ["what's the weather in Denver"],
    checks: [visible('weather'), state('weather', (s) => /denver/i.test(JSON.stringify(s?.result ?? s)), 'Denver weather loaded'), actions(8)],
  },
  {
    name: 'inbox-walkthrough',
    utterances: ["let's go through my inbox"],
    checks: [visible('email'), route('email', /^email\//)],
  },
  {
    name: 'todo-add',
    utterances: ['add buy eggs to my to-do list'],
    checks: [visible('todo'), state('todo', (s) => s?.todos.some((t: any) => /eggs/i.test(t.title)), 'an eggs to-do')],
  },
  {
    name: 'todo-complete',
    utterances: ['mark buy oat milk as done'],
    checks: [state('todo', (s) => s?.todos.find((t: any) => /oat milk/i.test(t.title))?.done === true, 'oat milk done')],
  },
  {
    name: 'music-play',
    utterances: ['play some music'],
    checks: [state('music', (s) => s?.playing === true, 'music playing')],
  },
  {
    // The user gets the answer: read from a page Stanley opened, or said.
    name: 'pm-research',
    utterances: ['who is the prime minister of the UK'],
    checks: [either(route('web', /^page\//), said(/\w{3,}/))],
  },
  {
    name: 'mid-thought-wait',
    utterances: ['um so I was thinking'],
    checks: [visible(null), changedNothing],
  },
  {
    name: 'question-gets-an-answer',
    utterances: ['what can you do for me'],
    checks: [said(), changedNothing],
  },
  {
    // The user gave the exact words, so replying means sending them.
    name: 'reply-with-words-sends',
    utterances: ['open the email from Sam', "reply saying I'm in, see you Friday"],
    checks: [sentCount(1)],
  },
  {
    // Only an idea of a reply: Stanley writes it, reads it back and asks before sending.
    name: 'reply-suggestion-confirms',
    utterances: ['open the email from Sam', "let's reply with something funny"],
    checks: [draft((t) => !!t, 'a drafted reply'), sentCount(0), saidDraft, said(/send|\?/i)],
  },
  {
    name: 'draft-a-reply',
    utterances: ['open the email from Sam', 'draft a reply saying sounds good'],
    checks: [draft((t) => !!t && /sounds good/i.test(t), 'a "sounds good" draft'), sentCount(0)],
  },
  {
    name: 'reply-and-send',
    utterances: ['open the email from Sam', "reply saying I'm in and send it"],
    checks: [sentCount(1), visible('email'), route('email', /^sent$/)],
  },
  {
    name: 'draft-then-send',
    utterances: ['open the email from Sam', 'reply saying sounds good', 'send it'],
    checks: [sentCount(1)],
  },
  {
    name: 'reply-without-content',
    utterances: ['open the email from Sam', 'reply'],
    checks: [sentCount(0), draft((t) => !t, 'no invented draft')],
  },
  {
    name: 'follow-up-across-tasks',
    utterances: ['open my email', 'open the one from Priya'],
    checks: [visible('email'), state('email', (s) => /priya/i.test(JSON.stringify(s?.emails?.find((e: any) => `email/${e.id}` === s.route) ?? '')), 'Priya email open')],
  },

  // ── Held-out phrasings: written after the prompts, never tuned against ──
  {
    name: 'todo-add-with-filler',
    utterances: ['add a new to do called um avocado'],
    checks: [state('todo', (s) => todos(s).some((t) => /avocado/i.test(t.title)), 'an avocado to-do'), state('todo', (s) => !todos(s).some((t) => /\bum\b|called/i.test(t.title)), 'no filler in the title')],
  },
  {
    name: 'todo-add-phrasing',
    utterances: ['put call the plumber on my list'],
    checks: [state('todo', (s) => todos(s).some((t) => /plumber/i.test(t.title)), 'a plumber to-do')],
  },
  {
    name: 'todo-delete-asked',
    utterances: ['get rid of the dentist task'],
    checks: [state('todo', (s) => !!s && !todos(s).some((t) => /dentist/i.test(t.title)), 'the dentist to-do deleted')],
  },
  {
    name: 'email-archive-asked',
    utterances: ['archive the message from my mom'],
    checks: [state('email', (s) => emails(s).find((e) => e.from === 'Mom')?.archived === true, "Mom's email archived"), (shell) => (inboxCount(shell) === 7 ? undefined : `expected only one email archived, inbox has ${inboxCount(shell)}`)],
  },
  {
    name: 'email-vague-cleanup',
    utterances: ['my inbox is a mess, deal with it'],
    checks: [inboxIntact, said()],
  },
  {
    name: 'reply-gist-confirms',
    utterances: ['open the email from Jordan', 'write back and politely say no'],
    checks: [state('email', (s) => !!s?.drafts?.m8, 'a drafted reply to Jordan'), sentCount(0), said(/send|\?/i)],
  },
  {
    name: 'music-skip',
    utterances: ['put on some tunes', 'skip this one'],
    checks: [state('music', (s) => s?.playing === true && s.currentId !== s.tracks[0].id, 'playing a later track')],
  },
  {
    name: 'weather-seattle',
    utterances: ['is it going to rain in Seattle tomorrow'],
    checks: [state('weather', (s) => /seattle/i.test(JSON.stringify(s?.result ?? '')), 'Seattle weather loaded')],
  },
  {
    name: 'never-mind',
    utterances: ['oh never mind'],
    checks: [changedNothing, visible(null)],
  },
  {
    name: 'arithmetic-answer',
    utterances: ["what's fifteen percent of eighty"],
    checks: [said(/\b12\b|twelve/i), changedNothing],
  },
]
