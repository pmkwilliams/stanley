import type { DecisionClient } from '@stanley/jev'
import type { AgentDebugEvent } from './debug'
import type { HeardWord } from './heard'
import { DEFAULT_AGENT_NAME } from '@stanley/app-sdk'
import { named, namedOptions } from './narrate'
import { normalize } from './transcript'

type Overlap = 'acknowledging' | 'interrupting' | 'answering' | 'elsewhere'

export const OVERLAP: Record<Overlap, string> = {
  acknowledging: 'Only acknowledging Stanley or letting it go on: "mm-hm", "yeah", "okay", "right", "uh-huh", "got it", while Stanley is still in the middle of what it is saying.',
  interrupting: 'Stopping Stanley or changing course: "wait", "stop", "hold on", "no", a correction, a change to what they asked, or a new request.',
  answering: 'Answering what Stanley is asking, or replying to what it said, as it finishes saying it.',
  elsewhere: "Not talking to Stanley: talking to someone else or on the phone, reading something out, background speech or noise, or Stanley's own voice picked up by the microphone.",
}
export const OVERLAP_INSTRUCTIONS = 'Stanley is talking, and the microphone heard the user say something over it. What is the user doing?'

export const OVERLAP_PROMPT = `# Stanley
Stanley is a voice assistant that operates apps and websites on the user's computer and talks to the user out loud. It is talking now, and the user said something over it. People do that to show they're following, to stop it, to answer it, or because they're talking to someone else. Stanley stops when the user wants to be heard, and goes on when they don't.`

type Working = 'stop' | 'hold' | 'elsewhere'

/**
 * Words said while Stanley works on something without talking (thinking, a lookup, writing a page).
 * The same judgement as speech over its voice, about its work instead: whether the words make
 * what it's doing wrong, or can wait until it's done.
 */
export const WORKING: Record<Working, string> = {
  stop: 'Stopping Stanley or changing what it is doing: "stop", "wait", "cancel", "never mind", "don\'t", "no", a correction, saying more exactly what they meant ("the Lakers game"), or asking for something else instead of it.',
  hold: 'Something more for after what Stanley is doing, which can wait until it finishes: a change to the finished result ("and make it blue", "also add a title"), or another question or request.',
  elsewhere: "Not talking to Stanley: talking to someone else or on the phone, reading something out, background speech or noise.",
}
export const WORKING_INSTRUCTIONS = 'Stanley is working on what the user asked, and the user said something while it works. What are they doing?'

export const WORKING_PROMPT = `# Stanley
Stanley is a voice assistant that operates apps and websites on the user's computer. It is working on something the user asked for, and the user said something while it works. People do that to stop it or change what it is doing, to add to it or ask for something more, or because they are talking to someone else. Stanley stops when what it is doing is no longer what the user wants. Otherwise it finishes, then does what they said.`

/** What Stanley is saying right now. */
export interface Speech {
  /** The reply being said. */
  id: number
  /** What it has said of it so far. */
  spoken: string
  /** What it has still to say. */
  rest: string
}

/** What the user said over Stanley, Stanley's own voice taken out: finished segments, then the one being spoken. */
export interface Overheard {
  segments: { text: string; words?: HeardWord[] }[]
  partial: { text: string; words?: HeardWord[] } | null
}

export interface BargeInConfig {
  /** Stop for the user at this P(interrupting or answering). */
  stop: number
  /** Go on at this P(acknowledging or elsewhere). */
  goOn: number
  /** Stop without waiting for Jev once the user has said this many words it hasn't judged a go-on. */
  cutWords: number
  /** Once the user goes quiet, settle what they said after this long. */
  quietMs: number
  /** Stanley's last words (and next) that the mic may pick up, for taking its own voice out. */
  echoWords: number
}

export const defaultBargeIn: BargeInConfig = { stop: 0.5, goOn: 0.6, cutWords: 4, quietMs: 700, echoWords: 16 }

export interface BargeInDeps {
  jev: DecisionClient
  /** The conversation so far without the screen, leaving out the reply being said. */
  conversation(except: number): string
  /** What Stanley is saying, or null once it isn't. */
  speech(): Speech | null
  /** What the user calls the assistant, read each time it is needed. Defaults to `DEFAULT_AGENT_NAME`. */
  name?(): string
  config?: BargeInConfig
  events: {
    /** Lower Stanley's voice (true), or bring it back up (false). */
    duck(on: boolean): void
    /** The user cut in: stop talking, and start a new utterance with these words. */
    cut(heard: Overheard): void
    /** What was heard is settled and wasn't for Stanley: forget it, also as context for what comes next. */
    dismiss(): void
    debug?(event: AgentDebugEvent): void
  }
}

