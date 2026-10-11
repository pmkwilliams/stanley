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
  /** `inbox`, `sent` or `email/<id>` */
  route: string
  nextSentId: number
  /** Unsent reply text per email id. Typing a reply never sends it; `send` does. */
  drafts: Record<string, string>
}

const seed: Email[] = [
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
    id: 'm5',
    from: 'GitHub',
    address: 'noreply@github.com',
    subject: '[stanley] PR #42: Add tick scheduler',
    date: '2026-10-07T22:47',
    body: 'jordan-k requested your review on pull request #42 "Add tick scheduler". 6 files changed, +312 −48. The PR adds stale-result handling and the confidence gate.',
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

/** `2026-10-09T11:42` → `Oct 9, 11:42` (no locale or timezone dependence). */
export function formatDate(iso: string): string {
  const [date = '', time = ''] = iso.split('T')
  const [, m = '1', d = '1'] = date.split('-')
  return `${months[Number(m) - 1]} ${Number(d)}, ${time.slice(0, 5)}`
}

function emailMarkdown(e: Email): string {
  return `# ${e.subject}\nFrom: ${e.from} <${e.address}>\nDate: ${formatDate(e.date)}\n\n${e.body}`
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
    const inbox = s.emails.filter((e) => !e.archived)
    const unread = inbox.filter((e) => !e.read).length
    const items: AgentNode[] = inbox.map((e) => {
      const draft = s.drafts[e.id]
      const send: AgentNode[] = draft
        ? [{ id: `email/${e.id}/send`, kind: 'action', label: `send the reply to ${e.from}`, description: `send the drafted reply: "${draft}"` }]
        : []
      return {
        id: `email/${e.id}`,
        kind: 'location',
        label: `"${e.subject}" from ${e.from}`,
        description: `${e.read ? 'read' : 'unread'} email, ${formatDate(e.date)}${draft ? ', reply drafted' : ''}`,
        children: [
          {
            id: `email/${e.id}/reply`,
            kind: 'input',
            label: draft ? `rewrite the reply to ${e.from}` : `write a reply to ${e.from}`,
            description: `type the reply to "${e.subject}" into the reply box`,
            input: {
              instructions: `The reply to ${e.from} about "${e.subject}", as the user said it: keep their words. If they only described it ("say I'm in"), write it briefly in the first person. No greeting line or signature, and nothing they didn't say.`,
              placeholder: `Reply to ${e.from}`,
            },
          },
          ...send,
          { id: `email/${e.id}/unread`, kind: 'action', label: `mark "${e.subject}" unread` },
          {
            id: `email/${e.id}/archive`,
            kind: 'action',
            label: `archive "${e.subject}"`,
            description: 'remove from the inbox',
            destructive: true,
          },
          {
            id: `email/${e.id}/delete`,
            kind: 'action',
            label: `delete "${e.subject}"`,
            description: 'permanently delete the email',
            destructive: true,
          },
        ],
      }
    })
    return [
      { id: 'inbox', kind: 'location', label: 'inbox', description: `${unread} unread of ${inbox.length} emails`, children: items },
      { id: 'sent', kind: 'location', label: 'sent mail', description: `${s.sent.length} sent replies` },
    ]
  },

  async perform(s, nodeId, args) {
    if (nodeId === 'inbox') return { state: { ...s, route: 'inbox' }, summary: 'Opened inbox' }
    if (nodeId === 'sent') return { state: { ...s, route: 'sent' }, summary: 'Opened sent mail' }

    const [, id, verb] = nodeId.split('/')
    const email = s.emails.find((e) => e.id === id)
    if (!email) return { state: s, summary: `No such email ${id}` }
    const label = `"${email.subject}" from ${email.from}`

    if (!verb) {
      const emails = s.emails.map((e) => (e.id === id ? { ...e, read: true } : e))
      return { state: { ...s, emails, route: nodeId }, summary: `Opened ${label}`, observation: emailMarkdown(email) }
    }
    if (verb === 'unread') {
      const emails = s.emails.map((e) => (e.id === id ? { ...e, read: false } : e))
      return { state: { ...s, emails }, summary: `Marked ${label} unread` }
    }
    if (verb === 'archive') {
      const emails = s.emails.map((e) => (e.id === id ? { ...e, archived: true } : e))
      return { state: { ...s, emails, route: 'inbox' }, summary: `Archived ${label}` }
    }
    if (verb === 'delete') {
      return { state: { ...s, emails: s.emails.filter((e) => e.id !== id), route: 'inbox' }, summary: `Deleted ${label}` }
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
      // Show the sent mail, so it is clear the reply went out.
      return {
        state: { ...s, sent: [...s.sent, reply], nextSentId: s.nextSentId + 1, drafts, route: 'sent' },
        summary: `Reply sent to ${email.from}: "${reply.subject}"`,
      }
    }
    return { state: s, summary: `Unknown action ${nodeId}` }
  },

  toMarkdown(s) {
    if (s.route === 'sent') {
      const sent = s.sent.map((m) => `- To ${m.to}: "${m.subject}" (${formatDate(m.date)})\n  ${m.body}`).join('\n')
      return `# Email › Sent\n${sent || '_No sent mail_'}`
    }
    const open = s.route.startsWith('email/') ? s.emails.find((e) => `email/${e.id}` === s.route) : undefined
    if (open) {
      const draft = s.drafts[open.id]
      const reply = draft ? `\n\n## Reply draft (not sent)\n${draft}` : ''
      return `# Email › ${open.subject}\nFrom: ${open.from} <${open.address}>\nDate: ${formatDate(open.date)}\n\n${open.body}${reply}`
    }
    const list = s.emails
      .filter((e) => !e.archived)
      .map((e) => `- ${e.read ? '' : '**[unread]** '}"${e.subject}" from ${e.from}, ${formatDate(e.date)}`)
      .join('\n')
    return `# Email › Inbox\n${list || '_Inbox zero_'}`
  },
})

export default emailApp
