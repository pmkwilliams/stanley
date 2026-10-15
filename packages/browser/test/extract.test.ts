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
      <a href="#main"><img alt="" aria-hidden="true" width="20" height="20"><span><img alt="Wikipedia" width="80" height="20"><img alt="The Free Encyclopedia" width="80" height="10"></span></a>
      <a href="#x"><span></span></a>`)
    const options = stepOptions(screen, [], 50)
    expect(Object.entries(options.criteria).filter(([n]) => n !== 'back' && n !== 'home screen')).toEqual([
      ['Archive', 'button'],
      ['upvote', 'link'],
      ['Settings', 'button'],
      ['Search', 'field, empty'],
      ['Wikipedia The Free Encyclopedia', 'link'],
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

  it('reads a data table row with its column headers, and a layout table as it is', async () => {
    const { screen } = await screenOf(`
      <table>
        <thead><tr><td></td><th>Apply online</th><th>Apply by paper form</th></tr></thead>
        <tbody><tr><th scope="row">Adult passport</th><td>$102</td><td>$115.50</td></tr></tbody>
      </table>
      <table><tr><th style="text-transform: uppercase">Day</th><th></th><th>Hours</th></tr><tr><td>Friday</td><td></td><td><div><a href="#fri">10 am-9 pm</a></div></td></tr></table>
      <table><tr><td>Blue mug</td><td>x 2</td></tr></table>
      <table><tr><th colspan="2">George Washington</th></tr><tr><th>Born</th><td>February 22, 1732</td></tr></table>`)
    expect(screen.markdown).toContain('Adult passport; Apply online: $102; Apply by paper form: $115.50')
    expect(screen.markdown).toContain('Day: Friday; Hours: 10 am-9 pm')
    expect(screen.markdown).toContain('Blue mug x 2')
    expect(screen.markdown).toContain('Born February 22, 1732')
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

  it('names radios by their labels, offers a dropdown as a field with its options, and marks dialogs', async () => {
    const { screen, world } = await screenOf(`
      <main><fieldset><legend>Time</legend><label><input type="radio" name="slot" value="7"> 7:00 PM</label><label><input type="radio" name="slot" value="8"> 8:00 PM</label></fieldset>
      <label for="size">Party size</label><select id="size"><option>1 person</option><option selected>2 people</option><option>4 people</option></select></main>
      <div role="dialog" aria-label="Cookie preferences"><p>We use cookies.</p><button>Accept all</button></div>`)
    const options = stepOptions(screen, [], 50)
    expect(options.criteria['7:00 PM']).toBe('radio')
    expect(options.criteria['Party size']).toBe('combobox, containing "2 people", options: 1 person, 2 people, 4 people')
    expect(options.criteria['Cookie preferences › Accept all']).toBe('button')
    expect(screen.markdown).toContain('## Cookie preferences\nWe use cookies.')
    const size = screen.elements.find((e) => e.label === 'Party size')!
    expect((await world.perform(size, { text: '4' })).summary).toBe('"4 people" is chosen')
  })

  it('fails fast on a control covered by something else', async () => {
    const { screen, world } = await screenOf(`<button>Under</button><div style="position:fixed;inset:0;background:#0008"></div>`)
    const under = screen.elements.find((e) => e.label === 'Under')!
    const started = Date.now()
    await expect(world.perform(under, {})).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(4000)
  })
})

