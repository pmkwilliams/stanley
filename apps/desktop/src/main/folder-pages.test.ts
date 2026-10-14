import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileUrl, filePath, inFolder, PAGE_CSP, rewriteCdn, serveFile, serveLib, viewable } from './folder-pages'
import { pageStyle } from './page-theme'

describe('folder pages', () => {
  it('points the usual CDN addresses of the bundled libraries at the bundle, and leaves others alone', () => {
    const page = `
      <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      <script type="importmap">{ "imports": { "three": "https://unpkg.com/three@0.160.0/build/three.module.js", "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/" } }</script>
      <script type="module">import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm"; import x from 'https://esm.sh/d3@7'</script>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js"></script>
      <script src="https://d3js.org/d3.v7.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/leaflet@1.9/dist/leaflet.js"></script>`
    const out = rewriteCdn(page)
    expect(out).toContain('src="stanley://lib/mermaid/dist/mermaid.min.js"')
    expect(out).toContain('src="stanley://lib/chart.js"')
    expect(out).toContain('"three": "stanley://lib/three/build/three.module.js"')
    expect(out).toContain('"three/addons/": "stanley://lib/three/examples/jsm/"')
    expect(out).toContain('from "stanley://lib/d3/+esm"')
    expect(out).toContain("from 'stanley://lib/d3/+esm'")
    expect(out).toContain('src="stanley://lib/d3/-/d3.min.js"')
    expect(out).toContain('src="stanley://lib/d3"')
    expect(out).toContain('https://cdn.jsdelivr.net/npm/leaflet@1.9/dist/leaflet.js')
  })

  it('reads paths as people and models write them, and nothing outside the folder', () => {
    const root = '/Users/sam/Stanley'
    expect(inFolder('diagrams/water.html', root, '~/Stanley')).toBe('diagrams/water.html')
    expect(inFolder('./water.html', root, '~/Stanley')).toBe('water.html')
    expect(inFolder('~/Stanley/water.html', root, '~/Stanley')).toBe('water.html')
    expect(inFolder('/Users/sam/Stanley/a b.html', root, '~/Stanley')).toBe('a b.html')
    expect(inFolder('../secrets.txt', root, '~/Stanley')).toBeNull()
    expect(inFolder('/etc/passwd', root, '~/Stanley')).toBeNull()
    expect(fileUrl('my pages/a b.html')).toBe('stanley://files/my%20pages/a%20b.html')
    expect(filePath('stanley://files/my%20pages/a%20b.html')).toBe('my pages/a b.html')
    expect(viewable('Report.PDF')).toBe(true)
    expect(viewable('notes.docx')).toBe(false)
  })

  it('serves the folder with a policy that keeps pages off the network, and nothing hidden but scratch, or outside it', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'folder-pages-')))
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'folder-outside-')))
    mkdirSync(join(root, 'site'))
    writeFileSync(join(root, 'site', 'index.html'), '<script src="https://unpkg.com/mermaid@11"></script>')
    mkdirSync(join(root, 'Pages'))
    writeFileSync(join(root, 'Pages', 'rain.html'), '<!doctype html><h1>Rain</h1>')
    writeFileSync(join(root, 'clip.mp4'), Buffer.alloc(100, 1))
    writeFileSync(join(root, '.secret'), 'no')
    mkdirSync(join(root, '.stanley/scratch/.cache'), { recursive: true })
    writeFileSync(join(root, '.stanley/scratch/sea.html'), '<h1>Sea</h1>')
    writeFileSync(join(root, '.stanley/scratch/.cache/x.html'), 'no')
    writeFileSync(join(root, '.stanley/other.html'), 'no')
    writeFileSync(join(outside, 'secret.txt'), 'no')
    symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'))
    const get = (path: string, headers: Record<string, string> = {}) => serveFile(root, `stanley://files/${path}`, new Headers(headers))
    const page = await get('site/')
    expect(page.headers.get('Content-Security-Policy')).toBe(PAGE_CSP)
    expect(await page.text()).toBe('<script src="stanley://lib/mermaid"></script>')
    expect(await (await get('Pages/rain.html')).text()).toBe(`<!doctype html>${pageStyle()}<h1>Rain</h1>`)
    const part = await get('clip.mp4', { Range: 'bytes=10-19' })
    expect(part.status).toBe(206)
    expect(part.headers.get('Content-Range')).toBe('bytes 10-19/100')
    expect((await part.arrayBuffer()).byteLength).toBe(10)
    expect(await (await get('.stanley/scratch/sea.html')).text()).toBe(`${pageStyle()}<h1>Sea</h1>`)
    expect((await get('.secret')).status).toBe(404)
    expect((await get('.stanley/other.html')).status).toBe(404)
    expect((await get('.stanley/scratch/.cache/x.html')).status).toBe(404)
    expect((await get('link.txt')).status).toBe(404)
    expect((await get('..%2F..%2Fetc%2Fpasswd')).status).toBe(404)
    expect(await (await get('')).text()).toContain('>clip.mp4</a>')
  })

  it('serves the libraries, and ES modules made from classic builds', async () => {
    const mermaid = await serveLib('stanley://lib/mermaid')
    expect(mermaid.headers.get('Content-Type')).toBe('text/javascript; charset=utf-8')
    expect(mermaid.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect((await serveLib('stanley://lib/three/examples/jsm/controls/OrbitControls.js')).status).toBe(200)
    expect((await serveLib('stanley://lib/chart.js/-/chart.min.js')).status).toBe(200)
    const d3 = await (await serveLib('stanley://lib/d3/+esm')).text()
    expect(d3).toContain(`import 'stanley://lib/d3/dist/d3.min.js'`)
    expect(d3).toMatch(/export const \{ .*\bscaleLinear\b.*\bselect\b.* \} = lib/)
    const chart = await (await serveLib('stanley://lib/chart.js/+esm')).text()
    expect(chart).toContain('export const Chart = lib')
    expect(chart).toMatch(/\bregister\b/)
    expect((await serveLib('stanley://lib/three/../../package.json')).status).toBe(404)
    expect((await serveLib('stanley://lib/leaflet')).status).toBe(404)
  })
})
