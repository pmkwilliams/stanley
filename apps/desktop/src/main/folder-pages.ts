import { createReadStream, existsSync } from 'node:fs'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { SCRATCH_DIR } from '@stanley/agent'
import { FILES_URL } from '@stanley/app-sdk'
import { themed, withTheme } from './page-theme'

/**
 * The user's folder and a few libraries, as the web view loads them: `stanley://files/<path>` and
 * `stanley://lib/<package>/<path>`. A page from the folder can use what is in the folder and the
 * libraries, but nothing from the network (`PAGE_CSP`), the same rule commands on the folder run
 * under: whatever a page holds, it can't send anywhere.
 */
export const SCHEME = 'stanley'
export const LIB_URL = 'stanley://lib/'

/**
 * Lets a page run its own scripts and load from the folder and the libraries, and nothing else:
 * no requests out, no forms sent out. Navigating away is stopped by the web view (see `page.ts`).
 */
export const PAGE_CSP = ["default-src stanley: data: blob:", "script-src stanley: data: blob: 'unsafe-inline' 'unsafe-eval'", "style-src stanley: data: blob: 'unsafe-inline'", 'form-action stanley:', 'base-uri stanley:'].join('; ')

/**
 * The libraries a page can use without the network, by npm name (and Inter, the shell's font): the file a bare address gives
 * (what CDNs serve for it), and its ES module. `+esm` is made from the classic build, whose global
 * is `global`.
 */
export const LIBS: Record<string, { main: string; esm: string; global?: string }> = {
  mermaid: { main: 'dist/mermaid.min.js', esm: 'dist/mermaid.esm.min.mjs' },
  three: { main: 'build/three.module.js', esm: 'build/three.module.js' },
  d3: { main: 'dist/d3.min.js', esm: '+esm', global: 'd3' },
  'chart.js': { main: 'dist/chart.umd.min.js', esm: '+esm', global: 'Chart' },
  // The shell's font, for pages Stanley writes (`page-theme.ts`).
  '@fontsource-variable/inter': { main: 'index.css', esm: 'index.css' },
}

/** cdnjs names for the libraries. */
const CDNJS: Record<string, string> = { mermaid: 'mermaid', 'three.js': 'three', d3: 'd3', 'Chart.js': 'chart.js' }

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  wasm: 'application/wasm',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  // Shown as text, not downloaded.
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  csv: 'text/plain; charset=utf-8',
}

/** Files the web view shows on their own: pages, documents, pictures, video and sound, text. */
const SHOWN = new Set(['html', 'htm', 'pdf', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'mp4', 'm4v', 'mov', 'webm', 'mp3', 'm4a', 'wav', 'ogg', 'txt', 'md', 'csv', 'json'])

/** Files whose text a CDN address in may be pointed at the libraries. */
const REWRITTEN = new Set(['html', 'htm', 'js', 'mjs', 'svg'])

const ext = (path: string) => extname(path).slice(1).toLowerCase()

export const viewable = (path: string): boolean => SHOWN.has(ext(path))

/** A path in the folder (from its top) as the web view's address for it. */
export function fileUrl(path: string): string {
  return FILES_URL + path.split('/').map(encodeURIComponent).join('/')
}

/** The path in the folder an address shows, or null for any other address. */
export function filePath(url: string): string | null {
  if (!url.startsWith(FILES_URL)) return null
  try {
    return decodeURIComponent(new URL(url).pathname.slice(1))
  } catch {
    return null
  }
}

/**
 * A path as a person or a model would write one, as a path from the folder's top: relative,
 * `./…`, `~/Wren/…` (`shown`, the folder's name for people) or absolute (`root`).
 */
export function inFolder(written: string, root: string, shown: string): string | null {
  let path = written.trim()
  for (const top of [`${shown}/`, `${root}/`]) if (path.startsWith(top)) path = path.slice(top.length)
  path = path.replace(/^(\.\/)+/, '')
  if (!path || path.startsWith('/') || path.startsWith('~')) return null
  const full = resolve(root, path)
  return full.startsWith(root + sep) ? full.slice(root.length + 1) : null
}

/**
 * Points the usual CDN addresses of the bundled libraries (jsDelivr, unpkg, esm.sh, cdnjs,
 * d3js.org) at `stanley://lib/`, so a page written the usual way works with no network. Other
 * addresses are left as they are, and the page's policy blocks them.
 */
export function rewriteCdn(text: string): string {
  return text
    .replace(/https?:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com|esm\.sh)\/((?:@[\w.-]+\/)?[\w.-]+)(?:@[\w.^~<>=*-]*)?(\/[^\s"'`)<>]*)?/g, (all, cdn: string, name: string, path = '') => {
      if (!LIBS[name]) return all
      if (name === 'three') path = path.replace(/^\/addons\//, '/examples/jsm/')
      return `${LIB_URL}${name}${path || (cdn === 'esm.sh' ? '/+esm' : '')}`
    })
    .replace(/https?:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/([\w.-]+)\/[^/\s"'`]+\/([^\s"'`)<>]+)/g, (all, name: string, file: string) => (CDNJS[name] ? `${LIB_URL}${CDNJS[name]}/-/${file}` : all))
    .replace(/https?:\/\/d3js\.org\/d3(?:\.v\d+)?(?:\.min)?\.js/g, `${LIB_URL}d3`)
}

/** A path with a hidden file or folder in it, other than the way into scratch. */
const hidden = (path: string) => (path.startsWith(`${SCRATCH_DIR}/`) ? path.slice(SCRATCH_DIR.length + 1) : path).split('/').some((part) => part.startsWith('.'))

const notFound = () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } })

