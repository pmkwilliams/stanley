/**
 * Voice scenario evals: like `pnpm eval`, but the utterance is a recorded clip played through
 * the real transcriber at real speed. A clip runs against the scenario named in its label;
 * for multi-turn scenarios, the clip replaces the last utterance and earlier ones are typed.
 *
 *   pnpm eval:voice              # list clips with a scenario (runs nothing)
 *   pnpm eval:voice todo         # clips whose id or scenario contains a filter
 *   pnpm eval:voice --all
 */
import { readWav } from '@stanley/stt'
import { listClips } from './speech/clips.mts'
import { playRealtime } from './speech/feed.mts'
import { loadEnv, printUsage, report, runScenario, select, typeUtterance } from './harness.mts'
import { scenarios } from './scenarios.mts'

const cases = listClips()
  .filter((c) => c.scenario)
  .map((clip) => ({ clip, scenario: scenarios.find((s) => s.name === clip.scenario) }))
for (const { clip, scenario } of cases) if (!scenario) console.warn(`${clip.id}: no scenario named "${clip.scenario}"`)

const selected = select(
  cases.filter((c) => c.scenario),
  ({ clip }) => `${clip.scenario}  ${clip.id}`,
  'pnpm eval:voice',
)
if (selected) {
  loadEnv()
  let passed = 0
  for (const { clip, scenario } of selected) {
    const last = scenario!.utterances.length - 1
    const heard: string[] = []
    const result = await runScenario({ ...scenario!, utterances: [...scenario!.utterances.slice(0, last), clip.expected ?? clip.heard] }, async (agent, utterance, i) => {
      if (i < last) return typeUtterance(agent, utterance)
      agent.utteranceStart()
      await playRealtime(readWav(clip.wav).samples, {
        partial: (t) => agent.partial(t),
        segment: (t) => {
          heard.push(t)
          agent.segment(t)
        },
        silence: () => agent.utteranceEnd(),
      })
    })
    if (result.ok) passed++
    report(`${scenario!.name}  ${clip.id}`, result)
    console.log(`   heard: "${heard.join(' ')}"${clip.expected ? `\n   said:  "${clip.expected}"` : ''}`)
  }
  console.log(`\n${passed}/${selected.length} clips passed`)
  printUsage()
}
