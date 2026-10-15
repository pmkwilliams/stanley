import type { Steps } from './scene.mts'

/**
 * What the screen should show once Stanley has done what the user asked. An arrangement is written
 * as the screen reads left to right: `email` fills the screen, `email | tasks` is side by side, and
 * `email | tasks + weather` puts Tasks and Weather stacked on the right; `home` shows none. Stacking
 * order isn't judged.
 * The apps hold their own data (`scene.mts`): what Stanley did is done in them by `steps`.
 */
export interface LayoutCase {
  name: string
  /** What is on the user's screen when they speak; `null` is the home screen. */
  on: string | null
  /** What the user said and what Stanley did, as Jev reads the conversation. */
  conversation: string[]
  /** The app Stanley worked on last (it may be hidden): its screen is in what Jev reads. */
  worked?: string
  steps?: Steps
  /** The arrangements that pass. */
  want: string[]
}

/** Two apps side by side, either way round. */
const pair = (a: string, b: string) => [`${a} | ${b}`, `${b} | ${a}`]

export const cases: LayoutCase[] = [
  // Asked for in so many words.
  { name: 'inbox-and-tasks', on: 'email', conversation: ['User: show me my inbox and my tasks'], want: pair('email', 'tasks') },
  { name: 'swap', on: 'email | tasks', conversation: ['User: swap them round'], want: ['tasks | email'] },
  { name: 'just-the-inbox', on: 'email | tasks', conversation: ['User: just the inbox please'], want: ['email'] },
  { name: 'hide-weather', on: 'email | tasks + weather', conversation: ["User: hide the weather, I don't need it"], want: pair('email', 'tasks') },
  { name: 'weather-on-the-right', on: 'email', conversation: ['User: put the weather on the right next to my email'], want: ['email | weather'] },
  { name: 'three-at-once', on: 'tasks', conversation: ['User: show me email, tasks and the weather all at once'], want: ['email | tasks + weather', 'email + tasks | weather', 'tasks | email + weather', 'tasks + email | weather', 'weather | email + tasks', 'email + weather | tasks'] },
  { name: 'music-left-too', on: 'email | tasks', conversation: ['User: put the music on the left as well'], want: ['email + music | tasks'] },
  { name: 'tasks-beside-recipe', on: 'web', conversation: ['User: open my tasks next to this'], worked: 'web', want: pair('web', 'tasks') },
  { name: 'explicit-sides', on: 'email', conversation: ['User: inbox on the right, tasks on the left'], want: ['tasks | email'] },
  { name: 'close-weather', on: 'email | weather', conversation: ['User: close the weather'], want: ['email'] },
  { name: 'clear-the-screen', on: 'email | tasks', conversation: ['User: clear the screen, put it all away'], want: ['home'] },
  { name: 'show-weather-from-home', on: null, conversation: ['User: show me the weather'], worked: 'weather', want: ['weather'] },

  // Left to Jev: the request is about something else, and what to show follows from it.
  {
    name: 'task-for-this-invoice',
    on: 'email',
    conversation: [
      'User: open the email from Alex',
      'Stanley opened [Alex Romero: Invoice #2291 overdue].',
      'User: add a task to pay this invoice',
      'Stanley typed "Pay Alex Romero invoice #2291" into [New task].',
      'Stanley pressed [New task › press Enter]: Added "Pay Alex Romero invoice #2291".',
    ],
    worked: 'tasks',
    steps: { email: ['email/m6'], tasks: ['title|Pay Alex Romero invoice #2291', 'add'] },
    want: pair('email', 'tasks'),
  },
  {
    name: 'lights-while-cooking',
    on: 'web',
    conversation: ['User: put the living room lights at 80 percent', 'Stanley typed "80" into [Living room › Brightness].'],
    worked: 'lights',
    want: ['web'],
  },
  {
    name: 'pause-music-while-reading',
    on: 'email',
    conversation: ['User: pause the music', 'Stanley pressed [Pause]: Paused.'],
    worked: 'music',
    steps: { music: ['toggle'] },
    want: ['email'],
  },
  {
    name: 'add-task-keeps-split',
    on: 'email | tasks',
    conversation: ['User: add buy milk to my tasks', 'Stanley typed "Buy milk" into [New task].', 'Stanley pressed [New task › press Enter]: Added "Buy milk".'],
    worked: 'tasks',
    steps: { tasks: ['title|Buy milk', 'add'] },
    want: ['email | tasks'],
  },
  {
    name: 'music-keeps-split',
    on: 'email | tasks',
    conversation: ['User: put some music on', 'Stanley pressed [Play]: Playing "Hallucinogens" by Konteks.'],
    worked: 'music',
    want: ['email | tasks'],
  },
  {
    name: 'add-task-from-home',
    on: null,
    conversation: ['User: put buy eggs on my task list', 'Stanley typed "Buy eggs" into [New task].', 'Stanley pressed [New task › press Enter]: Added "Buy eggs".'],
    worked: 'tasks',
    steps: { tasks: ['title|Buy eggs', 'add'] },
    want: ['tasks'],
  },
  { name: 'open-tasks-switches', on: 'email', conversation: ['User: open my tasks', 'Stanley opened Tasks.'], worked: 'tasks', want: ['tasks'] },
  { name: 'check-email-switches', on: 'tasks', conversation: ['User: check my email', 'Stanley opened Email.'], worked: 'email', want: ['email'] },
  {
    name: 'weather-tomorrow',
    on: 'email',
    conversation: ["User: what's the weather like tomorrow", 'Stanley opened Weather.'],
    worked: 'weather',
    want: ['weather', ...pair('email', 'weather')],
  },
]
