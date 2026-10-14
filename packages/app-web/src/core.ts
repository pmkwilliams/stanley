import { defineApp, FILES_URL, type AppContext, type LivePage, type PageView } from '@stanley/app-sdk'
import { clip, domainOf, parallelWeb, type PageContent } from './parallel'

/** A page opened this session, and the tab it was opened in. */
export interface WebPage extends PageContent {
  tab: number
}

export interface WebState {
  /** `home` (no page open yet) or `page/<n>` (index into `pages`). */
  route: string
  /** Pages opened this session, in order, including those reached from a link on one. Going back reopens one. */
  pages: WebPage[]
  /**
   * Tabs kept open, live, each its own web view showing one of `pages`: most recently shown last,
   * at most `MAX_TABS`. Opening one more closes the one shown longest ago.
   */
  tabs: { id: number; page: number }[]
  /** The tab the next page opens in: its view is in the window before it is needed, so the page can load at once. */
  ready: number
  /** The page shown, as last read: its text and elements. Null without one, or when it couldn't be read. */
  view: PageView | null
  error: string | null
}

/** Pages kept open at once: each is a web view, with a process of its own. */
export const MAX_TABS = 6

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

const current = (s: WebState): WebPage | null => (s.route.startsWith('page/') ? (s.pages[Number(s.route.slice(5))] ?? null) : null)

/** The tab shown, if a page is. */
export const shownTab = (s: WebState): number | null => current(s)?.tab ?? null

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

/** Page `n` shown, in tab `id`, which becomes the one shown last. */
function show(s: WebState, id: number, n: number, view: PageView | null, error: string | null = null): WebState {
  return { ...s, route: `page/${n}`, tabs: [...s.tabs.filter((t) => t.id !== id), { id, page: n }], view, error }
}

/** A page opened in a new tab, the one made ready for it; the tab shown longest ago closes when there are too many. */
function opened(s: WebState, page: PageContent, view: PageView | null, error: string | null): WebState {
  const id = s.ready
  const n = s.pages.length
  return { ...s, route: `page/${n}`, pages: [...s.pages, { ...page, tab: id }], tabs: [...s.tabs, { id, page: n }].slice(-MAX_TABS), ready: id + 1, view, error }
}

/**
 * The page shown, as read into the state. A page other than the one it was was reached from it (a
 * link pressed, a form sent, a redirect) and becomes the next one in the same tab, as a browser's
 * history has it.
 */
function follow(s: WebState, view: PageView): WebState {
  const page = current(s)
  if (!page || !real(view.url)) return { ...s, view: null }
  const title = titleOf(view.url, view.title)
  if (samePage(view.url, page.url)) {
    const pages = s.pages.map((p) => (p === page ? { ...p, url: view.url, title } : p))
    return { ...s, pages, view }
  }
  return show({ ...s, pages: [...s.pages, { url: view.url, title, markdown: '', tab: page.tab }] }, page.tab, s.pages.length, view)
}

/** The live page in the tab shown. */
const shownPage = (s: WebState, ctx: AppContext): LivePage | null => {
  const tab = shownTab(s)
  return ctx.pages && tab !== null ? ctx.pages.tab(tab) : null
}

/**
 * Shows web pages Stanley opens. It has no search box: Stanley searches in the background and opens
 * what it found here, by address (`openUrl`). On the desktop the pages are live (`AppContext.pages`),
 * each in a tab of its own that keeps running out of sight: the page shown is the screen, so
 * Stanley follows links, presses buttons and fills in forms on it, and a page it goes back to is as
 * it was left. Tabs have no bar: Stanley switches between them by opening a page again. Without
 * live pages (tests, evals), a reader service gives the page's text.
 */
