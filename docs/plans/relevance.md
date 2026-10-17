# Relevance on large states: the right step on offer

Status: built and measured overnight (2026-10-16 → 17), not committed. A summary, then the log of
what was measured and decided, in the order it happened.

## Summary

**What was wrong.** On any screen bringing more than ~110 new elements, the app never scored
meaning: each ranking tried to embed every new element within 300 ms, failed, kept nothing, and
left the embedding server working on the abandoned request. Large pages were ranked by words alone,
and the server could be busy for minutes.

**What changed** (first night, 1–10; second session, 11–15):
1. Elements are embedded in the background as they are seen, kept, the app being worked on first;
   a ranking embeds only the request, and what it names (relevance.ts).
2. **Items, not elements:** an element in a row or card is scored by the item it is in and, a
   quarter as much, its own label; an email is embedded once, not once per control (options.ts).
3. A link in running text is embedded with its sentence (browser extractor).
4. A score is how much closer an element is to the request than to a request for nothing, so short
   generic names ("3", "Scroll down") stop outranking what the user named.
5. **The request before:** a request leaning on the last one ("archive it") is also scored
   against it.
6. bge-base instead of bge-small; the server gets 16 slots; what isn't embedded yet ranks as
   neutral; failures back off.

Tried and not kept: weighting rare words (12), a cross-encoder reranker (13), embedding the role.

**What it does** (`eval:relevance`, mean reciprocal rank of the element among Jev's steps, dev /
held-out; before, every mode was in effect words alone):

| | before | first night | now |
|---|---|---|---|
| page opened 300 ms before the request | 0.735 / 0.728 | 0.721 / 0.677 | 0.755 / 0.778 |
| page opened 1 s before | 0.735 / 0.728 | 0.761 / 0.740 | 0.788 / 0.823 |
| every page embedded | 0.735 / 0.728 | 0.781 / 0.808 | 0.788 / 0.869 |
| in other words, every page embedded | 0.023 / 0.251 | 0.309 / 0.617 | 0.199 / 0.765 |
| leaning on the request before ("archive it") | — | — | 0.875 / 0.800 (from unlisted or 3rd–274th) |

Jev end to end (`eval:large`, 3 runs) is about where it was (dev 32 → 33 of 42, held-out 24 → 26
of 36), because what still fails there isn't the ranking: requests in other words are now offered
at or near the top, and Jev hands them to thinking (which `eval:large` stands in for) or acts on the
first half of the sentence (15). Offering Jev 60 steps instead of 150: dev 36/42, held-out 27/36,
~35% less input (both nights the same). On the demo apps with Jev alone (`pnpm eval --all
--no-thinking`, 2 runs): 55/160 → 60/160, no scenario worse.

**Decisions left to you:** offering Jev 60 steps; keeping embeddings on disk between sessions; a
find step for thinking; and Jev's policy of acting on what isn't navigation before the user
finishes.

**New evals:** `pnpm eval:relevance` (free) and `pnpm eval:large` (Jev only), each with held-out
cases written before any change; `pnpm eval --no-thinking`.

## The goal

Stanley takes every step by choosing among the steps on offer. Jev decides fast, often on words
the user is still saying, a few hundred milliseconds after a page opens; thinking is called now and
then, on an append-only history that must keep its cache. Both choose from a capped list (150 for
Jev, 300 for thinking) ranked by what the user is asking (`rankingFor`, options.ts). So the step
the user means must make that list, in the app Stanley works on, in another in front of the user,
or in one in the background, on pages of thousands of elements; and thinking must read it, without
the same screen ever reading differently.

## Evals

Only the embedding model and Jev: no thinking or writer calls.

- `pnpm eval:relevance`: six large generated pages (4,300+ elements), a shop Stanley works on, an
  article beside it, an inbox, a news front page, a forum thread and a reference in the background.
  A request for one element deep in a page passes when it is among Jev's steps and thinking's, and
  thinking reads it next. By default it ranks with the app's own relevance code, `--after` ms after
  the pages opened; `--warm` with every element embedded. `--holdout` runs cases kept out of
  tuning (new items, written before any change).
- `pnpm eval:large` (below): Jev itself on the same pages, live in headless Chromium, scored by what
  was done and where.

## Log

### 1. Baseline (the code before tonight's changes)

