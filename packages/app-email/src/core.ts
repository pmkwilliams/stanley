import { defineApp, type AgentNode } from '@stanley/app-sdk'

export interface Email {
  id: string
  from: string
  address: string
  subject: string
  /** Local ISO time, e.g. `2026-10-09T12:14` */
  date: string
  body: string
  read: boolean
  archived: boolean
}

export interface SentEmail {
  id: string
  to: string
  subject: string
  date: string
  body: string
}

export interface EmailState {
  emails: Email[]
  sent: SentEmail[]
  /** A mailbox (`inbox`, `sent`, `archived`), or the message open in one: `email/<id>` or `sent/<id>`. */
  route: string
  nextSentId: number
  /** Unsent reply text per email id. Typing a reply never sends it; `send` does. */
  drafts: Record<string, string>
}

const seed: Email[] = [
  {
    id: 'm5',
    from: 'GitHub',
    address: 'notifications@github.com',
    subject: '[pmkwilliams/stanley] Email: sidebar layout, avatars, fixed header and reply box (PR #1)',
    date: '2026-10-13T13:05',
    body: "You can view, comment on, or merge this pull request online at:\n\n  https://github.com/pmkwilliams/stanley/pull/1\n\nOverhauls the Email app's layout, from a hand sketch: a sidebar with Inbox / Sent / Archived over a scrolling list, a main pane with a fixed header and reply box, and avatars for every sender.\n\nCommit Summary\n\n  * Email: sidebar layout, avatars, fixed header and reply box\n  * Email: the GitHub email is PR #1\n\nFile Changes (25 files, +430 −210)\n\nPatch Links:\n\n  https://github.com/pmkwilliams/stanley/pull/1.patch\n  https://github.com/pmkwilliams/stanley/pull/1.diff",
    read: true,
    archived: false,
  },
  {
    id: 'm1',
    from: 'Sam Lee',
    address: 'sam.lee@fastmail.com',
    subject: 'Lunch Friday?',
    date: '2026-10-09T11:42',
    body: "Hey! Are you free for lunch on Friday? I was thinking that new ramen place on 5th, around 12:30. Let me know and I'll grab a table.\n\nSam",
    read: false,
    archived: false,
  },
  {
    id: 'm2',
    from: 'Priya Shah',
    address: 'priya@northwind.io',
    subject: 'Q4 roadmap review moved to Tuesday',
    date: '2026-10-09T09:05',
    body: "Hi all,\n\nHeads up that the Q4 roadmap review is moving from Monday to Tuesday at 2pm, same room. Please have your team's top three priorities ready, with rough estimates.\n\nThanks,\nPriya",
    read: false,
    archived: false,
  },
  {
    id: 'm3',
    from: 'Delta Air Lines',
    address: 'no-reply@delta.com',
    subject: 'Your trip to Denver: check-in is open',
    date: '2026-10-08T18:30',
    body: 'Check-in is now open for flight DL 1482, San Francisco (SFO) to Denver (DEN), departing Sunday Oct 11 at 7:15am. Confirmation number: HXQ7RT. Seat 14C.',
    read: false,
    archived: false,
  },
  {
    id: 'm4',
    from: 'Mom',
    address: 'linda.williams@gmail.com',
    subject: 'Photos from the weekend',
    date: '2026-10-08T15:12',
    body: "Hi sweetheart, I finally uploaded the photos from Grandpa's birthday. The one of you and the dog is my favourite. Call me when you get a chance!\n\nLove, Mom",
    read: true,
    archived: false,
  },
  {
    id: 'm6',
    from: 'Alex Romero',
    address: 'alex.romero@acme.co',
    subject: 'Invoice #2291 overdue',
    date: '2026-10-07T10:20',
    body: 'Hi, just a friendly reminder that invoice #2291 for $1,840.00 was due on October 1st. Could you let me know when we can expect payment? The invoice is attached again for convenience.\n\nBest,\nAlex',
    read: false,
    archived: false,
  },
  {
    id: 'm7',
    from: 'Coastal Running Club',
    address: 'hello@coastalrunning.org',
    subject: 'Saturday long run: 10 miles from the pier',
    date: '2026-10-06T19:00',
    body: 'This Saturday we meet at 7am at the pier for a 10 mile out-and-back along the coast path. Pace groups from 8:00 to 10:30 per mile. Coffee afterwards at Driftwood.',
    read: true,
    archived: false,
  },
  {
    id: 'm8',
    from: 'Jordan Kim',
    address: 'jordan.kim@northwind.io',
    subject: 'Can you cover my on-call shift?',
    date: '2026-10-06T08:33',
    body: "Hey, any chance you could take my on-call shift next Wednesday night? I have a family thing. Happy to swap for one of yours later this month.\n\nJordan",
    read: false,
    archived: false,
  },
]

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-10-09T11:42` → `Oct 9` (no locale or timezone dependence). */
export function formatDay(iso: string): string {
  const [, m = '1', d = '1'] = (iso.split('T')[0] ?? '').split('-')
  return `${months[Number(m) - 1]} ${Number(d)}`
}

/** `2026-10-09T11:42` → `Oct 9, 11:42` (no locale or timezone dependence). */
export function formatDate(iso: string): string {
  return `${formatDay(iso)}, ${(iso.split('T')[1] ?? '').slice(0, 5)}`
}

/** The open email, in the inbox or the archive. */
export const openEmail = (s: EmailState) => (s.route.startsWith('email/') ? s.emails.find((e) => `email/${e.id}` === s.route) : undefined)

/** The open sent message. */
export const openSent = (s: EmailState) => (s.route.startsWith('sent/') ? s.sent.find((m) => `sent/${m.id}` === s.route) : undefined)

/** The mailbox on screen. An open email is in whichever one it is filed in. */
export function mailbox(s: EmailState): 'inbox' | 'sent' | 'archived' {
  if (s.route === 'sent' || s.route.startsWith('sent/')) return 'sent'
  if (s.route === 'archived') return 'archived'
  return openEmail(s)?.archived ? 'archived' : 'inbox'
}

/** The visible names and counts of the view switcher, shared by the UI and `nodes()`. */
export function tabs(s: EmailState): { id: 'inbox' | 'sent' | 'archived'; label: string; count: string | undefined; selected: boolean }[] {
  const unread = s.emails.filter((e) => !e.archived && !e.read).length
  const archived = s.emails.filter((e) => e.archived).length
  const view = mailbox(s)
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
  return [
    { id: 'inbox', label: 'Inbox', count: unread ? `${unread} unread` : undefined, selected: view === 'inbox' },
    { id: 'sent', label: 'Sent', count: s.sent.length ? plural(s.sent.length, 'message') : undefined, selected: view === 'sent' },
    { id: 'archived', label: 'Archived', count: archived ? plural(archived, 'message') : undefined, selected: view === 'archived' },
  ]
}

function emailMarkdown(e: Email): string {
  return `# ${e.subject}\nFrom: ${e.from} <${e.address}>\nDate: ${formatDate(e.date)}\n\n${e.body}`
}

