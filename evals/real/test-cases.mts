import type { Layout } from '../relevance/state.mts'
import type { RealCase } from './cases.mts'

/**
 * The frozen test set: requests on pages of templates no tuning has seen (`TEST_SOURCES`), written
 * before any ranking was run on them. Run with `--real --test` once a change is settled, to judge
 * it; never to choose between changes, or it stops saying anything.
 */
export const TEST_LAYOUT: Layout = { focused: 'nodefs', shown: ['peps'], background: ['rustvec', 'datagov', 'osm'] }

export const TEST_CASES: RealCase[] = [
  { name: 'node-readfile', site: 'nodefs', request: 'open fs.readFile', target: /^fs\.readFile\(path\[, options\], callback\)$/ },
  { name: 'node-watch-other-words', site: 'nodefs', request: 'how do I watch a folder for changes', target: /^fs\.watch\(/ },
  { name: 'node-rm-other-words', site: 'nodefs', request: 'show me how to delete a directory with promises', target: /^fsPromises\.rm\(/ },
  { name: 'node-copy-other-words', site: 'nodefs', request: 'how do I copy a file', target: /^fs\.copyFile\(/ },
  { name: 'peps-zen', site: 'peps', request: 'open the Zen of Python', target: /^The Zen of Python$/ },
  { name: 'peps-style', site: 'peps', request: 'the style guide for python code', target: /^Style Guide for Python Code$/ },
  { name: 'peps-pattern-tutorial', site: 'peps', request: 'the PEP with the pattern matching tutorial', target: /^Structural Pattern Matching: Tutorial$/ },
  { name: 'peps-docstrings-other-words', site: 'peps', request: 'how should I write docstrings', target: /^Docstring Conventions$/ },
  { name: 'rust-push', site: 'rustvec', request: 'open Vec push', target: /^Vec › push$/ },
  { name: 'rust-dedup-other-words', site: 'rustvec', request: 'remove duplicates from a vector', target: /(^|› )dedup$/ },
  { name: 'rust-retain-other-words', site: 'rustvec', request: 'keep only the elements that match a condition', target: /(^|› )retain$/ },
  { name: 'data-ev-csv', site: 'datagov', request: 'download the electric vehicle population data as CSV', target: /^Electric Vehicle Population Data Trending › CSV$/ },
  { name: 'data-ev-open', site: 'datagov', request: 'open the electric vehicle population data', target: /^Electric Vehicle Population Data$/ },
  { name: 'data-crime-other-words', site: 'datagov', request: 'the crime statistics as a spreadsheet', target: /^Crime Data from 2020 to 2024 Trending › CSV$/ },
  { name: 'osm-parking', site: 'osm', request: 'open bicycle parking', target: /^bicycle_parking$/ },
  { name: 'osm-transport', site: 'osm', request: 'go to the public transport section', target: /Public transport$/ },
  { name: 'osm-repair-other-words', site: 'osm', request: 'where can I fix my bike', target: /^bicycle_repair_station$/ },
  { name: 'osm-rental-other-words', site: 'osm', request: 'tags for places to rent a bike', target: /^bicycle_rental$/ },
]
