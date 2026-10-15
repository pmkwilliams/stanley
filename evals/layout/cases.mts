/**
 * What the screen should show once Stanley has done what the user asked. An arrangement is written
 * as the screen reads left to right: `email` fills the screen, `email | tasks` is side by side, and
 * `email | tasks + weather` puts Tasks and Weather stacked on the right. Stacking order isn't judged.
 */
export interface LayoutCase {
  name: string
  /** What is on the user's screen when they speak; `null` is the home screen. */
  on: string | null
  /** What the user said and what Stanley did, as Jev reads the conversation. */
  conversation: string[]
  /** The app Stanley worked on last (it may be hidden), and what it shows. */
  worked?: { app: string; markdown: string }
  /** The arrangements that pass. */
  want: string[]
}

/** Two apps side by side, either way round. */
const pair = (a: string, b: string) => [`${a} | ${b}`, `${b} | ${a}`]

const INBOX = `# Inbox
- **Sam Lee** · Lunch Friday? · Are you free for lunch on Friday? 12:30 at Rosie's?
- **Acme Billing** · Invoice #4411 · Your invoice for September is due on Friday.
- **United** · Check in for your flight · Your flight to Denver leaves tomorrow at 7:05.`

const TASKS = `# Tasks
- [ ] Book dentist appointment
- [ ] Buy oat milk`

const RECIPE = `# Lemon chicken traybake
Serves 4 · 1 hour
## Ingredients
- 8 chicken thighs
- 2 lemons
## Method
1. Heat the oven to 200°C.
2. Slice the lemons and toss with the chicken.`

const WEATHER = `# Weather · San Francisco
Now: 64°F, partly cloudy
Tomorrow: 68°F, sunny`

export const cases: LayoutCase[] = [
  // Asked for in so many words.
  { name: 'inbox-and-tasks', on: 'email', conversation: ['User: show me my inbox and my tasks'], want: pair('email', 'tasks') },
  { name: 'swap', on: 'email | tasks', conversation: ['User: swap them round'], want: ['tasks | email'] },
  { name: 'just-the-inbox', on: 'email | tasks', conversation: ['User: just the inbox please'], want: ['email'] },
  { name: 'hide-weather', on: 'email | tasks + weather', conversation: ["User: hide the weather, I don't need it"], want: pair('email', 'tasks') },
  { name: 'weather-on-the-right', on: 'email', conversation: ['User: put the weather on the right next to my email'], want: ['email | weather'] },
  { name: 'three-at-once', on: 'tasks', conversation: ['User: show me email, tasks and the weather all at once'], want: ['email | tasks + weather', 'email + tasks | weather', 'tasks | email + weather', 'tasks + email | weather', 'weather | email + tasks', 'email + weather | tasks'] },
  { name: 'music-left-too', on: 'email | tasks', conversation: ['User: put the music on the left as well'], want: ['email + music | tasks'] },
  { name: 'tasks-beside-recipe', on: 'web', conversation: ['User: open my tasks next to this'], worked: { app: 'web', markdown: RECIPE }, want: pair('web', 'tasks') },
  { name: 'explicit-sides', on: 'email', conversation: ['User: inbox on the right, tasks on the left'], want: ['tasks | email'] },
  { name: 'close-weather', on: 'email | weather', conversation: ['User: close the weather'], want: ['email'] },
  { name: 'show-weather-from-home', on: null, conversation: ['User: show me the weather'], worked: { app: 'weather', markdown: WEATHER }, want: ['weather'] },

  // Left to Jev: the request is about something else, and what to show follows from it.
  {
    name: 'task-for-this-invoice',
    on: 'email',
    conversation: ['Stanley opened ["Invoice #4411"].', 'User: add a task to pay this invoice', 'Stanley typed "Pay Acme invoice #4411" into [New task].', 'Stanley pressed [Add]: Added "Pay Acme invoice #4411".'],
    worked: { app: 'tasks', markdown: `${TASKS}\n- [ ] Pay Acme invoice #4411` },
    want: pair('email', 'tasks'),
  },
  {
    name: 'lights-while-cooking',
    on: 'web',
    conversation: ['User: dim the kitchen lights a bit', 'Stanley pressed [Kitchen › Dim]: Kitchen at 60%.'],
    worked: { app: 'lights', markdown: '# Lights\n- Kitchen: on, 60%\n- Living room: off' },
    want: ['web'],
  },
  {
    name: 'pause-music-while-reading',
    on: 'email',
    conversation: ['User: pause the music', 'Stanley pressed [Pause]: Paused.'],
    worked: { app: 'music', markdown: '# Music\nPaused: So What · Miles Davis' },
    want: ['email'],
  },
  {
    name: 'add-task-keeps-split',
    on: 'email | tasks',
    conversation: ['User: add buy milk to my tasks', 'Stanley typed "Buy milk" into [New task].', 'Stanley pressed [Add]: Added "Buy milk".'],
    worked: { app: 'tasks', markdown: `${TASKS}\n- [ ] Buy milk` },
    want: ['email | tasks'],
  },
  {
    name: 'jazz-keeps-split',
    on: 'email | tasks',
    conversation: ['User: play some jazz', 'Stanley pressed [So What · Miles Davis]: Playing.'],
    worked: { app: 'music', markdown: '# Music\nPlaying: So What · Miles Davis' },
    want: ['email | tasks'],
  },
  {
    name: 'open-tasks-switches',
    on: 'email',
    conversation: ['User: open my tasks', 'Stanley opened Tasks.'],
    worked: { app: 'tasks', markdown: TASKS },
    want: ['tasks'],
  },
  {
    name: 'check-email-switches',
    on: 'tasks',
    conversation: ['User: check my email', 'Stanley opened Email.'],
    worked: { app: 'email', markdown: INBOX },
    want: ['email'],
  },
  {
    name: 'weather-tomorrow',
    on: 'email',
    conversation: ["User: what's the weather like tomorrow", 'Stanley opened Weather.'],
    worked: { app: 'weather', markdown: WEATHER },
    want: ['weather', ...pair('email', 'weather')],
  },
]