interface Word {
  text: string
  heard?: HeardWord
  segment: number
}

/**
 * Speech heard while Stanley talks. While Stanley talks, the transcriber's events come here
 * instead of the agent, until what was heard is settled. Stanley's own voice leaking into the mic
 * is taken out; Stanley lowers its voice as soon as the user starts, and Jev judges their words
 * (again as more come). When the user wants to be heard, Stanley stops and their words start a new
 * utterance. When not, Stanley goes on at full volume.
 */
export class BargeIn {
  private open = false
  private voiceOn = false
  private segments: Overheard['segments'] = []
  private current: Overheard['partial'] = null
  /** How many of the user's words Jev judged a go-on. */
  private wentOn = 0
  /** Jev's last verdict, on how many words. */
  private verdict: { words: number; stop: number; goOn: number } | null = null
  private asking: AbortController | null = null
  /** More words came while Jev was judging. */
  private dirty = false
  private quiet?: ReturnType<typeof setTimeout>
  private readonly config: BargeInConfig

  constructor(private deps: BargeInDeps) {
    this.config = deps.config ?? defaultBargeIn
  }

  /** Speech heard over Stanley is being judged: the transcriber's events belong here until it is settled. */
  get busy(): boolean {
    return this.open
  }

  /** The VAD started or stopped hearing speech. */
  voice(on: boolean): void {
    this.voiceOn = on
    if (on) {
      this.start()
      clearTimeout(this.quiet)
    } else this.settleLater()
  }

  partial(text: string, words?: HeardWord[]): void {
    this.start()
    this.current = { text, words }
    this.consider()
  }

  segment(text: string, words?: HeardWord[]): void {
    // The last words of speech already settled, decoded after the fact.
    if (!this.open && !this.voiceOn) return
    this.start()
    if (text.trim()) this.segments.push({ text, words })
    this.current = null
    this.consider()
    if (!this.voiceOn) this.settleLater()
  }

  /** Forgets what was heard, without settling it: something else ended Stanley's turn. */
  cancel(): void {
    if (!this.open) return
    this.close()
    this.reset()
  }

  /** Stanley finished talking. Anything the user said over its end was for after it. */
  speechEnded(): void {
    if (!this.open) return
    if (this.heard().user.length) return this.cut('Stanley finished while the user was talking')
    // Nothing to judge: the next words go to the agent as they are.
    this.close()
    this.deps.events.duck(false)
  }

  private start(): void {
    if (this.open) return
    this.open = true
    this.deps.events.duck(true)
    this.trace({ action: 'duck', heard: '' })
  }

  private consider(): void {
    const { user } = this.heard()
    const n = user.length
    if (!n || (this.wentOn && n <= this.wentOn)) return
    if (!this.wentOn && n >= this.config.cutWords) return this.cut(`${n} words, none of them judged a go-on`)
    this.ask()
  }

  private ask(): void {
    if (this.asking) {
      this.dirty = true
      return
    }
    const speech = this.deps.speech()
    const { user } = this.heard()
    const controller = new AbortController()
    this.asking = controller
    const name = this.deps.name?.() ?? DEFAULT_AGENT_NAME
    const state = [
      named(OVERLAP_PROMPT, name),
      this.deps.conversation(speech?.id ?? -1),
      `## What ${name} is saying`,
      speech ? `Said so far: "${speech.spoken.trim()}"\nStill to say: ${speech.rest.trim() ? `"${speech.rest.trim()}"` : 'nothing, it was finishing'}` : 'It has just finished.',
      '## What the user said over it',
      `"${user.map((w) => w.text).join(' ')}"`,
    ].join('\n\n')
    const started = performance.now()
    this.deps.jev
      .choose({ state, instructions: named(OVERLAP_INSTRUCTIONS, name), options: namedOptions(OVERLAP, name), signal: controller.signal })
      .then((result) => {
        if (this.asking !== controller) return
        this.asking = null
        const p = result.probabilities
        const stop = (p.interrupting ?? 0) + (p.answering ?? 0)
        const goOn = (p.acknowledging ?? 0) + (p.elsewhere ?? 0)
        this.verdict = { words: user.length, stop, goOn }
        this.trace({ action: 'judged', heard: user.map((w) => w.text).join(' '), verdict: { choice: result.choice, probabilities: p, latencyMs: performance.now() - started } })
        if (stop >= this.config.stop) return this.cut(`${result.choice} at ${stop.toFixed(2)}`)
        if (goOn >= this.config.goOn) {
          this.wentOn = user.length
          this.deps.events.duck(false)
        }
        if (this.dirty) {
          this.dirty = false
          this.consider()
        } else if (!this.voiceOn) this.settleLater()
      })
      .catch((err) => {
        if (this.asking !== controller) return
        this.asking = null
        // Better to stop for words that may matter than to talk over them.
        this.cut(`Jev failed: ${err instanceof Error ? err.message : String(err)}`)
      })
  }

