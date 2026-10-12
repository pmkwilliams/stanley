/**
 * Label recorded clips: plays each one and asks what was actually said, prefilled with the
 * closest line from speech/prompts.txt (or what Stanley heard). Enter accepts.
 *
 *   pnpm clips:label         # unlabelled clips
 *   pnpm clips:label --all   # revisit every clip
 *
 * At the "said" prompt: /r replays, /s skips, /d deletes the clip, /q quits.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { deleteClip, listClips, saveClip, type Clip } from './speech/clips.mts'
import { align } from './speech/wer.mts'
import { scenarios } from './scenarios.mts'

const revisit = process.argv.includes('--all')
/** Lines to read aloud: "(pause)"-style directions aren't words, and "→ name" is the clip's scenario. */
const prompts = readFileSync(join(import.meta.dirname, 'speech', 'prompts.txt'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const [words = '', scenario] = l.split('→').map((p) => p.trim())
    return { text: words.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim(), scenario: scenario || undefined }
  })

const clips = listClips().filter((c) => revisit || !c.expected)
if (!clips.length) {
  console.log('Nothing to label.')
  process.exit(0)
}
console.log(`${clips.length} clip(s). Scenarios: ${scenarios.map((s) => s.name).join(', ')}\n`)

const rl = createInterface({ input: process.stdin, output: process.stdout })
let player = null as ChildProcess | null
const play = (clip: Clip) => {
  player?.kill()
  player = spawn('afplay', [clip.wav], { stdio: 'ignore' })
}
const ask = async (question: string, prefill = '') => {
  const answer = rl.question(question)
  rl.write(prefill)
  return (await answer).trim()
}

try {
  for (const [i, clip] of clips.entries()) {
    console.log(`[${i + 1}/${clips.length}] ${clip.id}\n  heard: ${clip.heard || '(nothing)'}`)
    play(clip)
    let said = ''
    const prompt = closestPrompt(clip.heard)
    for (;;) {
      said = await ask('  said:  ', clip.expected ?? prompt.text)
      if (said === '/r') play(clip)
      else break
    }
    if (said === '/q') break
    if (said === '/s') continue
    if (said === '/d') {
      deleteClip(clip)
      console.log('  deleted')
      continue
    }
    clip.expected = said
    const scenario = await ask('  scenario (optional): ', clip.scenario ?? prompts.find((p) => p.text === said)?.scenario ?? '')
    if (scenario && !scenarios.some((s) => s.name === scenario)) console.log(`  note: no scenario named "${scenario}" yet`)
    clip.scenario = scenario || undefined
    saveClip(clip)
    console.log()
  }
} finally {
  player?.kill()
  rl.close()
}

/** The prompt the speaker was most likely reading, or what Stanley heard if none is close. */
function closestPrompt(heard: string): { text: string; scenario?: string } {
  let best: { text: string; scenario?: string; rate: number } = { text: heard, rate: 0.5 }
  for (const p of prompts) {
    const a = align(p.text, heard)
    const rate = a.errors / Math.max(1, a.length)
    if (rate < best.rate) best = { ...p, rate }
  }
  return best
}
