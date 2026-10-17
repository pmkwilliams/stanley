/**
 * Memory: what Stanley keeps from one session to the next, one short line each, in a file in the
 * user's folder (`~/.agents/MEMORY.md` to the agent). It is read when a session starts and given
 * whole to thinking and Jev; thinking adds to it with the file tools, rarely.
 */

/** Where memory is, from the top of the user's folder. */
export const MEMORY_PATH = '.agents/MEMORY.md'

/** How many characters of it the models read. */
const MAX_MEMORY = 4000

/** The file's text, as the models read it: trimmed, and cut short when it has grown too long. */
export function memoryText(text: string): string {
  const t = text.trim()
  return t.length > MAX_MEMORY ? `${t.slice(0, MAX_MEMORY).trimEnd()}…` : t
}

/** For thinking, when the session has the user's files: the memory as it was when it started. */
export function memoryPrompt(text: string): string {
  const memory = memoryText(text)
  return `## Memory
${memory ? `What you kept from earlier sessions, in ~/.agents/MEMORY.md:\n<memory>\n${memory}\n</memory>` : 'You have kept nothing from earlier sessions yet: ~/.agents/MEMORY.md is where it goes.'}
When the user asks you to remember something, or tells you something about themselves you will clearly need in later sessions, add it to that file as one short line. That is rare: never what you are doing now.`
}

/** For Jev, when there is memory. */
export function jevMemory(text: string): string {
  return `What you know about the user from earlier sessions:\n<memory>\n${memoryText(text)}\n</memory>`
}
