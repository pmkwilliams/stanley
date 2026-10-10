import type { Agent } from '@stanley/agent'
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

const onlyWaited: Check = (_, agent) => {
  const acted = agent.log.entries.filter((e) => e.role === 'assistant' && e.origin === 'agent' && e.toolCall.option !== 'wait')
  return acted.length === 0 ? undefined : `expected only waits, got ${acted.map((e) => (e.role === 'assistant' ? e.toolCall.option : '')).join(', ')}`
}

const actions = (max: number): Check => (_, agent) => {
  const n = agent.log.entries.filter((e) => e.role === 'assistant' && e.origin === 'agent').length
  return n <= max ? undefined : `expected ≤ ${max} decisions, got ${n}`
}

export const scenarios: Scenario[] = [
  {
    name: 'weather-denver',
    utterances: ["what's the weather in Denver"],
    checks: [visible('weather'), state('weather', (s) => /denver/i.test(JSON.stringify(s?.result ?? s)), 'Denver weather loaded'), actions(6)],
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
    name: 'pm-research',
    utterances: ['who is the prime minister of the UK'],
    checks: [visible('web'), route('web', /^page\//)],
  },
  {
    name: 'mid-thought-wait',
    utterances: ['um so I was thinking'],
    checks: [visible(null), onlyWaited],
  },
  {
    name: 'follow-up-across-tasks',
    utterances: ['open my email', 'open the one from Priya'],
    checks: [visible('email'), state('email', (s) => /priya/i.test(JSON.stringify(s?.emails?.find((e: any) => `email/${e.id}` === s.route) ?? '')), 'Priya email open')],
  },
]
