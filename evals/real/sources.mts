import type { Site } from '@stanley/browser'

/** A real page saved for the evals (`capture.mts`), served offline at its own address. */
export interface Source extends Site {
  license: string
}

/** Openly licensed pages, of the kinds Stanley meets: a long article, a reference, lists of items, a search, a forecast, a thread. */
export const SOURCES: Source[] = [
  { id: 'wikipedia', title: 'Wikipedia: Bicycle', description: 'Encyclopedia article', url: 'https://en.wikipedia.org/wiki/Bicycle', license: 'CC BY-SA 4.0' },
  { id: 'mdn', title: 'MDN: Array', description: 'JavaScript reference', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array', license: 'CC BY-SA 2.5' },
  { id: 'pydocs', title: 'Python: The Python Standard Library', description: 'Python documentation', url: 'https://docs.python.org/3/library/index.html', license: 'PSF License' },
  { id: 'arxiv', title: 'arXiv: Computation and Language, recent', description: 'Research papers', url: 'https://arxiv.org/list/cs.CL/recent', license: 'Listing metadata CC0' },
  { id: 'gutenberg', title: 'Project Gutenberg: cooking', description: 'Free ebooks', url: 'https://www.gutenberg.org/ebooks/search/?query=cooking', license: 'Public domain works; Project Gutenberg pages' },
  { id: 'govuk', title: 'GOV.UK: passport', description: 'UK government services', url: 'https://www.gov.uk/search/all?keywords=passport', license: 'Open Government Licence v3.0' },
  { id: 'weather', title: 'National Weather Service: Seattle', description: 'Weather forecast', url: 'https://forecast.weather.gov/MapClick.php?lat=47.6062&lon=-122.3321', license: 'Public domain (US government)' },
  { id: 'wikivoyage', title: 'Wikivoyage: Seattle', description: 'Travel guide', url: 'https://en.wikivoyage.org/wiki/Seattle', license: 'CC BY-SA 4.0' },
]

/**
 * Pages of templates no tuning has seen, for the frozen test set (`test-cases.mts`): measured once,
 * at the end, so a result on them says how the ranking does on pages it was never fitted to.
 */
export const TEST_SOURCES: Source[] = [
  { id: 'nodefs', title: 'Node.js: File system', description: 'Node.js API reference', url: 'https://nodejs.org/api/fs.html', license: 'MIT' },
  { id: 'peps', title: 'PEP 0: Index of Python Enhancement Proposals', description: 'Python proposals', url: 'https://peps.python.org/', license: 'Public domain / CC0' },
  { id: 'rustvec', title: 'Rust: Vec', description: 'Rust standard library', url: 'https://doc.rust-lang.org/std/vec/struct.Vec.html', license: 'MIT / Apache-2.0' },
  { id: 'datagov', title: 'Data.gov: bicycle', description: 'US government datasets', url: 'https://catalog.data.gov/dataset?q=bicycle', license: 'Public domain (US government)' },
  { id: 'osm', title: 'OpenStreetMap Wiki: Map features', description: 'Mapping reference', url: 'https://wiki.openstreetmap.org/wiki/Map_features', license: 'CC BY-SA 2.0' },
]
