import { describe, expect, it } from 'vitest'
import { Conversation } from '../src/conversation'
import type { FileMeta } from '../src/files'
import { narrate } from '../src/narrate'
import { parseSkill, skillBody, skillChanges, skillsPrompt, type SkillScan } from '../src/skills'

const windDown = `---
name: wind-down
description: When the user says they're winding down for the night.
---

# Wind down

1. Open Music and press Pause.
`

describe('parseSkill', () => {
  it('reads the name and description from the front matter', () => {
    expect(parseSkill('wind-down', windDown)).toEqual({ name: 'wind-down', description: "When the user says they're winding down for the night.", path: '.agents/skills/wind-down/SKILL.md' })
  })

  it('reads quoted, folded and literal descriptions, and values that go on over lines', () => {
    const description = (value: string) => (parseSkill('x', `---\nname: x\ndescription: ${value}\n---\nDo it.`) as { description?: string }).description
    expect(description(`"Say \\"hi\\": always"`)).toBe('Say "hi": always')
    expect(description(`'It''s for: mornings'`)).toBe("It's for: mornings")
    expect(description('>\n  When the user\n  says hello.')).toBe('When the user says hello.')
    expect(description('|\n  Line one\n  line two')).toBe('Line one line two')
    expect(description('When the user\n  says hello.')).toBe('When the user says hello.')
    expect(description('For C# and F# # a comment')).toBe('For C# and F#')
  })

  it('leaves out nested fields, and takes the folder as the name when there is none', () => {
    expect(parseSkill('notes', `---\nmetadata:\n  description: nested\ndescription: Top\n---\n`)).toEqual({ name: 'notes', description: 'Top', path: '.agents/skills/notes/SKILL.md' })
  })

  it("says why a skill can't be used", () => {
    const error = (folder: string, text: string) => (parseSkill(folder, text) as { error?: string }).error
    expect(error('x', '# Just a heading')).toMatch(/no front matter/)
    expect(error('x', '---\nname: x\n')).toMatch(/no front matter/)
    expect(error('x', '---\nname: x\n---\nDo it.')).toMatch(/no description/)
    expect(error('Wind Down', '---\ndescription: d\n---\n')).toMatch(/lowercase letters/)
    expect(error('x', '---\nname: y\ndescription: d\n---\n')).toMatch(/must be the name of its folder, "x"/)
    expect(error('x', `---\nname: x\ndescription: ${'a'.repeat(1025)}\n---\n`)).toMatch(/1025 characters/)
  })

  it('reads Windows line ends', () => {
    expect(parseSkill('x', '---\r\nname: x\r\ndescription: d\r\n---\r\nDo it.')).toMatchObject({ name: 'x', description: 'd' })
  })
})

describe('skillBody', () => {
  it('is what comes after the front matter', () => {
    expect(skillBody(windDown)).toBe('# Wind down\n\n1. Open Music and press Pause.')
  })
})

describe('skillChanges', () => {
  const skill = (name: string, description = `For ${name}.`) => ({ name, description, path: `.agents/skills/${name}/SKILL.md` })
  const scan = (...skills: ReturnType<typeof skill>[]): SkillScan => ({ skills, broken: [] })

  it('is null when nothing changed, and names what was added, changed and removed', () => {
    expect(skillChanges(scan(skill('a')), scan(skill('a')))).toBeNull()
    expect(skillChanges(scan(skill('a'), skill('b')), scan(skill('a', 'For mornings.'), skill('c')))).toBe('The skills changed: changed when "a" is for: For mornings.; added "c": For c.; removed "b".')
  })

  it("says when a skill can't be used, once", () => {
    const broken: SkillScan = { skills: [], broken: [{ path: '.agents/skills/a/SKILL.md', error: 'it has no description: say what it does and when to use it' }] }
    expect(skillChanges(scan(skill('a')), broken)).toBe("The skills changed: .agents/skills/a/SKILL.md can't be used: it has no description: say what it does and when to use it.")
    expect(skillChanges(broken, broken)).toBeNull()
  })
})

describe('skillsPrompt', () => {
  it('lists the skills, and says when there are none', () => {
    expect(skillsPrompt({ skills: [{ name: 'wind-down', description: 'For bedtime.', path: '' }], broken: [{ path: '.agents/skills/x/SKILL.md', error: 'it has no SKILL.md' }] })).toContain(
      "The skills:\n- wind-down: For bedtime.\n- .agents/skills/x/SKILL.md can't be used: it has no SKILL.md.",
    )
    expect(skillsPrompt({ skills: [], broken: [] })).toContain('There are no skills yet.')
  })
})

describe('narrate skills', () => {
  it('gives the whole skill where it was read last, and only that it was before', () => {
    const h = new Conversation()
    const read = (n: number) => {
      const file: FileMeta = { kind: 'skill', name: 'wind-down', path: '.agents/skills/wind-down/SKILL.md', body: skillBody(windDown) }
      h.stagePair({ toolCallId: `s${n}`, tool: 'bash', input: { command: 'cat' }, by: 'jev' }, { type: 'text', value: windDown }, { toolCallId: `s${n}`, file })
    }
    read(1)
    read(2)
    expect(narrate(h.view(), null)).toBe('## Conversation\nWren read its skill "wind-down".\nWren read its skill "wind-down":\n  # Wind down\n  \n  1. Open Music and press Pause.')
  })
})
