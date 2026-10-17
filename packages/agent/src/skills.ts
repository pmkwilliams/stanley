/**
 * Skills: what the user taught Stanley (how they like something done, what to do when they say
 * something), written down once in the Agent Skills format that coding agents use. Each is a folder
 * in `.agents/skills` in the user's folder, which is the agent's home: `~/.agents/skills` to it.
 */

/** A skill that can be used. */
export interface Skill {
  /** Its folder's name: lowercase letters, numbers and hyphens. */
  name: string
  /** What it does and when to use it: how a request finds it. */
  description: string
  /** Its SKILL.md, from the top of the user's folder. */
  path: string
}

/** A skill's folder whose SKILL.md can't be used, and why. */
export interface BrokenSkill {
  path: string
  error: string
}

/** The skills in the user's folder, as they are on disk. */
export interface SkillScan {
  skills: Skill[]
  broken: BrokenSkill[]
}

/** Where skills are, from the top of the user's folder. */
export const SKILLS_DIR = '.agents/skills'

export const NO_SKILLS: SkillScan = { skills: [], broken: [] }

/** A skill's SKILL.md, from the top of the user's folder. */
export function skillPath(folder: string): string {
  return `${SKILLS_DIR}/${folder}/SKILL.md`
}

/** How many characters of a skill's body Jev reads. */
const MAX_BODY = 8000

/**
 * A SKILL.md in folder `folder`: its front matter's name (which must be the folder's) and
 * description, or why it can't be used.
 */
export function parseSkill(folder: string, text: string): Skill | BrokenSkill {
  const path = skillPath(folder)
  const parts = split(text)
  if (!parts) return { path, error: 'it has no front matter: it must start with a line of ---, then name: and description:, then another ---' }
  const fields = frontMatter(parts.head)
  const name = fields.name?.trim() || folder
  const description = fields.description?.replace(/\s+/g, ' ').trim() ?? ''
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64) return { path, error: `its name, "${name}", must be lowercase letters, numbers and single hyphens, at most 64 characters` }
  if (name !== folder) return { path, error: `its name, "${name}", must be the name of its folder, "${folder}"` }
  if (!description) return { path, error: 'it has no description: say what it does and when to use it' }
  if (description.length > 1024) return { path, error: `its description is ${description.length} characters: at most 1024` }
  return { name, description, path }
}

/** What a SKILL.md says to do: everything after its front matter. */
export function skillBody(text: string): string {
  const body = (split(text)?.body ?? text).trim()
  return body.length > MAX_BODY ? `${body.slice(0, MAX_BODY).trimEnd()}…` : body
}

/** The front matter and the rest, or null when it has none. */
function split(text: string): { head: string; body: string } | null {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  if (lines[0]?.trim() !== '---') return null
  const end = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l))
  if (end === -1) return null
  return { head: lines.slice(1, end).join('\n'), body: lines.slice(end + 1).join('\n') }
}

/**
 * The front matter's top-level fields, as strings. YAML as skills write it: plain, quoted, folded
 * (`>`) and literal (`|`) values, and plain values that go on over indented lines. Anything nested
 * (`metadata:` and the like) is left out.
 */
function frontMatter(head: string): Record<string, string> {
  const fields: Record<string, string> = {}
  const lines = head.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z][\w-]*):(?:\s+(.*))?$/.exec(lines[i]!)
    if (!m) continue
    let value = (m[2] ?? '').trim()
    // The lines that go on from it: indented, or blank inside a block.
    const more: string[] = []
    while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]!) || (lines[i + 1]!.trim() === '' && more.length))) more.push(lines[++i]!)
    const block = /^([|>])[-+]?\d*$/.exec(value)
    if (block) {
      const indent = Math.min(...more.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length))
      const kept = more.map((l) => l.slice(indent))
      value = block[1] === '|' ? kept.join('\n').trim() : kept.map((l) => l.trim()).join(' ')
    } else {
      value = [value, ...more.map((l) => l.trim())].filter(Boolean).join(' ')
      const quoted = /^(["'])([\s\S]*)\1$/.exec(value)
      if (quoted) value = quoted[1] === "'" ? quoted[2]!.replace(/''/g, "'") : quoted[2]!.replace(/\\(["\\n])/g, (_, c: string) => (c === 'n' ? '\n' : c))
      else value = value.replace(/\s+#.*$/, '')
    }
    // Something nested (only indented lines after the key) isn't a value.
    if (!m[2] && !block && more.some((l) => /^\s+[\w-]+:/.test(l))) continue
    fields[m[1]!] = value
  }
  return fields
}

/** For thinking, when the session has the user's files: the skills as they were when it started. */
export function skillsPrompt(scan: SkillScan): string {
  return [
    `## Skills
Skills are in ~/.agents/skills, in the Agent Skills format: a folder for each, with a SKILL.md. When a request is one a skill is for, read its SKILL.md with \`bash\` first, unless it is already in the conversation, and follow it.`,
    skillList(scan),
  ].join('\n')
}

function skillList(scan: SkillScan): string {
  if (!scan.skills.length && !scan.broken.length) return 'There are no skills yet.'
  return [
    'The skills:',
    ...scan.skills.map((s) => `- ${s.name}: ${s.description}`),
    ...scan.broken.map((b) => `- ${b.path} can't be used: ${b.error}.`),
  ].join('\n')
}

/** For Jev, when there are skills. */
export const JEV_SKILLS = `You have skills, each described by when it is for. When the user asks for something a skill is for, you read it first, in the background, and it is in the conversation from then on. Then do what the skill says, a step at a time.`

/** How the skills changed from `before` to `after`, as a sentence, or null when they didn't. */
export function skillChanges(before: SkillScan, after: SkillScan): string | null {
  const was = new Map(before.skills.map((s) => [s.name, s]))
  const is = new Map(after.skills.map((s) => [s.name, s]))
  const wasBroken = new Map(before.broken.map((b) => [b.path, b.error]))
  const changes: string[] = []
  for (const s of after.skills) {
    const old = was.get(s.name)
    if (!old) changes.push(`added "${s.name}": ${s.description}`)
    else if (old.description !== s.description) changes.push(`changed when "${s.name}" is for: ${s.description}`)
  }
  for (const s of before.skills) if (!is.has(s.name) && !after.broken.some((b) => b.path === s.path)) changes.push(`removed "${s.name}"`)
  for (const b of after.broken) if (wasBroken.get(b.path) !== b.error) changes.push(`${b.path} can't be used: ${b.error}`)
  return changes.length ? `The skills changed: ${changes.join('; ').replace(/\.$/, '')}.` : null
}
