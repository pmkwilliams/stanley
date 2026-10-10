import { defineApp, type AgentNode, type AppContext } from '@stanley/app-sdk'

export interface SearchResult {
  title: string
  url: string
  domain: string
  /** First search excerpt, trimmed. */
  excerpt: string
}

export interface WebPage {
  url: string
  title: string
  markdown: string
}

export interface WebState {
  /** `home`, `results` or `page/<n>` (index into `results`) */
  route: string
  query: string
  results: SearchResult[]
  page: WebPage | null
  error: string | null
}

// Parallel REST API, https://docs.parallel.ai/api-reference/search/search and .../extract/extract
const SEARCH_URL = 'https://api.parallel.ai/v1/search'
const EXTRACT_URL = 'https://api.parallel.ai/v1/extract'
const MAX_RESULTS = 8
const EXCERPT_CHARS = 500
const PAGE_CHARS = 6000

interface ParallelSearchResponse {
  results: { url: string; title?: string | null; publish_date?: string | null; excerpts: string[] }[]
}

interface ParallelExtractResponse {
  results: { url: string; title?: string | null; excerpts: string[]; full_content?: string | null }[]
  errors: { url: string; error_type: string; http_status_code: number | null; content: string | null }[]
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text)
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

async function parallel<T>(ctx: AppContext, url: string, key: string, body: unknown): Promise<T> {
  const res = await ctx.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    throw new Error(`Parallel ${res.status}${err?.error?.message ? `: ${err.error.message}` : ''}`)
  }
  return (await res.json()) as T
}

async function search(ctx: AppContext, key: string, query: string): Promise<SearchResult[]> {
  const data = await parallel<ParallelSearchResponse>(ctx, SEARCH_URL, key, {
    objective: query,
    search_queries: [query],
    mode: 'fast',
    advanced_settings: { max_results: MAX_RESULTS },
  })
  return data.results.map((r) => ({
    title: r.title?.trim() || domainOf(r.url),
    url: r.url,
    domain: domainOf(r.url),
    excerpt: clip(oneLine(r.excerpts.join(' ')), EXCERPT_CHARS),
  }))
}

async function extract(ctx: AppContext, key: string, url: string, objective: string): Promise<{ title?: string; markdown: string }> {
  const data = await parallel<ParallelExtractResponse>(ctx, EXTRACT_URL, key, {
    urls: [url],
    objective,
    advanced_settings: { full_content: { max_chars_per_result: PAGE_CHARS } },
  })
  const page = data.results[0]
  if (!page) throw new Error(data.errors[0] ? `${data.errors[0].error_type} (${data.errors[0].http_status_code ?? 'no status'})` : 'no content')
  return { title: page.title ?? undefined, markdown: clip(page.full_content || page.excerpts.join('\n\n'), PAGE_CHARS) }
}

const resultsMarkdown = (s: WebState) =>
  s.results.map((r, i) => `${i + 1}. **${r.title}** (${r.domain})\n   ${r.url}\n   ${r.excerpt}`).join('\n') || '_No results_'

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

export const webApp = defineApp<WebState>({
  id: 'web',
  title: 'Web',
  description: 'Web search and page reader',

  init: () => ({ route: 'home', query: '', results: [], page: null, error: null }),

  current: (s) => s.route,

  nodes(s) {
    const results: AgentNode[] = s.results.map((r, i) => ({
      id: `page/${i}`,
      kind: 'location',
      label: r.title,
      description: r.excerpt ? `${r.domain}: ${clip(r.excerpt, 120)}` : r.domain,
    }))
    const children: AgentNode[] = [
      {
        id: 'search',
        kind: 'input',
        label: 'search the web',
        description: s.query ? `new web search (last: "${s.query}")` : 'run a web search',
        input: { instructions: 'A concise web search query (3-8 words) for what the user wants to find.', placeholder: 'Search the web' },
      },
    ]
    if (s.results.length || s.route === 'results') {
      children.push({ id: 'results', kind: 'location', label: `search results for "${s.query}"`, description: `${s.results.length} results`, children: results })
    }
    return [{ id: 'home', kind: 'location', label: 'web search page', description: 'search box', children }]
  },

  async perform(s, nodeId, args, ctx) {
    if (nodeId === 'home') return { state: { ...s, route: 'home', page: null }, summary: 'Opened web search' }
    if (nodeId === 'results') return { state: { ...s, route: 'results', page: null }, summary: `Back to results for "${s.query}"` }

    const key = ctx.env.PARALLEL_API_KEY

    if (nodeId === 'search') {
      const query = args.text?.trim()
      if (!query) return { state: s, summary: 'No query given; nothing searched' }
      if (!key) {
        const error = 'Web search unavailable: PARALLEL_API_KEY is not set'
        return { state: { ...s, query, error }, summary: error }
      }
      try {
        const results = await search(ctx, key, query)
        const next = { ...s, route: 'results', query, results, page: null, error: null }
        return { state: next, summary: `Searched "${query}": ${results.length} results`, observation: `# Results for "${query}"\n${resultsMarkdown(next)}` }
      } catch (err) {
        const error = `Web search failed: ${errorText(err)}`
        return { state: { ...s, query, error }, summary: error }
      }
    }

    const [, n] = nodeId.split('/')
    const result = s.results[Number(n)]
    if (!nodeId.startsWith('page/') || !result) return { state: s, summary: `Unknown action ${nodeId}` }

    // Without a key (or if Extract fails) still open the page; the agent gets the search excerpt instead.
    const fallback = { ...s, route: nodeId, page: { url: result.url, title: result.title, markdown: result.excerpt } }
    if (!key) {
      return { state: fallback, summary: `Opened "${result.title}" (page reader unavailable)`, observation: `# ${result.title}\n${result.url}\n\n${result.excerpt}` }
    }
    try {
      const page = await extract(ctx, key, result.url, s.query)
      const title = page.title || result.title
      return {
        state: { ...s, route: nodeId, page: { url: result.url, title, markdown: page.markdown }, error: null },
        summary: `Opened "${title}" (${result.domain})`,
        observation: `# ${title}\n${result.url}\n\n${page.markdown}`,
      }
    } catch (err) {
      const error = `Couldn't read page: ${errorText(err)}`
      return { state: { ...fallback, error }, summary: `Opened "${result.title}"; ${error}`, observation: `# ${result.title}\n${result.url}\n\n${result.excerpt}` }
    }
  },

  toMarkdown(s) {
    const notice = s.error ? `\n\n_${s.error}_` : ''
    if (s.route.startsWith('page/') && s.page) return `# Web › ${s.page.title}\n${s.page.url}\n\n${clip(s.page.markdown, 1500)}${notice}`
    if (s.route === 'results') return `# Web › Results for "${s.query}"\n${resultsMarkdown(s)}${notice}`
    return `# Web\nSearch box${s.query ? ` (last search: "${s.query}")` : ''}${notice}`
  },
})

export default webApp
