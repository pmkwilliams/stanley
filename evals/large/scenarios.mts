import type { Layout, Pages } from '../relevance/state.mts'

/**
 * What the run must leave: `act` done to item `id` on `site` (for `open`, Stanley ends on that item's
 * page), `act` done to nothing on `site`, or Stanley working on `site`.
 */
export type Expect = { site: string; act: string; id: string } | { site: string; act: string; none: true } | { focus: string }

export interface LargeScenario {
  name: string
  utterances: string[]
  checks: Expect[]
  /** The state it starts in, when not `LAYOUT`. */
  layout?: Layout
  /** Run with thinking itself when `--thinking` is given (a paid model): what Jev hands it is part of the outcome. */
  thinking?: boolean
}

/** Quickmail, Metro News and Threadhub not open yet: opening one and asking for something on it in one breath acts on a page that has just loaded. */
const CLOSED: Layout = { focused: 'megamart', shown: ['wikifacts'], background: ['devdocs'], closed: ['quickmail', 'metronews', 'threadhub'] }

export const did = (site: string, act: string, id: string): Expect => ({ site, act, id })
export const nothing = (site: string, act: string): Expect => ({ site, act, none: true })
export const on = (site: string): Expect => ({ focus: site })

/** Acts that can't be taken back in the world (a share has gone out): one done wrong is wrong even if undone after. */
const IRREVERSIBLE = new Set(['share'])

/**
 * What went wrong, judged from the end state of every site: each expectation met, and nothing else
 * left done anywhere. A wrong step undone on the way (saved, then unsaved) is corrected, not wrong,
 * unless it can't be taken back. Opening things on the way is going somewhere, and doesn't count.
 */
export async function judge(pages: Pages, sites: string[], expects: Expect[]): Promise<string[]> {
  const failures: string[] = []
  const allowed = new Set(expects.flatMap((e) => ('id' in e ? [`${e.site}:${e.act}:${e.id}`] : [])))
  for (const site of sites) {
    const { acts, on } = await pages.state(site)
    const done = Object.keys(on).filter((k) => on[k])
    for (const e of expects) {
      if (!('site' in e) || e.site !== site) continue
      if ('id' in e && e.act === 'open') {
        const at = await pages.route(site)
        if (at !== `/open/${e.id}`) failures.push(`expected ${site} to end on "${e.id}", it is on ${at}`)
      } else if ('id' in e) {
        if (!done.includes(`${e.act}:${e.id}`)) failures.push(`expected ${e.act} on ${site} "${e.id}", got ${done.filter((k) => k.startsWith(`${e.act}:`)).join(', ') || 'none'}${acts.some((a) => a.act === e.act && a.id === e.id) ? ' (done, then undone)' : ''}`)
      } else if (done.some((k) => k.startsWith(`${e.act}:`))) failures.push(`expected no ${e.act} left on ${site}, got ${done.filter((k) => k.startsWith(`${e.act}:`)).join(', ')}`)
    }
    const extra = done.filter((k) => !allowed.has(`${site}:${k}`))
    if (extra.length) failures.push(`also left on ${site}: ${extra.join(', ')}`)
    const gone = [...new Set(acts.filter((a) => IRREVERSIBLE.has(a.act) && !allowed.has(`${site}:${a.act}:${a.id}`)).map((a) => `${a.act}:${a.id}`))]
    if (gone.length) failures.push(`did on ${site}, which can't be taken back: ${gone.join(', ')}`)
  }
  for (const e of expects) if ('focus' in e && pages.focus !== e.focus) failures.push(`expected Stanley on ${e.focus}, it is on ${pages.focus}`)
  return failures
}

