import type { DecisionClient } from '@stanley/jev'
import type { AgentConfig } from './config'

/**
 * Answering from the page with Jev alone: the page is cut into passages, Jev picks the one that
 * says what the user asked, and the best run of neighbouring passages is read out as written.
 * Every spoken word is the page's own, so it can be wrong only by reading the wrong passage; the
 * confidence checks below decide when that is unlikely enough to say it without thinking.
 *
 * Not wired into the agent yet: `pnpm eval:answer` measures it on saved real pages.
 */

export const ANSWER_PROMPT = `# Stanley
You are Stanley, a voice assistant. The user asked something while a page is open, and you can answer by reading out, word for word, the part of the page that says it. The options are the page's passages in page order, each after the heading it sits under in brackets. Words in square brackets inside a passage are controls on the page.`

export const ANSWER_INSTRUCTIONS = 'Which passage, read out as it is written, answers what the user just asked?'

export const NOT_HERE = 'No passage says it. The page does not have it, or answering needs working it out (adding up, comparing, counting from today) rather than reading one passage out.'

export const CHECK_PROMPT = `# Stanley
You are Stanley, a voice assistant. The user asked something while a page is open, and you are about to answer by reading out passage 1 of the page, word for word and nothing else. Each passage is shown with where it sits on the page.`

export const ANSWERS_INSTRUCTIONS = 'Heard alone, does passage 1 tell the user what they just asked?'

export const ANSWERS = {
  yes: 'Yes: it tells them what they asked.',
  no: 'No: it is about something near what they asked, not what they asked.',
}

export const WHEN_INSTRUCTIONS = 'Does passage 1 describe the time the user asked about: now, unless they asked about another time?'

export const WHEN = {
  yes: 'Yes: it is how things are at that time, or something that does not change.',
  no: 'No: it describes another time, such as how things were.',
}



export const CELL_INSTRUCTIONS = 'Passage 1 is a row of a table. Which of its cells answers what the user just asked?'

export const agreeInstructions = (n: number) => `Does passage ${n} give the same answer as passage 1 to what the user just asked?`

export const AGREE = {
  same: 'The same answer, even if worded differently or one says more.',
  different: 'Different answers: a different number, date, name or condition, or only one of them answers.',
}

/** A piece of the page: offsets into its text, the heading it sits under, and the headings above that. */
export interface Chunk {
  start: number
  end: number
  heading: string
  /** Every heading it sits under, outermost first: "Eiffel Tower › History › Inauguration and the 1889 exposition". */
  path: string
}

export interface AnswerRun {
  start: number
  end: number
  /** Jev's probability over the run's passages, bridged ones included. */
  mass: number
  /** What would be spoken. */
  text: string
  /** Where it sits on the page (`Chunk.path`). */
  path: string
}

export interface AnswerReport {
  outcome: 'speak' | 'decline'
  /** Why it declined: thinking takes the turn. */
  reason?: 'not here' | 'unsure' | 'conflict' | 'not the answer' | 'too long'
  text?: string
  /** What is said: `text`, after where it is from when the page isn't on screen ("Wikipedia says: …"). */
  say?: string
  /** Confidence in the answer: the top run's mass, plus the runner-up's when they agree. */
  mass: number
  notHere: number
  runs: AnswerRun[]
  /** Passages per pass (a long page is ranked coarse, then fine). */
  passes: { chunks: number; windows: number; top: { chunk: string; p: number }[] }[]
  /** Jev's P(the top run, read out alone, answers what the user meant). */
  answers?: number
  /** Jev's P(it describes the time the user asked about). */
  when?: number
  /** For each runner-up checked against the top run: whether it gives the same answer. */
  agreed?: boolean[]
  calls: number
  latencyMs: number
  inputTokens: number
}

export interface AnswerRequest {
  jev: DecisionClient
  /** The page's readable markdown (`Screen.markdown`), the whole page rather than one screenful. */
  text: string
  title: string
  /** The page is in front of the user: what it is from goes without saying. */
  onScreen: boolean
  /** The site or app the page is from, as it would be said; else taken from `title` (`sourceOf`). */
  source?: string
  /** The conversation as Jev reads it (`## Conversation` and its lines). */
  conversation: string
  today: string
  config: AgentConfig['answer']
  signal?: AbortSignal
}

