/**
 * Voice scenario evals: like `pnpm eval`, but the utterance is a recorded clip played through
 * the real transcriber at real speed. A clip runs against the scenario named in its label;
 * for multi-turn scenarios, the clip replaces the last utterance and earlier ones are typed.
 *
 *   pnpm eval:voice              # list clips with a scenario (runs nothing)
 *   pnpm eval:voice tasks        # clips whose id or scenario contains a filter
 *   pnpm eval:voice --all
 *   pnpm eval:voice --say --all  # no clips: speak each scenario with macOS \`say\` instead
 *
 * --say makes the timing real (partials, pauses, segment ends, the silence end) without
 * recordings. A synthetic voice is cleaner than yours, so it doesn't measure accuracy.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { screenVocabulary } from '@stanley/agent'
import { readWav } from '@stanley/stt'
import { listClips, type Clip } from './speech/clips.mts'
import { playRealtime } from './speech/feed.mts'
import { loadEnv, printUsage, report, runScenario, select, typeUtterance } from './harness.mts'
import { scenarios } from './scenarios.mts'

const cases = process.argv.includes('--say')
  ? scenarios.map((scenario) => ({ clip: spoken(scenario.name, scenario.utterances.at(-1)!), scenario }))
  : listClips()
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
    const pauses: (number | null)[] = []
    const result = await runScenario({ ...scenario!, utterances: [...scenario!.utterances.slice(0, last), clip.expected ?? clip.heard] }, async (agent, utterance, i, turn, world) => {
      if (i < last) return typeUtterance(agent, utterance, i, turn)
      let cutIns = 0
      // Speech after the agent ended the turn starts a new utterance, as in the app.
      const open = () => {
        if (agent.turnOpen) return
        cutIns++
        agent.utteranceStart()
      }
      agent.utteranceStart()
      const { lastWordAt } = await playRealtime(
        readWav(clip.wav).samples,
        {
          partial: (t, words) => {
            open()
            agent.partial(t, words)
          },
          segment: (t, words) => {
            open()
            heard.push(t)
            agent.segment(t, words)
          },
          speaking: (on) => agent.voice(on),
          pause: (p) => {
            pauses.push(p.complete)
            agent.pause(p)
          },
          silence: () => agent.utteranceEnd(),
        },
        { ended: () => !agent.turnOpen, hotwords: screenVocabulary(await world.screen(), world.appList()) },
      )
      return { lastWordAt, cutIns }
    })
    if (result.ok) passed++
    report(`${scenario!.name}  ${clip.id}`, result)
    console.log(`   heard: "${heard.join(' ')}"${clip.expected ? `\n   said:  "${clip.expected}"` : ''}`)
    console.log(`   pauses (voice P finished): ${pauses.map((p) => (p === null ? '?' : p.toFixed(2))).join(', ') || 'none'} · turn ended ${(result.endMs.at(-1)! / 1000).toFixed(1)}s after the last word`)
  }
  console.log(`\n${passed}/${selected.length} clips passed`)
  printUsage()
}

/** A clip of `text` in a synthetic voice, with a natural pause around filler words. */
function spoken(name: string, text: string): Clip {
  const dir = (spoken.dir ??= mkdtempSync(join(tmpdir(), 'stanley-say-')))
  const wav = join(dir, `${name}.wav`)
  // A mic hears a moment of silence before speech starts; a pause sits around filler words.
  // A `|` in a scenario is a pause mid-thought.
  const script = `[[slnc 500]] ${text.replace(/\b(um|uh|hmm)\b/gi, '[[slnc 700]] $1 [[slnc 700]]').replace(/\s*\|\s*/g, ' [[slnc 800]] ')}`
  execFileSync('say', ['-o', wav, '--file-format=WAVE', '--data-format=LEI16@16000', script])
  const plain = text.replace(/\s*\|\s*/g, ' ')
  return { id: `say:${name}`, wav, heard: plain, expected: plain, scenario: name } as Clip
}
spoken.dir = '' as string

