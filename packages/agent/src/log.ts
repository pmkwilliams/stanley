export interface DecisionMeta {
  confidence: number
  probabilities: Record<string, number>
  latencyMs: number
}

export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; utteranceId: string }
  | {
      role: 'assistant'
      toolCall: { id: string; option: string; nodeId?: string; args?: { text?: string } }
      /** `user` when the person clicked/typed in an app directly. */
      origin: 'agent' | 'user'
      decision?: DecisionMeta
    }
  | { role: 'tool'; toolCallId: string; content: string; summary: string }
  | { role: 'event'; kind: 'task-start' | 'task-end' | 'gated' | 'stale' | 'forced-stop'; detail?: string }

export type LogEntry = Message & { at: number }

/** Append-only conversation log. Source of truth for every serializer. */
export class MessageLog {
  readonly entries: LogEntry[] = []
  constructor(private sink?: (entry: LogEntry) => void) {}

  push(message: Message): LogEntry {
    const entry = { ...message, at: Date.now() } as LogEntry
    this.entries.push(entry)
    this.sink?.(entry)
    return entry
  }
}
