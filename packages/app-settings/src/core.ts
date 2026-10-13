import { DEFAULT_AGENT_NAME, defineApp, type AgentNode, type AppStore } from '@stanley/app-sdk'

export type Theme = 'dark' | 'light'

export const THEMES: { id: Theme; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
]

/** The name field's label. */
export const NAME_LABEL = 'Name'

/** Everything the user can set. Saved in the shell's store, so it outlasts a session and a restart. */
export interface Settings {
  theme: Theme
  /** What the assistant is called: in what it says, what it hears, and on the lock screen. */
  name: string
}

/** The saved settings, with the defaults for any never set. A blank name is the default one. */
export function readSettings(store: AppStore | undefined): Settings {
  const name = store?.get('name')
  return {
    theme: store?.get('theme') === 'light' ? 'light' : 'dark',
    name: (typeof name === 'string' && name.trim()) || DEFAULT_AGENT_NAME,
  }
}

/** `name` is the field's text, which may be blank while the user retypes it. */
export type SettingsState = Settings

export const settingsApp = defineApp<SettingsState>({
  id: 'settings',
  title: 'Settings',
  description: "Settings: the assistant's name, and appearance (light or dark theme)",

  init: (ctx) => readSettings(ctx.store),

  current: () => 'home',

  nodes(s) {
    const assistant: AgentNode = {
      id: 'assistant',
      kind: 'group',
      label: 'Assistant',
      children: [{ id: 'name', kind: 'input', label: NAME_LABEL, value: s.name }],
    }
    const appearance: AgentNode = {
      id: 'appearance',
      kind: 'group',
      label: 'Appearance',
      children: THEMES.map((t) => ({
        id: `theme/${t.id}`,
        kind: 'action',
        role: 'radio',
        label: t.label,
        description: s.theme === t.id ? 'selected' : 'not selected',
      })),
    }
    return [assistant, appearance]
  },

  async perform(s, nodeId, args, ctx) {
    if (nodeId === 'home') return { state: s, summary: 'Opened settings' }
    if (nodeId === 'name') {
      const text = args.text ?? ''
      ctx.store?.set('name', text.trim())
      const name = text.trim() || DEFAULT_AGENT_NAME
      return { state: { ...s, name: text }, summary: text.trim() ? `The assistant is now called ${name}` : `The assistant is called ${name} again` }
    }
    const theme = THEMES.find((t) => nodeId === `theme/${t.id}`)
    if (!theme) return { state: s, summary: `Unknown action ${nodeId}` }
    if (s.theme === theme.id) return { state: s, summary: `The theme is already ${theme.label.toLowerCase()}` }
    ctx.store?.set('theme', theme.id)
    return { state: { ...s, theme: theme.id }, summary: `Switched to the ${theme.label.toLowerCase()} theme` }
  },

  toMarkdown(s) {
    const options = THEMES.map((t) => `(${s.theme === t.id ? '•' : ' '}) ${t.label}`).join('  ')
    return `# Settings\n## Assistant\n[${NAME_LABEL}: ${s.name || 'empty'}]\n## Appearance\nTheme: ${options}`
  },
})

export default settingsApp