function sentMarkdown(m: SentEmail): string {
  return `# ${m.subject}\nTo: ${m.to}\nDate: ${formatDate(m.date)}\n\n${m.body}`
}

function localNow(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const emailApp = defineApp<EmailState>({
  id: 'email',
  title: 'Email',
  description: 'Email inbox: read, archive, delete and reply to messages',

  init: () => ({ emails: structuredClone(seed), sent: [], route: 'inbox', nextSentId: 1, drafts: {} }),

  current: (s) => s.route,

  nodes(s) {
    // As on screen: the sidebar's Inbox / Sent / Archived switcher (each with its count) and the
    // mailbox's messages, then the open message with its buttons and the reply box under it.
    const switcher = tabs(s).map((t): AgentNode => ({
      id: t.id,
      kind: 'location',
      role: 'tab',
      label: t.label,
      description: [t.count, t.selected ? 'selected' : undefined].filter(Boolean).join(', ') || undefined,
    }))
    if (mailbox(s) === 'sent') {
      const open = openSent(s)
      const rows = s.sent.toReversed().map((m): AgentNode => ({
        id: `sent/${m.id}`,
        kind: 'location',
        label: `To ${m.to}: ${m.subject}`,
        description: open?.id === m.id ? 'open' : undefined,
      }))
      if (!open) return [...switcher, ...rows]
      return [...switcher, ...rows, { id: `sent/${open.id}/article`, kind: 'group', role: 'article', label: `"${open.subject}"`, description: `To ${open.to}, ${formatDate(open.date)}` }]
    }
    const open = openEmail(s)
    const rows = s.emails
      .filter((e) => e.archived === (mailbox(s) === 'archived'))
      .map((e): AgentNode => ({
        id: `email/${e.id}`,
        kind: 'location',
        label: `${e.from}: ${e.subject}`,
        description: [e.read ? undefined : 'unread', open?.id === e.id ? 'open' : undefined].filter(Boolean).join(', ') || undefined,
      }))
    if (!open) return [...switcher, ...rows]
    const article: AgentNode = {
      id: `email/${open.id}/article`,
      kind: 'group',
      role: 'article',
      label: `"${open.subject}"`,
      description: `From ${open.from} <${open.address}>, ${formatDate(open.date)}`,
      children: [
        { id: `email/${open.id}/unread`, kind: 'action', label: 'Mark unread' },
        open.archived ? { id: `email/${open.id}/restore`, kind: 'action', label: 'Move to Inbox' } : { id: `email/${open.id}/archive`, kind: 'action', label: 'Archive' },
        { id: `email/${open.id}/delete`, kind: 'action', label: 'Delete' },
        { id: `email/${open.id}/reply`, kind: 'input', label: `Reply to ${open.from}`, value: s.drafts[open.id] ?? '' },
        { id: `email/${open.id}/send`, kind: 'action', label: 'Send reply' },
      ],
    }
    return [...switcher, ...rows, article]
  },

  async perform(s, nodeId, args) {
    if (nodeId === 'inbox') return { state: { ...s, route: 'inbox' }, summary: 'Opened inbox' }
    if (nodeId === 'sent') return { state: { ...s, route: 'sent' }, summary: 'Opened sent mail' }
    if (nodeId === 'archived') return { state: { ...s, route: 'archived' }, summary: 'Opened archived mail' }

    if (nodeId.startsWith('sent/')) {
      const sent = s.sent.find((m) => `sent/${m.id}` === nodeId)
      if (!sent) return { state: s, summary: `No such sent message ${nodeId}` }
      return { state: { ...s, route: nodeId }, summary: `Opened "${sent.subject}" to ${sent.to}`, observation: sentMarkdown(sent) }
    }

    const [, id, verb] = nodeId.split('/')
    const email = s.emails.find((e) => e.id === id)
    if (!email) return { state: s, summary: `No such email ${id}` }
    const label = `"${email.subject}" from ${email.from}`
    const isOpen = s.route === `email/${id}`

    if (!verb) {
      const emails = s.emails.map((e) => (e.id === id ? { ...e, read: true } : e))
      return { state: { ...s, emails, route: nodeId }, summary: `Opened ${label}`, observation: emailMarkdown(email) }
    }
    if (verb === 'unread') {
      const emails = s.emails.map((e) => (e.id === id ? { ...e, read: false } : e))
      return { state: { ...s, emails }, summary: `Marked ${label} unread` }
    }
    // Filing an open email away leaves its mailbox on screen, not the email in its new one.
    if (verb === 'archive') {
      const emails = s.emails.map((e) => (e.id === id ? { ...e, archived: true } : e))
      return { state: { ...s, emails, route: isOpen ? 'inbox' : s.route }, summary: `Archived ${label}` }
    }
    if (verb === 'restore') {
      const emails = s.emails.map((e) => (e.id === id ? { ...e, archived: false } : e))
      return { state: { ...s, emails, route: isOpen ? 'archived' : s.route }, summary: `Moved ${label} back to the inbox` }
    }
    if (verb === 'delete') {
      const { [id!]: _, ...drafts } = s.drafts
      const route = isOpen ? (email.archived ? 'archived' : 'inbox') : s.route
      return { state: { ...s, emails: s.emails.filter((e) => e.id !== id), drafts, route }, summary: `Deleted ${label}` }
    }
    if (verb === 'reply') {
      const body = args.text?.trim() ?? ''
      const { [id!]: _, ...rest } = s.drafts
      const drafts = body ? { ...s.drafts, [id!]: body } : rest
      const summary = body ? `Drafted a reply to ${email.from} (not sent): "${body}"` : `Cleared the reply to ${email.from}`
      return { state: { ...s, drafts, route: `email/${id}` }, summary }
    }
    if (verb === 'send') {
      const body = s.drafts[id!]?.trim()
      if (!body) return { state: s, summary: `No reply drafted to ${email.from}; nothing sent` }
      const reply = { id: `s${s.nextSentId}`, to: email.from, subject: `Re: ${email.subject}`, date: localNow(), body }
      const { [id!]: _, ...drafts } = s.drafts
      // Stay on the email: the reply box empties and Sent's count goes up.
      return {
        state: { ...s, sent: [...s.sent, reply], nextSentId: s.nextSentId + 1, drafts },
        summary: `Reply sent to ${email.from}: "${reply.subject}"`,
      }
    }
    return { state: s, summary: `Unknown action ${nodeId}` }
  },

  toMarkdown(s) {
    if (mailbox(s) === 'sent') {
      const open = openSent(s)
      if (open) return `# Email › Sent › ${open.subject}\nTo: ${open.to}\nDate: ${formatDate(open.date)}\n\n${open.body}`
      const sent = s.sent.toReversed().map((m) => `- To ${m.to}: "${m.subject}" (${formatDate(m.date)})`).join('\n')
      return `# Email › Sent\n${sent || '_No sent mail_'}`
    }
    const open = openEmail(s)
    if (open) {
      const reply = `[Reply to ${open.from}: ${s.drafts[open.id] || 'empty'}] [Send reply]`
      return `# Email › ${open.subject}\nFrom: ${open.from} <${open.address}>\nDate: ${formatDate(open.date)}\n\n${open.body}\n\n${reply}`
    }
    const archived = mailbox(s) === 'archived'
    const list = s.emails
      .filter((e) => e.archived === archived)
      .map((e) => `- ${e.read ? '' : '**[unread]** '}"${e.subject}" from ${e.from}, ${formatDate(e.date)}`)
      .join('\n')
    return archived ? `# Email › Archived\n${list || '_Nothing archived_'}` : `# Email › Inbox\n${list || '_No messages_'}`
  },
})

export default emailApp
