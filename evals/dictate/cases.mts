/**
 * What the quick model writes into a field from what the user said, as it reads it (`dictation()`
 * in think.ts): the end of the conversation, then the field and what it holds. It passes when the
 * field ends up holding what the user meant it to: the message they meant to send, the title they
 * meant, a search that finds what they asked for. The words can differ from theirs; what they get
 * can't. Each case is what one call would be sent; right answers are in `gold.json` (written by
 * GPT-6.1 Sol, reviewed by hand; an array lists several that are all right, the first preferred).
 *
 * - `has`: every entry must be in the text (an array: any one of them). Matched as whole words,
 *   ignoring case and the kind of apostrophe or dash.
 * - `notHas`: none may be.
 * - `empty`: nothing has been said for the field yet, so the text must be empty (or what the field
 *   already holds: either leaves it as it is).
 *
 * The checks hold what gets the user something they didn't mean (a word kept from the request, the
 * version they took back); the judge, given the gold, decides the rest.
 */
export interface DictateCase {
  name: string
  kind: Kind
  conversation: string[]
  field: string
  /** What the field holds before this call. */
  value?: string
  has?: (string | string[])[]
  notHas?: string[]
  empty?: boolean
}

export type Kind =
  | 'plain'
  | 'filler'
  | 'correction'
  | 'request'
  | 'append'
  | 'replace'
  | 'unsure'
  | 'format'
  | 'empty'
  | 'clean'
  | 'long'
  | 'live'
  | 'names'
  | 'literal'
  | 'spoken-punctuation'

const SAM = '"Lunch Friday?" › Reply to Sam Lee'
const PRIYA = '"Q4 roadmap review moved to Tuesday" › Reply to Priya Shah'
const ALEX = '"Invoice #2291 overdue" › Reply to Alex Romero'
const MOM = 'Messages › Mom › Message'
const NOTE = 'Notes › New note'
const SUBJECT = 'New email › Subject'
const BODY = 'New email › Message'
const SLACK = 'Slack › #design › Message'
const EVENT = 'Calendar › New event › Title'

