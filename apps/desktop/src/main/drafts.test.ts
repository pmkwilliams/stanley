import { describe, expect, it } from 'vitest'
import { Drafts } from './drafts'
import { PAGE_CSP } from './folder-pages'

/** Reads a stream as it comes: everything so far, and whether it ended. */
function reader(response: Response) {
  const stream = response.body!.getReader()
  const decoder = new TextDecoder()
  const state = { text: '', done: false }
  void (async () => {
    for (;;) {
      const { value, done } = await stream.read()
      if (done) return void (state.done = true)
      state.text += decoder.decode(value)
    }
  })()
  return state
}

const tick = () => new Promise((r) => setTimeout(r, 5))

describe('Drafts', () => {
  it('serves a page as it is written, holding back an address until it is complete', async () => {
    const drafts = new Drafts()
    const draft = drafts.begin('Pages/rain.html')
    draft.write('<h1>Rain</h1><script src="https://cdn.jsdelivr.net/npm/mer')
    const response = drafts.serve('Pages/rain.html')!
    expect(response.headers.get('Content-Security-Policy')).toBe(PAGE_CSP)
    const page = reader(response)
    await tick()
    expect(page.text).toBe('<h1>Rain</h1><script src="')
    draft.write('<h1>Rain</h1><script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script><p>It ')
    await tick()
    expect(page.text).toBe('<h1>Rain</h1><script src="stanley://lib/mermaid/dist/mermaid.min.js"></script><p>It ')
    expect(page.done).toBe(false)
    draft.end('<h1>Rain</h1><script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script><p>It falls.</p>')
    await tick()
    expect(page.text).toBe('<h1>Rain</h1><script src="stanley://lib/mermaid/dist/mermaid.min.js"></script><p>It falls.</p>')
    expect(page.done).toBe(true)
    expect(drafts.has('Pages/rain.html')).toBe(false)
    expect(drafts.serve('Pages/rain.html')).toBeNull()
  })

  it('ends a page where it got to when its writing stops, and lets a new one replace it', async () => {
    const drafts = new Drafts()
    const first = drafts.begin('a.html')
    first.write('<h1>One ')
    const page = reader(drafts.serve('a.html')!)
    const second = drafts.begin('a.html')
    await tick()
    expect(page).toEqual({ text: '<h1>One ', done: true })
    second.write('<h1>Two ')
    expect(drafts.has('a.html')).toBe(true)
    second.cancel()
    expect(drafts.has('a.html')).toBe(false)
  })
})
