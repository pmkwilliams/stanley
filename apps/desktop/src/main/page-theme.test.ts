import { describe, expect, it } from 'vitest'
import { pageStyle, themed, withTheme } from './page-theme'

describe('page theme', () => {
  it("gives pages the shell's tokens for light and dark, in a layer the page's own styles win over", () => {
    expect(pageStyle()).toMatch(/^<style id="stanley-theme">@import url\(stanley:\/\/lib\/@fontsource-variable\/inter\/index.css\) layer\(stanley\);@layer stanley\{/)
    expect(pageStyle()).toContain("--font-sans:'Inter Variable',")
    expect(pageStyle()).toContain('{:root{--radius:0.5rem;--background:oklch(0.147 0.004 49.3)')
    expect(pageStyle()).toContain('@media (prefers-color-scheme:light){:root{--background:oklch(1 0 0)')
    expect(pageStyle().match(/--chart-1:#f9b770/g)).toHaveLength(2)
    expect(pageStyle()).toContain('--chart-6:#7ca9ca')
    expect(pageStyle()).toContain('--font-mono:')
    expect(pageStyle()).not.toContain('--window-shadow')
    expect(pageStyle()).not.toContain('--pill')
  })

  it('is for pages Stanley writes, in Pages/ or scratch', () => {
    expect(themed('Pages/water-cycle.html')).toBe(true)
    expect(themed('.stanley/scratch/water-cycle.html')).toBe(true)
    expect(themed('.stanley/scratch/data.json')).toBe(false)
    expect(themed('Pages/old/plan.HTM')).toBe(true)
    expect(themed('Pages/chart.svg')).toBe(false)
    expect(themed('Notes/site.html')).toBe(false)
    expect(themed('MyPages/site.html')).toBe(false)
  })

  it('goes after the doctype and comments before it, so the page stays in standards mode', () => {
    expect(withTheme('<!DOCTYPE html>\n<html><p>Hi')).toBe(`<!DOCTYPE html>${pageStyle()}\n<html><p>Hi`)
    expect(withTheme('  <!-- made by Stanley -->\n<!doctype html><p>Hi')).toBe(`  <!-- made by Stanley -->\n<!doctype html>${pageStyle()}<p>Hi`)
    expect(withTheme('<html><p>Hi')).toBe(`${pageStyle()}<html><p>Hi`)
    expect(withTheme('<!-- a note --><p>Hi')).toBe(`<!-- a note -->${pageStyle()}<p>Hi`)
    expect(withTheme('')).toBe(pageStyle())
  })

  it('waits, while a page is written, until it is clear where it goes, and then stays where it went', () => {
    for (const start of ['', ' \n', '<', '<!', '<!doc', '<!DOCTYPE', '<!doctype html', '<!-- still'])
      expect(withTheme(start, true)).toBe('')
    expect(withTheme('<!doctype html>', true)).toBe(`<!doctype html>${pageStyle()}`)
    expect(withTheme('<h', true)).toBe(`${pageStyle()}<h`)
    const page = '<!doctype html><html><body><h1>Rain</h1></body></html>'
    let before = ''
    for (let i = 0; i <= page.length; i++) {
      const now = withTheme(page.slice(0, i), true)
      if (now) expect(now.startsWith(before)).toBe(true)
      before = now || before
    }
    expect(before).toBe(withTheme(page))
  })
})
