import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { filesOf, lookupsOf, parseSkill, saidOf, stepsOf, targetOf, type Agent } from '@stanley/agent'
import type { Shell } from '../apps/desktop/src/main/shell'

/** Returns a failure message, or nothing when the check passes. `files` is the user's folder for the run. */
export type Check = (shell: Shell, agent: Agent, files: string) => string | void

export interface Scenario {
  name: string
  utterances: string[]
  checks: Check[]
  /** Limits on thinking's input over the run: the share read from the cache, and the largest call. */
  cache?: { minReadRatio: number; maxInputTokens: number }
}

const visible = (appId: string | null): Check => (shell) =>
  shell.layout.visible === appId ? undefined : `expected ${appId} visible, got ${shell.layout.visible}`

const route = (appId: string, pattern: RegExp): Check => (shell) => {
  const state = shell.surfaces.get(appId) as { route?: string } | undefined
  return state?.route && pattern.test(state.route) ? undefined : `expected ${appId} route ~ ${pattern}, got ${state?.route}`
}

const state = (appId: string, test: (s: any) => boolean, what: string): Check => (shell) =>
  test(shell.surfaces.get(appId)) ? undefined : `expected ${what}`

const stanleySteps = (agent: Agent) => stepsOf(agent.history.view()).filter((e) => e.by !== 'user')
const spoken = (agent: Agent) => saidOf(agent.history.view())

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

/** The Web app shows a page whose address or title matches. */
const webPage = (pattern: RegExp): Check => (shell) => {
  const s = shell.surfaces.get('web') as { route?: string; pages?: { url: string; title: string }[] } | undefined
  const page = s?.route?.startsWith('page/') ? s.pages?.[Number(s.route.slice(5))] : undefined
  return page && (pattern.test(page.url) || pattern.test(page.title)) ? undefined : `expected a web page ~ ${pattern}, got ${page ? page.url : 'none'}`
}

/** Thinking searched the web in the background. */
const searches = (agent: Agent) => lookupsOf(agent.history.view()).filter((l) => l.kind === 'search' && !l.error)
const searched: Check = (_, agent) => (searches(agent).length ? undefined : 'expected a web search')
/** Thinking searched exactly `n` times: what it found earlier is reused, not looked up again. */
const searchCount = (n: number): Check => (_, agent) => (searches(agent).length === n ? undefined : `expected ${n} web search${n === 1 ? '' : 'es'}, got ${searches(agent).map((l) => (l.kind === 'search' ? `"${l.query}"` : '')).join(', ') || 'none'}`)

/** A file in the user's folder whose text matches every pattern. */
const fileSays = (path: string, ...patterns: RegExp[]): Check => (_, __, files) => {
  const file = join(files, path)
  if (!existsSync(file)) return `expected the file ${path}`
  const text = readFileSync(file, 'utf8')
  const missing = patterns.filter((p) => !p.test(text))
  return missing.length ? `expected ${path} to match ${missing.join(', ')}, got: ${JSON.stringify(text)}` : undefined
}
const fileGone = (path: string): Check => (_, __, files) => (existsSync(join(files, path)) ? `expected ${path} to be gone` : undefined)
/** Some new file anywhere in the folder, named like `name`, says `text`. */
const newFile = (name: RegExp, text: RegExp): Check => (_, __, files) => {
  const all = readdirSync(files, { recursive: true, encoding: 'utf8' })
  const hit = all.find((f) => name.test(f) && text.test(readFileSync(join(files, f), 'utf8')))
  return hit ? undefined : `expected a file named ~ ${name} saying ~ ${text}, got ${all.join(', ')}`
}

/** Stanley read skill `name`: Jev's step for it, or a command of thinking's on its folder. */
const usedSkill = (name: string) => (agent: Agent) =>
  filesOf(agent.history.view()).some((f) => (f.kind === 'skill' && f.name === name && !f.error) || (f.kind === 'bash' && f.command.includes(`.agents/skills/${name}`)))
