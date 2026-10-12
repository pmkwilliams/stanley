import type { LogEntry } from './log'

/** A page found by a web search. */
export interface WebResult {
  title: string
  url: string
  /** What the search engine quoted from the page. */
  excerpt: string
}

/** A web page's readable content. */
export interface WebPage {
  url: string
  title: string
  markdown: string
}

/** Looking things up on the web in the background, without changing the screen. */
export interface WebTools {
  search(query: string, signal?: AbortSignal): Promise<WebResult[]>
  fetch(url: string, signal?: AbortSignal): Promise<WebPage>
}

/** A page Stanley found or read, which it can open on screen. */
export interface KnownPage {
  url: string
  title: string
  /** From the latest search or read, so the likeliest to be meant by "that". */
  latest: boolean
}

/** `en.wikipedia.org/wiki/George_Washington`: a URL as a person would read it. */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** The same page: protocol, `www.`, fragment and trailing slash don't matter. */
export function sameUrl(a: string, b: string): boolean {
  const key = (u: string) => shortUrl(u.replace(/#.*$/, '')).toLowerCase()
  return key(a) === key(b)
}

/** Pages from the searches and reads in `entries`, once each: most recent first, a search's in its order. */
export function knownPages(entries: LogEntry[]): KnownPage[] {
  const pages: KnownPage[] = []
  let latest = true
  for (const e of [...entries].reverse()) {
    const found = e.role === 'search' ? e.results : e.role === 'read' && !e.error ? [e] : []
    if (!found.length) continue
    for (const { url, title } of found) if (!pages.some((p) => sameUrl(p.url, url))) pages.push({ url, title, latest })
    latest = false
  }
  return pages
}
