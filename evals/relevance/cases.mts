/**
 * Requests for one element deep in a large page, in the app Stanley works on, in another app in
 * front of the user, or in one in the background (see `LAYOUT`). `target` is the element's name
 * as an option, without its app's.
 */
export interface RelevanceCase {
  name: string
  site: string
  request: string
  target: string
  /** What the user asked just before, when the request leans on it ("archive it"). */
  before?: string
}

/** Kept out of tuning: run with `--holdout`, and judge a change by these too. */
export const HOLDOUT: RelevanceCase[] = [
  { name: 'shop-pizza-stone', site: 'megamart', request: 'add the pizza stone to my cart', target: 'Cordierite pizza stone with peel › Add to cart' },
  { name: 'shop-knife-block', site: 'megamart', request: 'save the knife block for later', target: 'Magnetic acacia knife block › Save for later' },
  { name: 'shop-price-filter', site: 'megamart', request: 'show things under 25 dollars', target: 'Under $25' },
  { name: 'shop-pizza-other-words', site: 'megamart', request: 'add the thing for baking pizza at home', target: 'Cordierite pizza stone with peel › Add to cart' },
  { name: 'shop-knives-other-words', site: 'megamart', request: 'save that wooden thing that holds knives with magnets', target: 'Magnetic acacia knife block › Save for later' },
  { name: 'article-bersaglieri', site: 'wikifacts', request: 'open the Bersaglieri link', target: 'Bersaglieri' },
  { name: 'article-hadland', site: 'wikifacts', request: 'open the Hadland book on bicycle design', target: 'Hadland, Tony (2014). Bicycle Design: An Illustrated History. MIT Press.' },
  { name: 'article-tyres-section', site: 'wikifacts', request: 'go to the section on pneumatic tyres', target: '9 Pneumatic tyres' },
  { name: 'article-soldiers-other-words', site: 'wikifacts', request: 'open the Italian soldiers who rode folding bikes', target: 'Bersaglieri' },
  { name: 'mail-concert-archive', site: 'quickmail', request: 'archive the concert tickets email', target: 'Marcus Bell: Tickets for the Thursday concert › Archive' },
  { name: 'mail-dentist-star', site: 'quickmail', request: 'star the one from Lakeside Dental', target: 'Lakeside Dental: Your cleaning is booked for March 3 › Star' },
  { name: 'mail-teeth-other-words', site: 'quickmail', request: 'open the message about getting my teeth cleaned', target: 'Lakeside Dental: Your cleaning is booked for March 3' },
  { name: 'mail-show-other-words', site: 'quickmail', request: 'archive the one about the gig on Thursday', target: 'Marcus Bell: Tickets for the Thursday concert › Archive' },
  { name: 'news-heat', site: 'metronews', request: 'open the heat wave story', target: 'Heat wave prompts cooling centers to open early' },
  { name: 'news-robots-save', site: 'metronews', request: 'save the article about warehouse robots', target: 'Warehouse robots take over night shifts at the port › Save' },
  { name: 'news-hot-other-words', site: 'metronews', request: 'read the one about places to stay cool when it gets really hot', target: 'Heat wave prompts cooling centers to open early' },
  { name: 'forum-scale-like', site: 'threadhub', request: 'like the comment about the coffee scale', target: 'gram_counter: Buy a cheap coffee scale before anything else… › Like' },
  { name: 'forum-refurb-reply', site: 'threadhub', request: 'reply to thrifty_tom', target: 'thrifty_tom: Look for refurbished machines from the maker, … › Reply' },
  { name: 'forum-weigh-other-words', site: 'threadhub', request: 'like the post saying to weigh your shots', target: 'gram_counter: Buy a cheap coffee scale before anything else… › Like' },
  { name: 'docs-with-resolvers', site: 'devdocs', request: 'open Promise.withResolvers', target: 'Promise.withResolvers()' },
  { name: 'docs-union', site: 'devdocs', request: 'look up the set union method', target: 'Set.prototype.union()' },
  { name: 'docs-pad-other-words', site: 'devdocs', request: 'how do I add zeros to the front of a string', target: 'String.prototype.padStart()' },
  // Leaning on what was asked before.
  { name: 'context-mail-star', site: 'quickmail', before: 'which email is from Lakeside Dental', request: 'star it', target: 'Lakeside Dental: Your cleaning is booked for March 3 › Star' },
  { name: 'context-news-save', site: 'metronews', before: 'is there anything about warehouse robots', request: 'save that one', target: 'Warehouse robots take over night shifts at the port › Save' },
  { name: 'context-shop-save', site: 'megamart', before: 'how much is the pizza stone', request: 'save it for later', target: 'Cordierite pizza stone with peel › Save for later' },
  { name: 'context-forum-reply', site: 'threadhub', before: 'who wrote about the coffee scale', request: 'reply to them', target: 'gram_counter: Buy a cheap coffee scale before anything else… › Reply' },
]