const WORD = /[\p{L}\p{N}]+/gu
const words = (t: string) => t.match(WORD)?.length ?? 0

/** Each line with something to read in it, as a block. Headings are blocks too, and name the blocks under them. */
export function blocksOf(text: string): Chunk[] {
  const out: Chunk[] = []
  const above: string[] = []
  let at = 0
  for (const line of text.split('\n')) {
    const start = at
    at += line.length + 1
    if (!words(line)) continue
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    out.push({ start, end: start + line.length, heading: above.at(-1) ?? '', path: above.filter(Boolean).join(' › ') })
    if (h) {
      above.length = h[1]!.length - 1
      above.push(speakable(h[2]!))
    }
  }
  return out
}

const ABBREV = /(?:\b[A-Z]|\bU\.S|\bMr|\bMrs|\bMs|\bDr|\bSt|\be\.g|\bi\.e|\bvs|\betc|\bNo|\bapprox|\bO\.S)\.$/

/** Sentence ends inside `[start, end)`, as offsets just past each sentence. */
function sentenceEnds(text: string, start: number, end: number): number[] {
  const slice = text.slice(start, end)
  const ends: number[] = []
  // The next sentence may open after citation marks: "City. [j] [180] His coach".
  for (const m of slice.matchAll(/[.!?]["”’')\]]*\s+(?=(?:\[[^\]]*\]\s*)*["“‘(]?[\p{Lu}\p{N}])/gu)) {
    const before = slice.slice(0, m.index! + 1)
    if (ABBREV.test(before)) continue
    ends.push(start + m.index! + m[0].trimEnd().length)
  }
  return ends
}

function cut(text: string, c: Chunk, ends: number[], minWords: number): Chunk[] {
  const parts: Chunk[] = []
  let from = c.start
  for (const e of ends) {
    if (words(text.slice(from, e)) < minWords || words(text.slice(e, c.end)) < minWords) continue
    parts.push({ ...c, start: from, end: e })
    from = e
    while (from < c.end && /\s/.test(text[from]!)) from++
  }
  parts.push({ ...c, start: from })
  return parts
}

/**
 * A block into sentences, however short: a sentence is said whole or not at all, so a "Yes." that
 * answers an FAQ's own question isn't glued to the sentence after it. With `clauses`, a sentence
 * into clauses too, each at least `minWords` long, though not before a number ("April 30, 1789").
 */
function split(text: string, c: Chunk, minWords: number, clauses: boolean): Chunk[] {
  const sentences = cut(text, c, sentenceEnds(text, c.start, c.end), 1)
  if (sentences.length > 1 || !clauses) return sentences
  const slice = text.slice(c.start, c.end)
  // At commas and dashes only: semicolons and colons hold a table row's cells to their headers.
  const ends = [...slice.matchAll(/[,—–]\s+(?!\d)/g)].map((m) => c.start + m.index! + 1)
  return cut(text, c, ends, minWords)
}

/**
 * At most `budget` passages, as fine as the budget allows: an article to sentences, and with
 * `clauses` (a short page) further still. Too many blocks even whole, and neighbours are merged
 * into passages of about equal length.
 */
export function chunk(text: string, blocks: Chunk[], budget: number, minWords: number, clauses = false): Chunk[] {
  if (blocks.length > budget) {
    const total = blocks.reduce((n, b) => n + words(text.slice(b.start, b.end)), 0)
    for (let target = Math.ceil(total / budget); ; target = Math.ceil(target * 1.25)) {
      const merged: Chunk[] = []
      let size = 0
      for (const b of blocks) {
        const n = words(text.slice(b.start, b.end))
        const last = merged.at(-1)
        if (last && size + n <= target) {
          last.end = b.end
          size += n
        } else {
          merged.push({ ...b })
          size = n
        }
      }
      if (merged.length <= budget) return merged
    }
  }
  const out = blocks.map((b) => ({ ...b }))
  const whole = new Set<Chunk>()
  for (;;) {
    let i = -1
    for (let j = 0; j < out.length; j++) {
      if (whole.has(out[j]!)) continue
      if (i === -1 || words(text.slice(out[j]!.start, out[j]!.end)) > words(text.slice(out[i]!.start, out[i]!.end))) i = j
    }
    if (i === -1) return out
    const parts = split(text, out[i]!, minWords, clauses)
    if (parts.length < 2 || out.length + parts.length - 1 > budget) whole.add(out[i]!)
    else out.splice(i, 1, ...parts)
  }
}

