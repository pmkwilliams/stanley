import { PAGE_CSP, rewriteCdn } from './folder-pages'
import { themed, withTheme } from './page-theme'

const encoder = new TextEncoder()

/** Where an address in text still being written can't be growing any more: after its closing quote, `>` or a space. */
function settled(text: string): string {
  for (let i = text.length - 1; i >= 0; i--) if (/["'`>\s]/.test(text[i]!)) return text.slice(0, i + 1)
  return ''
}

/**
 * A page being written, served as it comes: a request for it gets what is written so far, then the
 * rest as it is written, so the web view draws it the way a browser draws a page arriving slowly
 * over the network. CDN addresses are pointed at the libraries as the files are (`rewriteCdn`); an
 * address is held back until it is complete. A page Stanley writes is drawn in its look from the
 * start (`page-theme.ts`).
 */
export class Draft {
  /** What has been sent, rewritten. */
  private sent = ''
  private done = false
  private readers = new Set<ReadableStreamDefaultController<Uint8Array>>()

  constructor(
    private onClose: () => void,
    /** Drawn in Stanley's look. */
    private themed = false,
  ) {}

  /** All of the page written so far. */
  write(content: string): void {
    this.send(this.look(rewriteCdn(settled(content)), true))
  }

  /** The whole page: the rest is sent, and the page is complete. */
  end(content: string): void {
    this.send(this.look(rewriteCdn(content), false))
    this.close()
  }

  /** Writing stopped: the page ends where it got to. */
  cancel(): void {
    this.close()
  }

  response(): Response {
    let reader: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        reader = controller
        if (this.sent) controller.enqueue(encoder.encode(this.sent))
        if (this.done) controller.close()
        else this.readers.add(controller)
      },
      cancel: () => void this.readers.delete(reader),
    })
    return new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PAGE_CSP, 'Cache-Control': 'no-store' } })
  }

  private look(html: string, partial: boolean): string {
    return this.themed ? withTheme(html, partial) : html
  }

  private send(text: string): void {
    // What was sent stays as it was: text that would change it isn't sent until the end.
    if (this.done || text.length <= this.sent.length || !text.startsWith(this.sent)) return
    const more = encoder.encode(text.slice(this.sent.length))
    this.sent = text
    for (const reader of this.readers) reader.enqueue(more)
  }

  private close(): void {
    if (this.done) return
    this.done = true
    for (const reader of this.readers) reader.close()
    this.readers.clear()
    this.onClose()
  }
}

/** Pages being written, by their path in the user's folder. */
export class Drafts {
  private open = new Map<string, Draft>()

  /** Starts serving `path` as it is written. A page written again replaces the one being written. */
  begin(path: string): Draft {
    this.open.get(path)?.cancel()
    const draft: Draft = new Draft(() => this.open.get(path) === draft && this.open.delete(path), themed(path))
    this.open.set(path, draft)
    return draft
  }

  has(path: string): boolean {
    return this.open.has(path)
  }

  /** The page at `path` as written so far, then as it comes; null when it isn't being written. */
  serve(path: string): Response | null {
    return this.open.get(path)?.response() ?? null
  }
}
