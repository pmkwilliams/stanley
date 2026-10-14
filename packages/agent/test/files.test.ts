import { describe, expect, it } from 'vitest'
import { bashText } from '../src/files'

describe('bashText', () => {
  it('gives the output, the exit code when it failed, or that there was none', () => {
    expect(bashText({ output: 'hi\n', exitCode: 0 })).toBe('hi')
    expect(bashText({ output: '', exitCode: 0 })).toBe('(no output)')
    expect(bashText({ output: 'nope\n', exitCode: 1 })).toBe('nope\n(exit code 1)')
  })

  it('lists what the command changed in the folder, in place of no output', () => {
    const changes = [
      { kind: 'moved', from: '.stanley/scratch/a.html', path: 'Pages/a.html' },
      { kind: 'deleted', path: 'old.md' },
    ] as const
    expect(bashText({ output: '', exitCode: 0, changes: [...changes] })).toBe('Changes to the folder:\n- moved .stanley/scratch/a.html to Pages/a.html\n- deleted old.md')
    expect(bashText({ output: 'done\n', exitCode: 0, changes: [changes[1]] })).toBe('done\n\nChanges to the folder:\n- deleted old.md')
  })

  it('lists only the first changes of many', () => {
    const changes = Array.from({ length: 25 }, (_, i) => ({ kind: 'added' as const, path: `${i}.md` }))
    const text = bashText({ output: '', exitCode: 0, changes })
    expect(text).toContain('- added 19.md\n… and 5 more')
    expect(text).not.toContain('20.md')
  })
})
