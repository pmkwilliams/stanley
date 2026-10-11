import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright-core'
import { stepOptions } from '@stanley/agent'
import { findChromium, PageWorld } from '../src/page-world'

const executablePath = findChromium()
let browser: Browser

beforeAll(async () => {
  if (executablePath) browser = await chromium.launch({ executablePath })
})
afterAll(() => browser?.close())

async function screenOf(html: string, scroll = 0) {
  const page: Page = await browser.newPage({ viewport: { width: 1000, height: 600 } })
  await page.route('https://site.test/', (r) => r.fulfill({ contentType: 'text/html', body: html }))
  const world = new PageWorld(page, [{ id: 'site', title: 'Site', description: 'test', url: 'https://site.test/' }], { settleMs: 0 })
  await world.open('site')
  if (scroll) await page.evaluate(`window.scrollTo(0, ${scroll})`)
  return { screen: await world.screen(), world, page }
}

describe.skipIf(!executablePath)('page extraction', () => {
  it('names controls as a screen reader would, including icon buttons, and drops the nameless', async () => {
    const { screen } = await screenOf(`
      <button aria-label="Archive"><svg></svg></button>
      <a href="#up"><div title="upvote"></div></a>
      <button><img alt="Settings"></button>
      <label for="q">Search</label><input id="q">
      <a href="#x"><span></span></a>`)
    const options = stepOptions(screen, [], 50)
    expect(Object.entries(options.criteria).filter(([n]) => n !== 'back' && n !== 'home')).toEqual([
      ['Archive', 'button'],
      ['upvote', 'link'],
      ['Settings', 'button'],
      ['Search', 'field, empty'],
    ])
  })

  it('tells repeated controls apart by their card heading or row link, never by a run of text', async () => {
    const { screen } = await screenOf(`
      <nav><ul><li><a href="#a">Home</a></li><li><a href="#b">News</a></li></ul></nav>
      <nav><ul><li><a href="#a">Home</a></li><li><a href="#b">News</a></li></ul></nav>
      <article><h3>Blue mug</h3><button>Add to cart</button></article>
      <article><h3>Red mug</h3><button>Add to cart</button></article>
      <ul><li><a href="#s1">First story</a> <a href="#c1">comments</a></li><li><a href="#s2">Second story</a> <a href="#c2">comments</a></li></ul>`)
    const names = Object.keys(stepOptions(screen, [], 50).criteria)
    expect(names).toContain('Blue mug › Add to cart')
    expect(names).toContain('Red mug › Add to cart')
    expect(names).toContain('First story › comments')
    expect(names).toContain('Second story › comments')
    expect(names.filter((n) => n.startsWith('Home'))).toEqual(['Home', 'Home (2)'])
  })

  it('reads switch state, field values, and offers Enter on a filled single-line field', async () => {
    const { screen } = await screenOf(`
      <span id="l">Dark mode</span><div role="switch" aria-checked="true" aria-labelledby="l" tabindex="0"></div>
      <input type="search" placeholder="Search products" value="mug">`)
    const options = stepOptions(screen, [], 50)
    expect(options.criteria['Dark mode']).toBe('switch, on')
    expect(options.criteria['Search products']).toBe('search field, containing "mug"')
    expect(options.criteria['Search products › press Enter']).toBe('key')
  })

  it('reads the main content from where the page is scrolled, and offers scrolling', async () => {
    const tall = Array.from({ length: 40 }, (_, i) => `<p>Paragraph ${i}</p><button>Act ${i}</button>`).join('')
    const { screen } = await screenOf(`<header>Banner junk</header><main><h1>Title</h1>${tall}</main>`, 900)
    expect(screen.markdown).not.toContain('Banner junk')
    expect(screen.markdown).not.toContain('Paragraph 0\n')
    expect(screen.markdown).toContain('Paragraph 30')
    const labels = screen.elements.map((e) => e.label)
    expect(labels).toContain('Scroll up')
    expect(labels).toContain('Scroll down')
    expect(screen.elements.find((e) => e.label === 'Act 0')?.offscreen).toBe(true)
  })

  it('offers what is in view plus what matches the request when a page has too many controls', async () => {
    const many = Array.from({ length: 80 }, (_, i) => `<p style="height:40px"><a href="#${i}">Item ${i}</a></p>`).join('') + '<a href="#ref">References</a>'
    const { screen } = await screenOf(`<main>${many}</main>`)
    const names = Object.keys(stepOptions(screen, [], 20, 'show me the references').criteria)
    expect(names).toContain('References')
    expect(names).toContain('Item 0')
    expect(names).not.toContain('Item 60')
  })

  it('clicks, types and presses Enter on real elements, and reports what visibly changed', async () => {
    const { screen, world } = await screenOf(`
      <form onsubmit="event.preventDefault(); document.getElementById('out').textContent = 'Searched ' + this.q.value">
        <input name="q" aria-label="Query"></form><p id="out"></p><button onclick="">Nothing</button>`)
    const field = screen.elements.find((e) => e.label === 'Query')!
    expect((await world.perform(field, { text: 'mugs' })).summary).toBe('"mugs" is in the field')
    const enter = (await world.screen()).elements.find((e) => e.label === 'Query')!.children![0]!
    expect((await world.perform(enter, {})).summary).toBe('The page changed')
    expect((await world.screen()).markdown).toContain('Searched mugs')
    const nothing = (await world.screen()).elements.find((e) => e.label === 'Nothing')!
    expect((await world.perform(nothing, {})).summary).toBe('Nothing on the page changed')
  })
})
