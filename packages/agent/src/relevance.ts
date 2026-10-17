/**
 * How related each step on offer is to what the user is asking, before Jev chooses among them: Jev
 * decides what moves the user forward, out of the steps it is given, so the steps it is given must
 * be the ones about what they asked for. "Stop the song" shares no word with [Music › Pause]: an
 * embedding model, which reads meaning, relates them. Words still count (see options.ts): names and
 * numbers ("Sam Lee", "#2291") are matched better by their letters than by their meaning.
 */

/** One vector per text, in order. Throws when it can't. */
export type Embed = (texts: string[], signal?: AbortSignal) => Promise<number[][]>

/** The embedding model's server on this computer (llama.cpp, `--embedding`). */
export const EMBED_URL = 'http://127.0.0.1:8095'

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

/** How many option texts are kept embedded: the screens' elements, which change little from one decision to the next. */
const CACHE = 4000

/**
 * Scores texts against a request by meaning, as cosine similarity. An option's text is embedded
 * once and kept; only the request is embedded each time. Too slow (`timeoutMs`) or failing, it
 * scores nothing, and words alone rank the steps.
 */
export class Relevance {
  private cache = new Map<string, number[]>()

  constructor(
    private embed: Embed,
    private timeoutMs = 300,
  ) {}

  /** Text → similarity to `query` (about 0.3 for unrelated, 0.8 and up for close). Empty when it couldn't tell. */
  async score(query: string, texts: string[]): Promise<Map<string, number>> {
    const scores = new Map<string, number>()
    if (!query.trim() || !texts.length) return scores
    const missing = [...new Set(texts.filter((t) => !this.cache.has(t)))]
    try {
      const vectors = await this.embed([QUERY + query, ...missing], AbortSignal.timeout(this.timeoutMs))
      const q = vectors[0]!
      missing.forEach((t, i) => this.keep(t, vectors[i + 1]!))
      for (const t of texts) scores.set(t, cosine(q, this.cache.get(t)!))
    } catch {
      return new Map()
    }
    return scores
  }

  private keep(text: string, vector: number[]): void {
    if (this.cache.size >= CACHE) this.cache.delete(this.cache.keys().next().value!)
    this.cache.set(text, vector)
  }
}

function cosine(a: number[], b: number[]): number {
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
