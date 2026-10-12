import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChoiceRequest, DecisionClient } from '@stanley/jev'
import { BargeIn, echoes, type Overheard, type Speech } from '../src/barge'

type Verdict = Partial<Record<'acknowledging' | 'interrupting' | 'answering' | 'elsewhere', number>>

function setup(judge: (heard: string) => Verdict, speech: Speech | null = { id: 1, spoken: 'Your next meeting is at three with Sam', rest: ' in the small room.' }) {
  const asked: string[] = []
  const jev: DecisionClient = {
    decide: async () => {
      throw new Error('not used')
    },
    choose: async (req: ChoiceRequest) => {
      const heard = req.state.split('## What the user said over it\n\n')[1]!.replace(/"/g, '')
      asked.push(heard)
      const probabilities = { acknowledging: 0, interrupting: 0, answering: 0, elsewhere: 0, ...judge(heard) }
      const choice = Object.entries(probabilities).sort(([, a], [, b]) => b - a)[0]![0]
      return { choice, probabilities, confidence: probabilities[choice as keyof Verdict], latencyMs: 1 }
    },
  }
  const ducks: boolean[] = []
  const cuts: Overheard[] = []
  let dismissed = 0
  const barge = new BargeIn({
    jev,
    conversation: () => '## Conversation\nUser: what is next',
    speech: () => speech,
    events: { duck: (on) => ducks.push(on), cut: (h) => cuts.push(h), dismiss: () => dismissed++ },
  })
  return { barge, asked, ducks, cuts, dismissed: () => dismissed }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('BargeIn', () => {
  it('goes on after an acknowledgement, at full volume again', async () => {
    const { barge, ducks, cuts, dismissed } = setup(() => ({ acknowledging: 0.9 }))
    barge.voice(true)
    expect(ducks).toEqual([true])
    barge.partial('mm-hm')
    await vi.advanceTimersByTimeAsync(1)
    expect(ducks).toEqual([true, false])
    barge.voice(false)
    barge.segment('Mm-hm.')
    await vi.advanceTimersByTimeAsync(1000)
    expect(cuts).toEqual([])
    expect(dismissed()).toBe(1)
    expect(barge.busy).toBe(false)
  })

  it('stops for "wait", handing over the words', async () => {
    const { barge, cuts } = setup(() => ({ interrupting: 0.95 }))
    barge.voice(true)
    barge.partial('wait wait')
    await vi.advanceTimersByTimeAsync(1)
    expect(cuts).toEqual([{ segments: [], partial: { text: 'wait wait' } }])
    expect(barge.busy).toBe(false)
  })

  it("stops without waiting for Jev once the user says more than a few words", async () => {
    const { barge, cuts, asked } = setup(() => ({}))
    barge.voice(true)
    barge.partial('actually make it Thursday instead')
    expect(cuts).toHaveLength(1)
    expect(asked).toEqual([])
  })

  it('takes out its own voice picked up by the mic', async () => {
    const { barge, cuts, asked, dismissed } = setup(() => ({ acknowledging: 0.9 }))
    barge.voice(true)
    barge.partial('three with Sam')
    barge.voice(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(asked).toEqual([])
    expect(cuts).toEqual([])
    expect(dismissed()).toBe(1)
  })

  it('keeps the user\'s words heard along with its own voice', async () => {
    const { barge, cuts } = setup(() => ({ interrupting: 0.9 }))
    barge.voice(true)
    barge.partial('with Sam no stop')
    await vi.advanceTimersByTimeAsync(1)
    expect(cuts[0]!.partial?.text).toBe('no stop')
  })

  it('judges again as more words come, and stops when they turn out to be for it', async () => {
    const { barge, cuts, asked } = setup((heard) => (heard.includes('wait') ? { interrupting: 0.9 } : { acknowledging: 0.8 }))
    barge.voice(true)
    barge.partial('yeah')
    await vi.advanceTimersByTimeAsync(1)
    expect(cuts).toEqual([])
    barge.partial('yeah wait')
    await vi.advanceTimersByTimeAsync(1)
    expect(asked).toEqual(['yeah', 'yeah wait'])
    expect(cuts).toHaveLength(1)
  })

  it('hands over words heard as Stanley finished', async () => {
    const { barge, cuts } = setup(() => ({ answering: 0.4, acknowledging: 0.5 }))
    barge.voice(true)
    barge.partial('yes')
    await vi.advanceTimersByTimeAsync(1)
    barge.speechEnded()
    expect(cuts).toEqual([{ segments: [], partial: { text: 'yes' } }])
  })

  it('goes on after noise with no words', async () => {
    const { barge, ducks, dismissed } = setup(() => ({}))
    barge.voice(true)
    barge.voice(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(ducks).toEqual([true, false])
    expect(dismissed()).toBe(1)
  })
})

describe('echoes', () => {
  it('matches runs of two or more words, in order', () => {
    expect([...echoes(['at', 'three', 'with', 'sam', 'stop'], ['meeting', 'is', 'at', 'three', 'with', 'sam'])]).toEqual([0, 1, 2, 3])
  })

  it('leaves single words the user may have said', () => {
    expect([...echoes(['yes'], ['should', 'i', 'send', 'it', 'yes'])]).toEqual([])
  })
})
