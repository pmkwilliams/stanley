import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { localFiles } from '../src/index'

function setup(opts: { timeoutMs?: number; maxOutput?: number } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'stanley-files-test-')))
  const root = join(dir, 'Stanley')
  const history = join(dir, 'history.git')
  return { files: localFiles({ root, history, ...opts }), root, history, dir }
}

const log = (history: string) => execFileSync('git', ['--git-dir', history, 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n')

describe.runIf(process.platform === 'darwin')('localFiles', () => {
  it('runs bash in the folder, with output and exit code', async () => {
    const { files, root } = setup()
    writeFileSync(join(root, 'packing.md'), '- Passport\n- Charger\n')
    expect(await files.bash('ls -p && cat packing.md')).toEqual({ output: 'packing.md\n- Passport\n- Charger\n', exitCode: 0 })
    expect(await files.bash('cat missing.md')).toEqual({ output: 'cat: missing.md: No such file or directory\n', exitCode: 1 })
    expect((await files.bash('echo $HOME')).output.trim()).toBe(realpathSync(root))
  })

  it('writes and reads files by any path that is in the folder, and keeps each write', async () => {
    const { files, root, history, dir } = setup()
    await files.write!('Pages/water.html', '<h1>Water</h1>')
    expect(readFileSync(join(root, 'Pages/water.html'), 'utf8')).toBe('<h1>Water</h1>')
    expect(await files.read!(`${root}/Pages/water.html`)).toBe('<h1>Water</h1>')
    await files.write!('./Pages/water.html', '<h1>Rain</h1>')
    expect(log(history)[0]).toBe('Stanley wrote Pages/water.html')
    await expect(files.write!('../outside.html', 'x')).rejects.toThrow("isn't in the user's folder")
    symlinkSync(dir, join(root, 'out'))
    await expect(files.write!('out/escape.html', 'x')).rejects.toThrow("isn't in the user's folder")
    expect(existsSync(join(dir, 'escape.html'))).toBe(false)
    await expect(files.read!('gone.html')).rejects.toThrow()
  })

  it('finds the skills in .agents/skills, and says why one can\'t be used', async () => {
    const { files, root } = setup()
    expect(await files.skills!()).toEqual({ skills: [], broken: [] })
    await files.write!('~/.agents/skills/wind-down/SKILL.md', '---\nname: wind-down\ndescription: For bedtime.\n---\nPause the music.\n')
    expect(existsSync(join(root, '.agents/skills/wind-down/SKILL.md'))).toBe(true)
    await files.bash('mkdir -p .agents/skills/empty .agents/skills/bad && printf -- "---\nname: bad\n---\n" > .agents/skills/bad/SKILL.md')
    expect(await files.skills!()).toEqual({
      skills: [{ name: 'wind-down', description: 'For bedtime.', path: '.agents/skills/wind-down/SKILL.md' }],
      broken: [
        { path: '.agents/skills/bad/SKILL.md', error: 'it has no description: say what it does and when to use it' },
        { path: '.agents/skills/empty/SKILL.md', error: 'it has no SKILL.md' },
      ],
    })
    expect(await files.paths()).toEqual([])
  })

  it('keeps scratch until it starts again, and out of the history', async () => {
    const { files, root, history } = setup()
    await files.write!('.stanley/scratch/sea.html', '<h1>Sea</h1>')
    await files.write!('Pages/rain.html', '<h1>Rain</h1>')
    expect(execFileSync('git', ['--git-dir', history, 'ls-files'], { encoding: 'utf8' })).toBe('Pages/rain.html\n')
    localFiles({ root, history })
    expect(existsSync(join(root, '.stanley/scratch/sea.html'))).toBe(false)
    expect(existsSync(join(root, 'Pages/rain.html'))).toBe(true)
  })

  it('gives every file and folder in it, without hidden ones, those nearest the top when there are too many', async () => {
    const { files, root, history } = setup()
    await files.bash('mkdir -p Trips/.cache && touch Trips/packing.md Trips/.cache/x .hidden budget.csv')
    expect(await files.paths()).toEqual(['Trips/', 'Trips/packing.md', 'budget.csv'])
    await files.bash('mkdir -p A/B && touch A/B/1 A/B/2 A/B/3')
    expect(await localFiles({ root, history, maxPaths: 3 }).paths()).toEqual(['A/', 'Trips/', 'budget.csv'])
  })

  it("can't write outside the folder, read the user's home, or reach the network", async () => {
    const { files, dir } = setup()
    const outside = join(dir, 'outside.txt')
    expect((await files.bash(`echo hi > ${outside}`)).exitCode).not.toBe(0)
    expect(existsSync(outside)).toBe(false)
    expect((await files.bash(`ls ${homedir()}/Library`)).exitCode).not.toBe(0)
    expect((await files.bash('curl -sS -m 5 https://example.com')).exitCode).not.toBe(0)
  })

  it('keeps every version: what the user changed, then what each command did', async () => {
    const { files, root, history } = setup()
    writeFileSync(join(root, 'note.md'), 'first\n')
    await files.bash('echo second > note.md')
    await files.bash('ls')
    expect(log(history)).toEqual(['Stanley ran: echo second > note.md', 'Changes made outside Stanley'])
    // Commands can read the history, to bring back an earlier version.
    await files.bash('git --git-dir="$STANLEY_HISTORY" show HEAD~1:note.md > note.md')
    expect(readFileSync(join(root, 'note.md'), 'utf8')).toBe('first\n')
    // ...but not change it.
    expect((await files.bash('touch "$STANLEY_HISTORY/x"')).exitCode).not.toBe(0)
  })

  it('stops a command that runs too long, or is aborted', async () => {
    const { files } = setup({ timeoutMs: 300 })
    const slow = await files.bash('echo started; sleep 10')
    expect(slow.exitCode).toBe(124)
    expect(slow.output).toContain('started\n(stopped: it ran longer than 0.3 s)')
    const controller = new AbortController()
    const run = files.bash('sleep 10', controller.signal)
    setTimeout(() => controller.abort(), 50)
    await expect(run).rejects.toBeDefined()
  })

  it('keeps the start and end of long output, and none of binary output', async () => {
    const { files } = setup({ maxOutput: 100 })
    const long = await files.bash('seq 1 1000')
    expect(long.output.startsWith('1\n2\n')).toBe(true)
    expect(long.output.trimEnd().endsWith('999\n1000')).toBe(true)
    expect(long.output).toContain('the middle was left out')
    expect((await files.bash('head -c 64 /dev/urandom; printf "\\0"')).output).toMatch(/^\(binary output, \d+ bytes\)$/)
  })
})
