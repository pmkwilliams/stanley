/**
 * Words said while Stanley works (`WORKING` in packages/agent/src/barge.ts): does Jev stop the
 * work for them, or let it finish first? Paid: one Jev call per case.
 *
 *   pnpm eval:working
 */
import { WORKING, WORKING_INSTRUCTIONS, WORKING_PROMPT, named, namedOptions } from '@stanley/agent'
import { createJevClient } from '@stanley/jev'
import { loadEnv } from './harness.mts'

loadEnv()
const jev = createJevClient()

const PAGE = ['draw me a diagram of the water cycle', 'writing the file water-cycle.html.'] as const
/** What the user asked, what Stanley is doing, what they said meanwhile, and the verdict wanted. */
const cases: [string, string, string, 'stop' | 'hold' | 'elsewhere'][] = [
  [...PAGE, 'and make the arrows blue', 'hold'],
  [...PAGE, 'also add a title', 'hold'],
  [...PAGE, 'make the text bigger', 'hold'],
  [...PAGE, 'what time is it', 'hold'],
  [...PAGE, 'stop', 'stop'],
  [...PAGE, 'wait', 'stop'],
  [...PAGE, 'never mind', 'stop'],
  [...PAGE, 'no wait, make it about the nitrogen cycle', 'stop'],
  [...PAGE, 'actually open my email instead', 'stop'],
  [...PAGE, "hang on mum I'm on the phone", 'elsewhere'],
  [...PAGE, 'thanks', 'elsewhere'],
  ['who won the game last night', 'searching the web for "game last night score".', 'the Lakers game', 'stop'],
  ['email Sam that I am running late', 'a step on the screen, [Compose].', "don't send it yet", 'stop'],
  ['what is on my calendar today', 'a step on the screen, [open Calendar].', 'and tomorrow', 'hold'],
  ['play some jazz', 'searching the web for "jazz playlist".', 'actually make it classical', 'stop'],
]

let right = 0
for (const [asked, doing, heard, want] of cases) {
  const state = [named(WORKING_PROMPT, 'Stanley'), `## Conversation\nUser: ${asked}`, '## What Stanley is doing', `Working on what the user asked, not finished yet. Right now: ${doing}`, '## What the user said while it works', `"${heard}"`].join('\n\n')
  const r = await jev.choose({ state, instructions: named(WORKING_INSTRUCTIONS, 'Stanley'), options: namedOptions(WORKING, 'Stanley'), signal: new AbortController().signal })
  // Only stopping or not changes what Stanley does.
  const ok = (r.choice === 'stop') === (want === 'stop')
  if (ok) right++
  console.log(`${ok ? 'ok  ' : 'MISS'} "${heard}" → ${r.choice} (P(stop) ${(r.probabilities.stop ?? 0).toFixed(2)}, ${Math.round(r.latencyMs)} ms), want ${want}`)
}
console.log(`\n${right}/${cases.length} · ${cases.length} paid calls`)