const readSkill = (name: string): Check => (_, agent) => (usedSkill(name)(agent) ? undefined : `expected the skill ${name} to be read`)
const skippedSkill = (name: string): Check => (_, agent) => (usedSkill(name)(agent) ? `expected the skill ${name} not to be read` : undefined)
/** Every step was Jev's: a skill was followed on the fast path, without thinking. */
const fastPath: Check = (_, agent) => {
  const slow = stanleySteps(agent).filter((e) => e.by === 'thinking')
  return slow.length ? `expected Jev to take every step, thinking took ${slow.map((e) => targetOf(e.target)).join(', ')}` : undefined
}
/** Every skill in the folder can be used, and one of them says to do `what`. */
const skillSays = (what: RegExp): Check => (_, __, files) => {
  const dir = join(files, '.agents/skills')
  const folders = existsSync(dir) ? readdirSync(dir) : []
  const texts = folders.map((f) => (existsSync(join(dir, f, 'SKILL.md')) ? readFileSync(join(dir, f, 'SKILL.md'), 'utf8') : ''))
  const broken = folders.flatMap((f, i) => {
    const skill = parseSkill(f, texts[i]!)
    return 'error' in skill ? [`${skill.path}: ${skill.error}`] : []
  })
  if (broken.length) return `expected every skill to be usable: ${broken.join('; ')}`
  return texts.some((t) => what.test(t)) ? undefined : `expected a skill saying ~ ${what}, got ${folders.join(', ')}`
}
const playing = (title: RegExp): Check => state('music', (s) => s?.playing === true && title.test(s.tracks?.find((t: any) => t.id === s.currentId)?.title ?? ''), `playing ~ ${title}`)

const said = (pattern = /\S/): Check => (_, agent) =>
  spoken(agent).some((t) => pattern.test(t)) ? undefined : `expected Stanley to say something matching ${pattern}`

const saidNothing: Check = (_, agent) => (spoken(agent).length === 0 ? undefined : `expected nothing said, got "${spoken(agent).join(' ')}"`)

/** Stanley never told the user to look it up themselves, or that it can't know current facts. */
const noHedge: Check = (_, agent) => {
  const hedge = spoken(agent).find((t) => /check (a|an|the)? ?(current|up-to-date|reliable|official|latest)|as of my (last|knowledge)|(don't|can't|cannot) (have|access) (real-time|current|live)/i.test(t))
  return hedge ? `expected an answer, not a hedge: "${hedge}"` : undefined
}

/** Stanley never told the user what's on screen or what opened: they can see it. */
const noNarration: Check = (_, agent) => {
  const narrated = spoken(agent).find((t) => /\bon (the |your )?screen\b|\b(app|page|screen) (is|shows|says)\b|\b(is|are) (now )?(open|showing|up)\b|\b(i've |i )?(opened|pulled up|brought up)\b/i.test(t))
  return narrated ? `expected no narration of the screen: "${narrated}"` : undefined
}

/** No sentence of an earlier reply comes back in a later one. */
const noRepeat: Check = (_, agent) => {
  const replies = spoken(agent).map((t) => normalizeWords(t).join(' '))
  for (const [i, later] of replies.entries()) {
    for (const earlier of replies.slice(0, i)) {
      const repeated = earlier.split(/(?<=[.!?])\s+/).map((s) => s.trim()).find((s) => s.split(' ').length > 3 && later.includes(s))
      if (repeated) return `expected no repeat, but "${repeated}" was said again`
    }
  }
  return undefined
}

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
  const heard = spoken(agent).some((t) => words.length > 0 && words.every((w) => normalizeWords(t).includes(w)))
  return heard ? undefined : `expected Stanley to read back the draft "${text}"`
}
const normalizeWords = (t: string) => t.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []

const sentBodies = (shell: Shell) => (((shell.surfaces.get('email') as any)?.sent ?? []) as { body: string }[]).map((m) => m.body)
const sentBody = (test: RegExp | ((body: string) => boolean), what: string): Check => (shell) => {
  const bodies = sentBodies(shell)
  const ok = bodies.length > 0 && bodies.every((b) => (typeof test === 'function' ? test(b) : test.test(b)))
  return ok ? undefined : `expected the sent reply to have ${what}, got ${JSON.stringify(bodies)}`
}

const todoDone = (title: RegExp, done: boolean): Check => (shell) => {
  const todo = todos(shell.surfaces.get('todo')).find((t) => title.test(t.title))
  return todo?.done === done ? undefined : `expected ${title} ${done ? 'done' : 'not done'}, got ${todo ? (todo.done ? 'done' : 'not done') : 'missing'}`
}

/** The seed list has 4 to-dos. */
const newTodos = (n: number): Check => (shell) => {
  const added = todos(shell.surfaces.get('todo')).length - 4
  return added === n ? undefined : `expected ${n} new to-do, got ${added}: ${JSON.stringify(todos(shell.surfaces.get('todo')).slice(4).map((t) => t.title))}`
}

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
  return !s || inboxCount(shell) === 7 ? undefined : `expected all 7 emails still in the inbox, got ${inboxCount(shell)}`
}

