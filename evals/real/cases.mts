import type { Layout } from '../relevance/state.mts'

/**
 * Requests on the real pages (`sources.mts`): `target` matches the name of the element meant, as an
 * option without its app's; a page often has several that do the same (a sidebar link and one in
 * the text), and any of them is right.
 */
export interface RealCase {
  name: string
  site: string
  request: string
  target: RegExp
  before?: string
}

/** Someone planning a trip: the travel guide in front, the forecast beside it, the rest open in the background. */
export const REAL_LAYOUT: Layout = { focused: 'wikivoyage', shown: ['weather'], background: ['wikipedia', 'mdn', 'pydocs', 'arxiv', 'gutenberg', 'govuk'] }

export const REAL_CASES: RealCase[] = [
  { name: 'guide-ferries', site: 'wikivoyage', request: 'open the Washington State Ferries link', target: /^Washington State Ferries$/ },
  { name: 'guide-museums', site: 'wikivoyage', request: 'show me the museums in Seattle Center', target: /^Museums › Seattle Center$/ },
  { name: 'guide-other-words', site: 'wikivoyage', request: 'how do I take the train from the airport', target: /^Link light rail$/ },
  { name: 'weather-hourly', site: 'weather', request: 'open the hourly forecast', target: /^Hourly Weather Forecast( \(\d\))?$/ },
  { name: 'weather-other-words', site: 'weather', request: "is there a map of where it's raining", target: /Radar/ },
  { name: 'wiki-dunlop', site: 'wikipedia', request: 'open the article on John Boyd Dunlop', target: /John Boyd Dunlop/ },
  { name: 'wiki-history', site: 'wikipedia', request: 'go to the history section', target: /^History$/ },
  { name: 'wiki-other-words', site: 'wikipedia', request: 'who invented the running machine', target: /Drais/ },
  { name: 'mdn-findlast', site: 'mdn', request: 'open the docs for findLast', target: /findLast\(\)$/ },
  { name: 'mdn-other-words', site: 'mdn', request: 'how do I flatten nested arrays', target: /(^|› )(Array\.prototype\.)?flat\(\)$/ },
  { name: 'pydocs-json', site: 'pydocs', request: 'open the json module docs', target: /^json — / },
  { name: 'pydocs-other-words', site: 'pydocs', request: 'how do I read a spreadsheet file in python', target: /^csv — / },
  { name: 'arxiv-pdf', site: 'arxiv', request: 'download the PDF of the OmniVerifier paper', target: /^OmniVerifier.* › pdf$/ },
  { name: 'arxiv-other-words', site: 'arxiv', request: 'open the paper about evaluating agent memory', target: /^Beyond Downstream QA.* › (pdf|html)$/ },
  { name: 'books-coffee', site: 'gutenberg', request: 'open All about coffee', target: /^All about coffee/ },
  { name: 'books-other-words', site: 'gutenberg', request: 'the old Roman cookbook', target: /^Cookery and Dining in Imperial Rome/ },
  { name: 'gov-lost', site: 'govuk', request: 'how do I replace a lost passport', target: /^Replace a lost, stolen or damaged passport$/ },
  { name: 'gov-cookies', site: 'govuk', request: 'accept the cookies', target: /^Accept additional cookies$/ },
  { name: 'gov-other-words', site: 'govuk', request: 'my kid needs a passport', target: /^Get a passport for your child$/ },
]

/** Kept out of tuning: `--holdout`. */
export const REAL_HOLDOUT: RealCase[] = [
  { name: 'guide-airporter', site: 'wikivoyage', request: 'open the Bel Air Airporter link', target: /^Bel Air Airporter$/ },
  { name: 'guide-other-words', site: 'wikivoyage', request: 'how do I get up to Vancouver by train', target: /Amtrak Cascades › Vancouver/ },
  { name: 'weather-discussion', site: 'weather', request: 'open the forecast discussion', target: /^Forecast Discussion( \(\d\))?$/ },
  { name: 'weather-other-words', site: 'weather', request: 'is the air ok to breathe today', target: /^Air Quality Forecasts$/ },
  { name: 'wiki-derailleur', site: 'wikipedia', request: 'open the derailleur gears article', target: /[Dd]erailleur/ },
  { name: 'wiki-other-words', site: 'wikipedia', request: 'the old bike with the giant front wheel', target: /[Pp]enny-farthing/ },
  { name: 'mdn-tosorted', site: 'mdn', request: 'open toSorted', target: /toSorted\(\)$/ },
  { name: 'mdn-other-words', site: 'mdn', request: 'how do I check if an array contains a value', target: /includes\(\)$/ },
  { name: 'pydocs-sqlite', site: 'pydocs', request: 'open the sqlite3 docs', target: /^sqlite3 — / },
  { name: 'pydocs-other-words', site: 'pydocs', request: 'how do I parse command line flags', target: /^argparse — / },
  { name: 'arxiv-pdf', site: 'arxiv', request: 'download the Grid-Bench paper', target: /^Grid-Bench.* › pdf$/ },
  { name: 'arxiv-other-words', site: 'arxiv', request: 'the paper about mixture of experts', target: /^Explaining the Roles of Experts.* › (pdf|html)$/ },
  { name: 'books-kitchen', site: 'gutenberg', request: 'open Science in the Kitchen', target: /^Science in the Kitchen/ },
  { name: 'books-other-words', site: 'gutenberg', request: "something about cooking when you're out camping", target: /^Camp Cookery/ },
  { name: 'gov-track', site: 'govuk', request: 'track my passport application', target: /^Track your passport application$/ },
  { name: 'gov-reject', site: 'govuk', request: 'reject cookies', target: /^Reject additional cookies$/ },
  { name: 'gov-other-words', site: 'govuk', request: 'I need a passport fast', target: /^Get a passport urgently$/ },
]
