/**
 * What a web page offers, read the way an accessibility tree describes it: each interactive
 * element's role, accessible name, value and state, plus the containers that tell repeated
 * elements apart, and the page's readable text as markdown. Nothing here knows any site.
 *
 * The extractor is plain JavaScript in a string so it runs unchanged in any page context
 * (Playwright's `page.evaluate`, Electron's `webContents.executeJavaScript`), untouched by bundlers.
 */

export interface ExtractedElement {
  /** Stable for the life of the element: written to its `data-stanley-id`. */
  id: string
  kind: 'location' | 'action' | 'input'
  role: string
  name: string
  value?: string
  /** State a person would see: checked, selected, expanded, disabled, current. */
  state?: string
  /** Names of the containers it sits in, outermost first, when its own name is not unique. */
  context: string[]
  /** Single-line text fields with text in them can be submitted with Enter. */
  submits?: boolean
  /** Scrolled out of view: a person would have to scroll to see it. */
  offscreen?: boolean
}

export interface Extracted {
  title: string
  url: string
  markdown: string
  elements: ExtractedElement[]
  /** More of the page below / above the viewport. */
  more: { below: boolean; above: boolean }
}

export const EXTRACT = String.raw`(function (opts) {
  var maxText = opts.maxText || 4000
  var SEL = 'a[href], button, input:not([type=hidden]), textarea, select, summary, [role=button], [role=link], [role=checkbox], [role=switch], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=option], [role=radio], [role=textbox], [role=searchbox], [contenteditable=""], [contenteditable=true]'
  var CONTAINER = 'article, li, tr, [role=row], [role=listitem], [role=article], dialog, [role=dialog], form, fieldset, section, nav, aside, header, footer'

  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim() }
  function shown(el) {
    if (el.closest('[aria-hidden=true], [hidden], [inert]')) return false
    var r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return false
    var s = getComputedStyle(el)
    return s.visibility !== 'hidden' && s.display !== 'none'
  }
  function textOf(el) { return clean(el.innerText || el.textContent) }
  function byIds(ids) {
    return clean(ids.split(/\s+/).map(function (id) { var n = document.getElementById(id); return n ? textOf(n) : '' }).join(' '))
  }
  function nameOf(el) {
    var v = el.getAttribute('aria-label'); if (clean(v)) return clean(v)
    v = el.getAttribute('aria-labelledby'); if (v && byIds(v)) return byIds(v)
    if (el.id) { var l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && textOf(l)) return textOf(l) }
    // A label around the control; a text field's own value isn't part of its name.
    var wrap = el.closest('label')
    if (wrap && wrap !== el) {
      var typed = (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(radio|checkbox|submit|button|reset|image)$/.test(el.type))) ? el.value : ''
      var t = clean(typed ? wrap.innerText.replace(typed, '') : wrap.innerText); if (t) return t
    }
    var tag = el.tagName
    if (tag === 'INPUT' && /^(submit|button|reset)$/.test(el.type)) return clean(el.value) || el.type
    if (tag === 'INPUT' || tag === 'TEXTAREA') { if (clean(el.placeholder)) return clean(el.placeholder) }
    var t2 = textOf(el); if (t2) return t2.length > 80 ? t2.slice(0, 79) + '…' : t2
    var img = el.querySelector('img[alt], svg[aria-label], [role=img][aria-label], [aria-label], [title]')
    if (img) { var n = clean(img.getAttribute('alt') || img.getAttribute('aria-label') || img.getAttribute('title')); if (n) return n }
    if (clean(el.title)) return clean(el.title)
    return clean(el.getAttribute('name'))
  }
  function roleOf(el) {
    var r = el.getAttribute('role'); if (r) return r === 'textbox' || r === 'searchbox' ? 'field' : r
    var tag = el.tagName
    if (tag === 'A') return 'link'
    if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button'
    if (tag === 'SELECT') return 'combobox'
    if (tag === 'TEXTAREA' || el.isContentEditable) return 'field'
    if (tag === 'INPUT') {
      if (el.type === 'checkbox') return 'checkbox'
      if (el.type === 'radio') return 'radio'
      if (/^(submit|button|reset|image)$/.test(el.type)) return 'button'
      return el.type === 'search' ? 'search field' : 'field'
    }
    return 'button'
  }
  function kindOf(role) {
    if (role === 'link') return 'location'
    if (role === 'field' || role === 'search field' || role === 'combobox') return 'input'
    return 'action'
  }
  function valueOf(el) {
    if (el.tagName === 'SELECT') return el.selectedOptions[0] ? clean(el.selectedOptions[0].textContent) : ''
    return el.isContentEditable ? textOf(el) : (el.value || '')
  }
  function stateOf(el) {
    var s = []
    var checked = el.getAttribute('aria-checked')
    if (checked === 'true' || el.checked === true) s.push(el.getAttribute('role') === 'switch' ? 'on' : 'checked')
    else if (checked === 'false' || (el.type === 'checkbox' && !el.checked)) s.push(el.getAttribute('role') === 'switch' ? 'off' : 'not checked')
    if (el.getAttribute('aria-selected') === 'true') s.push('selected')
    if (el.getAttribute('aria-pressed') === 'true') s.push('pressed')
    var exp = el.getAttribute('aria-expanded'); if (exp) s.push(exp === 'true' ? 'expanded' : 'collapsed')
    if (el.getAttribute('aria-current') && el.getAttribute('aria-current') !== 'false') s.push('current')
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') s.push('disabled')
    return s.join(', ')
  }
  function short(t) { return t.length > 60 ? t.slice(0, 59) + '…' : t }
  // A container's name: its label or heading, or for a row or card, its main link. Never a run of
  // its text, which reads as noise ("Home Sport Business…").
  function containerName(c, inner) {
    var v = c.getAttribute('aria-label'); if (clean(v)) return short(clean(v))
    v = c.getAttribute('aria-labelledby'); if (v && byIds(v)) return short(byIds(v))
    var h = c.querySelector('h1, h2, h3, h4, h5, h6, [role=heading], legend, caption')
    if (h && textOf(h)) return short(textOf(h))
    if (c.matches('li, tr, [role=row], [role=listitem], article, [role=article]')) {
      var best = ''
      c.querySelectorAll('a[href]').forEach(function (a) { var t = textOf(a); if (a !== inner && !a.contains(inner) && t.length > best.length) best = t })
      if (best.length > 3) return short(best)
    }
    return ''
  }

  var seen = Number(document.documentElement.getAttribute('data-stanley-next') || '1')
  var found = []
  document.querySelectorAll(SEL).forEach(function (el) {
    if (!shown(el)) return
    if (el.parentElement && el.parentElement.closest(SEL) && el.parentElement.closest(SEL).matches('a[href], button, summary, [role=button], [role=link]')) return
    var id = el.getAttribute('data-stanley-id')
    if (!id) { id = 'e' + seen++; el.setAttribute('data-stanley-id', id) }
    var role = roleOf(el)
    var kind = kindOf(role)
    var name = nameOf(el)
    // An element with no name is noise to anyone who can't see it ("link", "button").
    if (!name && kind !== 'input') return
    var item = { id: id, kind: kind, role: role, name: name || role, context: [], el: el }
    var rect = el.getBoundingClientRect()
    if (rect.bottom < 0 || rect.top > innerHeight) item.offscreen = true
    if (kind === 'input') { item.value = valueOf(el); item.submits = el.tagName === 'INPUT' && !!item.value }
    var st = stateOf(el)
    if (el.tagName === 'SELECT') st = [st, 'options: ' + Array.from(el.options).slice(0, 12).map(function (o) { return clean(o.textContent) }).join(', ')].filter(Boolean).join(', ')
    if (st) item.state = st
    found.push(item)
  })
  document.documentElement.setAttribute('data-stanley-next', String(seen))

  // Repeated names ("Delete" on every row) get the name of the container that tells them apart.
  // Controls in a dialog always say so: a banner or modal on top changes what can be done.
  var DIALOG = 'dialog, [role=dialog], [role=alertdialog], [aria-modal=true]'
  var counts = {}
  found.forEach(function (f) { counts[f.name] = (counts[f.name] || 0) + 1 })
  found.forEach(function (f) {
    var d = f.el.closest(DIALOG)
    if (d) { var dn = containerName(d, f.el) || 'dialog'; if (dn !== f.name) { f.context = [dn]; return } }
    if (counts[f.name] < 2) return
    var c = f.el.parentElement && f.el.parentElement.closest(CONTAINER)
    while (c) {
      var n = containerName(c, f.el)
      if (n && n !== f.name) { f.context = [n]; return }
      c = c.parentElement && c.parentElement.closest(CONTAINER)
    }
  })

  // Readable text: headings, paragraphs, list items; controls inline as [name] or [name: value].
  // From the main content when the page marks it, and from the scroll position on, as a person reads.
  var lines = []
  var line = ''
  var BLOCK = /^(P|DIV|LI|TR|H[1-6]|SECTION|ARTICLE|HEADER|FOOTER|NAV|ASIDE|MAIN|FORM|FIELDSET|UL|OL|TABLE|BLOCKQUOTE|PRE|DL|DT|DD|FIGURE|FIGCAPTION|DIALOG|BR|HR)$/
  function flush() { var t = clean(line); if (t) lines.push(t); line = '' }
  function visit(c) {
    if (c.nodeType === 3) { line += ' ' + c.textContent; return }
    if (c.nodeType !== 1) return
    var el = c
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG)$/.test(el.tagName)) return
    if (!shown(el) && el.tagName !== 'BR') return
    if (el.matches(SEL)) {
      var nm = nameOf(el), r = roleOf(el)
      if (kindOf(r) === 'input') line += ' [' + (nm || r) + ': ' + (valueOf(el) || 'empty') + ']'
      // A link reads in full in the text, even when its option name is shortened.
      else if (r === 'link') { var lt = textOf(el); line += ' ' + (lt ? (lt.length > 400 ? lt.slice(0, 399) + '…' : lt) : nm) }
      else if (nm) { var st2 = stateOf(el); line += ' [' + nm + (st2 ? ': ' + st2 : '') + ']' }
      return
    }
    var block = BLOCK.test(el.tagName)
    if (block) flush()
    var h = /^H([1-6])$/.exec(el.tagName)
    if (h) line += '#'.repeat(Number(h[1])) + ' '
    if (el.tagName === 'LI') line += '- '
    children(el, false)
    if (block) flush()
  }
  // With \`fromView\`, skip what is scrolled above the viewport and descend into what straddles it.
  function children(node, fromView) {
    for (var c = node.firstChild; c; c = c.nextSibling) {
      if (fromView && c.nodeType === 1) {
        var r = c.getBoundingClientRect()
        if (r.bottom < 0) continue
        if (r.top < 0 && c.firstElementChild) { children(c, true); continue }
      }
      visit(c)
    }
  }
  var root = document.querySelector('main, [role=main]') || document.body
  children(root, window.scrollY > 0)
  flush()
  // Dialogs and banners sit on top of everything, often outside the main content: always read them.
  document.querySelectorAll(DIALOG).forEach(function (d) {
    if (root.contains(d) || !shown(d)) return
    lines.push('## ' + (containerName(d, d) || 'Dialog'))
    children(d, false)
    flush()
  })
  var markdown = lines.join('\n')
  if (markdown.length > maxText) markdown = markdown.slice(0, maxText) + '\n…'
  var more = { below: window.scrollY + innerHeight < document.documentElement.scrollHeight - 4, above: window.scrollY > 0 }

  return {
    title: document.title,
    url: location.href,
    markdown: markdown,
    more: more,
    elements: found.map(function (f) { var o = Object.assign({}, f); delete o.el; return o }),
  }
})`