- **The app never scores meaning on a large state.** `Relevance.score` embedded every element it
  hadn't seen, plus the request, in one call within 300 ms. 4,000 elements take seconds, so it
  timed out, kept nothing, and the next call started over: on any screen bringing more than ~110
  new elements, words alone ranked the steps. Worse, the server kept working on every abandoned
  request: a few dozen rankings on the large state queued tens of minutes of work, and the server
  answered nothing else meanwhile (one word took over 20 s).
- `eval:relevance`, the app's code 500 ms after the pages opened (in effect words alone): dev
  21/25, held-out 17/22. Words find every request that uses the element's own words (ranked 1st);
  they miss what is said in other words (2 of 6 dev).
- `eval:relevance --warm` (every element embedded, the old ranking): dev 23/25. Meaning finds 4 of
  the 6 paraphrases, and pushes some exact matches from 1st to 5th–13th, still well within 150.
- `eval:large` (Jev, 2 runs each): dev 18/24, held-out 14/20. Failures: paraphrases whose element
  wasn't offered (Jev opened the app, or the search field), and once Jev starred the right email
  and then kept going (opened it, pressed Compose).
- The first `eval:large` counted any turn handed to thinking as a failure. Jev hands over after
  the step to say it's done, as in the app; that is not what this eval tests, so it now checks only
  what was done, to what, and where Stanley ended up (a turn handed over *instead* of the step
  still fails, since the stand-in for thinking does nothing).

### 2. Embedding in the background (relevance.ts)

- Each element is embedded once, in the background, as soon as it is seen (`Relevance.prepare`,
  called with every ranking): the app being worked on first, then the others, those seen last
  ahead of any still waiting, four batches of 32 at a time, each kept as it lands. A batch the
  server hasn't answered in 10 s is given up on (a stuck server once froze everything behind it).
- A ranking embeds only the request (about 60 ms; 114 ms while a page is being embedded) and
  scores what is embedded so far. What isn't yet counts as the middle of what is, not as zero, so it
  neither wins nor loses for that.
- The elements a request names (sharing a word with it, `wordMatches`) are embedded in the same call
  as the request when they aren't yet. Without this, a page 300 ms after opening ranked exact
  requests *worse* than words alone (Jev's first 10: 15 of 25 vs 20), since half-embedded noise
  outscored the unembedded element the user named; with it, 20.
- The request's vector is kept for the next rankings of the same words (Jev's list, thinking's,
  each decision while the user pauses). The cache holds 20,000 elements (Float32, ~30 MB).
- The embedding server gets 16 slots (`-np 16`, quick.ts): about twice as fast as one, and a
  request isn't kept waiting behind the background's batches. ~1,000 elements a second at first.

### 3. What an element is embedded as

`candidateText` was the option's name and how it reads to Jev: "… › Add to cart, button, out of
view, in Inbox – Quickmail, in the background". Compared with every element embedded (mean
reciprocal rank of the element among Jev's steps; 1 = first):

| embedded as | dev | own words | other words | held-out |
|---|---|---|---|---|
| name, role, state, place (before) | 0.651 | 0.814 | 0.134 | 0.711 |
| name, role | 0.619 | 0.774 | 0.127 | 0.707 |
| app › name, role | 0.663 | 0.792 | 0.253 | 0.698 |
| name alone | **0.725** | **0.868** | **0.269** | **0.714** |

The held-out cases barely separate them (0.698–0.714), so ranking alone wouldn't decide it; what
does is that the name alone doesn't change as the page scrolls ("out of view") or the user types (a
field's text), so an element isn't embedded again and again, and placement is scored apart already
(`RankWeights.tier`, `near`). Now the name alone.

### 4. Words and meaning together

