import { defineApp, FILES_URL, type PageView } from '@stanley/app-sdk'
import { clip, domainOf, parallelWeb, type PageContent } from './parallel'

export interface WebState {
  /** `home` (no page open yet) or `page/<n>` (index into `pages`). */
  route: string
  /** Pages opened this session, in order, including those reached from a link on one. Going back reopens one. */
  pages: PageContent[]
  /** The live page as last read, while one is open: its text and elements. Null without one, or when it couldn't be read. */
  view: PageView | null
  error: string | null
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

const current = (s: WebState): PageContent | null => (s.route.startsWith('page/') ? (s.pages[Number(s.route.slice(5))] ?? null) : null)

/** The same page: a fragment or a trailing slash doesn't make another one. */
const samePage = (a: string, b: string) => a.replace(/#.*$/, '').replace(/\/$/, '') === b.replace(/#.*$/, '').replace(/\/$/, '')

/** A page someone can be on, not the blank or error page a web view shows between them. */
const real = (url: string) => /^(https?|stanley):/.test(url)

/** Where a page is from, for saying so: its site, or the user's files. */
export function sourceOf(url: string): string {
  return url.startsWith(FILES_URL) ? "the user's files" : domainOf(url)
}

/** A page's title, or failing that the file it is or its site. */
const titleOf = (url: string, title: string) => title || (url.startsWith(FILES_URL) ? decodeURIComponent(url.split('/').at(-1)!) : domainOf(url))

/**
 * The live page as read into the state. A page other than the one open was reached from it (a link
 * pressed, a form sent, a redirect) and becomes the next one, as a browser's history has it.
 */
function follow(s: WebState, view: PageView): WebState {
  const page = current(s)
  if (!page || !real(view.url)) return { ...s, view: null }
  const title = titleOf(view.url, view.title)
  if (samePage(view.url, page.url)) {
    const pages = s.pages.map((p) => (p === page ? { ...p, url: view.url, title } : p))
    return { ...s, pages, view }
  }
  return { ...s, route: `page/${s.pages.length}`, pages: [...s.pages, { url: view.url, title, markdown: '' }], view, error: null }
}

/**
 * Shows web pages Stanley opens. It has no search box: Stanley searches in the background and opens
 * what it found here, by address (`openUrl`). On the desktop the page is live (`AppContext.page`):
 * its elements are the screen's, so Stanley follows links, presses buttons and fills in forms on
 * it, and so can the user. Without one (tests, evals), a reader service gives the page's text.
 */
export const webApp = defineApp<WebState>({
  id: 'web',
  title: 'Web',
  description: 'Web browser: shows the web pages Stanley opens',

  init: () => ({ route: 'home', pages: [], view: null, error: null }),

  current: (s) => s.route,

  nodes: (s) => (current(s) && s.view ? s.view.elements : []),

  url: (s) => (current(s) ? (s.view?.url ?? current(s)!.url) : undefined),

  async perform(s, nodeId, args, ctx) {
    // Going back reopens an earlier route.
    if (nodeId === 'home') return { state: { ...s, route: 'home', view: null }, summary: 'Opened Web' }
    if (nodeId.startsWith('page/')) {
      const page = s.pages[Number(nodeId.slice(5))]
      if (!page) return { state: s, summary: `Unknown action ${nodeId}` }
      const summary = `Opened "${page.title}" (${sourceOf(page.url)})`
      if (!ctx.page) return { state: { ...s, route: nodeId, error: null }, summary }
      try {
        await ctx.page.goto(page.url)
        return { state: { ...s, route: nodeId, view: await ctx.page.read(), error: null }, summary }
      } catch (err) {
        return { state: { ...s, route: nodeId, view: null, error: `Couldn't open the page: ${errorText(err)}` }, summary: `${summary}, which failed: ${errorText(err)}` }
      }
    }
    // An element of the live page.
    if (!ctx.page || !current(s)) return { state: s, summary: `Unknown action ${nodeId}` }
    const summary = await ctx.page.perform(nodeId, args)
    return { state: follow(s, await ctx.page.read()), summary }
  },

  async openUrl(s, url, ctx) {
    const open = (page: PageContent, error: string | null) => ({ ...s, route: `page/${s.pages.length}`, pages: [...s.pages, page], view: null, error })
    if (ctx.page) {
      try {
        await ctx.page.goto(url)
        const view = await ctx.page.read()
        const page = { url: view.url, title: titleOf(view.url, view.title), markdown: '' }
        return { state: { ...open(page, null), view }, summary: `Opened "${page.title}" (${sourceOf(page.url)})`, observation: `# ${page.title}\n${page.url}\n\n${view.markdown}`, title: page.title }
      } catch (err) {
        const error = `Couldn't open the page: ${errorText(err)}`
        const title = titleOf(url, '')
        return { state: open({ url, title, markdown: '' }, error), summary: `Opened ${title}; ${error}`, title }
      }
    }
    const key = ctx.env.PARALLEL_API_KEY
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

  async refresh(s, ctx) {
    if (!ctx.page || !current(s)) return s
    const view = await ctx.page.read().catch(() => null)
    if (!view) return s
    const next = follow(s, view)
    return next.route === s.route && JSON.stringify(next) === JSON.stringify(s) ? s : next
  },

  toMarkdown(s) {
    const notice = s.error ? `\n\n_${s.error}_` : ''
    const page = current(s)
    if (page && s.view) return `# Web › ${page.title}\n${s.view.url}\n\n${s.view.markdown}${notice}`
    if (page) return `# Web › ${page.title}\n${page.url}\n\n${clip(page.markdown, 1500)}${notice}`
    return `# Web\nNo page open.${notice}`
  },
})

export default webApp
