/**
 * How related each step on offer is to what the user is asking, before Jev chooses among them: Jev
 * decides what moves the user forward, out of the steps it is given, so the steps it is given must
 * be the ones about what they asked for. "Stop the song" shares no word with [Music › Pause]: an
 * embedding model, which reads meaning, relates them. Words still count (see options.ts): names and
 * numbers ("Sam Lee", "#2291") are matched better by their letters than by their meaning.
 */

/** One vector per text, in order. Throws when it can't. */
export type Embed = (texts: string[], signal?: AbortSignal) => Promise<number[][]>

/** The embedding model's server on this computer (llama.cpp, `--embedding`); `STANLEY_EMBED_URL` for another, as the evals use. */
export const EMBED_URL = (typeof process !== 'undefined' && process.env.STANLEY_EMBED_URL) || 'http://127.0.0.1:8095'

/**
 * bge's instruction for a short query searched against passages: without it, a few words of a
 * request sit as close to unrelated labels as to the right one.
 */
const QUERY = 'Represent this sentence for searching relevant passages: '

/** Embeds through a llama.cpp server's OpenAI-style endpoint. */
export function llamaEmbed(url = EMBED_URL): Embed {
  return async (texts, signal) => {
    const res = await fetch(`${url}/v1/embeddings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: texts }), signal })
    if (!res.ok) throw new Error(`embeddings: ${res.status} ${await res.text().catch(() => '')}`)
    const body = (await res.json()) as { data: { index: number; embedding: number[] }[] }
    return body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding)
  }
}

/**
 * How many option texts are kept embedded: the elements of every open app, which change little
 * from one decision to the next, and of the pages seen lately. 12,000 of bge-base's vectors are
 * about 37 MB: three times six large pages.
 */
const CACHE = 12_000

/**
 * Elements embedded per call, and calls in flight: small enough that a request's own embedding
 * isn't kept waiting behind them. A batch the server hasn't answered in `BATCH_MS` is given up on,
 * so a stuck server doesn't stop everything after it.
 */
const BATCH = 16
const IN_FLIGHT = 2
const BATCH_MS = 10_000
/** After a batch fails, how long nothing more is sent: the server is down, or not there at all. */
const DOWN_MS = 5_000
/** Requests' vectors kept. */
const QUERIES = 32

/**
 * Scores texts against a request by meaning (see `score`). Each element's text is embedded once,
 * in the background, as soon as it is seen (`prepare`), and kept: a page of a thousand elements
 * takes a second or two, and decisions don't wait for it. Each request embeds only itself (and
 * what it names), within `timeoutMs`, and is scored against what is embedded so far; the rest are
 * left unscored, and words rank them (see options.ts). Too slow or failing, it scores nothing.
 */
export class Relevance {
  private cache = new Map<string, Float32Array>()
  /** Texts waiting to be embedded, those seen last first, and those waiting or in flight. */
  private queue: string[] = []
  private pending = new Set<string>()
  private running = 0
  /** Until when nothing is sent to be embedded in the background, after a batch failed. */
  private downUntil = 0
  /** The vector of a request that asks for nothing: what an element is as close to as to any request (see `score`). */
  private blank?: number[]
  /** The latest requests' vectors: the same words are ranked again for thinking's steps, and each decision while the user pauses. */
  private queries = new Map<string, number[]>()

  constructor(
    private embed: Embed,
    private timeoutMs = 300,
  ) {}

  /** Starts embedding those of `texts` not embedded yet, ahead of any still waiting that aren't among them: they are on the screens now. */
  prepare(texts: string[]): void {
    if (Date.now() < this.downUntil) return
    const now = new Set(texts.filter((t) => !this.cache.has(t)))
    if (!now.size) return
    const waiting = this.queue.filter((t) => now.has(t))
    const fresh = [...now].filter((t) => !this.pending.has(t))
    if (!fresh.length && this.queue.slice(0, waiting.length).every((t) => now.has(t))) return
    for (const t of fresh) this.pending.add(t)
    this.queue = [...fresh, ...waiting, ...this.queue.filter((t) => !now.has(t))]
    while (this.running < IN_FLIGHT && this.queue.length) void this.pump()
  }

  /** A budget for one ranking's requests together (`score` takes it), so two of them don't take twice as long. */
  deadline(): AbortSignal {
    return AbortSignal.timeout(this.timeoutMs)
  }

  /** How many of `texts` are embedded, each counted once. */
  embedded(texts: string[]): number {
    return [...new Set(texts)].filter((t) => this.cache.has(t)).length
  }

  /** Resolves once nothing is waiting to be embedded. */
  async idle(): Promise<void> {
    while (this.running || this.queue.length) await new Promise((r) => setTimeout(r, 20))
  }

  /** Embeds batches from the queue until it is empty. A batch that fails is dropped: its texts are queued again when next seen. */
  private async pump(): Promise<void> {
    this.running++
    try {
      while (this.queue.length) {
        const batch = this.queue.splice(0, BATCH)
        try {
          const vectors = await this.embed(batch, AbortSignal.timeout(BATCH_MS))
          batch.forEach((t, i) => this.keep(t, vectors[i]!))
        } catch {
          // The server is down, restarting or not there: everything waiting comes back when the
          // screens are next read, once it has had time to.
          this.downUntil = Date.now() + DOWN_MS
          for (const t of this.queue) this.pending.delete(t)
          this.queue = []
        } finally {
          for (const t of batch) this.pending.delete(t)
        }
      }
    } finally {
      this.running--
    }
  }

  /**
   * Text → how much closer it is to `query` than to a request that asks for nothing, for those of
   * `texts` embedded so far: short, generic names ("3", "Scroll down") sit close to every request,
   * and would otherwise outrank what the user named. `named`, those the request names (sharing its
   * words), are embedded with the request when they aren't yet, up to a batch: what it names is
   * scored at once, not by its words alone while the rest of the page is still being embedded.
   * Empty when it couldn't tell.
   */
  async score(query: string, texts: string[], named: string[] = [], deadline = this.deadline()): Promise<Map<string, number>> {
    const scores = new Map<string, number>()
    if (!query.trim() || !texts.length) return scores
    this.prepare(texts)
    let q = this.queries.get(query)
    // With the server down, nothing is sent: what is already known is used, or nothing.
    const down = Date.now() < this.downUntil
    const now = down ? [] : [...new Set(named)].filter((t) => !this.cache.has(t)).slice(0, BATCH)
    if (!down && (!q || now.length || !this.blank)) {
      try {
        const blank = this.blank ? [] : [QUERY]
        const vectors = await this.embed([QUERY + query, ...blank, ...now], deadline)
        q = vectors[0]!
        if (blank.length) this.blank = vectors[1]!
        now.forEach((t, i) => this.keep(t, vectors[1 + blank.length + i]!))
        this.queries.delete(query)
        this.queries.set(query, q)
        if (this.queries.size > QUERIES) this.queries.delete(this.queries.keys().next().value!)
      } catch {
        // Too slow or failing: the request's vector, if known from before, still scores what is embedded.
      }
    }
    if (!q || !this.blank) return scores
    for (const t of texts) {
      const v = this.cache.get(t)
      if (v) scores.set(t, cosine(q, v) - cosine(this.blank, v))
    }
    return scores
  }

  private keep(text: string, vector: number[]): void {
    if (this.cache.size >= CACHE) this.cache.delete(this.cache.keys().next().value!)
    this.cache.set(text, Float32Array.from(vector))
  }
}

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}