export const CASES: RelevanceCase[] = [
  // The shop Stanley works on: nearly 900 elements, the product near the end.
  { name: 'shop-add-dutch-oven', site: 'megamart', request: 'add the cast iron dutch oven to my cart', target: 'Cast iron dutch oven, 6 qt › Add to cart' },
  { name: 'shop-save-kettle', site: 'megamart', request: 'save the copper kettle for later', target: 'Hammered copper kettle › Save for later' },
  { name: 'shop-steamer-in-cart', site: 'megamart', request: 'put the bamboo steamer in my cart', target: 'Bamboo dumpling steamer, 2 tier › Add to cart' },
  { name: 'shop-filter-brand', site: 'megamart', request: 'only show me Lodge', target: 'Lodge' },
  { name: 'shop-partial', site: 'megamart', request: 'add the dutch oven', target: 'Cast iron dutch oven, 6 qt › Add to cart' },
  // The article beside it: over 1,200 links.
  { name: 'article-draisine', site: 'wikifacts', request: 'open the draisine article', target: 'Draisine' },
  { name: 'article-reference', site: 'wikifacts', request: 'open the 2004 Herlihy book in the references', target: 'Herlihy, David V. (2004). Bicycle: The History. Yale University Press.' },
  { name: 'article-contents', site: 'wikifacts', request: 'jump to the penny-farthing section', target: '6 Penny-farthing era' },
  { name: 'article-edit-section', site: 'wikifacts', request: 'edit the safety bicycle section', target: 'Safety bicycle › edit' },
  // Apps in the background.
  { name: 'mail-archive', site: 'quickmail', request: 'archive the plumber quote from Dana', target: 'Dana Okafor: Plumber quote for the upstairs bathroom › Archive' },
  { name: 'mail-star', site: 'quickmail', request: "star Priya's email about the venue deposit", target: 'Priya Shah: Venue deposit is due Friday › Star' },
  { name: 'mail-open', site: 'quickmail', request: 'open the email from Dana Okafor', target: 'Dana Okafor: Plumber quote for the upstairs bathroom' },
  { name: 'mail-partial', site: 'quickmail', request: 'archive the plumber', target: 'Dana Okafor: Plumber quote for the upstairs bathroom › Archive' },
  { name: 'news-open', site: 'metronews', request: 'open the story about the Bainbridge ferry', target: 'Ferry service to Bainbridge Island resumes after repairs' },
  { name: 'news-share', site: 'metronews', request: 'share the article on the library levy', target: 'Voters weigh library levy that would add Sunday hours › Share' },
  { name: 'forum-reply', site: 'threadhub', request: 'reply to marisol about descaling', target: 'marisol_k: Descale with citric acid every couple of months … › Reply' },
  { name: 'forum-like', site: 'threadhub', request: 'like the comment about the Gaggia', target: 'oldschool_ed: The Gaggia Classic Pro is still the one to be… › Like' },
  { name: 'docs-findlast', site: 'devdocs', request: 'open the docs for findLast', target: 'Array.prototype.findLast()' },
  { name: 'docs-tosorted', site: 'devdocs', request: 'look up toSorted', target: 'Array.prototype.toSorted()' },
  // Said in other words: no word of the element's own, so only its meaning finds it.
  { name: 'shop-in-other-words', site: 'megamart', request: 'get me that heavy pot for braising', target: 'Cast iron dutch oven, 6 qt › Add to cart' },
  { name: 'article-in-other-words', site: 'wikifacts', request: 'open the bit about the early bike you pushed with your feet', target: 'Draisine' },
  { name: 'mail-in-other-words', site: 'quickmail', request: 'open the message about fixing the pipes', target: 'Dana Okafor: Plumber quote for the upstairs bathroom' },
  { name: 'news-in-other-words', site: 'metronews', request: 'read me the one about the boat to the island', target: 'Ferry service to Bainbridge Island resumes after repairs' },
  { name: 'forum-in-other-words', site: 'threadhub', request: 'answer whoever said to clean out the limescale', target: 'marisol_k: Descale with citric acid every couple of months … › Reply' },
  { name: 'docs-in-other-words', site: 'devdocs', request: 'how do I get an array back in order without changing the original', target: 'Array.prototype.toSorted()' },
  // Leaning on what was asked before.
  { name: 'context-mail-archive', site: 'quickmail', before: 'did Dana Okafor send me anything', request: 'archive it', target: 'Dana Okafor: Plumber quote for the upstairs bathroom › Archive' },
  { name: 'context-news-share', site: 'metronews', before: "what's the news on the Bainbridge ferry", request: 'share that', target: 'Ferry service to Bainbridge Island resumes after repairs › Share' },
  { name: 'context-shop-cart', site: 'megamart', before: 'do they have a cast iron dutch oven', request: 'add it to my cart', target: 'Cast iron dutch oven, 6 qt › Add to cart' },
  { name: 'context-forum-like', site: 'threadhub', before: 'what did people say about the Gaggia', request: 'like that comment', target: 'oldschool_ed: The Gaggia Classic Pro is still the one to be… › Like' },
]