/** Every scenario starts in `LAYOUT`: the shop Stanley works on, the article beside it, four sites in the background. */
export const SCENARIOS: LargeScenario[] = [
  { name: 'shop-add-to-cart', utterances: ['add the cast iron dutch oven to my cart'], checks: [did('megamart', 'cart', 'dutch-oven')] },
  { name: 'shop-save', utterances: ['save the copper kettle for later'], checks: [did('megamart', 'save', 'kettle')] },
  { name: 'shop-filter', utterances: ['only show me Lodge'], checks: [did('megamart', 'filter', 'Lodge')] },
  { name: 'shop-other-words', utterances: ['get me that heavy pot for braising'], checks: [did('megamart', 'cart', 'dutch-oven')], thinking: true },
  { name: 'article-link', utterances: ['open the draisine article'], checks: [did('wikifacts', 'open', 'draisine'), on('wikifacts')] },
  { name: 'mail-archive', utterances: ['archive the plumber quote from Dana'], checks: [did('quickmail', 'archive', 'okafor')] },
  { name: 'mail-star', utterances: ["star Priya's email about the venue deposit"], checks: [did('quickmail', 'star', 'priya')] },
  { name: 'mail-open-other-words', utterances: ['open the message about fixing the pipes'], checks: [did('quickmail', 'open', 'okafor'), on('quickmail')], thinking: true },
  { name: 'news-share', utterances: ['share the article on the library levy'], checks: [did('metronews', 'share', 'levy')] },
  { name: 'news-open', utterances: ['open the story about the Bainbridge ferry'], checks: [did('metronews', 'open', 'ferry'), on('metronews')] },
  { name: 'forum-like', utterances: ['like the comment about the Gaggia'], checks: [did('threadhub', 'like', 'gaggia')] },
  { name: 'docs-open', utterances: ['open the docs for findLast'], checks: [did('devdocs', 'open', 'Array.findLast'), on('devdocs')] },
  // A page opened and used in the same breath: Jev acts on it while it is still being embedded.
  { name: 'open-then-archive', utterances: ['open Quickmail and archive the plumber quote from Dana'], checks: [did('quickmail', 'archive', 'okafor'), on('quickmail')], layout: CLOSED },
  { name: 'open-then-other-words', utterances: ['go to Metro News and share the one about the boat to the island'], checks: [did('metronews', 'share', 'ferry')], layout: CLOSED },
  // The second request leans on the first.
  { name: 'context-archive', utterances: ['did Dana Okafor send me anything', 'archive it'], checks: [did('quickmail', 'archive', 'okafor')] },
  { name: 'context-cart', utterances: ['do they have a cast iron dutch oven', 'add it to my cart'], checks: [did('megamart', 'cart', 'dutch-oven')] },
  // The user changes their mind: a step taken on the first words is undone, the right one taken.
  { name: 'correct-target', utterances: ['archive the email from Priya | sorry, the one from Dana Okafor'], checks: [did('quickmail', 'archive', 'okafor')], thinking: true },
  { name: 'correct-act', utterances: ['add the copper kettle to my cart | no, save it for later instead'], checks: [did('megamart', 'save', 'kettle'), nothing('megamart', 'cart')], thinking: true },
]

/** Kept out of tuning, on items no other case asks for: `--holdout`. */
export const HOLDOUT: LargeScenario[] = [
  { name: 'shop-pizza-stone', utterances: ['add the pizza stone to my cart'], checks: [did('megamart', 'cart', 'pizza-stone')] },
  { name: 'shop-knives-other-words', utterances: ['save that wooden thing that holds knives with magnets'], checks: [did('megamart', 'save', 'knife-block')], thinking: true },
  { name: 'article-bersaglieri', utterances: ['open the Bersaglieri link'], checks: [did('wikifacts', 'open', 'bersaglieri'), on('wikifacts')] },
  { name: 'mail-concert-archive', utterances: ['archive the concert tickets email'], checks: [did('quickmail', 'archive', 'concert')] },
  { name: 'mail-dentist-star', utterances: ['star the one from Lakeside Dental'], checks: [did('quickmail', 'star', 'dentist')] },
  { name: 'mail-show-other-words', utterances: ['archive the one about the gig on Thursday'], checks: [did('quickmail', 'archive', 'concert')] },
  { name: 'news-robots-save', utterances: ['save the article about warehouse robots'], checks: [did('metronews', 'save', 'robots')] },
  { name: 'news-hot-other-words', utterances: ['read the one about places to stay cool when it gets really hot'], checks: [did('metronews', 'open', 'heat'), on('metronews')], thinking: true },
  { name: 'forum-scale-like', utterances: ['like the comment about the coffee scale'], checks: [did('threadhub', 'like', 'scale')] },
  { name: 'docs-union', utterances: ['look up the set union method'], checks: [did('devdocs', 'open', 'Set.union'), on('devdocs')] },
  { name: 'open-then-star', utterances: ['open Quickmail and star the email from Lakeside Dental'], checks: [did('quickmail', 'star', 'dentist'), on('quickmail')], layout: CLOSED },
  { name: 'open-then-like-other-words', utterances: ['go to Threadhub and like the post saying to weigh your shots'], checks: [did('threadhub', 'like', 'scale')], layout: CLOSED },
  { name: 'context-star', utterances: ['which email is from Lakeside Dental', 'star it'], checks: [did('quickmail', 'star', 'dentist')] },
  { name: 'context-save', utterances: ['how much is the pizza stone', 'save it for later'], checks: [did('megamart', 'save', 'pizza-stone')] },
  { name: 'correct-target', utterances: ['star the concert tickets email | no wait, the one from Lakeside Dental'], checks: [did('quickmail', 'star', 'dentist')], thinking: true },
  { name: 'correct-act', utterances: ['share the warehouse robots article | actually just save it'], checks: [did('metronews', 'save', 'robots'), nothing('metronews', 'share')], thinking: true },
]
