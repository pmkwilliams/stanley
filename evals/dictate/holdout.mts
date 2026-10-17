import type { DictateCase } from './cases.mts'

/**
 * Cases kept out of tuning prompts and settings: run with `--holdout` to check that a change that
 * helped on `cases.mts` holds up on words it wasn't tuned on. Same kinds, other apps and phrasings.
 */

const DANA = '"Offsite agenda" › Reply to Dana Kim'
const LEO = '"Rent split for October" › Reply to Leo Park'
const DAD = 'Messages › Dad › Message'
const WHATSAPP = 'WhatsApp › Book club › Message'
const MAPS = 'Maps › Search'
const SHOP = 'Shopping › Search'
const TASK = 'New task'
const REMINDER = 'Reminders › New reminder › Title'
const DOC = 'Docs › Untitled document'
const TWEET = 'Social › New post'

export const holdout: DictateCase[] = [
  // ── Plain ──
  { name: 'ho-task-plain', kind: 'plain', conversation: ['User: put call the insurance company on my to do list', 'You opened Tasks.'], field: TASK, has: ['call the insurance company'], notHas: ['to do list', 'put'] },
  { name: 'ho-dad-plain', kind: 'plain', conversation: ['You opened [Dad].', 'User: tell dad the game starts at eight'], field: DAD, has: ['game starts at', ['eight', '8']], notHas: ['tell dad'] },
  { name: 'ho-reminder-plain', kind: 'plain', conversation: ['You opened Reminders.', 'You pressed [New reminder]: Opened a new reminder.', 'User: remind me to water the tomatoes'], field: REMINDER, has: ['water the tomatoes'], notHas: ['remind me'] },
  { name: 'ho-whatsapp-plain', kind: 'plain', conversation: ['You opened [Book club] in WhatsApp.', "User: send to the book club I haven't finished chapter nine yet"], field: WHATSAPP, has: ['finished chapter', ['nine', '9']], notHas: ['send to', 'book club'] },

  // ── Filler and false starts ──
  { name: 'ho-filler-dana', kind: 'filler', conversation: ['You opened [Dana Kim: Offsite agenda].', "User: reply um so I think the uh the agenda looks good but like can we add a break after lunch"], field: DANA, has: ['agenda looks good', 'break after lunch'], notHas: ['um', 'uh', 'the the', 'like can'] },
  { name: 'ho-filler-false-start', kind: 'filler', conversation: ['You opened [Dad].', "User: say I'll pick you up at the air- at the train station"], field: DAD, has: ['pick you up at the train station'], notHas: ['air-', 'airport'] },
  { name: 'ho-filler-task', kind: 'filler', conversation: ['You opened Tasks.', 'User: add uh you know book the uh car service'], field: TASK, has: ['book the car service'], notHas: ['uh', 'you know'] },

  // ── Corrections ──
  { name: 'ho-correct-day', kind: 'correction', conversation: ['You opened [Leo Park: Rent split for October].', "User: reply I'll send my half on Monday wait no Tuesday"], field: LEO, has: ['send my half', 'Tuesday'], notHas: ['Monday', 'wait'] },
  { name: 'ho-correct-amount', kind: 'correction', conversation: ['You opened [Leo Park: Rent split for October].', 'User: say my share is eight fifty actually make that nine hundred'], field: LEO, has: [['900', 'nine hundred']], notHas: ['850', 'eight fifty', 'actually'] },
  { name: 'ho-correct-name', kind: 'correction', conversation: ['You opened [Book club] in WhatsApp.', "User: say Maria's hosting sorry Marta's hosting this month"], field: WHATSAPP, has: ['Marta'], notHas: ['Maria', 'sorry'] },
  { name: 'ho-correct-later-turn', kind: 'correction', conversation: ['You opened [Dad].', 'User: say dinner is at Luigi’s', 'You typed "Dinner is at Luigi\'s." into [Messages › Dad › Message].', 'User: no it’s at Rosa’s'], field: DAD, value: "Dinner is at Luigi's.", has: ["Rosa's"], notHas: ["Luigi's", 'no it'] },
  { name: 'ho-not-correction', kind: 'correction', conversation: ['You opened [Dana Kim: Offsite agenda].', "User: reply no worries I can do either day"], field: DANA, has: ['no worries', 'either day'] },

  // ── The request around the words ──
  { name: 'ho-request-respond-with', kind: 'request', conversation: ['You opened [Dana Kim: Offsite agenda].', 'User: respond with count me in for the hike'], field: DANA, has: ['count me in for the hike'], notHas: ['respond with'] },
  { name: 'ho-request-let-him-know', kind: 'request', conversation: ['You opened [Dad].', "User: let him know I'm running late and to start without me"], field: DAD, has: ['running late', 'start without me'], notHas: ['let him know'] },
  { name: 'ho-request-trailing', kind: 'request', conversation: ['You opened [Leo Park: Rent split for October].', 'User: sounds fair to me send that'], field: LEO, has: ['sounds fair to me'], notHas: ['send that'] },
  { name: 'ho-request-maps-search', kind: 'request', conversation: ['You opened Maps.', 'User: find coffee shops near me that are open now'], field: MAPS, has: ['coffee'], notHas: ['find'] },
  { name: 'ho-request-shop-search', kind: 'request', conversation: ['You opened Shopping.', 'User: look up a usb c charger for my laptop'], field: SHOP, has: [['USB-C charger', 'USB C charger', 'USB-C laptop charger']], notHas: ['look up'] },
  { name: 'ho-request-doc', kind: 'request', conversation: ['You opened Docs.', 'You pressed [New document]: Opened a new document.', 'User: start the doc with meeting notes for the Q3 review'], field: DOC, has: ['meeting notes', 'Q3 review'], notHas: ['start the doc'] },

  // ── Adding to what the field holds ──
  { name: 'ho-append-also', kind: 'append', conversation: ['You opened [Book club] in WhatsApp.', 'User: also say bring snacks'], field: WHATSAPP, value: "I'll host next week.", has: ["I'll host next week", 'bring snacks'] },
  { name: 'ho-append-list', kind: 'append', conversation: ['You opened [Groceries] in Notes.', 'User: add lemons and parsley'], field: 'Notes › Groceries', value: 'Rice\nChicken', has: ['Rice', 'Chicken', 'lemons', 'parsley'], notHas: ['add'] },
  { name: 'ho-append-sentence', kind: 'append', conversation: ['You opened [Leo Park: Rent split for October].', 'User: and say thanks for covering September'], field: LEO, value: 'Sending my half today.', has: ['Sending my half today', 'thanks for covering September'], notHas: ['and say'] },

  // ── Replacing what the field holds ──
  { name: 'ho-replace-make-it', kind: 'replace', conversation: ['You opened [Dad].', 'User: make it see you Saturday instead'], field: DAD, value: 'See you Sunday.', has: ['Saturday'], notHas: ['Sunday', 'make it'] },
  { name: 'ho-replace-clear', kind: 'replace', conversation: ['You opened [Dana Kim: Offsite agenda].', 'User: scrap that and just say thanks'], field: DANA, value: 'I have a few concerns about the schedule', has: ['thanks'], notHas: ['concerns', 'scrap'] },

  // ── Words speech recognition was unsure of ──
  { name: 'ho-unsure-name', kind: 'unsure', conversation: ['You opened [Dana Kim: Offsite agenda].', 'User: reply thanks Dayna(?) looks great'], field: DANA, has: ['Dana', 'looks great'], notHas: ['Dayna', '(?)'] },
  { name: 'ho-unsure-homophone', kind: 'unsure', conversation: ['You opened [Dad].', "User: say I'll be there in an our(?)"], field: DAD, has: ['in an hour'], notHas: ['(?)', ' our'] },
  { name: 'ho-unsure-month', kind: 'unsure', conversation: ['You opened [Leo Park: Rent split for October].', 'User: say the October(?) rent is paid'], field: LEO, has: ['October rent is paid'], notHas: ['(?)'] },

  // ── Numbers, dates, times, amounts ──
  { name: 'ho-format-money', kind: 'format', conversation: ['You opened [Leo Park: Rent split for October].', 'User: say I owe you one thousand two hundred and fifty dollars'], field: LEO, has: ['$1,250'] },
  { name: 'ho-format-time', kind: 'format', conversation: ['You opened [Dad].', 'User: say pick me up at quarter past six'], field: DAD, has: [['6:15', 'quarter past six', 'quarter past 6']] },
  { name: 'ho-format-reminder-date', kind: 'format', conversation: ['You pressed [New reminder]: Opened a new reminder.', 'User: call it renew passport by June first'], field: REMINDER, has: ['Renew passport'] },
  { name: 'ho-format-address', kind: 'format', conversation: ['You opened Maps.', 'User: search for four fifty Market Street San Francisco'], field: MAPS, has: ['450 Market Street'], notHas: ['search for'] },

  // ── Nothing said for the field yet ──
  { name: 'ho-empty-respond-with', kind: 'empty', conversation: ['You opened [Dana Kim: Offsite agenda].', 'User (still speaking): respond with'], field: DANA, empty: true },
  { name: 'ho-empty-tell-dad', kind: 'empty', conversation: ['You opened [Dad].', 'User (still speaking): tell dad that'], field: DAD, empty: true },
  { name: 'ho-empty-search', kind: 'empty', conversation: ['You opened Maps.', 'User (still speaking): search for'], field: MAPS, empty: true },
  { name: 'ho-empty-hmm', kind: 'empty', conversation: ['You opened [Book club] in WhatsApp.', 'User (still speaking): uh what should I say'], field: WHATSAPP, empty: true },
  { name: 'ho-empty-reminder', kind: 'empty', conversation: ['You pressed [New reminder]: Opened a new reminder.', 'User (still speaking): remind me to'], field: REMINDER, empty: true },

  // ── Already clean, and their own voice ──
  { name: 'ho-clean-short', kind: 'clean', conversation: ['You opened [Dad].', 'User: say On my way.'], field: DAD, has: ['On my way'] },
  { name: 'ho-clean-slang', kind: 'clean', conversation: ['You opened [Book club] in WhatsApp.', 'User: say this book slaps ngl'], field: WHATSAPP, has: ['slaps'] },
  { name: 'ho-clean-emoji-word', kind: 'clean', conversation: ['You opened [Dad].', 'User: say love you heart emoji'], field: DAD, has: ['love you'], notHas: ['heart emoji'] },

  // ── Long ──
  {
    name: 'ho-long-update',
    kind: 'long',
    conversation: [
      'You opened [Dana Kim: Offsite agenda].',
      "User: reply hey Dana thanks for putting this together um a couple of thoughts the morning session feels a bit packed so maybe we move the roadmap talk to after lunch uh also I can lead the retro if nobody else has claimed it and for dinner I'd vote for the Thai place over the steakhouse since a few people are vegetarian let me know what you think",
    ],
    field: DANA,
    has: ['Hey Dana', 'morning session', 'roadmap talk to after lunch', 'lead the retro', 'Thai place', 'vegetarian'],
    notHas: ['um', 'uh', 'reply hey'],
  },
  {
    name: 'ho-long-correction',
    kind: 'long',
    conversation: [
      'You opened [Leo Park: Rent split for October].',
      "User: say hey so for October I'll cover the internet and you take electric oh wait no we switched last month so you take internet and I'll do electric and rent is the usual split",
    ],
    field: LEO,
    has: ['you take internet', 'electric', 'usual split'],
    notHas: ["I'll cover the internet", 'oh wait'],
  },
  {
    name: 'ho-long-post',
    kind: 'long',
    conversation: [
      'You opened Social.',
      'You pressed [New post]: Opened a new post.',
      'User: post just finished my first half marathon two hours and four minutes legs are destroyed but so worth it huge thanks to everyone who cheered',
    ],
    field: TWEET,
    has: ['half marathon', ['2:04', 'two hours and four minutes', '2 hours and 4 minutes'], 'so worth it', 'cheered'],
    notHas: ['post just'],
  },

  // ── Live dictation ──
  { name: 'ho-live-went-on', kind: 'live', conversation: ['You opened [Dad].', "User: say I'll be home", 'You typed "I\'ll be home." into [Messages › Dad › Message].', 'User (went on): around nine tonight'], field: DAD, value: "I'll be home.", has: ['home around', ['nine', '9']] },
  { name: 'ho-live-still-speaking', kind: 'live', conversation: ['You opened [Dana Kim: Offsite agenda].', 'User: reply the agenda looks good', 'You typed "The agenda looks good." into ["Offsite agenda" › Reply to Dana Kim].', 'User (went on, still speaking): one thing though'], field: DANA, value: 'The agenda looks good.', has: ['agenda looks good'] },
  { name: 'ho-live-takes-back', kind: 'live', conversation: ['You opened [Book club] in WhatsApp.', 'User: say I can host', 'You typed "I can host." into [WhatsApp › Book club › Message].', "User (went on): actually no I can't host this time"], field: WHATSAPP, value: 'I can host.', has: ["can't host"], notHas: ['actually no'] },

  // ── Names and terms ──
  { name: 'ho-names-thread', kind: 'names', conversation: ['You opened [Leo Park: Rent split for October].', 'User: reply thanks leo'], field: LEO, has: ['Leo'] },
  { name: 'ho-names-brands', kind: 'names', conversation: ['You opened Tasks.', 'User: add cancel the netflix and spotify subscriptions'], field: TASK, has: ['Netflix', 'Spotify'] },
  { name: 'ho-names-spelled', kind: 'names', conversation: ['You opened [Dad].', "User: say the vet's name is Dr Okafor O K A F O R"], field: DAD, has: ['Okafor'], notHas: ['O K A F O R'] },

  // ── Written as said, never answered ──
  { name: 'ho-literal-question', kind: 'literal', conversation: ['You opened [Book club] in WhatsApp.', 'User: ask the group what book we should read next'], field: WHATSAPP, has: ['book', 'next'], notHas: ['I recommend', 'how about'] },
  { name: 'ho-literal-command', kind: 'literal', conversation: ['You opened Notes.', 'You pressed [New note]: Opened a new note.', 'User: write delete all the old photos from the shared drive'], field: 'Notes › New note', has: ['delete all the old photos'] },
  { name: 'ho-literal-fact', kind: 'literal', conversation: ['You opened [Dad].', 'User: say how far is the drive to Portland'], field: DAD, has: ['drive to Portland'], notHas: ['miles', 'hours'] },

  // ── Punctuation said aloud ──
  { name: 'ho-spoken-comma-question', kind: 'spoken-punctuation', conversation: ['You opened [Dad].', 'User: say hey dad comma are you coming question mark'], field: DAD, has: ['Hey Dad,', 'coming?'], notHas: ['comma', 'question mark'] },
  { name: 'ho-spoken-new-line', kind: 'spoken-punctuation', conversation: ['You opened [Groceries] in Notes.', 'User: write eggs new line milk new line bread'], field: 'Notes › Groceries', has: ['eggs', 'milk', 'bread'], notHas: ['new line'] },
]
