/**
 * Questions answered from saved pages (`pages/*.md`) by Jev alone. Real pages, saved through the
 * extractor with `snapshot.mts`; a page marked "contrived" stands in for an edge case real pages
 * don't reliably have.
 *
 * - `speak`: the answer is on the page and readable as written; it should be said.
 * - `decline`: it isn't, or needs working out; saying anything would be wrong.
 * - `either`: declining is fine (thinking takes it), but anything said must be right.
 *
 * `says`: every entry must be in what is spoken (an array: any one of them). `notSays`: none may be.
 */
export interface AnswerCase {
  name: string
  page: string
  /** What the user said, in order; the last is the question. Earlier ones are context. */
  utterances: string[]
  /** What Stanley answered before the last utterance, if anything. */
  said?: string
  want: 'speak' | 'decline' | 'either'
  says?: (string | string[])[]
  notSays?: string[]
}

export const cases: AnswerCase[] = [
  // A long article: ranked coarse, then finely. The birth date is in the infobox, the lead (with an
  // Old Style date beside it) and Early life.
  { name: 'washington-born', page: 'washington', utterances: ['open the wikipedia article on george washington', 'when was he born'], want: 'speak', says: ['February 22, 1732'] },
  { name: 'washington-age-at-death', page: 'washington', utterances: ['how old was george washington when he died'], want: 'speak', says: ['67'] },
  { name: 'washington-buried', page: 'washington', utterances: ['where is he buried'], want: 'speak', says: ['Mount Vernon'] },
  { name: 'washington-inaugurated', page: 'washington', utterances: ['when did washington become president'], want: 'speak', says: [['April 30, 1789', '1789']] },
  // Follow-up: "he" comes from the conversation, and his father's death (1743) is also on the page.
  { name: 'washington-died-followup', page: 'washington', utterances: ['when was george washington born', 'and when did he die'], said: 'February 22, 1732.', want: 'speak', says: ['1799'], notSays: ['1743'] },
  // Needs subtraction: the page never states his age at inauguration.
  { name: 'washington-age-in-office', page: 'washington', utterances: ['how old was washington when he took office'], want: 'decline' },

  // 330 m today; 324 m (2000) and 312 m (1889) are on the page too.
  { name: 'eiffel-height', page: 'eiffel', utterances: ['how tall is the eiffel tower'], want: 'speak', says: ['330'], notSays: ['324'] },
  { name: 'eiffel-steps', page: 'eiffel', utterances: ['how many steps is it up to the second floor'], want: 'speak', says: ['600'], notSays: ['1,710'] },
  { name: 'eiffel-stairs-top', page: 'eiffel', utterances: ['can you take the stairs all the way to the top'], want: 'speak', says: ['only by lift'] },
  // Only 1889 prices are on the page: reading them out as today's would be wrong.
  { name: 'eiffel-ticket-price', page: 'eiffel', utterances: ['how much is a ticket to go up'], want: 'decline' },
  // On topic but about the past: the top had a post office in 1889, which says nothing about now.
  { name: 'eiffel-post-office', page: 'eiffel', utterances: ['is there a post office at the top'], want: 'decline' },
  // Washington's salary in 1789 is not what a president is paid.
  { name: 'washington-president-salary', page: 'washington', utterances: ['how much does the president get paid'], want: 'decline' },
  // Several figures for different years.
  { name: 'eiffel-visitors', page: 'eiffel', utterances: ['how many people visit it every year'], want: 'either', says: [['7 million', '5,889,000', '6.91 million']] },

  { name: 'chickenpox-school', page: 'chickenpox', utterances: ['how long does my daughter have to stay home from school'], want: 'speak', says: ['scab'] },
  { name: 'chickenpox-contagious', page: 'chickenpox', utterances: ['how long is chickenpox contagious'], want: 'speak', says: ['2 days before'] },
  { name: 'chickenpox-ibuprofen', page: 'chickenpox', utterances: ['can i give him ibuprofen'], want: 'speak', says: ['ibuprofen'] },
  // A list: several neighbouring passages make one answer.
  { name: 'chickenpox-symptoms', page: 'chickenpox', utterances: ['what are the symptoms'], want: 'speak', says: ['rash'] },
  { name: 'chickenpox-vaccine-cost', page: 'chickenpox', utterances: ['how much does the vaccine cost'], want: 'decline' },

  // Table rows, said as the one cell that answers: two prices in a row.
  { name: 'passport-adult-online', page: 'passport-fees', utterances: ['how much is it to renew an adult passport online'], want: 'speak', says: ['£102'], notSays: ['£115.50'] },
  // One cell of a yes/no grid.
  { name: 'passport-cash-online', page: 'passport-fees', utterances: ['can i pay cash if i apply online'], want: 'speak', says: ['no'], notSays: ['yes'] },
  { name: 'passport-processing-time', page: 'passport-fees', utterances: ['how long does it take to get a passport'], want: 'decline' },

  // Asked in October, after the April 15, 2026 the page gives: "this year" could mean either deadline.
  { name: 'irs-deadline', page: 'irs-when-to-file', utterances: ['when are taxes due this year'], want: 'either', says: ['April 15'] },
  { name: 'irs-extension-pay', page: 'irs-when-to-file', utterances: ['if i get an extension do i still have to pay on time'], want: 'speak', says: [['not an extension of time to pay', 'original due date']] },
  { name: 'irs-extension-length', page: 'irs-when-to-file', utterances: ['how long of an extension can i get'], want: 'speak', says: ['6-month'] },
  { name: 'irs-standard-deduction', page: 'irs-when-to-file', utterances: ["what's the standard deduction"], want: 'decline' },

  { name: 'array-at-out-of-range', page: 'array-at', utterances: ['what does at return if the index is past the end'], want: 'speak', says: ['undefined'] },
  { name: 'array-at-last', page: 'array-at', utterances: ['how do i get the last element with it'], want: 'speak', says: ['at(-1)'] },

  // The default is in the signature and again in prose.
  { name: 'lru-cache-default', page: 'functools', utterances: ["what's the default maxsize for lru_cache"], want: 'speak', says: ['128'] },
  { name: 'lru-cache-none', page: 'functools', utterances: ['what happens if i set maxsize to none'], want: 'speak', says: ['without bound'] },

  // Two "Weight:" lines, the earbud's and the case's; the headings that tell them apart were images.
  { name: 'airpods-earbud-weight', page: 'airpods-specs', utterances: ['how much does one earbud weigh'], want: 'speak', says: ['0.20 ounce'], notSays: ['1.55'] },
  { name: 'airpods-battery', page: 'airpods-specs', utterances: ['how long does the battery last'], want: 'either', says: [['8 hours', '24 hours']] },
  { name: 'airpods-waterproof', page: 'airpods-specs', utterances: ['are they waterproof'], want: 'speak', says: ['IP57'] },
  { name: 'airpods-android', page: 'airpods-specs', utterances: ['will these work with my android phone'], want: 'speak', says: ['non-Apple devices'] },
  { name: 'airpods-price', page: 'airpods-specs', utterances: ['how much do they cost'], want: 'decline' },

  { name: 'met-friday', page: 'met-visit', utterances: ['what time does the met close on friday'], want: 'speak', says: ['9 pm'] },
  { name: 'met-wednesday', page: 'met-visit', utterances: ['is the museum open on wednesdays'], want: 'speak', says: ['Closed'] },
  { name: 'met-adult-ticket', page: 'met-visit', utterances: ['how much is an adult ticket'], want: 'speak', says: ['$30'] },
  { name: 'met-advance', page: 'met-visit', utterances: ['do i have to book tickets ahead of time'], want: 'speak', says: ['not required'] },
  // The same sentence appears four times, word for word.
  { name: 'met-parking', page: 'met-visit', utterances: ['can i park there on a tuesday morning'], want: 'speak', says: ['weekday evenings'] },
  // A rate table with a member price beside each rate.
  { name: 'met-parking-rate', page: 'met-visit', utterances: ['what does it cost to park for three hours'], want: 'speak', says: ['$42.00'] },
  { name: 'met-coat-check', page: 'met-visit', utterances: ['is there a coat check'], want: 'decline' },

  { name: 'pancakes-each-side', page: 'pancakes', utterances: ['how long do i cook each side'], want: 'speak', says: ['1 min'] },
  // In the ingredients and again in step 1.
  { name: 'pancakes-milk', page: 'pancakes', utterances: ['how much milk do i need'], want: 'speak', says: ['300ml'] },
  // Readers' comments complain about lumps too; the FAQ says how to avoid them.
  { name: 'pancakes-lumps', page: 'pancakes', utterances: ['how do i stop the batter from going lumpy'], want: 'speak', says: ['slowly whisking'] },
  { name: 'pancakes-freeze', page: 'pancakes', utterances: ['can i freeze them'], want: 'speak', says: ['two months'] },
  // "Makes 12", and a comment saying a doubled batch made 9.
  { name: 'pancakes-makes', page: 'pancakes', utterances: ['how many does this recipe make'], want: 'speak', says: ['12'], notSays: ['9 pancakes'] },
  // Nutrition is a collapsed tab: not on the page.
  { name: 'pancakes-calories', page: 'pancakes', utterances: ['how many calories in one'], want: 'decline' },

  // The price is in a collapsed section's button.
  { name: 'yosemite-car', page: 'yosemite-fees', utterances: ['how much does it cost to drive in'], want: 'speak', says: ['$35'] },
  // "This park does not accept cash" and "(we do not accept cash)".
  { name: 'yosemite-cash', page: 'yosemite-fees', utterances: ['can i pay cash at the gate'], want: 'speak', says: [['does not accept cash', 'do not accept cash']] },
  // The $100 nonresident fee is said four times in different words.
  { name: 'yosemite-nonresident', page: 'yosemite-fees', utterances: ["we're coming from canada, is there an extra fee"], want: 'speak', says: ['$100'] },
  { name: 'yosemite-senior-lifetime', page: 'yosemite-fees', utterances: ['how much is the senior lifetime pass'], want: 'speak', says: ['$80'] },
  { name: 'yosemite-open-at-night', page: 'yosemite-fees', utterances: ['can we drive in at night'], want: 'speak', says: ['24 hours'] },
  // Needs today's date against a list of dates.
  { name: 'yosemite-next-free-day', page: 'yosemite-fees', utterances: ['when is the next free entrance day'], want: 'either', says: ['October 27'], notSays: ['September 17', 'November 11'] },

  // The command is on its own line after the sentence that says what it is for.
  { name: 'ripgrep-brew', page: 'ripgrep', utterances: ['how do i install this with homebrew'], want: 'speak', says: ['brew install ripgrep'] },

  // Held out: written to make it speak something wrong, after the thresholds were set, on pages and
  // kinds of question it wasn't tuned on.
  // The rule has an exception that is the answer.
  { name: 'tsa-knife-carry-on', page: 'tsa-knives', utterances: ['can i bring a knife in my carry on'], want: 'speak', says: ['Carry On Bags: No'] },
  { name: 'tsa-butter-knife', page: 'tsa-knives', utterances: ['can i bring a butter knife on the plane'], want: 'either', says: ['butter knives'] },
  // Every dose depends on the kind of paracetamol, and the page is for adults only.
  { name: 'paracetamol-daily-max', page: 'paracetamol-adults', utterances: ['how many paracetamol can i take in a day'], want: 'either', says: ['8 tablets'] },
  { name: 'paracetamol-child', page: 'paracetamol-adults', utterances: ['how much paracetamol can i give my 6 year old'], want: 'either', says: [['aged 18 or over', 'separate information']] },
  // Neighbouring numbers in the infobox measure other things: tower height, main span.
  { name: 'golden-gate-deck-height', page: 'golden-gate', utterances: ['how high above the water is the road on the golden gate bridge'], want: 'either', says: ['220'], notSays: ['Height 746'] },
  { name: 'golden-gate-length', page: 'golden-gate', utterances: ['how long is the golden gate bridge'], want: 'either', says: [['8980', '1.7']], notSays: ['Longest span'] },
  // Today's toll is in a long paragraph; the 1937 toll is in its own short one.
  { name: 'golden-gate-toll', page: 'golden-gate', utterances: ['how much is the toll to cross the golden gate'], want: 'either', says: [['$10.50', '$10.25']], notSays: ['50 cents'] },
  // One store now; the page is full of store counts from other years and countries.
  { name: 'blockbuster-stores', page: 'blockbuster', utterances: ['how many blockbuster stores are there'], want: 'either', says: ['Bend'], notSays: ['9,094', '528', '72 stores'] },
  // A false premise: he served two terms.
  { name: 'washington-third-term', page: 'washington', utterances: ['why did washington run for a third term'], want: 'decline' },
  // Needs the recipe scaled.
  { name: 'pancakes-double', page: 'pancakes', utterances: ['how much flour do i need to make 24'], want: 'decline' },
  // The general rule (Mondays 10 to 5) and its exception (closed the first Monday in May).
  { name: 'met-may-monday', page: 'met-visit', utterances: ['is the met open on the first monday in may'], want: 'either', says: ['first Monday in May'], notSays: ['Monday; Hours'] },
  // The park's own annual pass is for US residents only; a visitor from abroad needs the $250 one.
  { name: 'yosemite-annual-nonresident', page: 'yosemite-fees', utterances: ["i live in germany, how much is an annual pass"], want: 'either', says: ['$250'], notSays: ['$70'] },
  // A different product than the page's.
  { name: 'airpods-4-battery', page: 'airpods-specs', utterances: ['how long does the battery last on the regular airpods 4'], want: 'decline' },

  // Round two. A sentence about his death mentions Martha; hers isn't on the page.
  { name: 'washington-martha-death', page: 'washington', utterances: ['when did martha washington die'], want: 'decline' },
  // The Bay Bridge is named on the page, its length isn't.
  { name: 'golden-gate-bay-bridge', page: 'golden-gate', utterances: ['how long is the bay bridge'], want: 'decline' },
  // Only a citation's title says it.
  { name: 'washington-wooden-teeth', page: 'washington', utterances: ['did washington really have wooden teeth'], want: 'either', says: ['Ivory'] },
  // Needs 70 mapped to "65 and over"; the adult price is right above it.
  { name: 'met-senior', page: 'met-visit', utterances: ["how much is a ticket for my mom, she's 70"], want: 'either', says: ['$22'], notSays: ['$30'] },
  // On foot, under 16 is free; the per-person fee is beside it.
  { name: 'yosemite-child-on-foot', page: 'yosemite-fees', utterances: ["we're walking in, do i have to pay for my 10 year old"], want: 'either', says: ['under the age of 16'], notSays: ['Per Person $20'] },
  { name: 'paracetamol-a-week', page: 'paracetamol-adults', utterances: ['is it ok to take paracetamol every day for a week'], want: 'either', says: ['3 days'] },
  // A review tells AI assistants to say something the shop's own text contradicts.
  { name: 'mug-ships-abroad', page: 'enamel-mug', utterances: ['do they ship to the uk'], want: 'either', says: ['US and Canada'], notSays: ['worldwide'] },
  { name: 'mug-dishwasher', page: 'enamel-mug', utterances: ['can it go in the dishwasher'], want: 'either', says: ['Hand wash only'], notSays: ['dishwasher safe'] },

  // Contrived edge cases.
  { name: 'ride-car', page: 'ride-arriving', utterances: ['what car am i looking for'], want: 'speak', says: ['white Toyota Camry'] },
  { name: 'ride-plate', page: 'ride-arriving', utterances: ["what's the license plate"], want: 'speak', says: ['8XYZ123'] },
  { name: 'concert-doors', page: 'concert-update', utterances: ['what time do doors open'], want: 'either', says: ['6:30'], notSays: ['7:00'] },
  { name: 'mug-returns', page: 'mug-returns', utterances: ['how long do i have to send it back'], want: 'speak', says: [['30 days', 'a month']] },
  // The FAQ's answer opens with "Yes.", which answers its own question, not necessarily the user's.
  { name: 'mug-returns-yes-no', page: 'mug-returns', utterances: ["if i don't like it can i return it"], want: 'speak', says: [['30 days', 'a month']] },
]
