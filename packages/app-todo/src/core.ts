import { defineApp, type AgentNode } from '@stanley/app-sdk'

export interface Todo {
  id: string
  title: string
  done: boolean
}

export interface TodoState {
  todos: Todo[]
  /** `list` or `item/<id>` */
  route: string
  nextId: number
  /** Text in the "New to-do" box, not yet added. */
  newTitle: string
}

/** The add box's placeholder, which is also its label. */
export const FIELD = 'New to-do'

/** Open to-dos first, then the completed ones, each in the order they were added. */
export function sections(todos: Todo[]): { open: Todo[]; done: Todo[] } {
  return { open: todos.filter((t) => !t.done), done: todos.filter((t) => t.done) }
}

/** The bar's count: "3 remaining", "All done", or nothing when the list is empty. */
export function remaining(todos: Todo[]): string {
  if (!todos.length) return ''
  const n = todos.filter((t) => !t.done).length
  return n ? `${n} remaining` : 'All done'
}

const seed: Todo[] = [
  { id: 't1', title: 'Book dentist appointment', done: false },
  { id: 't2', title: 'Buy oat milk', done: false },
  { id: 't3', title: 'Send slides to Priya', done: true },
  { id: 't4', title: 'Renew passport', done: false },
]

export const todoApp = defineApp<TodoState>({
  id: 'todo',
  title: 'To-do',
  description: 'To-do list: add, complete and delete tasks',

  init: () => ({ todos: structuredClone(seed), route: 'list', nextId: seed.length + 1, newTitle: '' }),

  current: (s) => s.route,

  nodes(s) {
    // As on screen: the "New to-do" box (Enter adds), the open to-dos, then a "Completed" section.
    const field: AgentNode = {
      id: 'title',
      kind: 'input',
      label: FIELD,
      value: s.newTitle,
      children: s.newTitle ? [{ id: 'add', kind: 'action', role: 'key', label: 'press Enter' }] : [],
    }
    const row = (t: Todo): AgentNode => ({
      id: `item/${t.id}`,
      kind: 'location',
      role: 'button',
      label: t.title,
      description: s.route === `item/${t.id}` ? 'selected' : undefined,
      children: [
        { id: `item/${t.id}/toggle`, kind: 'action', role: 'checkbox', label: 'checkbox', description: t.done ? 'checked' : 'not checked' },
        { id: `item/${t.id}/delete`, kind: 'action', label: 'Delete' },
      ],
    })
    const { open, done } = sections(s.todos)
    const completed: AgentNode[] = done.length ? [{ id: 'completed', kind: 'group', label: 'Completed', children: done.map(row) }] : []
    return [field, ...open.map(row), ...completed]
  },

  async perform(s, nodeId, args) {
    if (nodeId === 'list') return { state: { ...s, route: 'list' }, summary: 'Opened to-do list' }

    if (nodeId === 'title') {
      const newTitle = args.text?.trim() ?? ''
      return { state: { ...s, newTitle, route: 'list' }, summary: newTitle ? `"${newTitle}" is in the box, not added yet` : 'The box is empty' }
    }
    if (nodeId === 'add') {
      const title = s.newTitle.trim()
      if (!title) return { state: s, summary: 'No task typed; nothing added' }
      const todo = { id: `t${s.nextId}`, title, done: false }
      return {
        state: { ...s, todos: [...s.todos, todo], nextId: s.nextId + 1, route: 'list', newTitle: '' },
        summary: `Added to-do "${title}"`,
      }
    }

    const [, id, verb] = nodeId.split('/')
    const todo = s.todos.find((t) => t.id === id)
    if (!todo) return { state: s, summary: `No such to-do ${id}` }

    if (!verb) return { state: { ...s, route: nodeId }, summary: `Selected "${todo.title}"` }
    if (verb === 'toggle') {
      const todos = s.todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
      return { state: { ...s, todos }, summary: `Marked "${todo.title}" ${todo.done ? 'not done' : 'done'}` }
    }
    if (verb === 'delete') {
      return { state: { ...s, todos: s.todos.filter((t) => t.id !== id), route: 'list' }, summary: `Deleted "${todo.title}"` }
    }
    return { state: s, summary: `Unknown action ${nodeId}` }
  },

  toMarkdown(s) {
    const selected = s.route.startsWith('item/') ? s.todos.find((t) => `item/${t.id}` === s.route) : undefined
    const { open, done } = sections(s.todos)
    const item = (t: Todo) => `- [${t.done ? 'x' : ' '}] ${t.title}`
    const count = remaining(s.todos)
    const parts = [
      `# To-do${count ? `\n${count}` : ''}`,
      `[${FIELD}: ${s.newTitle || 'empty'}]`,
      s.todos.length ? open.map(item).join('\n') : 'No to-dos',
      done.length ? `## Completed\n${done.map(item).join('\n')}` : '',
      selected ? `Selected: ${selected.title}` : '',
    ]
    return parts.filter(Boolean).join('\n\n')
  },
})

export default todoApp
