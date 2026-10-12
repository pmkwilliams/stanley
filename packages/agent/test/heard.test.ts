import { describe, expect, it } from 'vitest'
import { markUnsure, screenVocabulary, unmarked } from '../src/heard'

describe('unsure words', () => {
  const words = [
    { word: 'about', confidence: 0.99 },
    { word: 'the', confidence: 0.9 },
    { word: 'Aconquo', confidence: 0.34 },
    { word: 'invoice.', confidence: 0.45 },
  ]

  it('marks words below the threshold, keeping punctuation after the mark', () => {
    expect(markUnsure('about the Aconquo invoice.', words, 0.5)).toBe('about the Aconquo(?) invoice(?).')
    expect(markUnsure('about the Aconquo invoice.', words, 0.3)).toBe('about the Aconquo invoice.')
    expect(markUnsure('as typed', undefined, 0.5)).toBe('as typed')
  })

  it('reads back without the marks', () => {
    expect(unmarked('about the Aconquo(?) invoice(?).')).toBe('about the Aconquo invoice.')
  })
})

describe('screenVocabulary', () => {
  it('lists names on the screen and apps, capitalized ones first', () => {
    const words = screenVocabulary(
      {
        id: 'email:inbox',
        title: 'Email',
        visible: true,
        markdown: '# Inbox\n- invoice from Okonkwo Ltd',
        elements: [{ id: 'm1', kind: 'location', label: 'Priya Shah: roadmap review', children: [{ id: 'a', kind: 'action', label: 'Archive' }] }],
      },
      [{ id: 'todo', title: 'To-do', description: 'tasks' }],
    )
    expect(words.slice(0, 6)).toEqual(['To-do', 'Priya', 'Shah', 'Archive', 'Inbox', 'Okonkwo'])
    expect(words).toContain('roadmap')
  })
})
