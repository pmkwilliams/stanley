import type { Snapshot } from '../../shared/ipc'

/**
 * What the presence wave shows: Stanley's voice, the ear (mic, VAD, utterance) and the brain (agent
 * status) combined. Stanley talking wins, then working states, so the person can tell the agent is
 * doing something even while it listens; the user's voice level is layered on top of every state.
 */
export type Presence =
  | 'off'
  | 'speaking'
  | 'armed'
  | 'hearing'
  | 'trailing'
  | 'guessing'
  | 'thinking'
  | 'writing'
  | 'acting'
  | 'done'
  | 'didnt-get-that'
  | 'stuck'
  | 'error'

type Inputs = Pick<Snapshot, 'listening' | 'speaking' | 'utteranceOpen' | 'transcript' | 'status' | 'stt' | 'talking'>

export function presence(s: Inputs): Presence {
  if (s.talking) return 'speaking'
  if (s.status === 'thinking' || s.status === 'writing' || s.status === 'acting') return s.status
  if (s.status === 'guessing') return 'guessing'
  if (!s.listening || s.stt !== 'ready') return 'off'
  if (s.speaking) return 'hearing'
  // Turning the mic on opens an utterance before anything is said; trailing needs words to trail.
  if (s.utteranceOpen && (s.transcript.finalized.length || s.transcript.partial)) return 'trailing'
  if (s.status === 'done' || s.status === 'didnt-get-that' || s.status === 'stuck' || s.status === 'error') return s.status
  return 'armed'
}

/** How long a state is held before giving way: guesses arrive in bursts, outcomes fade back to armed. */
const HOLD: Partial<Record<Presence, number>> = { guessing: 1500 }
const FADE: Partial<Record<Presence, number>> = { done: 1400, 'didnt-get-that': 2500, stuck: 5000, error: 5000 }

/** Holds a state through brief gaps, and fades outcomes back to armed. Call every frame. */
export class Settler {
  private raw: Presence = 'off'
  private rawSince = 0
  private shown: Presence = 'off'
  /** Last time the shown state was also the raw state. */
  private shownSeen = 0

  update(raw: Presence, now: number): Presence {
    if (raw !== this.raw) {
      this.raw = raw
      this.rawSince = now
    }
    let next = raw
    const fade = FADE[raw]
    if (fade && now - this.rawSince >= fade) next = 'armed'
    // A guess keeps its shimmer through the gaps between guessing ticks, but never over real work.
    const hold = HOLD[this.shown]
    if (hold && now - this.shownSeen < hold && (raw === 'hearing' || raw === 'trailing')) next = this.shown
    this.shown = next
    if (next === raw) this.shownSeen = now
    return next
  }
}

/** Shape, color and motion of the wave. Every state blends into the next, so these are targets, not frames. */
export interface Style {
  /** Wave height, as a fraction of the screen height. */
  amp: number
  blur: number
  speed: number
  freq: number
  /** 0: the layers drift independently. 1: they move together. */
  coherence: number
  /** Hues up the curtain: the bottom fringe, the middle and the crown. */
  h0: number
  h1: number
  h2: number
  sat: number
  lit: number
  alpha: number
  /** Width of the wave as a fraction of the screen: wide is ambient, narrow is focused. */
  width: number
  /** How much the voice level moves the wave. */
  voice: number
  breathe: number
  /** Glints along the edge: understanding forming. */
  shimmer: number
  /** A bright spot sweeping back and forth: deciding. */
  scan: number
  /** Pulsing with Stanley's voice: speaking. */
  pulse: number
  /** Energy flowing in one direction: doing. */
  travel: number
}

const ARMED: Style = {
  amp: 0.06, blur: 40, speed: 0.25, freq: 1.3, coherence: 0.4, h0: 150, h1: 172, h2: 250, sat: 55, lit: 52, alpha: 0.35,
  width: 0.8, voice: 1, breathe: 1, shimmer: 0, scan: 0, pulse: 0, travel: 0,
}
const HEARING: Partial<Style> = {
  amp: 0.09, blur: 24, speed: 0.55, freq: 1.8, coherence: 0.3, h0: 128, h1: 160, h2: 290, sat: 80, lit: 55, alpha: 0.6,
  width: 0.62, voice: 1.7, breathe: 0,
}