/** Page text as it should be heard: no markup, citation marks or control brackets, lines joined. */
export function speakable(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, '')
        .replace(/^\s*-\s*/, '')
        // A shell prompt before a command: "$ brew install ripgrep".
        .replace(/^\$\s+(?=[a-z])/, '')
        .replace(/\s*\[\s*(?:\d+|[a-z]{1,2}|[a-z] \d+|note \d+|citation needed|clarification needed)\s*\]/gi, '')
        .replace(/\[([^\]:]+)(?::[^\]]*)?\]/g, '$1')
        .replace(/\s+([.,;:!?)])/g, '$1')
        .replace(/\(\s+/g, '(')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((line) => words(line))
    .reduce((all, line) => (!all ? line : /[.!?:]$/.test(all) ? `${all} ${line}` : `${all}; ${line}`), '')
}

const PRONOUN = /^(?:he|she|it|they|this|these|that|those|his|her|its|their|there)\b/i

/**
 * What would be read out for passages `first..last`: widened to whole sentences, and with the
 * sentence before when it opens with a word that points back ("He was born…").
 */
function spoken(text: string, blocks: Chunk[], chunks: Chunk[], first: number, last: number): { start: number; end: number; text: string } {
  const inBlock = (at: number) => blocks.find((b) => b.start <= at && at <= b.end)!
  const startBlock = inBlock(chunks[first]!.start)
  const endBlock = inBlock(chunks[last]!.end)
  const skipSpace = (at: number): number => (/\s/.test(text[at] ?? '') ? skipSpace(at + 1) : at)
  const starts = [startBlock.start, ...sentenceEnds(text, startBlock.start, startBlock.end).map(skipSpace)]
  let s = starts.filter((at) => at <= chunks[first]!.start).length - 1
  const end = Math.min(endBlock.end, ...sentenceEnds(text, endBlock.start, endBlock.end).filter((e) => e >= chunks[last]!.end))
  let start = starts[s]!
  if (PRONOUN.test(speakable(text.slice(start, end)))) {
    if (s > 0) start = starts[--s]!
    else {
      const b = blocks[blocks.indexOf(startBlock) - 1]
      if (b && !/^#/.test(text.slice(b.start, b.end))) start = b.start
    }
  }
  return { start, end, text: speakable(text.slice(start, end)) }
}

/**
 * Where a page is from, as a person would say it: the site name a title ends with ("George
 * Washington - Wikipedia", "Easy pancakes recipe | Good Food"), or undefined when it has none.
 */
export function sourceOf(title: string): string | undefined {
  const parts = title.split(/\s[|·–—-]\s/)
  if (parts.length < 2) return undefined
  const name = parts.at(-1)!.replace(/\s*\([^)]*\)\s*$/, '').trim()
  return name && words(name) <= 5 ? name : undefined
}

/**
 * The cells that could answer, when a spoken passage is one table row as the extractor reads it
 * ("Apply online; Debit or credit card accepted: Yes; Cash: No"): every "header: value" after what
 * names the row, which is its first cell when no part is unlabelled ("Hours: Up to 3 hrs; …").
 */
function tableCells(text: string, run: AnswerRun): string[] | undefined {
  if (text.slice(run.start, run.end).includes('\n')) return undefined
  const parts = run.text.split('; ')
  const isCell = (part: string) => /^[^:;]{1,60}: \S/.test(part)
  const named = parts.filter((part) => !isCell(part)).length
  const cells = parts.filter(isCell)
  if (named > 1 || cells.length < (named ? 1 : 2)) return undefined
  return named ? cells : cells.slice(1)
}

/** A cell's value, as a person answering would say it: "Cash: No" → "No". */
const valueOf = (cell: string) => cell.slice(cell.indexOf(': ') + 2)

