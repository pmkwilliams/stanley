import { readFileSync, writeFileSync } from 'node:fs'
import type { AppStore } from '@stanley/app-sdk'

/** An `AppStore` kept in a JSON file. `onChange` runs after every write. */
export function fileStore(path: string, onChange: () => void): AppStore {
  let values: Record<string, unknown> = {}
  try {
    values = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    // Not written yet, or unreadable: start from the defaults.
  }
  return {
    get: (key) => values[key],
    set(key, value) {
      values = { ...values, [key]: value }
      writeFileSync(path, JSON.stringify(values, null, 2))
      onChange()
    },
  }
}
