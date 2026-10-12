export interface DecisionMeta {
  /** Jev's answers that led to the step: what to do, and which step. */
  next?: { choice: string; confidence: number }
  step?: { choice: string; confidence: number; probabilities: Record<string, number> }
  latencyMs?: number
}

/** Who took a step: the fast decision model, the thinking model, or the user in the app directly. */
export type Actor = 'fast' | 'thinking' | 'user'

/** What a step operated, enough to describe it without the screen it was on. */
export type StepTarget =
  | { kind: 'element'; name: string; role: string; nodeKind: 'location' | 'action' | 'input' | 'group'; nodeId: string }
  | { kind: 'app'; appId: string; title: string }
  | { kind: 'back' }
  | { kind: 'home' }

export type Message =
  /** One finalized VAD segment of what the user said. */
  | { role: 'user'; content: string; utteranceId: number }
  /** A step on screen, logged once it has run. */
  | {
      role: 'step'
      id: string
      by: Actor
      target: StepTarget
      /** Text typed into a field. */
      text?: string
      /** Whose words `text` is: the user's (or follows from their request), or written by Stanley. */
      wrote?: 'user' | 'stanley'
      result: { summary: string; observation?: string; error?: boolean }
      /** The utterance being heard when the step was decided, so it reads after those words. */
      utteranceId?: number
      /** How many of that utterance's words had been heard when the step was decided. */
      heardWords?: number
      decision?: DecisionMeta
    }
  /** What Stanley said to the user (shown on screen; spoken later). */
  | { role: 'said'; content: string }
  | { role: 'event'; kind: 'task-start' | 'task-end' | 'stuck'; detail?: string }

export type LogEntry = Message & { at: number }

/** Append-only conversation log. The source of truth `narrate()` renders. */
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