With every element embedded, words alone ranked requests in the element's own words better than
words and meaning together (mean reciprocal rank 0.961 vs 0.868 dev, 1.000 vs 0.821 held-out);
meaning only helped what is said in other words. A heavier word weight (0.2–0.5) changed nothing
for own words and hurt other words: the misses weren't for want of word weight. They were short,
generic names ("3", "Scroll down") that sit close to *every* request and outranked what the user
named, and genuine ties (a row's link, Archive, Star and Select all share "Dana Okafor").

So a score is now how much closer an element is to the request than to a request that asks for
nothing (`cosine(q, e) − cosine(blank, e)`, the usual correction for embeddings that are near
everything). Chosen on dev (λ = 1 over 0.5), confirmed on held-out:

| | dev | own words | other words | held-out | own words | other words |
|---|---|---|---|---|---|---|
| cosine | 0.725 | 0.868 | 0.269 | 0.714 | 0.821 | 0.527 |
| minus half the blank's | 0.724 | 0.899 | 0.169 | 0.764 | 0.881 | 0.560 |
| minus the blank's | 0.743 | 0.934 | 0.139 | 0.754 | 0.869 | 0.553 |

The scores' scale changed, so `ranking.clear` was set again from the session logs the same way
(1% of the steps not taken reach it): 0.19.

### 5. Links in running text

A link in a sentence is named by a word or two ("Draisine"); what it is about is the sentence. The
extractor now gives such a link the text of the paragraph or list item it sits in (`about`, when
that is 30+ characters longer than the link), which is embedded with its name and never shown to
the models. With every element embedded: dev 23/25 → 24/25 (the "early bike you pushed with your
feet" case found, 73rd), held-out 21/22 → 22/22 (the Italian soldiers on folding bikes, 16th);
mean reciprocal rank unchanged (0.743 → 0.744, 0.754 → 0.751).

### 6. A larger embedding model

bge-base-en-v1.5 (Q8_0, 118 MB) against bge-small (37 MB), same server flags. Mean reciprocal rank:

| | bge-small dev | bge-base dev | bge-small held-out | bge-base held-out |
|---|---|---|---|---|
| every element embedded | 0.744 | **0.781** | 0.751 | **0.808** |
| page opened 300 ms before | 0.645 | **0.721** | 0.623 | **0.677** |
| page opened 1 s before | 0.725 | **0.761** | 0.714 | **0.740** |
| all six opened 1 s before | 0.601 | **0.737** | 0.582 | **0.720** |

What is said in other words, every element embedded: dev 0.141 → 0.309, held-out 0.561 → 0.617.
A request alone takes 12 ms with small and 17 ms with base, so Jev's decisions don't feel it; a
page takes about twice as long to embed (4,181 elements in ~7.6 s against ~3.5–5.5 s). The one
place small passes more cases is a page asked about 300 ms after it opened (held-out 19/22 vs
17/22): every miss there is a request in other words whose page isn't embedded yet, which nothing
can rank, and small sometimes gets there first. bge-base is now the model (`EMBED_GGUF`,
`pnpm models` fetches it); `ranking.clear` was set again for it from the logs: 0.18.

Batches went from 4 × 32 to 2 × 16 in flight: with bge-base a request waited 290–430 ms behind four
batches of 32 (past its 300 ms budget, so it scored nothing), 90–135 ms behind two of 16, for about
the same throughput.

### 7. Robustness

- A batch the server hasn't answered in 10 s is given up on; after a failed batch nothing more is
  sent for 5 s and the queue is dropped (it comes back as the screens are read again). Without a
  model downloaded, the app would otherwise send every element of every screen, every decision.
- The request and the "asks for nothing" vector go in one call, so the first ranking isn't two
  round trips.
- The cache holds 12,000 elements (bge-base's vectors are 3 KB: ~37 MB).

### 8. The eval of Jev, made to test what it means to

- Scenarios now say what state they start in. The "open X and do Y" ones start with X not open
  yet (`Layout.closed`): opening it loads the page then, so Jev acts on a page still being embedded.
  Before, every page was loaded from the start, and Jev rightly used the inbox's controls from the
  background without opening it — which didn't test a page just opened.
- `--no-thinking` on `pnpm eval` (and the stand-in in `eval:large`) also turns web search off, so
  nothing paid but Jev runs.

### 9. Jev on the large state, end to end

`eval:large`, three runs of each scenario (14 dev, 12 held-out), each setup on an embedding server
of its own:

| | dev | held-out | Jev's input tokens (dev) |
|---|---|---|---|
| before (committed code, bge-small) | 32/42 | 24/36 | — |
| now, bge-small | 33/42 | 26/36 | — |
| now, bge-base | 33/42 | 26/36 | 2.17 M |
| now, bge-base, Jev offered 60 steps | 36/42 | 25/36 | 1.33 M |

What still fails is mostly not the steps on offer. Requests in other words whose element is
offered low (the dutch oven for "that heavy pot for braising", ~66th of 150): Jev doesn't reach that
far and waits or scrolls. "Open the message about fixing the pipes": Jev opens the inbox on the
first words and then prefers its search field (0.78) to the right email (0.09) near the top — in the
app the writer would type the search, which this eval can't. "Star Priya's email": Jev stars it,
then keeps going (opens it, presses Compose) at 150 steps, and stops at 60.

**Recommendation, not applied: offer Jev 60 steps, not 150.** Its input falls by ~40% (and with it
each decision's time), with no loss in these runs (dev +3, held-out −1, within the runs' noise). In
`eval:relevance` it loses only elements ranked 61st–150th, all requests in other words that Jev
didn't take at 150 either (dev 24/25 → 22/25, held-out unchanged). It is one value,
`maxElements`; the risk is on pages larger than these, so it's yours to decide.

### 10. The demo apps, Jev alone

`pnpm eval --all --no-thinking --runs 2`, the committed code against now (most scenarios need
thinking, so the pass rate means nothing on its own; the comparison does): 57/160 → 60/160. One
scenario is clearly worse: `open-link-quietly` ("go to the GitHub page for the PR" in the GitHub
email), 2/2 → 1/4. The ranking there now puts the email's links to github.com 2nd–4th, above the
email's own row (5th); before, the row was 1st and the links 3rd–5th, and Jev took a link. Now Jev
takes the row, which is already open, and presses it again. The new order reads as better; Jev's
choice among near-equal steps moved with it. Not tuned for: it's one scenario.

## Not done, and why

- **Saying how many elements were left out, and a "find on screen" step.** Once pages are embedded,
  the element asked for is among Jev's 150 in every case but one request in other words per set;
  where it isn't, it is a request in other words on a page not embedded yet, which a note can't
  fix. A find step would let thinking search with its own words (it can rephrase "the limescale" as
  "descale"); that is worth building, but it can only be judged with thinking's calls, which the
  evals tonight didn't make. Jev can't write a query, so for Jev it would rank by the same words.
- **Keeping embeddings on disk between sessions.** A page seen before (an inbox, a news front page)
  would be ranked by meaning the moment it opens. Measured here only as `--warm`; the code is
  small (load at start, save as batches land, per model), but it adds a file of up to ~37 MB, so
  it's left for you to decide.
- **A lower limit for Jev or thinking.** With pages embedded, the element asked for is in Jev's
  first 30 in 22 of 25 dev and 22 of 22 held-out cases; requests in other words are often lower
  (16th–73rd). A lower limit would cut tokens but lose those.

## Second session (2026-10-17): other strategies

The first night refined one approach (embed every element, rank, cut at 150). These try different ones,
each against those results, decided on dev and confirmed on held-out.

### 11. Ranking items, not elements

An element in an item (a row, a card: the containers the extractor names to tell repeated controls
apart) is scored by its item's text and, `weights.own` as much, its own label (`candidateTexts`):
an email is embedded once as itself, not as "… › Archive", "… › Star", "… › Select", and the page's
labels ("Archive", "Add to cart") once each. 4,181 texts to embed become 2,471.

`own` chosen on dev (0, 0.25, 0.5, 1, 2, 4 → 0.758, **0.788**, 0.688, 0.662, 0.612, 0.594, every
element embedded). Mean reciprocal rank, element by element → by item:

| | dev | held-out | held-out in other words |
|---|---|---|---|
| every element embedded | 0.781 → 0.788 | 0.808 → **0.869** | 0.617 → **0.765** |
| page opened 300 ms before | 0.721 → 0.755 | 0.677 → **0.778** | 0.256 → **0.515** |
| page opened 1 s before | 0.761 → 0.788 | 0.740 → 0.823 | 0.430 → 0.640 |
| all six opened 1 s before | 0.737 → 0.714 | 0.720 → 0.682 | 0.375 → 0.313 |

Better everywhere but the rare state of six large pages opened at once (most of it not embedded
either way). `ranking.clear` set again from the logs, scored the same way: 0.17.

### 12. Rare words over common ones (rejected)

A word shared with an element counted by how few of the elements on offer have it (`log(n/df) /
log(n)`: 1 for a word one element has, toward 0 for "open" or an app's name on all its elements).
Words alone, it helps (dev 0.735 → 0.770); with meaning, it doesn't: every word now counts less, so
meaning outweighs exact names (own words 0.974 → 0.868), and a heavier word weight to make up for
it only gets back to where it was (0.3 or 0.5: 0.781 vs 0.788 every element embedded, 0.754 vs
0.755 300 ms after opening). Nothing gained on dev, so not kept.

### 13. A cross-encoder reranker (rejected)

bge-reranker-v2-m3 (Q4_K_M, 438 MB) on llama.cpp's reranking endpoint, reordering Jev's first k:
worse and slow. Every element embedded, dev 0.788 → 0.712 (k = 20) / 0.710 (k = 50), held-out
0.869 → 0.834 / 0.809, at 205–540 ms a request — longer than a decision of Jev's. (jina-reranker-
v1-turbo, 38M, took 70 ms but gave nearly every pair the same score: the conversion looks broken.)
Short UI names read as poor passages to a reranker trained on documents; the embedding plus words
does better here.

### 14. What the user said before

"Archive it" ranks every Archive button alike: the email it means was in the request before. A
request is now also scored against the user's previous utterance (`saidBefore`): an element
counts `weights.before` (0.5) of its closeness to that, when that is more than it has from the
request itself. New cases lean on the request before (4 dev; 4 held-out on other items, written
before measuring). Every element embedded, Jev's rank of the element:

| | no context | weighted sum | **the larger, ×0.5** |
|---|---|---|---|
| dev "archive it" etc. | unlisted, unlisted, 134th, 35th | 12th, 2nd, 1st, 1st | 2nd, 1st, 1st, 1st |
| held-out | 8th, unlisted, 3rd, 108th | — | 1st, 1st, 1st, 5th |

×0.25 was too little (5th, 2nd, 10th, 3rd); ×0.5 and ×1 the same, so the smaller. When the request
before is unrelated (every other case given "what's the weather like tomorrow" before it), the
held-out cases' mean reciprocal rank is unchanged in other words (0.765 → 0.764) and the whole
held-out set goes 0.753 → 0.877 (every element embedded) and 0.663 → 0.762 (300 ms after opening).
On dev a few move between 1st and 2nd and one request in other words drops out of the 150.

### 15. Where Jev's failures are now

`eval:large` with items and context (3 runs): the original scenarios pass as before (dev 33/42,
held-out 26/36), though the ranking is better. The reason is in the traces: the elements are now
offered high, and Jev doesn't take them.

- Requests in other words are mostly at the top of Jev's list now (every element embedded: the
  knife block 1st, the heat wave story 1st, the dutch oven 3rd), but Jev is unsure and hands the
  turn to thinking, which here does nothing. In the app thinking would take it, from its own list
  where it is as high and "sent" (`eval:relevance`'s third column). So `eval:large` can't show
  these gains; it measures Jev alone.
- Jev acts on words the user is still saying, also when it isn't navigation: halfway through "save
  that wooden thing that holds knives…" it saved the walnut utensil holder (the best match for the
  words so far), before "knives with magnets".
- The two-turn scenarios ("did Dana Okafor send me anything" … "archive it") pass the same with
  and without the request before in the ranking: Jev answers the first by opening the item, and
  then only its own controls are on screen. Context helps when the user stays on the list
  (`eval:relevance`, 14); it costs one cached vector. ("Archive it" there fails both ways: Jev takes
  the inbox's "Archive" folder link for the button — a real ambiguity, left in.) The fixtures'
  detail pages first lacked the controls a real one has (Star on an email, Save on a product), which
  sent Jev to the folder links; they have them now.

The ranking is no longer what limits Jev on these pages; its policy is (acting early on what isn't
navigation, deferring requests in other words), and that is outside this work.

### 16. The demo apps again

`pnpm eval --all --no-thinking --runs 2`, the committed code against now: 55/160 → 60/160. No
scenario is worse by two runs or more (`open-link-quietly`, worse after the first night, is back);
`inbox-walkthrough` and `tasks-undo` are better by two.

## Third round: real pages, and a review

### 17. Real pages

Eight openly licensed pages saved for the evals (`evals/real/`: rendered once in headless
Chromium, stylesheets inlined, scripts removed, served offline at their own addresses, a click
noted and stopped): Wikivoyage's Seattle guide (worked on), the weather.gov forecast (beside it),
Wikipedia's Bicycle, MDN's Array, the Python library index, an arXiv listing, a Project Gutenberg
search and a GOV.UK search (3,937 elements). Cases written from what is on them, dev and held-out
(`real/cases.mts`); a target is a pattern, since a page often has several links to the same place.
`pnpm eval:relevance --real`.

They found what the generated pages couldn't:
- **A name that is a whole number comes first among the options.** Option names are an object's
  keys, and JavaScript lists integer-like keys first, whatever their order: a page's "2", "3"
  (pages, footnotes, map markers) jumped to the top of Jev's list and thinking's whenever they
  were offered. Quoted now (`"2"`). This was most of the "collapse" first measured on real pages,
  and it was why "3" outranked `toSorted()` on the generated docs (blamed on the embedding in 4).
- **arXiv's links weren't told apart** ("pdf (8)", "other (10)"): a definition list's term holds the
  links, the description after it the title. A `<dt>` is now an item named by the first line its
  description shows.
- Mozilla Support and Stack Exchange answer a headless browser with a challenge page; not used.

### 18. A review (GPT-6-Astra), and what was taken from it

Accepted and done:
- **Names that mean the same element whatever is offered.** Counters ("Download (2)") were given
  after ranking, so the same name could mean another element once the order changed — and thinking
  acts by the names it read earlier. Every candidate is named over all of them, in screen order,
  before ranking (`nameAll`).
- **The request before, fixed.** A score below nothing's (negative) is no longer "discounted" upward
  by ×0.5, and a weight of 0 now turns it off (it used to clip negatives to 0).
- **The background queue:** what is waiting moves forward when it is on the screens again; a
  ranking that can't embed what the request names still scores with a request vector it knows;
  nothing is sent while the server is down; the two requests of a ranking share one 300 ms budget.
- **Thinking's view:** apps with the same title no longer share a part; each app in the background
  is its own part; and "unchanged" no longer fails whenever more than 20 options clearly match
  ("archive it" matches every Archive) — only the first 20 are judged.
- **`eval:large` judges the end state of every site:** each expectation met and nothing else left
  done; a share counts even if undone; opening means ending on the page; it reports success in the
  fewest steps and with one more. A run still busy after 2 minutes fails.
- **`eval:relevance`** times from when the page is there, and ranks once per case (Jev's and
  thinking's steps from the same ranking); arXiv targets now mean the paper's PDF/HTML link.
- **A frozen test set** on five pages of templates no tuning has seen (Node.js `fs`, the PEP index,
  Rust's `Vec`, a data.gov search, OpenStreetMap's Map features; ~10,000 elements), 18 cases,
  checked to exist, not yet run (`real/test-cases.mts`, `--real --test`).
- **Items are items:** the extractor says whether a container is an item (row, card, entry) or a
  section; only an item's elements are scored by it. A link's `about` is the words around it, not
  the start of its paragraph. About even (real dev 0.730 → 0.735 / 0.722 → 0.717; generated the
  same), kept as more right.

Tried on its advice and not kept:
- **Protecting what the request names** (guaranteed places for elements sharing most of the
  request's words). Loose, it buried requests in other words under elements sharing a word or two
  ("the train from the airport" → [Airport]): real dev 0.730 → 0.662. Tight (≥2 words, ≥60% of the
  request), it changed nothing on real pages — the named ones were already first, and the misses
  share one name word with requests full of words like "open", "section", "docs" — and cost the
  generated set a little (0.852 → 0.834).
- **Fusing a word ranking and a meaning ranking by reciprocal rank:** worse everywhere (real dev
  0.62–0.67 vs 0.73; generated 0.66–0.71 vs 0.85).

Not taken: handles bound to each document version (names stable per screen do the same here, more
simply); dropping the neutral score before there are separate channels to leave unknowns out of.
- **The blank correction and the neutral score, each taken out alone** (the review's point that the
  generated-page evidence for the correction was partly the numeric-name bug). Without the
  correction: real dev a little better (0.735 → 0.749), generated dev much worse (0.851 → 0.745;
  own words 1.000 → 0.828) — kept. 0 for what isn't embedded, instead of the median of what is:
  the same on generated, a little better on real 300 ms after opening (0.717 → 0.726). With the
  correction, 0 is what "no closer to the request than to nothing" means, and it doesn't move as
  unrelated embeddings finish — so 0, and the median is gone.

### 19. Find, for thinking

`find(query, app?)` searches every element of every open app, past thinking's 300: the same
ranking, its own words (thinking can say "descale" for "clean out the limescale"), and a moment
(up to 1.5 s) for what isn't embedded yet, so a request in other words can be found on a page just
opened. It returns the best 15 by name, each an option for `act` (names mean the same element
whatever is listed, 18). Each part of thinking's view says how many of its app's elements aren't
listed, so it knows when to look.