  /** The user went quiet: once it's clear they stay quiet, settle what they said. */
  private settleLater(): void {
    clearTimeout(this.quiet)
    if (!this.open) return
    this.quiet = setTimeout(() => {
      if (this.voiceOn || !this.open || this.asking) return
      const n = this.heard().user.length
      if (!n) return this.dismiss('no words, only noise or Stanley itself')
      if (this.wentOn >= n) return this.dismiss('judged a go-on')
      // Jev was unsure and nothing more is coming: go with what it leaned to.
      if (this.verdict?.words === n) return this.verdict.stop > this.verdict.goOn ? this.cut('leaned to stopping') : this.dismiss('leaned to going on')
      this.ask()
    }, this.config.quietMs)
  }

  private cut(reason: string): void {
    const heard = this.heard()
    this.close()
    const segments = new Map<number, Word[]>()
    for (const w of heard.user) segments.set(w.segment, [...(segments.get(w.segment) ?? []), w])
    const part = (i: number) => {
      const words = segments.get(i)
      if (!words?.length) return null
      return { text: words.map((w) => w.text).join(' '), words: words.every((w) => w.heard) ? words.map((w) => w.heard!) : undefined }
    }
    const overheard: Overheard = {
      segments: this.segments.map((_, i) => part(i)).filter((s) => s !== null),
      partial: part(this.segments.length),
    }
    this.trace({ action: 'cut', heard: heard.user.map((w) => w.text).join(' '), echo: heard.echo.join(' ') || undefined, reason })
    this.reset()
    this.deps.events.cut(overheard)
  }

  private dismiss(reason: string): void {
    const heard = this.heard()
    this.close()
    this.trace({ action: 'go-on', heard: heard.user.map((w) => w.text).join(' '), echo: heard.echo.join(' ') || undefined, reason })
    this.reset()
    this.deps.events.duck(false)
    this.deps.events.dismiss()
  }

  private close(): void {
    this.open = false
    clearTimeout(this.quiet)
    this.asking?.abort()
    this.asking = null
    this.dirty = false
  }

  private reset(): void {
    this.segments = []
    this.current = null
    this.wentOn = 0
    this.verdict = null
  }

  /** The words heard, split into the user's and Stanley's own (its voice picked up by the mic). */
  private heard(): { user: Word[]; echo: string[] } {
    const all: Word[] = []
    ;[...this.segments, ...(this.current ? [this.current] : [])].forEach((s, segment) => {
      if (s.words?.length) for (const heard of s.words) all.push({ text: heard.word, heard, segment })
      else for (const text of s.text.split(/\s+/).filter(Boolean)) all.push({ text, segment })
    })
    const speech = this.deps.speech()
    const said = speech ? [...normalize(speech.spoken).slice(-this.config.echoWords), ...normalize(speech.rest).slice(0, 6)] : []
    const echo = echoes(all.map((w) => normalize(w.text).join(' ')), said)
    return { user: all.filter((_, i) => !echo.has(i)), echo: all.filter((_, i) => echo.has(i)).map((w) => w.text) }
  }

  private trace(event: Omit<Extract<AgentDebugEvent, { type: 'overlap' }>, 'type'>): void {
    this.deps.events.debug?.({ type: 'overlap', ...event })
  }
}

/**
 * Which heard words are Stanley's own voice: runs of two or more that match, in order, words it
 * was saying. A single word could as well be the user's ("yes", "send"), so it stays theirs.
 */
export function echoes(heard: string[], said: string[]): Set<number> {
  const echo = new Set<number>()
  let i = 0
  while (i < heard.length) {
    let best = 0
    for (let j = 0; j < said.length; j++) {
      let n = 0
      while (i + n < heard.length && j + n < said.length && heard[i + n] && heard[i + n] === said[j + n]) n++
      best = Math.max(best, n)
    }
    if (best >= 2) {
      for (let k = 0; k < best; k++) echo.add(i + k)
      i += best
    } else i++
  }
  return echo
}
