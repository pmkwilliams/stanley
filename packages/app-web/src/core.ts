import { defineApp } from '@stanley/app-sdk'
import { clip, domainOf, parallelWeb, type PageContent } from './parallel'

export interface WebState {
  /** `home` (no page open yet) or `page/<n>` (index into `pages`). */
  route: string
  /** Pages opened this session, in order. Going back reopens one without reading it again. */
  pages: PageContent[]
  error: string | null
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

const current = (s: WebState): PageContent | null => (s.route.startsWith('page/') ? (s.pages[Number(s.route.slice(5))] ?? null) : null)

/**
 * Shows web pages Stanley opens. It has no search box: Stanley searches in the background and opens
 * what it found here, by address (`openUrl`).
 */
export const webApp = defineApp<WebState>({
  id: 'web',
  title: 'Web',
  description: 'Web browser: shows the web pages Stanley opens',

  init: () => ({ route: 'home', pages: [], error: null }),

  current: (s) => s.route,

  // The page itself is shown as text (`toMarkdown`); its links aren't elements.
  nodes: () => [],

  url: (s) => current(s)?.url,

  // A page can fill the screen; the empty window can't.
  fullscreen: (s) => current(s) !== null,

  async perform(s, nodeId) {
    // Going back reopens an earlier route.
    if (nodeId === 'home') return { state: { ...s, route: 'home' }, summary: 'Opened Web' }
    const page = nodeId.startsWith('page/') ? s.pages[Number(nodeId.slice(5))] : undefined
    if (!page) return { state: s, summary: `Unknown action ${nodeId}` }
    return { state: { ...s, route: nodeId, error: null }, summary: `Opened "${page.title}" (${domainOf(page.url)})` }
  },

  async openUrl(s, url, ctx) {
    const key = ctx.env.PARALLEL_API_KEY
    const open = (page: PageContent, error: string | null) => ({ ...s, route: `page/${s.pages.length}`, pages: [...s.pages, page], error })
    // Without the reader the page still opens; Stanley just can't read it.
    if (!key) {
      const error = 'Page reader unavailable: PARALLEL_API_KEY is not set'
      return { state: open({ url, title: domainOf(url), markdown: '' }, error), summary: `Opened ${domainOf(url)}; ${error}`, title: domainOf(url) }
    }
    try {
      const page = await parallelWeb(key, ctx.fetch).fetch(url)
      return { state: open(page, null), summary: `Opened "${page.title}" (${domainOf(page.url)})`, observation: `# ${page.title}\n${page.url}\n\n${page.markdown}`, title: page.title }
    } catch (err) {
      const error = `Couldn't read page: ${errorText(err)}`
      return { state: open({ url, title: domainOf(url), markdown: '' }, error), summary: `Opened ${domainOf(url)}; ${error}`, title: domainOf(url) }
    }
  },

  toMarkdown(s) {
    const notice = s.error ? `\n\n_${s.error}_` : ''
    const page = current(s)
    if (page) return `# Web › ${page.title}\n${page.url}\n\n${clip(page.markdown, 1500)}${notice}`
    return `# Web\nNo page open.${notice}`
  },
})

export default webApp