/**
 * Answers a request for `stanley://files/…` from the folder at `root` (a real path). Nothing
 * outside it, and nothing hidden but Stanley's scratch pages, is served. A folder shows its
 * `index.html`, or a list of what is in it. Pages Stanley writes are served in its look
 * (`page-theme.ts`).
 */
export async function serveFile(root: string, url: string, headers: Headers): Promise<Response> {
  const path = filePath(url)
  if (path === null || hidden(path)) return notFound()
  let full = resolve(root, path)
  try {
    full = await realpath(full)
  } catch {
    return notFound()
  }
  if (full !== root && !full.startsWith(root + sep)) return notFound()
  const info = await stat(full)
  if (info.isDirectory()) {
    if (existsSync(join(full, 'index.html'))) return serveFile(root, fileUrl(join(path, 'index.html')), headers)
    return listing(full, path)
  }
  const type = TYPES[ext(full)] ?? 'application/octet-stream'
  const page = type.startsWith('text/html') || type === 'image/svg+xml'
  const base: Record<string, string> = { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-DNS-Prefetch-Control': 'off', ...(page && { 'Content-Security-Policy': PAGE_CSP }) }
  if (REWRITTEN.has(ext(full))) {
    const text = rewriteCdn(await readFile(full, 'utf8'))
    return new Response(themed(path) ? withTheme(text) : text, { headers: base })
  }
  return ranged(full, info.size, headers, base)
}

/** A file, or the part of it a media player asked for. */
function ranged(full: string, size: number, headers: Headers, base: Record<string, string>): Response {
  const range = /^bytes=(\d*)-(\d*)$/.exec(headers.get('Range') ?? '')
  if (!range || (!range[1] && !range[2])) {
    return new Response(Readable.toWeb(createReadStream(full)) as ReadableStream, { headers: { ...base, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } })
  }
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
  if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  return new Response(Readable.toWeb(createReadStream(full, { start, end })) as ReadableStream, {
    status: 206,
    headers: { ...base, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' },
  })
}

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

async function listing(full: string, path: string): Promise<Response> {
  const entries = (await readdir(full, { withFileTypes: true })).filter((e) => !e.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name))
  const title = path ? path.split('/').at(-1)! : 'Stanley'
  const items = entries.map((e) => {
    const name = e.isDirectory() ? `${e.name}/` : e.name
    return `<li><a href="${escape(fileUrl(path ? `${path}/${e.name}` : e.name))}">${escape(name)}</a></li>`
  })
  const html = `<!doctype html><meta charset="utf-8"><title>${escape(title)}</title><style>body{font:15px system-ui;margin:2rem}li{margin:.3rem 0}</style><main><h1>${escape(title)}</h1><ul>${items.join('') || '<li>Empty</li>'}</ul></main>`
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PAGE_CSP } })
}

/** Where an npm package is installed, found from here up as Node would. */
function packageDir(name: string): string | null {
  for (let dir = dirname(fileURLToPath(import.meta.url)); ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    if (dirname(dir) === dir) return null
  }
}

/** ES modules made from classic builds, by package. */
const shims = new Map<string, string>()

/**
 * Answers a request for `stanley://lib/<package>/<path>`: a file of a bundled library, its
 * default file for a bare address, `+esm` for its ES module, `-/<file>` for a file found by name
 * (cdnjs addresses). Any page may load them.
 */
export async function serveLib(url: string): Promise<Response> {
  const [, name = '', ...rest] = new URL(url).pathname.split('/')
  const scoped = name.startsWith('@') ? `${name}/${rest.shift()}` : name
  const lib = LIBS[decodeURIComponent(scoped)]
  const dir = lib && packageDir(decodeURIComponent(scoped))
  if (!lib || !dir) return notFound()
  const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=86400' }
  let path = rest.map(decodeURIComponent).join('/') || lib.main
  if (path === '+esm') {
    if (lib.esm !== '+esm') path = lib.esm
    else return new Response(await shim(scoped, dir, lib), { headers: { ...headers, 'Content-Type': TYPES.js! } })
  }
  if (path.startsWith('-/')) {
    const file = path.slice(2) === 'chart.min.js' ? 'chart.umd.min.js' : path.slice(2)
    path = ['dist', 'build', ''].map((d) => join(d, file)).find((p) => existsSync(join(dir, p))) ?? path
  }
  const full = resolve(dir, path)
  if (!full.startsWith(dir + sep) || !existsSync(full) || (await stat(full)).isDirectory()) return notFound()
  return new Response(await readFile(full), { headers: { ...headers, 'Content-Type': TYPES[ext(full)] ?? 'application/octet-stream' } })
}

/** An ES module over a library's classic build: it loads the build, and exports what its global has. */
async function shim(name: string, dir: string, lib: { main: string; global?: string }): Promise<string> {
  const known = shims.get(name)
  if (known) return known
  const source = await readFile(join(dir, lib.main), 'utf8')
  const sandbox: Record<string, unknown> = {}
  sandbox.window = sandbox.self = sandbox.globalThis = sandbox
  runInNewContext(source, sandbox)
  const global = lib.global!
  // A class's statics (Chart.register) aren't enumerable, so every own name, less a function's own.
  const skip = new Set(['default', global, 'length', 'name', 'prototype', 'caller', 'arguments'])
  const names = Object.getOwnPropertyNames(sandbox[global] ?? {}).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n) && !skip.has(n))
  // `Chart.register(...registerables)`: the classic build has registered them all already.
  const extra = name === 'chart.js' && !names.includes('registerables') ? ['export const registerables = []'] : []
  const text = [
    `import '${LIB_URL}${name}/${lib.main}'`,
    `const lib = globalThis.${global}`,
    'export default lib',
    `export const ${global} = lib`,
    ...(names.length ? [`export const { ${names.join(', ')} } = lib`] : []),
    ...extra,
  ].join('\n')
  shims.set(name, text)
  return text
}
