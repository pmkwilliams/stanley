// Parallel REST API, https://docs.parallel.ai/api-reference/search/search and .../extract/extract
const SEARCH_URL = 'https://api.parallel.ai/v1/search'
const EXTRACT_URL = 'https://api.parallel.ai/v1/extract'
const MAX_RESULTS = 8
const EXCERPT_CHARS = 500
const PAGE_CHARS = 6000

export interface SearchResult {
  title: string
  url: string
  /** First search excerpts, trimmed. */
  excerpt: string
}

export interface PageContent {
  url: string
  title: string
  markdown: string
}

interface ParallelSearchResponse {
  results: { url: string; title?: string | null; publish_date?: string | null; excerpts: string[] }[]
}

interface ParallelExtractResponse {
  results: { url: string; title?: string | null; excerpts: string[]; full_content?: string | null }[]
  errors: { url: string; error_type: string; http_status_code: number | null; content: string | null }[]
}

export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text)
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Web search and page reading through Parallel. Fits the agent's `WebTools`. */
export function parallelWeb(key: string, fetchFn: typeof fetch = fetch) {
  async function call<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
      throw new Error(`Parallel ${res.status}${err?.error?.message ? `: ${err.error.message}` : ''}`)
    }
    return (await res.json()) as T
  }

  return {
    async search(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
      const data = await call<ParallelSearchResponse>(
        SEARCH_URL,
        { objective: query, search_queries: [query], mode: 'fast', advanced_settings: { max_results: MAX_RESULTS } },
        signal,
      )
      return data.results.map((r) => ({
        title: r.title?.trim() || domainOf(r.url),
        url: r.url,
        excerpt: clip(oneLine(r.excerpts.join(' ')), EXCERPT_CHARS),
      }))
    },

    async fetch(url: string, signal?: AbortSignal): Promise<PageContent> {
      const data = await call<ParallelExtractResponse>(EXTRACT_URL, { urls: [url], advanced_settings: { full_content: { max_chars_per_result: PAGE_CHARS } } }, signal)
      const page = data.results[0]
      if (!page) throw new Error(data.errors[0] ? `${data.errors[0].error_type} (${data.errors[0].http_status_code ?? 'no status'})` : 'no content')
      return { url: page.url || url, title: page.title?.trim() || domainOf(url), markdown: clip(page.full_content || page.excerpts.join('\n\n'), PAGE_CHARS) }
    },
  }
}
