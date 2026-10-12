import { walk } from '@stanley/app-sdk'
import type { AppEntry, Screen } from './world'

/** A word as the transcriber decoded it, with its confidence (0–1). */
export interface HeardWord {
  word: string
  confidence: number
}

/**
 * The user's words as every model reads them: a word speech recognition was unsure of carries
 * `(?)` ("about the Aconquo(?) invoice"), so a model can fix it from context or ask.
 */
export function markUnsure(text: string, words: HeardWord[] | undefined, below: number): string {
  if (!words?.length || !words.some((w) => w.confidence < below)) return text
  return words.map((w) => (w.confidence < below ? w.word.replace(/([^\p{L}\p{N}']*)$/u, '(?)$1') : w.word)).join(' ')
}

/** Without the `(?)` marks: the words as said, for matching and display. */
export function unmarked(text: string): string {
  return text.replace(/\(\?\)/g, '')
}

/**
 * Words the user is likely to say next: names and labels on the screen and the apps. Capitalized
 * ones first (names, titles), as the transcriber keeps only a few it finds rare.
 */
export function screenVocabulary(screen: Screen, apps: AppEntry[]): string[] {
  const texts: string[] = apps.map((a) => a.title)
  walk(screen.elements, (node) => {
    texts.push(node.label)
    if (node.description) texts.push(node.description)
  })
  texts.push(screen.markdown)
  const words = texts.flatMap((t) => t.match(/[\p{L}][\p{L}'’-]*/gu) ?? [])
  const capitalized = words.filter((w) => /^\p{Lu}/u.test(w))
  return [...new Set([...capitalized, ...words])]
}
