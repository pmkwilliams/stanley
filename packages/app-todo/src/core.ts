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
  /** Text in the "add a task" box, not yet added. */
  newTitle: string
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
    // As on screen: the "Add a task" box (Enter adds), then one row per task.
    const field: AgentNode = {
      id: 'title',
      kind: 'input',
      label: 'Add a task',
      value: s.newTitle,
      children: s.newTitle ? [{ id: 'add', kind: 'action', role: 'key', label: 'press Enter' }] : [],
    }
    const rows: AgentNode[] = s.todos.map((t) => ({
      id: `item/${t.id}`,
      kind: 'location',
      role: 'button',
      label: t.title,
      description: s.route === `item/${t.id}` ? 'selected' : undefined,
      children: [
        { id: `item/${t.id}/toggle`, kind: 'action', role: 'checkbox', label: 'checkbox', description: t.done ? 'checked' : 'not checked' },
        { id: `item/${t.id}/delete`, kind: 'action', label: 'Delete' },
      ],
    }))
    return [field, ...rows]
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
    const open = s.route.startsWith('item/') ? s.todos.find((t) => `item/${t.id}` === s.route) : undefined
    const list = s.todos.map((t) => `- [${t.done ? 'x' : ' '}] ${t.title}`).join('\n') || '_No tasks_'
    const selected = open ? `\n\nSelected: ${open.title}` : ''
    return `# To-do\n[Add a task: ${s.newTitle || 'empty'}]\n\n${list}${selected}`
  },
})

export default todoApp