/**
 * Utterances here must never appear in a prompt, an option description or an app's field
 * instructions (evals/leak.test.ts checks), or a pass shows only that the prompt was fitted to it.
 */
export const scenarios: Scenario[] = [
  {
    name: 'weather-denver',
    utterances: ["what's the weather in Denver"],
    checks: [visible('weather'), state('weather', (s) => /denver/i.test(JSON.stringify(s?.result ?? s)), 'Denver weather loaded'), actions(8), said(/\d/), noNarration],
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
    checks: [sentCount(1), visible('email'), route('email', /^email\/m1$/)],
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
    // Hands-free, the words that went in are said back.
    checks: [state('todo', (s) => todos(s).some((t) => /plumber/i.test(t.title)), 'a plumber to-do'), said(/plumber/i)],
  },
  {
    name: 'todo-delete-asked',
    utterances: ['get rid of the dentist task'],
    checks: [state('todo', (s) => !!s && !todos(s).some((t) => /dentist/i.test(t.title)), 'the dentist to-do deleted')],
  },
  {
    name: 'email-archive-asked',
    utterances: ['archive the message from the running club'],
    checks: [state('email', (s) => emails(s).find((e) => e.from === 'Coastal Running Club')?.archived === true, "the running club's email archived"), (shell) => (inboxCount(shell) === 6 ? undefined : `expected only one email archived, inbox has ${inboxCount(shell)}`)],
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

  // ── Turn-taking: pauses mid-thought (`|`), trailing off, corrections. Act on what's settled,
  //    never on half a thought. Every scenario also fails if Stanley speaks before the last word.
  {
    // A pause after "called": nothing is added until the title is said, and only the title is.
    name: 'todo-title-after-pause',
    utterances: ['make me a new to-do named | pick up the dry cleaning'],
    checks: [newTodos(1), state('todo', (s) => todos(s).some((t) => /dry cleaning/i.test(t.title) && !/named/i.test(t.title)), 'a "dry cleaning" to-do')],
  },
  {
    // The words to send come after a pause: sending before them would send half a message.
    name: 'reply-dictated-in-pieces',
    utterances: ['open the email from Sam', "reply saying | I can't do Friday | but Saturday works"],
    checks: [sentCount(1), sentBody(/saturday/i, 'mentions Saturday'), sentBody(/friday/i, 'mentions Friday')],
  },
  {
    name: 'reply-self-correction',
    utterances: ['open the email from Sam', "reply saying I'll be there at five | actually make it six"],
    checks: [sentCount(1), sentBody(/\bsix\b|\b6\b/i, 'says six'), sentBody((t) => !/\bfive\b|\b5\b/i.test(t), 'does not say five')],
  },
  {
    // Trailing off: nothing to write yet, so nothing is written or sent.
    name: 'reply-trails-off',
    utterances: ['open the email from Sam', 'write back and tell him that | um'],
    checks: [sentCount(0), draft((t) => !t || !/\b(um|that)\b/i.test(t), 'no half-sentence draft')],
  },
  {
    // The intent is clear before the sentence ends: go to the right email while they talk.
    name: 'navigate-before-finished',
    utterances: ['I need to answer the one from Priya about | the roadmap'],
    checks: [route('email', /^email\/m2$/), sentCount(0)],
  },
  {
    name: 'todo-correction-in-sentence',
    utterances: ['tick off the passport one | no wait | the dentist one'],
    checks: [todoDone(/dentist/i, true), todoDone(/passport/i, false)],
  },
  {
    name: 'todo-undo',
    utterances: ['mark buy oat milk as done', 'oops, undo that'],
    checks: [todoDone(/oat milk/i, false)],
  },
  {
    name: 'email-unarchive',
    utterances: ['archive the message from the running club', 'actually put it back'],
    checks: [state('email', (s) => emails(s).find((e) => e.from === 'Coastal Running Club')?.archived === false, "the running club's email back in the inbox")],
  },
  {
    // An undoable change said first, then more: the tick can go in while they're still talking,
    // and the rest still gets done.
    name: 'todo-done-then-add',
    utterances: ['show me my to-dos', "okay I finished the dentist one | and we're out of bananas so add those"],
    checks: [todoDone(/dentist/i, true), todoDone(/passport/i, false), newTodos(1), state('todo', (s) => todos(s).some((t) => /banana/i.test(t.title)), 'a bananas to-do')],
  },
  {
    // The same without a pause: the tick goes in while they're still talking.
    name: 'todo-done-then-add-run-on',
    utterances: ['show me my to-dos', 'right so the dentist one is done now and we also need some bananas'],
    checks: [todoDone(/dentist/i, true), todoDone(/passport/i, false), newTodos(1), state('todo', (s) => todos(s).some((t) => /banana/i.test(t.title)), 'a bananas to-do')],
  },
  {
    // Ticked mid-sentence, then the user keeps talking: re-deciding over the same words must not
    // tick it again (that would untick it).
    name: 'todo-tick-then-ask',
    utterances: ['cross off the oat milk | and then how many are left'],
    checks: [todoDone(/oat milk/i, true), newTodos(0), said(/\d|one|two|three/i)],
  },
  {
    name: 'todo-two-ticks',
    utterances: ['tick off the oat milk and the passport ones'],
    checks: [todoDone(/oat milk/i, true), todoDone(/passport/i, true), todoDone(/dentist/i, false)],
  },
  {
    // Archiving can't wait on a guess: taken back before the end, nothing is archived.
    name: 'archive-taken-back',
    utterances: ['archive the one from my mom | hmm no actually leave it there'],
    checks: [inboxIntact],
  },
  {
    // Going somewhere and asking about it: the question still gets answered.
    name: 'navigate-and-ask',
    utterances: ['pull up my inbox and who sent the newest one'],
    checks: [visible('email'), said(/sam/i)],
  },
  {
    // Only going somewhere: nothing to say once it's there.
    name: 'navigate-quietly',
    utterances: ['take me to my to-dos'],
    checks: [visible('todo'), saidNothing],
  },
  {
    // Thinking opens a page from a link on screen: the page is the answer, so nothing is said.
    name: 'open-link-quietly',
    utterances: ['open the GitHub email', 'go to the GitHub page for the PR'],
    checks: [route('web', /^page\//), saidNothing],
  },
  {
    name: 'question-after-pause',
    utterances: ["what's the weather | in Chicago tomorrow"],
    checks: [state('weather', (s) => /chicago/i.test(JSON.stringify(s?.result ?? '')), 'Chicago weather loaded')],
  },

  // ── Misheard words: speech recognition marks words it was unsure of with (?). Fix them from
  //    context, ask when they make no sense, and never send them unheard.
  {
    // As in a real session: asked what the to-do should say, the answer came out garbled.
    name: 'todo-misheard-asks',
    utterances: ['add a new to do', 'how do(?) you do(?) to do(?)'],
    checks: [newTodos(0), said(/\?/)],
  },
  {
    name: 'todo-homophone-fixed',
    utterances: ['put by(?) a phone charger on my list'],
    checks: [newTodos(1), state('todo', (s) => todos(s).some((t) => /^buy a phone charger/i.test(t.title)), 'a "Buy a phone charger" to-do'), said(/charger/i)],
  },
  {
    name: 'email-name-from-screen',
    utterances: ['open my email', 'open the one from pre(?) uh(?)'],
    checks: [route('email', /^email\/m2$/)],
  },
  {
    name: 'reply-unsure-word-reads-back',
    utterances: ['open the email from Sam', "reply saying I'm in, see you fry(?) day(?)"],
    checks: [sentCount(0), said(/\?/)],
  },
  {
    // Answered from a file: Jev can look it up while the user speaks, thinking says it.
    name: 'files-answer',
    utterances: ["what's on my packing list for Lisbon"],
    checks: [said(/passport|adapter|rain jacket|shoes|charger/i), changedNothing],
  },
  {
    name: 'files-add-a-line',
    utterances: ['put sunscreen on the Lisbon list'],
    checks: [fileSays('Trips/Lisbon packing.md', /sunscreen/i, /Passport/, /Phone charger/)],
  },
  {
    // Working something out from a file takes a command, not just reading it.
    name: 'files-add-up',
    utterances: ['how much have I spent on groceries this year'],
    checks: [said(/316/), changedNothing],
  },
  {
    name: 'files-new-note',
    utterances: ['make a new file for the plumber saying he comes Thursday at nine'],
    checks: [newFile(/plumber/i, /thursday/i)],
  },
  {
    name: 'files-delete-when-asked',
    utterances: ['delete the shakshuka recipe'],
    checks: [fileGone('Recipes/shakshuka.md'), fileSays('Recipes/banana bread.md', /bananas/)],
  },
  {
    // A skill the user wrote: read as soon as it matches, then followed step by step by Jev alone.
    name: 'skill-routine',
    utterances: ['time for a break'],
    checks: [readSkill('break-time'), playing(/^Deep Blue$/), fastPath, saidNothing],
  },
  {
    // Know-how: how the user writes changes what Stanley composes for them.
    name: 'skill-know-how',
    utterances: ['open the email from Jordan', 'write back and say yes to the swap'],
    checks: [readSkill('email-style'), state('email', (s) => { const t: string | undefined = s?.drafts?.m8; return !!t && t === t.toLowerCase() && /— ?pat\s*$/.test(t) }, 'a lowercase reply to Jordan signed "— pat"'), sentCount(0)],
  },
  {
    // Skills that don't apply stay out of the way.
    name: 'skill-not-needed',
    utterances: ['add call the bank to my list'],
    checks: [newTodos(1), skippedSkill('break-time'), skippedSkill('email-style')],
  },
  {
    // Taught, then used in the same session.
    name: 'skill-taught',
    utterances: ['play some music', "remember that whenever I say I'm on a call you should pause the music", "I'm on a call"],
    checks: [skillSays(/pause/i), state('music', (s) => s?.playing === false, 'music paused')],
  },
  {
    // Changed when asked, and still usable.
    name: 'skill-edit-when-asked',
    utterances: ['change my break skill so it plays Coffee instead'],
    checks: [fileSays('.agents/skills/break-time/SKILL.md', /Coffee/), skillSays(/Coffee/)],
  },
  {
    // A question is answered from a background search; nothing opens on screen.
    name: 'lookup-in-background',
    utterances: ['who is the current CEO of Microsoft'],
    checks: [searched, said(/\w{3,}/), changedNothing],
  },
  {
    // "that" is whatever was just answered: a page about it goes on screen.
    name: 'show-me-the-answer',
    utterances: ["what's the tallest building in the world", 'show me that'],
    checks: [visible('web'), webPage(/burj|khalifa/i)],
  },
  {
    // The user names the kind of page they want; the search already found one.
    name: 'show-a-named-source',
    utterances: ['who painted the Mona Lisa', 'pull up the wikipedia article about him'],
    checks: [visible('web'), webPage(/wikipedia\.org.*leonardo/i)],
  },
  {
    // A source that wasn't among the first answer's results: found, then put on screen.
    name: 'show-an-official-source',
    utterances: ['who is the governor of California', 'show me an official source'],
    checks: [visible('web'), webPage(/\.gov\b/i)],
  },
  {
    // From one page to another, with no search box on screen.
    name: 'show-from-a-page',
    utterances: ['show me the wikipedia page for the Eiffel Tower', 'now show me George Washington'],
    checks: [visible('web'), webPage(/george_washington|george washington/i)],
  },
  {
    name: 'arithmetic-answer',
    utterances: ["what's fifteen percent of eighty"],
    checks: [said(/\b12\b|twelve/i), changedNothing],
  },
  {
    // A follow-up is answered on its own: what was already said isn't said again.
    name: 'follow-up-no-repeat',
    utterances: ['what is the capital of Australia', 'and roughly how many people live there'],
    checks: [said(/\d/), noRepeat],
  },
  {
    // Who holds an office now is looked up and answered, not deferred to the user.
    name: 'current-office-holder',
    utterances: ["who's the mayor of Denver"],
    checks: [searched, said(/\w{3,}/), noHedge],
  },
  {
    // What a search already found is in the conversation, so asking about it needs no new search.
    name: 'reuse-earlier-results',
    utterances: ['who won the most recent Nobel Prize in Literature', 'what did the second one say'],
    checks: [searchCount(1), said(/\w{3,}/)],
  },
  {
    // A long session: thinking keeps reading its history from the cache, and stays well under the
    // size where input gets dearer.
    name: 'long-session',
    utterances: [
      'open my to-do list',
      'add water the plants',
      'add renew my library card',
      'what is on my list now',
      'tick off water the plants',
      'open my email',
      'who wrote to me about the roadmap',
      'open that one',
      'go back',
      "what's the weather in Boston",
      'and in Miami',
      'play some jazz',
      'skip this song',
      'pause the music',
      'add book a haircut to my list',
      'how many things are left on my list',
      'what is twelve times eight',
      'open the email from Sam',
      'what day is he suggesting',
      'go home',
      "what's the weather in Austin tomorrow",
      'add pack an umbrella',
      'mark renew my library card as done',
      'open my email',
      'how many emails are there',
      'open the first one',
      'go back',
      'what is the boiling point of water in Fahrenheit',
      'thanks',
      'open my to-do list',
    ],
    checks: [newTodos(4)],
    cache: { minReadRatio: 0.7, maxInputTokens: 100_000 },
  },
]