export const cases: DictateCase[] = [
  // ── Plain: the words, tidied. ──
  { name: 'task-plain', kind: 'plain', conversation: ['User: add buy eggs to my task list', 'Stanley opened Tasks.'], field: 'New task', has: ['buy eggs'], notHas: ['task list', 'add'] },
  { name: 'task-named', kind: 'plain', conversation: ['User: make a task called renew the car registration', 'Stanley opened Tasks.'], field: 'New task', has: ['renew the car registration'], notHas: ['called', 'make a task'] },
  { name: 'reply-plain', kind: 'plain', conversation: ['User: open the email from Sam', 'Stanley opened Email.', 'Stanley opened [Sam Lee: Lunch Friday?].', "User: reply saying I'm in see you Friday"], field: SAM, has: ['in', 'see you Friday'], notHas: ['reply', 'saying'] },
  { name: 'text-mom-plain', kind: 'plain', conversation: ["User: text mom that I'll call her tonight", 'Stanley opened Messages.', 'Stanley opened [Mom].'], field: MOM, has: [['call her tonight', 'call you tonight']], notHas: ['text mom', 'that i'] },
  { name: 'slack-plain', kind: 'plain', conversation: ['User: post in the design channel the new mockups are up in figma', 'Stanley opened Slack.', 'Stanley opened [#design].'], field: SLACK, has: ['new mockups are up in figma'], notHas: ['post', 'design channel'] },
  { name: 'subject-plain', kind: 'plain', conversation: ['User: new email to Jordan subject quarterly numbers', 'Stanley opened Email.', 'Stanley pressed [Compose]: Opened a new email.', 'Stanley typed "jordan@example.com" into [New email › To].'], field: SUBJECT, has: ['quarterly numbers'], notHas: ['subject', 'jordan'] },
  { name: 'event-plain', kind: 'plain', conversation: ['User: put team offsite planning on my calendar', 'Stanley opened Calendar.', 'Stanley pressed [New event]: Opened a new event.'], field: EVENT, has: ['team offsite planning'], notHas: ['calendar', 'put'] },
  { name: 'note-plain', kind: 'plain', conversation: ['User: take a note the wifi password is on the back of the router', 'Stanley opened Notes.', 'Stanley pressed [New note]: Opened a new note.'], field: NOTE, has: [['wifi password', 'wi-fi password'], 'on the back of the router'], notHas: ['take a note'] },

  // ── Filler and false starts. ──
  { name: 'task-um', kind: 'filler', conversation: ['User: add a new task called um avocado', 'Stanley opened Tasks.'], field: 'New task', has: ['avocado'], notHas: ['um', 'called'] },
  { name: 'reply-likes', kind: 'filler', conversation: ['Stanley opened [Sam Lee: Lunch Friday?].', "User: reply saying like yeah I'm totally down for lunch you know whatever works for you"], field: SAM, has: ['down for lunch', 'whatever works for you'], notHas: ['like yeah', 'you know whatever'] },
  { name: 'reply-uh-restart', kind: 'filler', conversation: ['Stanley opened [Priya Shah: Q4 roadmap review moved to Tuesday].', 'User: tell her that uh the the deck will be uh ready by Monday'], field: PRIYA, has: ['deck will be ready by Monday'], notHas: ['uh', 'the the', 'tell her'] },
  { name: 'note-false-start', kind: 'filler', conversation: ['Stanley opened Notes.', 'Stanley pressed [New note]: Opened a new note.', 'User: write the plumber is coming on wed- on Thursday morning'], field: NOTE, has: ['plumber is coming on Thursday morning'], notHas: ['wed'] },
  { name: 'mom-so-basically', kind: 'filler', conversation: ['Stanley opened [Mom].', "User: so basically tell her um I'm gonna be late because the train is like delayed"], field: MOM, has: ['late', 'train', 'delayed'], notHas: ['basically', 'um', 'like delayed', 'tell her'] },
  { name: 'slack-i-mean-filler', kind: 'filler', conversation: ['Stanley opened [#design].', "User: say hey everyone uh I'll be uh out tomorrow so um ping Dana for reviews"], field: SLACK, has: ['hey everyone', 'out tomorrow', 'ping Dana for reviews'], notHas: ['uh', 'um', 'say hey'] },
  { name: 'task-er-hmm', kind: 'filler', conversation: ['Stanley opened Tasks.', 'User: add er hmm call the vet about er Biscuit'], field: 'New task', has: ['call the vet about Biscuit'], notHas: ['er', 'hmm'] },
  { name: 'reply-repeated-words', kind: 'filler', conversation: ['Stanley opened [Alex Romero: Invoice #2291 overdue].', "User: reply I I I've already already paid it last week"], field: ALEX, has: ["already paid it last week"], notHas: ['i i', 'already already'] },
  { name: 'body-sort-of-filler-kept', kind: 'filler', conversation: ['Stanley pressed [Compose]: Opened a new email.', 'User: the message is it was sort of a rough week but we shipped it'], field: BODY, has: ['rough week', 'we shipped it'], notHas: ['the message is'] },

  // ── Corrections: only the version they settled on. ──
  { name: 'reply-five-six', kind: 'correction', conversation: ['Stanley opened [Sam Lee: Lunch Friday?].', "User: reply saying I'll be there at five actually make it six"], field: SAM, has: [['six', '6']], notHas: ['five', '5', 'actually', 'make it'] },
  { name: 'task-no-wait', kind: 'correction', conversation: ['Stanley opened Tasks.', 'User: add buy milk no wait buy oat milk'], field: 'New task', has: ['oat milk'], notHas: ['no wait'] },
  { name: 'mom-scratch-that', kind: 'correction', conversation: ['Stanley opened [Mom].', "User: tell her I'll be there Sunday scratch that Saturday afternoon"], field: MOM, has: ['Saturday afternoon'], notHas: ['Sunday', 'scratch'] },
  { name: 'reply-sorry-i-mean', kind: 'correction', conversation: ['Stanley opened [Priya Shah: Q4 roadmap review moved to Tuesday].', 'User: reply Tuesday works for me sorry I mean Wednesday works for me'], field: PRIYA, has: ['Wednesday works for me'], notHas: ['Tuesday', 'sorry', 'i mean'] },
  { name: 'event-not-x-y', kind: 'correction', conversation: ['Stanley pressed [New event]: Opened a new event.', 'User: call it dinner with the Hendersons not the Hendricks the Hendersons'], field: EVENT, has: ['Dinner with the Hendersons'], notHas: ['Hendricks', 'call it'] },
  { name: 'body-word-swap', kind: 'correction', conversation: ['Stanley pressed [Compose]: Opened a new email.', "User: write the budget is approved I mean pending we'll know Friday"], field: BODY, has: ['budget is pending', "we'll know Friday"], notHas: ['approved', 'i mean'] },
  { name: 'slack-correction-later-turn', kind: 'correction', conversation: ['Stanley opened [#design].', "User: say the review is at two", 'Stanley typed "The review is at two." into [Slack › #design › Message].', 'User: oh no it\'s at three'], field: SLACK, value: 'The review is at two.', has: [['three', '3']], notHas: ['two', '2', 'oh no'] },
  { name: 'task-correction-amount', kind: 'correction', conversation: ['Stanley opened Tasks.', 'User: add pay rent twelve hundred no thirteen hundred'], field: 'New task', has: [['1,300', '1300', 'thirteen hundred']], notHas: ['1,200', '1200', 'twelve'] },
  { name: 'not-a-correction-actually', kind: 'correction', conversation: ['Stanley opened [Sam Lee: Lunch Friday?].', "User: reply saying actually I'm free all day Friday so any time works"], field: SAM, has: ['actually', 'free all day Friday', 'any time works'] },
  { name: 'reply-correct-name', kind: 'correction', conversation: ['Stanley opened [Mom].', 'User: say Jake no Jacob is picking you up'], field: MOM, has: ['Jacob is picking you up'], notHas: ['Jake'] },

  // ── The request around the words: only the words for the field. ──
  { name: 'request-draft-reply', kind: 'request', conversation: ['Stanley opened [Sam Lee: Lunch Friday?].', 'User: draft a reply saying sounds good to me'], field: SAM, has: ['sounds good to me'], notHas: ['draft', 'reply', 'saying'] },
  { name: 'request-and-send', kind: 'request', conversation: ['Stanley opened [Sam Lee: Lunch Friday?].', "User: reply saying I'm in and send it"], field: SAM, has: ["I'm in"], notHas: ['send it', 'and send'] },
  { name: 'request-tell-him-that', kind: 'request', conversation: ['Stanley opened [Alex Romero: Invoice #2291 overdue].', 'User: write back and tell him that the payment went out this morning'], field: ALEX, has: ['payment went out this morning'], notHas: ['write back', 'tell him'] },
  { name: 'request-let-her-know', kind: 'request', conversation: ['Stanley opened [Mom].', 'User: let her know the flight lands at seven'], field: MOM, has: ['flight lands at', ['seven', '7']], notHas: ['let her know'] },
  { name: 'request-ask-him-whether', kind: 'request', conversation: ['Stanley opened [Sam Lee: Lunch Friday?].', 'User: ask him whether we can move it to noon'], field: SAM, has: ['move it to noon'], notHas: ['ask him'] },
  { name: 'request-with-recipient', kind: 'request', conversation: ['Stanley opened Messages.', 'Stanley opened [Mom].', 'User: send mom a message saying happy birthday love you'], field: MOM, has: ['happy birthday', 'love you'], notHas: ['send mom', 'a message saying'] },
  { name: 'request-search-box', kind: 'request', conversation: ['Stanley opened Music.', 'User: search for songs by Fleetwood Mac'], field: 'Music › Search', has: ['Fleetwood Mac'], notHas: ['search for'] },
  { name: 'request-title-it', kind: 'request', conversation: ['Stanley opened Notes.', 'Stanley pressed [New note]: Opened a new note.', 'User: title it grocery ideas'], field: 'Notes › New note › Title', has: ['grocery ideas'], notHas: ['title it'] },
  { name: 'request-for-someone', kind: 'request', conversation: ['Stanley opened [#design].', 'User: for the design folks write lunch is on me today'], field: SLACK, has: ['lunch is on me today'], notHas: ['design folks', 'write'] },
  { name: 'request-after-words', kind: 'request', conversation: ['Stanley opened [Priya Shah: Q4 roadmap review moved to Tuesday].', 'User: Tuesday is fine see you then put that in the reply'], field: PRIYA, has: ['Tuesday is fine', 'see you then'], notHas: ['put that', 'in the reply'] },
  { name: 'request-saying-that-quoted', kind: 'request', conversation: ['Stanley opened [Sam Lee: Lunch Friday?].', "User: reply with quote can't wait end quote"], field: SAM, has: ["can't wait"], notHas: ['quote', 'reply with'] },

  // ── Adding to what the field holds. ──
  { name: 'append-also-say', kind: 'append', conversation: ['Stanley opened [Sam Lee: Lunch Friday?].', "User: reply saying I'm in", 'Stanley typed "I\'m in." into ["Lunch Friday?" › Reply to Sam Lee].', 'User: also say bring the photos'], field: SAM, value: "I'm in.", has: ["I'm in", 'bring the photos'], notHas: ['also say'] },
  { name: 'append-add-that', kind: 'append', conversation: ['Stanley opened [Mom].', 'User: add that the kids say hi'], field: MOM, value: 'Dinner at six on Sunday?', has: ['Dinner at six on Sunday', 'kids say hi'], notHas: ['add that'] },
  { name: 'append-new-line-note', kind: 'append', conversation: ['Stanley opened [Shopping list] in Notes.', 'User: add paper towels to the list'], field: 'Notes › Shopping list', value: 'Eggs\nMilk\nBread', has: ['Eggs', 'Milk', 'Bread', 'paper towels'], notHas: ['to the list'] },
  { name: 'append-and-tell-her', kind: 'append', conversation: ['Stanley opened [Priya Shah: Q4 roadmap review moved to Tuesday].', 'User: and tell her the slides are attached'], field: PRIYA, value: 'Tuesday works for me.', has: ['Tuesday works for me', 'slides are attached'], notHas: ['tell her'] },
  { name: 'append-ps', kind: 'append', conversation: ['Stanley pressed [Compose]: Opened a new email.', 'User: add a PS the parking is around back'], field: BODY, value: "Hi all,\n\nThe party starts at 7 on Saturday. Bring a dish if you can.", has: ['party starts at', 'Bring a dish', 'parking is around back'] },
  { name: 'append-end-of-sentence', kind: 'append', conversation: ['Stanley opened [#design].', 'User: put at the end that the file is in the shared drive'], field: SLACK, value: 'New icons are ready for review.', has: ['New icons are ready for review', 'file is in the shared drive'], notHas: ['put at the end'] },

  // ── Replacing what the field holds. ──
  { name: 'replace-change-it-to', kind: 'replace', conversation: ['Stanley opened [Mom].', 'User: change it to running ten minutes late'], field: MOM, value: "I'm on my way.", has: [['ten minutes late', '10 minutes late']], notHas: ['on my way', 'change it'] },
  { name: 'replace-instead-say', kind: 'replace', conversation: ['Stanley opened [Sam Lee: Lunch Friday?].', 'User: instead just say sounds great'], field: SAM, value: "I'm in. See you Friday.", has: ['sounds great'], notHas: ['see you friday', 'instead'] },
  { name: 'replace-title', kind: 'replace', conversation: ['Stanley pressed [New event]: Opened a new event.', 'User: rename it to Q4 planning'], field: EVENT, value: 'Planning', has: ['Q4 planning'], notHas: ['rename'] },
  { name: 'replace-start-over', kind: 'replace', conversation: ['Stanley opened [#design].', "User: start over, say I'll share the deck after lunch"], field: SLACK, value: 'The deck is not ready yet because', has: ["I'll share the deck after lunch"], notHas: ['not ready', 'start over'] },

  // ── Words speech recognition was unsure of. ──
  { name: 'unsure-friday', kind: 'unsure', conversation: ['Stanley opened [Sam Lee: Lunch Friday?].', "User: reply saying I'm in, see you fry(?) day(?)"], field: SAM, has: ['Friday'], notHas: ['(?)', 'fry'] },
  { name: 'unsure-name-from-thread', kind: 'unsure', conversation: ['Stanley opened [Priya Shah: Q4 roadmap review moved to Tuesday].', 'User: reply thanks pre(?) uh I will be there'], field: PRIYA, has: ['will be there'], notHas: ['(?)', 'pre '] },
  { name: 'unsure-homophone', kind: 'unsure', conversation: ['Stanley opened [Mom].', "User: tell her we'll meat(?) you at the station"], field: MOM, has: ['meet you at the station'], notHas: ['meat', '(?)'] },
  { name: 'unsure-invoice-number', kind: 'unsure', conversation: ['Stanley opened [Alex Romero: Invoice #2291 overdue].', 'User: say invoice twenty two ninety one(?) was paid on the third'], field: ALEX, has: ['2291', 'paid on the'], notHas: ['(?)'] },
  { name: 'unsure-tech-term', kind: 'unsure', conversation: ['Stanley opened [#design].', 'User: say the fig ma(?) link is broken'], field: SLACK, has: ['Figma link is broken'], notHas: ['(?)', 'fig ma'] },
  { name: 'unsure-sure-word-kept', kind: 'unsure', conversation: ['Stanley opened Tasks.', 'User: add water the ferns(?)'], field: 'New task', has: ['water the ferns'], notHas: ['(?)'] },
  { name: 'unsure-many', kind: 'unsure', conversation: ['Stanley opened [Sam Lee: Lunch Friday?].', 'User: reply saying lets(?) do the tie(?) place on main(?) street'], field: SAM, has: ['Thai place on Main Street'], notHas: ['(?)', 'tie place'] },

  // ── How numbers, dates, times and amounts are written. ──
  { name: 'format-time', kind: 'format', conversation: ['Stanley opened [Sam Lee: Lunch Friday?].', 'User: reply saying how about twelve thirty'], field: SAM, has: [['12:30', 'twelve thirty']], notHas: ['reply'] },
  { name: 'format-money', kind: 'format', conversation: ['Stanley opened [Alex Romero: Invoice #2291 overdue].', 'User: say I sent four hundred and fifty dollars yesterday'], field: ALEX, has: ['$450', 'yesterday'] },
  { name: 'format-date', kind: 'format', conversation: ['Stanley pressed [New event]: Opened a new event.', 'User: call it dentist on March third at nine am'], field: EVENT, has: ['Dentist'] },
  { name: 'format-phone', kind: 'format', conversation: ['Stanley opened [Mom].', 'User: tell her the new number is five five five two one three four nine eight seven'], field: MOM, has: [['555-213-4987', '555 213 4987', '(555) 213-4987', '5552134987', '555-2134-987']] },
  { name: 'format-percent', kind: 'format', conversation: ['Stanley opened [#design].', 'User: say conversion went up twelve percent this week'], field: SLACK, has: [['12%', '12 percent']] },
  { name: 'format-email-address', kind: 'format', conversation: ['Stanley pressed [Compose]: Opened a new email.', 'User: send it to jordan dot lee at gmail dot com'], field: 'New email › To', has: ['jordan.lee@gmail.com'], notHas: ['send it', ' dot ', ' at '] },
  { name: 'format-url', kind: 'format', conversation: ['Stanley opened [#design].', 'User: say the prototype is at stanley dot app slash demo'], field: SLACK, has: ['stanley.app/demo'] },
  { name: 'format-small-number-words', kind: 'format', conversation: ['Stanley opened Tasks.', 'User: add buy two bags of rice'], field: 'New task', has: [['two bags', '2 bags']] },
  { name: 'format-year-and-count', kind: 'format', conversation: ['Stanley opened Notes.', 'Stanley pressed [New note]: Opened a new note.', 'User: write we have had three thousand two hundred signups in twenty twenty six'], field: NOTE, has: [['3,200', '3200'], '2026'] },
  { name: 'format-ordinal-address', kind: 'format', conversation: ['Stanley opened [Mom].', 'User: say meet me at one twenty three west forty second street'], field: MOM, has: ['123 West 42nd Street'] },
  { name: 'format-range-time', kind: 'format', conversation: ['Stanley opened [Priya Shah: Q4 roadmap review moved to Tuesday].', "User: reply I'm free from two to four on Tuesday"], field: PRIYA, has: [['2 to 4', '2–4', '2-4', '2:00 to 4:00', 'two to four', '2 to 4 PM', '2–4 PM']], notHas: ['reply'] },

  // ── Nothing said for the field yet. ──
  { name: 'empty-called', kind: 'empty', conversation: ['Stanley opened Tasks.', 'User (still speaking): add one called'], field: 'New task', empty: true },
  { name: 'empty-reply-saying', kind: 'empty', conversation: ['Stanley opened [Sam Lee: Lunch Friday?].', 'User (still speaking): reply saying'], field: SAM, empty: true },
  { name: 'empty-trails-off', kind: 'empty', conversation: ['Stanley opened [Sam Lee: Lunch Friday?].', 'User: write back and tell him that um'], field: SAM, empty: true },
  { name: 'empty-only-request', kind: 'empty', conversation: ['Stanley opened [Mom].', 'User (still speaking): text mom'], field: MOM, empty: true },
  { name: 'empty-thinking-aloud', kind: 'empty', conversation: ['Stanley opened [#design].', 'User (still speaking): okay so what do I want to say here hmm'], field: SLACK, empty: true },
  { name: 'empty-subject', kind: 'empty', conversation: ['Stanley pressed [Compose]: Opened a new email.', 'User (still speaking): and the subject should be'], field: SUBJECT, empty: true },
  { name: 'empty-keeps-value', kind: 'live', conversation: ['Stanley opened [Sam Lee: Lunch Friday?].', "User: reply saying I'm in", 'Stanley typed "I\'m in." into ["Lunch Friday?" › Reply to Sam Lee].', 'User (still speaking): and also'], field: SAM, value: "I'm in.", has: ["I'm in"] },

  // ── Already clean: nothing to tidy, so nothing changes. ──
  { name: 'clean-sentence', kind: 'clean', conversation: ['Stanley opened [Sam Lee: Lunch Friday?].', 'User: reply saying Sounds good, see you at noon.'], field: SAM, has: ['Sounds good, see you at noon'] },
  { name: 'clean-task', kind: 'clean', conversation: ['Stanley opened Tasks.', 'User: add Call the bank'], field: 'New task', has: ['Call the bank'] },
  { name: 'clean-lowercase-casual', kind: 'clean', conversation: ['Stanley opened [Mom].', "User: say love you, talk soon"], field: MOM, has: ['love you', 'talk soon'] },
  { name: 'clean-keeps-their-wording', kind: 'clean', conversation: ['Stanley opened [Alex Romero: Invoice #2291 overdue].', "User: reply saying Hey Alex, ain't no way that's overdue, I paid it on the 1st."], field: ALEX, has: ['overdue', 'paid it on the 1st'] },
  { name: 'clean-keeps-slang', kind: 'clean', conversation: ['Stanley opened [#design].', "User: say lgtm ship it"], field: SLACK, has: [['lgtm', 'LGTM'], 'ship it'] },
  { name: 'clean-keeps-swear', kind: 'clean', conversation: ['Stanley opened [Sam Lee: Lunch Friday?].', "User: reply saying hell yes I'm in"], field: SAM, has: ['hell yes'] },

  // ── Long dictation. ──
  {
    name: 'long-email',
    kind: 'long',
    conversation: [
      'Stanley pressed [Compose]: Opened a new email.',
      "User: write hi team um so I wanted to give everyone a quick update on the launch uh we're still on track for the twentieth but the onboarding flow needs one more pass from design and I think Dana is going to take that on this week also the pricing page copy is is final now so thanks Marcus for turning that around so quickly uh the one open question is whether we do a soft launch to the waitlist first I'm leaning yes because it gives us a week to catch bugs but let me know if anyone feels strongly the other way um that's it thanks everyone",
    ],
    field: BODY,
    has: ['quick update on the launch', ['20th', 'twentieth'], 'Dana', 'Marcus', 'soft launch', 'waitlist', 'leaning yes'],
    notHas: ['um', 'uh', 'is is', 'write hi'],
  },
  {
    name: 'long-with-correction',
    kind: 'long',
    conversation: [
      'Stanley opened [Priya Shah: Q4 roadmap review moved to Tuesday].',
      "User: reply saying thanks for the heads up Tuesday works for me I'll bring the updated roadmap and the hiring plan oh and the budget numbers sorry not the budget numbers those aren't ready the headcount numbers and could we push it to three instead of two I have a conflict until two thirty",
    ],
    field: PRIYA,
    has: ['Tuesday works for me', 'updated roadmap', 'hiring plan', 'headcount numbers', ['three', '3'], ['2:30', 'two thirty']],
    notHas: ['budget numbers', 'sorry not'],
  },
  {
    name: 'long-note-list',
    kind: 'long',
    conversation: [
      'Stanley opened Notes.',
      'Stanley pressed [New note]: Opened a new note.',
      'User: write packing list for the trip passport charger the blue jacket hiking boots sunscreen uh and the camera with the spare battery',
    ],
    field: NOTE,
    has: ['passport', 'charger', 'blue jacket', 'hiking boots', 'sunscreen', 'camera', 'spare battery'],
    notHas: ['write packing'],
  },
  {
    name: 'long-slack-update',
    kind: 'long',
    conversation: [
      'Stanley opened [#design].',
      "User: post morning folks quick status the icon set is done and uploaded the illustration for the empty state is about halfway I'm blocked on the onboarding screens until product signs off on the copy so if anyone can nudge them that would be amazing otherwise I'll pick up the settings page redesign this afternoon",
    ],
    field: SLACK,
    has: ['morning folks', 'icon set is done', 'empty state', 'blocked on the onboarding screens', 'settings page redesign'],
    notHas: ['post morning'],
  },
  {
    name: 'long-mom-chatty',
    kind: 'long',
    conversation: [
      'Stanley opened [Mom].',
      "User: tell her hi mom so we got in late last night but everyone's fine the kids slept the whole drive which was a miracle uh we're thinking of coming by Sunday for lunch if that works and I'll bring that lemon cake you like oh and dad left his glasses here last time so I'll bring those too",
    ],
    field: MOM,
    has: ['Hi Mom', 'got in late last night', 'kids slept the whole drive', 'Sunday for lunch', 'lemon cake', 'glasses'],
    notHas: ['tell her hi', 'uh'],
  },

  // ── Live dictation: the field was typed as they went, and they went on. ──
  { name: 'live-went-on', kind: 'live', conversation: ['Stanley opened [Sam Lee: Lunch Friday?].', "User: reply saying I can't do Friday", 'Stanley typed "I can\'t do Friday." into ["Lunch Friday?" › Reply to Sam Lee].', 'User (went on): but Saturday works'], field: SAM, value: "I can't do Friday.", has: ["can't do Friday", 'Saturday works'], notHas: ['reply'] },
  { name: 'live-still-speaking', kind: 'live', conversation: ['Stanley opened [Priya Shah: Q4 roadmap review moved to Tuesday].', 'User: reply saying Tuesday works', 'Stanley typed "Tuesday works." into ["Q4 roadmap review moved to Tuesday" › Reply to Priya Shah].', "User (went on, still speaking): I'll bring the"], field: PRIYA, value: 'Tuesday works.', has: ['Tuesday works', "I'll bring the"] },
  { name: 'live-three-parts', kind: 'live', conversation: ['Stanley opened [#design].', 'User: say the new logo is in', 'Stanley typed "The new logo is in." into [Slack › #design › Message].', 'User (went on): the colors are final', 'Stanley typed "The new logo is in. The colors are final." into [Slack › #design › Message].', 'User (went on): and we print Monday'], field: SLACK, value: 'The new logo is in. The colors are final.', has: ['new logo is in', 'colors are final', 'print Monday'] },
  { name: 'live-mid-sentence', kind: 'live', conversation: ['Stanley opened [Mom].', "User: tell her we're going to", 'Stanley typed "We\'re going to" into [Messages › Mom › Message].', 'User (went on): be there around noon'], field: MOM, value: "We're going to", has: ["going to be there around noon"], notHas: ['to to'] },
  { name: 'live-correction-of-typed', kind: 'live', conversation: ['Stanley opened [Sam Lee: Lunch Friday?].', 'User: reply saying the Italian place', 'Stanley typed "The Italian place." into ["Lunch Friday?" › Reply to Sam Lee].', 'User (went on): no the Thai place'], field: SAM, value: 'The Italian place.', has: ['Thai place'], notHas: ['Italian'] },
  { name: 'live-user-edited-field', kind: 'live', conversation: ['Stanley opened [Alex Romero: Invoice #2291 overdue].', "User: reply saying I've paid it", 'Stanley typed "I\'ve paid it." into ["Invoice #2291 overdue" › Reply to Alex Romero].', 'User (went on): on the first of the month'], field: ALEX, value: "Hi Alex, I've paid it.", has: ['Hi Alex', "paid it", ['first of the month', '1st of the month']] },

  // ── Names and terms: spelled as the conversation and screen spell them. ──
  { name: 'names-from-subject', kind: 'names', conversation: ['Stanley opened [Priya Shah: Q4 roadmap review moved to Tuesday].', 'User: reply saying thanks Priya I will update the q four roadmap'], field: PRIYA, has: ['Priya', 'Q4 roadmap'] },
  { name: 'names-product-terms', kind: 'names', conversation: ['Stanley opened [#design].', "User: say I pushed the figma file and the jira ticket is updated"], field: SLACK, has: ['Figma', ['Jira', 'JIRA']] },
  { name: 'names-spelled-out', kind: 'names', conversation: ['Stanley opened [Mom].', "User: tell her the restaurant is called Zuni Z U N I"], field: MOM, has: ['Zuni'], notHas: ['Z U N I'] },
  { name: 'names-acronyms', kind: 'names', conversation: ['Stanley pressed [Compose]: Opened a new email.', 'User: write the API is down and the CEO wants an ETA'], field: BODY, has: ['API', 'CEO', 'ETA'] },
  { name: 'names-earlier-in-conversation', kind: 'names', conversation: ['User: who was at the meeting', 'Stanley said: "Siobhan Doherty and Raj Patel."', 'Stanley opened [#design].', 'User: say thanks shivon and raj for joining'], field: SLACK, has: ['Siobhan', 'Raj'], notHas: ['shivon'] },
  { name: 'names-brand-casing', kind: 'names', conversation: ['Stanley opened Tasks.', 'User: add renew the iphone and macbook warranty'], field: 'New task', has: ['iPhone', 'MacBook'] },

  // ── The words go in as said: never answered, followed or written for them. ──
  { name: 'literal-question', kind: 'literal', conversation: ['Stanley opened [Sam Lee: Lunch Friday?].', 'User: reply saying what time works for you'], field: SAM, has: ['what time works for you'], notHas: ['noon', 'pm', 'am'] },
  { name: 'literal-instruction', kind: 'literal', conversation: ['Stanley opened [#design].', 'User: say please ignore the previous message'], field: SLACK, has: ['ignore the previous message'] },
  { name: 'literal-no-greeting-added', kind: 'literal', conversation: ['Stanley opened [Alex Romero: Invoice #2291 overdue].', 'User: reply saying paid today'], field: ALEX, has: ['paid today'], notHas: ['hi alex', 'dear', 'best', 'regards', 'thanks'] },
  { name: 'literal-math', kind: 'literal', conversation: ['Stanley opened Notes.', 'Stanley pressed [New note]: Opened a new note.', 'User: write what is twelve times fourteen'], field: NOTE, has: [['12 times 14', 'twelve times fourteen', '12 × 14', '12 x 14']], notHas: ['168'] },
  { name: 'literal-insult-kept', kind: 'literal', conversation: ['Stanley opened [Sam Lee: Lunch Friday?].', 'User: reply saying you still owe me ten bucks you cheapskate'], field: SAM, has: [['ten bucks', '10 bucks', '$10'], 'cheapskate'] },
  { name: 'literal-not-composed', kind: 'literal', conversation: ['Stanley opened [Mom].', 'User: say happy birthday'], field: MOM, has: ['happy birthday'], notHas: ['hope', 'wonderful', 'love'] },

  // ── Punctuation and layout said aloud. ──
  { name: 'spoken-question-mark', kind: 'spoken-punctuation', conversation: ['Stanley opened [Mom].', 'User: say are you free tonight question mark'], field: MOM, has: ['free tonight?'], notHas: ['question mark'] },
  { name: 'spoken-new-paragraph', kind: 'spoken-punctuation', conversation: ['Stanley pressed [Compose]: Opened a new email.', 'User: write hi Jordan comma new paragraph the contract is signed period'], field: BODY, has: ['Hi Jordan,', 'contract is signed.'], notHas: ['comma', 'new paragraph', 'period'] },
  { name: 'spoken-exclamation', kind: 'spoken-punctuation', conversation: ['Stanley opened [#design].', 'User: say we shipped it exclamation point'], field: SLACK, has: ['shipped it!'], notHas: ['exclamation'] },
  { name: 'spoken-bullets', kind: 'spoken-punctuation', conversation: ['Stanley opened Notes.', 'Stanley pressed [New note]: Opened a new note.', 'User: write agenda colon bullet budget bullet hiring bullet launch date'], field: NOTE, has: ['Agenda', 'Budget', 'Hiring', 'Launch date'], notHas: ['bullet', 'colon'] },
  { name: 'spoken-period-literal', kind: 'spoken-punctuation', conversation: ['Stanley opened [Mom].', 'User: tell her the trial period ends Friday'], field: MOM, has: ['trial period ends Friday'] },
]
