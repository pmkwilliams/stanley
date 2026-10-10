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

  init: () => ({ todos: structuredClone(seed), route: 'list', nextId: seed.length + 1 }),

  current: (s) => s.route,

  nodes(s) {
    const items: AgentNode[] = s.todos.map((t) => ({
      id: `item/${t.id}`,
      kind: 'location',
      label: `"${t.title}"`,
      description: t.done ? 'completed task' : 'open task',
      children: [
        { id: `item/${t.id}/toggle`, kind: 'action', label: t.done ? 'mark not done' : 'mark done' },
        { id: `item/${t.id}/delete`, kind: 'action', label: 'delete', destructive: true },
      ],
    }))
    return [
      {
        id: 'list',
        kind: 'location',
        label: 'list',
        description: 'all tasks',
        children: [
          {
            id: 'add',
            kind: 'input',
            label: 'add task',
            description: 'create a new task',
            input: { instructions: 'The title of the new to-do item, short and imperative.' },
          },
          ...items,
        ],
      },
    ]
  },

  async perform(s, nodeId, args) {
    if (nodeId === 'list') return { state: { ...s, route: 'list' }, summary: 'Opened to-do list' }

    if (nodeId === 'add') {
      const title = args.text?.trim()
      if (!title) return { state: s, summary: 'No title given; nothing added' }
      const todo = { id: `t${s.nextId}`, title, done: false }
      return {
        state: { ...s, todos: [...s.todos, todo], nextId: s.nextId + 1, route: 'list' },
        summary: `Added to-do "${title}"`,
      }
    }

    const [, id, verb] = nodeId.split('/')
    const todo = s.todos.find((t) => t.id === id)
    if (!todo) return { state: s, summary: `No such to-do ${id}` }

    if (!verb) return { state: { ...s, route: nodeId }, summary: `Opened "${todo.title}"` }
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
    return open ? `# To-do › ${open.title}\nStatus: ${open.done ? 'done' : 'open'}` : `# To-do\n${list}`
  },
})

export default todoApp