export const webApp = defineApp<WebState>({
  id: 'web',
  title: 'Web',
  description: 'Web browser: shows the web pages Stanley opens',

  init: () => ({ route: 'home', pages: [], tabs: [], ready: 1, view: null, error: null }),

  current: (s) => s.route,

  nodes: (s) => (current(s) && s.view ? s.view.elements : []),

  url: (s) => (current(s) ? (s.view?.url ?? current(s)!.url) : undefined),

  // A page can fill the screen; the empty window can't.
  fullscreen: (s) => current(s) !== null,

  openPages: (s) => {
    const shown = shownTab(s)
    return s.tabs.filter((t) => t.id !== shown).map((t) => ({ url: s.pages[t.page]!.url, title: s.pages[t.page]!.title }))
  },

  async perform(s, nodeId, args, ctx) {
    // Going back reopens an earlier route: in its tab, as it was left, if the tab still shows it.
    if (nodeId === 'home') return { state: { ...s, route: 'home', view: null }, summary: 'Opened Web' }
    if (nodeId.startsWith('page/')) {
      const n = Number(nodeId.slice(5))
      const page = s.pages[n]
      if (!page) return { state: s, summary: `Unknown action ${nodeId}` }
      const summary = `Opened "${page.title}" (${sourceOf(page.url)})`
      if (!ctx.pages) return { state: { ...s, route: nodeId, error: null }, summary }
      const tab = s.tabs.find((t) => t.id === page.tab)
      // Its tab was closed: it opens in a new one.
      const id = tab?.id ?? s.ready
      const into = tab ? s : { ...s, pages: s.pages.map((p, i) => (i === n ? { ...p, tab: id } : p)), tabs: [...s.tabs, { id, page: n }].slice(-MAX_TABS), ready: id + 1 }
      try {
        if (tab?.page !== n) await ctx.pages.tab(id).goto(page.url)
        return { state: show(into, id, n, await ctx.pages.tab(id).read()), summary }
      } catch (err) {
        return { state: show(into, id, n, null, `Couldn't open the page: ${errorText(err)}`), summary: `${summary}, which failed: ${errorText(err)}` }
      }
    }
    // An element of the page shown.
    const live = shownPage(s, ctx)
    if (!live) return { state: s, summary: `Unknown action ${nodeId}` }
    const summary = await live.perform(nodeId, args)
    return { state: follow(s, await live.read()), summary }
  },

  async openUrl(s, url, ctx, opts) {
    if (ctx.pages) {
      const shown = shownTab(s)
      const tab = s.tabs.find((t) => samePage(s.pages[t.page]!.url, url))
      try {
        // Kept open in another tab: it comes back as it was left.
        if (tab && tab.id !== shown && !opts?.fresh) {
          const view = await ctx.pages.tab(tab.id).read()
          const state = follow(show(s, tab.id, tab.page, view), view)
          const page = current(state)!
          return { state, summary: `Opened "${page.title}" (${sourceOf(page.url)}), as it was left`, title: page.title }
        }
        // In its own tab again (just written, or opened again: it loads as it is now), or in a new one.
        const id = tab?.id ?? s.ready
        await ctx.pages.tab(id).goto(url)
        const view = await ctx.pages.tab(id).read()
        const at = real(view.url) ? view.url : url
        const page = { url: at, title: titleOf(at, view.title), markdown: '' }
        const state = tab ? follow(show(s, tab.id, tab.page, view), view) : opened(s, page, view, null)
        return { state, summary: `Opened "${page.title}" (${sourceOf(page.url)})`, observation: `# ${page.title}\n${page.url}\n\n${view.markdown}`, title: page.title }
      } catch (err) {
        const error = `Couldn't open the page: ${errorText(err)}`
        const title = titleOf(url, '')
        const state = tab ? show(s, tab.id, tab.page, null, error) : opened(s, { url, title, markdown: '' }, null, error)
        return { state, summary: `Opened ${title}; ${error}`, title }
      }
    }
    const open = (page: PageContent, error: string | null) => ({ ...s, route: `page/${s.pages.length}`, pages: [...s.pages, { ...page, tab: 0 }], view: null, error })
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
    const live = shownPage(s, ctx)
    if (!live) return s
    const view = await live.read().catch(() => null)
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
