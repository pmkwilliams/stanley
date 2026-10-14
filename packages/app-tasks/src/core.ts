import { defineApp, type AgentNode } from '@stanley/app-sdk'

export interface Task {
  id: string
  title: string
  done: boolean
}

export interface TasksState {
  tasks: Task[]
  /** `list` or `item/<id>` */
  route: string
  nextId: number
  /** Text in the "New task" box, not yet added. */
  newTitle: string
}

/** The add box's placeholder, which is also its label. */
export const FIELD = 'New task'

/** Open tasks first, then the completed ones, each in the order they were added. */
export function sections(tasks: Task[]): { open: Task[]; done: Task[] } {
  return { open: tasks.filter((t) => !t.done), done: tasks.filter((t) => t.done) }
}

/** The bar's count: how many tasks are still open. */
export function remaining(tasks: Task[]): number {
  return tasks.filter((t) => !t.done).length
}

const seed: Task[] = [
  { id: 't1', title: 'Book dentist appointment', done: false },
  { id: 't2', title: 'Buy oat milk', done: false },
  { id: 't3', title: 'Send slides to Priya', done: true },
  { id: 't4', title: 'Renew passport', done: false },
]

export const tasksApp = defineApp<TasksState>({
  id: 'tasks',
  title: 'Tasks',
  description: 'Task list: add, complete and delete tasks',

  init: () => ({ tasks: structuredClone(seed), route: 'list', nextId: seed.length + 1, newTitle: '' }),

  current: (s) => s.route,

  nodes(s) {
    // As on screen: the open tasks, the "New task" box (Enter adds), then a "Completed" section.
    const field: AgentNode = {
      id: 'title',
      kind: 'input',
      label: FIELD,
      value: s.newTitle,
      children: s.newTitle ? [{ id: 'add', kind: 'action', role: 'key', label: 'press Enter' }] : [],
    }
    const row = (t: Task): AgentNode => ({
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
    const { open, done } = sections(s.tasks)
    const completed: AgentNode[] = done.length ? [{ id: 'completed', kind: 'group', label: 'Completed', children: done.map(row) }] : []
    return [...open.map(row), field, ...completed]
  },

  async perform(s, nodeId, args) {
    if (nodeId === 'list') return { state: { ...s, route: 'list' }, summary: 'Opened task list' }

    if (nodeId === 'title') {
      const newTitle = args.text?.trim() ?? ''
      return { state: { ...s, newTitle, route: 'list' }, summary: newTitle ? `"${newTitle}" is in the box, not added yet` : 'The box is empty' }
    }
    if (nodeId === 'add') {
      const title = s.newTitle.trim()
      if (!title) return { state: s, summary: 'No task typed; nothing added' }
      const task = { id: `t${s.nextId}`, title, done: false }
      return {
        state: { ...s, tasks: [...s.tasks, task], nextId: s.nextId + 1, route: 'list', newTitle: '' },
        summary: `Added task "${title}"`,
      }
    }

    const [, id, verb] = nodeId.split('/')
    const task = s.tasks.find((t) => t.id === id)
    if (!task) return { state: s, summary: `No such task ${id}` }

    if (!verb) return { state: { ...s, route: nodeId }, summary: `Selected "${task.title}"` }
    if (verb === 'toggle') {
      const tasks = s.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
      return { state: { ...s, tasks }, summary: `Marked "${task.title}" ${task.done ? 'not done' : 'done'}` }
    }
    if (verb === 'delete') {
      return { state: { ...s, tasks: s.tasks.filter((t) => t.id !== id), route: 'list' }, summary: `Deleted "${task.title}"` }
    }
    return { state: s, summary: `Unknown action ${nodeId}` }
  },

  toMarkdown(s) {
    const selected = s.route.startsWith('item/') ? s.tasks.find((t) => `item/${t.id}` === s.route) : undefined
    const { open, done } = sections(s.tasks)
    const item = (t: Task) => `- [${t.done ? 'x' : ' '}] ${t.title}`
    const count = remaining(s.tasks)
    const parts = [
      `# Tasks${count ? ` (${count})` : ''}`,
      s.tasks.length ? open.map(item).join('\n') : 'No tasks',
      `[${FIELD}: ${s.newTitle || 'empty'}]`,
      done.length ? `## Completed\n${done.map(item).join('\n')}` : '',
      selected ? `Selected: ${selected.title}` : '',
    ]
    return parts.filter(Boolean).join('\n\n')
  },
})

export default tasksApp