export const STYLES: Record<Presence, Style> = {
  off: { ...ARMED, amp: 0.012, blur: 4, speed: 0.15, sat: 8, lit: 45, alpha: 0.18, width: 0.9, voice: 0, breathe: 0 },
  armed: ARMED,
  hearing: { ...ARMED, ...HEARING },
  trailing: { ...ARMED, ...HEARING, amp: 0.075, blur: 30, speed: 0.4, freq: 1.6, sat: 72, lit: 58, alpha: 0.5, width: 0.66, voice: 1.5, breathe: 0.6 },
  guessing: { ...ARMED, ...HEARING, speed: 0.6, freq: 1.9, coherence: 0.45, h1: 185, h2: 310, sat: 82, lit: 58, alpha: 0.62, width: 0.6, voice: 1.6, shimmer: 1 },
  thinking: {
    ...ARMED, amp: 0.07, blur: 16, speed: 0.9, freq: 2.6, coherence: 0.9, h0: 200, h1: 275, h2: 320, sat: 85, lit: 60, alpha: 0.72,
    width: 0.42, voice: 0.7, breathe: 0, scan: 1,
  },
  // Thinking's shape in warmer colors: typing is part of the same work, not a new state of mind.
  writing: {
    ...ARMED, amp: 0.07, blur: 16, speed: 0.9, freq: 2.6, coherence: 0.9, h0: 175, h1: 300, h2: 340, sat: 88, lit: 60, alpha: 0.72,
    width: 0.42, voice: 0.7, breathe: 0, scan: 1,
  },
  speaking: {
    ...ARMED, amp: 0.08, blur: 14, speed: 0.8, freq: 3.2, coherence: 0.85, h0: 190, h1: 262, h2: 325, sat: 88, lit: 62, alpha: 0.75,
    width: 0.58, voice: 0.6, breathe: 0, pulse: 1,
  },
  acting: {
    ...ARMED, amp: 0.11, blur: 16, speed: 1.2, freq: 2.2, coherence: 0.85, h0: 100, h1: 130, h2: 345, sat: 90, lit: 55, alpha: 0.8,
    width: 0.85, voice: 0.8, breathe: 0, travel: 1,
  },
  done: ARMED,
  'didnt-get-that': { ...ARMED, h0: 210, h1: 220, h2: 235, sat: 22, alpha: 0.42, width: 0.7, voice: 1.4, breathe: 0.5, blur: 30, speed: 0.3 },
  stuck: { ...ARMED, amp: 0.05, blur: 30, speed: 0.07, freq: 1.2, coherence: 0.9, h0: 22, h1: 34, h2: 44, sat: 90, alpha: 0.55, width: 0.7, voice: 0.8, breathe: 0.3 },
  error: { ...ARMED, amp: 0.045, blur: 26, speed: 0.06, freq: 1.2, coherence: 0.9, h0: 0, h1: 14, h2: 30, sat: 85, lit: 52, alpha: 0.55, width: 0.7, voice: 0.8, breathe: 0.2 },
}

/** Mic loudness, 0–1, written by the capture callback and read every frame. */
export const mic = { level: 0 }

/** Stanley's own loudness, 0–1, read every frame. Set once its voice is playing (see voice.ts). */
export const voiceOut = { level: () => 0 }

/** RMS of a chunk → 0–1, mapping −50 dBFS (room noise) to 0 and −15 dBFS (close speech) to 1. */
export function loudness(chunk: Float32Array): number {
  let sum = 0
  for (const x of chunk) sum += x * x
  const db = 10 * Math.log10(sum / Math.max(1, chunk.length) + 1e-12)
  return Math.min(1, Math.max(0, (db + 50) / 35))
}