function optionText(text: string, c: Chunk): string {
  const body = speakable(text.slice(c.start, c.end))
  return c.heading && c.heading !== body ? `(${c.heading}) ${body}` : body
}

export async function answer(req: AnswerRequest): Promise<AnswerReport> {
  const { jev, text, config: cfg } = req
  const started = performance.now()
  const report: AnswerReport = { outcome: 'decline', mass: 0, notHere: 0, runs: [], passes: [], calls: 0, latencyMs: 0, inputTokens: 0 }
  const state = `${ANSWER_PROMPT}\n\nToday is ${req.today}.\n\n${req.conversation}\n\n## Page: ${req.title}`
  const done = (r: Partial<AnswerReport>) => Object.assign(report, r, { latencyMs: performance.now() - started })

  /**
   * Jev's probability for each passage. More text than one call takes goes in windows of
   * consecutive passages, asked at once; a window's probabilities count only as much as it
   * thinks the answer is in it.
   */
  const rank = async (chunks: Chunk[]) => {
    const texts = chunks.map((c) => optionText(text, c))
    const windows: number[][] = [[]]
    let size = 0
    texts.forEach((t, i) => {
      if (windows.at(-1)!.length && size + t.length > cfg.chars) {
        windows.push([])
        size = 0
      }
      windows.at(-1)!.push(i)
      size += t.length
    })
    const p = chunks.map(() => 0)
    const answers = await Promise.all(
      windows.map(async (w) => {
        const options: Record<string, string> = { 'not here': NOT_HERE }
        for (const i of w) options[`p${i + 1}`] = texts[i]!
        const r = await jev.choose({ state, instructions: ANSWER_INSTRUCTIONS, options, signal: req.signal })
        report.calls++
        report.inputTokens += r.usage?.inputTokens ?? 0
        const notHere = r.probabilities['not here'] ?? 0
        const weight = windows.length > 1 ? 1 - notHere : 1
        for (const i of w) p[i] = (r.probabilities[`p${i + 1}`] ?? 0) * weight
        return notHere
      }),
    )
    const top = p.map((v, i) => ({ chunk: texts[i]!, p: v })).sort((a, b) => b.p - a.p).slice(0, 5)
    report.passes.push({ chunks: chunks.length, windows: windows.length, top })
    return { p, notHere: Math.min(...answers) }
  }

  const blocks = blocksOf(text)
  if (!blocks.length) return done({ reason: 'not here', notHere: 1 })
  // A page too short to fill the budget with sentences is cut into clauses: a notification, a
  // product card. Elsewhere clauses only spread Jev's probability over the parts of one answer,
  // and what is spoken is widened to whole sentences anyway.
  const short = cfg.clauses && words(text) < cfg.options * cfg.minWords
  const minWords = short ? 2 : cfg.minWords
  let chunks = chunk(text, blocks, cfg.options, minWords, short)
  let ranked = await rank(chunks)
  // A long page: ranked in large passages first, then the most likely of them again, finely.
  if (blocks.length > cfg.options && ranked.notHere < cfg.notHere) {
    const order = ranked.p.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p)
    const regions = order.filter((o, k) => k < cfg.regions && o.p >= cfg.keep * order[0]!.p).map((o) => chunks[o.i]!)
    const inside = blocks.filter((b) => regions.some((r) => b.start >= r.start && b.end <= r.end))
    chunks = chunk(text, inside, cfg.options, minWords, short)
    ranked = await rank(chunks)
  }
  const { p, notHere } = ranked
  report.notHere = notHere
  if (notHere >= cfg.notHere) return done({ reason: 'not here' })

  // Runs: the passages near the top, grouped in page order across a gap of one passage. Passages
  // from different parts of a long page are never neighbours, however close their numbers.
  const top = Math.max(...p)
  const kept = p.map((v, i) => (v >= Math.max(cfg.keep * top, cfg.floor) ? i : -1)).filter((i) => i >= 0)
  const between = (a: Chunk, b: Chunk) => blocks.filter((x) => x.start >= a.end && x.end <= b.start).length
  const groups: number[][] = []
  for (const i of kept) {
    const g = groups.at(-1)
    const last = g?.at(-1)
    if (g && last !== undefined && i - last <= 2 && between(chunks[last]!, chunks[i]!) <= 1 && (i - last === 1 || between(chunks[last + 1]!, chunks[i]!) === 0)) g.push(i)
    else groups.push([i])
  }
  report.runs = groups
    .map((g) => {
      const mass = p.slice(g[0], g.at(-1)! + 1).reduce((a, b) => a + b, 0)
      return { ...spoken(text, blocks, chunks, g[0]!, g.at(-1)!), mass, path: chunks[g[0]!]!.path }
    })
    .sort((a, b) => b.mass - a.mass)
  const [first, second] = report.runs
  if (!first) return done({ reason: 'not here' })

  let best = first
  let mass = first.mass
  // Ranking finds the passage most about what was asked; that isn't always one that answers it.
  // A fact has two scopes: what it is about, and when it holds. Before anything is said, one call
  // asks whether the top run, heard alone, tells the user what they asked, and whether it describes
  // the time they asked about (a passage on how things were reads as an answer, and is about the
  // right thing, but isn't one). The same call checks runners-up: the same fact in different words splits the probability between
  // places, so those that agree add their mass, and a strong one that disagrees is a conflict.
  const unsure = first.mass < cfg.speak
  const rivals = report.runs.slice(1, 1 + cfg.compare).filter((r) => unsure || r.mass >= cfg.agree * first.mass)
  if (first.mass + rivals.reduce((n, r) => n + r.mass, 0) < cfg.speak) return done({ reason: 'unsure', mass })
  // A table row is said as the one cell that answers, its value alone ("No", "$42.00"): its labels
  // only repeat the question, and read out they aren't speech. Jev picks the cell in this call.
  const row = tableCells(text, first)
  const where = (r: AnswerRun) => (r.path ? ` (on the page under: ${r.path})` : '')
  const passages = [first, ...rivals].map((r, k) => `## Passage ${k + 1}${where(r)}\n${r.text}`).join('\n\n')
  const checked = await jev.decide({
    state: `${CHECK_PROMPT}\n\nToday is ${req.today}.\n\n${req.conversation}\n\n## Page: ${req.title}\n\n${passages}`,
    questions: {
      answers: { instructions: ANSWERS_INSTRUCTIONS, options: ANSWERS },
      when: { instructions: WHEN_INSTRUCTIONS, options: WHEN },
      ...(row && row.length > 1 ? { cell: { instructions: CELL_INSTRUCTIONS, options: Object.fromEntries(row.map((c, k) => [`c${k + 1}`, c])) } } : {}),
      ...Object.fromEntries(rivals.map((_, k) => [`p${k + 2}`, { instructions: agreeInstructions(k + 2), options: AGREE }])),
    },
    signal: req.signal,
  })
  report.calls++
  report.inputTokens += checked.usage?.inputTokens ?? 0
  report.answers = checked.answers.answers!.probabilities.yes ?? 0
  report.when = checked.answers.when!.probabilities.yes ?? 0
  if (rivals.length) report.agreed = rivals.map((_, k) => checked.answers[`p${k + 2}`]!.choice === 'same')
  for (const [k, rival] of rivals.entries()) {
    if (!report.agreed![k]) {
      if (rival.mass >= cfg.agree * first.mass) return done({ reason: 'conflict', mass })
      continue
    }
    mass += rival.mass
    if (words(rival.text) < words(best.text)) best = rival
  }
  if (report.answers < cfg.answers || report.when < cfg.when) return done({ reason: 'not the answer', mass })
  if (mass < cfg.speak) return done({ reason: 'unsure', mass })
  let said = best.text
  if (row && best === first) {
    const cell = checked.answers.cell
    // Unsure which cell answers: thinking can read the table instead.
    if (cell && cell.confidence < cfg.cell) return done({ reason: 'unsure', mass })
    said = valueOf(row[cell ? Number(cell.choice.slice(1)) - 1 : 0]!)
  }
  if (words(said) > cfg.maxWords) return done({ reason: 'too long', mass })
  // Where it is from, unless the user is looking at it.
  const source = req.onScreen ? undefined : (req.source ?? sourceOf(req.title))
  return done({ outcome: 'speak', text: said, say: source ? `${source} says: ${said}` : said, mass })
}
