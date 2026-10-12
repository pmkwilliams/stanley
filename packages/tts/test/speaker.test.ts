import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Speaker, wordsUpTo, type Piece, type Synth } from '../src/speaker'

/** Synthesizes 50 ms of audio a character, taking `ms` to do it. */
function fakeSynth(ms = 100): Synth & { texts: string[] } {
  const texts: string[] = []
  return {
    texts,
    synthesize: (text) =>
      new Promise((resolve) => {
        texts.push(text)
        setTimeout(() => resolve({ samples: new Float32Array(text.length * 50), sampleRate: 1000 }), ms)
      }),
  }
}

/** Plays pieces in order, as the renderer does, reporting each start and end. */
function setup(synthMs = 100) {
  const synth = fakeSynth(synthMs)
  const played: Piece[] = []
  const stopped: number[] = []
  const talking: boolean[] = []
  let playingUntil = 0
  const speaker: Speaker = new Speaker(
    synth,
    {
      audio: (piece) => {
        played.push(piece)
        const ms = (piece.samples.length / piece.sampleRate) * 1000
        const start = Math.max(Date.now(), playingUntil)
        playingUntil = start + ms
        setTimeout(() => speaker.started(piece.reply, piece.seq), start - Date.now())
        setTimeout(() => speaker.ended(piece.reply, piece.seq), playingUntil - Date.now())
      },
      stop: (id) => stopped.push(id),
      speaking: (on) => talking.push(on),
    },
    { now: () => Date.now() },
  )
  return { speaker, synth, played, stopped, talking }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Speaker', () => {
  it('says the first sentence at once, then the rest as one piece', async () => {
    const { speaker, synth, talking } = setup()
    speaker.update(1, 'Sure thing. Your next meeting is at three', false)
    await vi.advanceTimersByTimeAsync(150)
    expect(synth.texts).toEqual(['Sure thing.'])
    expect(talking).toEqual([true])
    // More text arrives while the first piece plays; nothing is cut until it's needed.
    speaker.update(1, 'Sure thing. Your next meeting is at three, with Sam. It is in the small room.', true)
    await vi.advanceTimersByTimeAsync(1)
    expect(synth.texts).toHaveLength(2)
    expect(synth.texts[1]).toBe('Your next meeting is at three, with Sam. It is in the small room.')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(talking).toEqual([true, false])
    expect(speaker.speaking).toBe(false)
  })

  it('waits to cut the next piece until the queued audio runs low', async () => {
    const { speaker, synth } = setup()
    // "First sentence here." is ~1 s of audio at 50 ms a character.
    speaker.update(1, 'First sentence here. Second', false)
    await vi.advanceTimersByTimeAsync(150)
    expect(synth.texts).toEqual(['First sentence here.'])
    speaker.update(1, 'First sentence here. Second one. Third one, and', false)
    await vi.advanceTimersByTimeAsync(100)
    expect(synth.texts).toHaveLength(1)
    speaker.update(1, 'First sentence here. Second one. Third one, and more. Then', false)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(synth.texts[1]).toBe('Second one. Third one, and more.')
  })

  it('reports what was said, to the word, when stopped', async () => {
    const { speaker, stopped } = setup()
    speaker.update(1, 'One two three four five six seven eight nine ten.', true)
    // Synthesized by 100 ms; 50 chars × 50 ms = 2.5 s of audio; stop halfway.
    await vi.advanceTimersByTimeAsync(100 + 1250)
    expect(speaker.position()?.spoken).toBe('One two three four five')
    expect(speaker.stop(1)).toBe('One two three four five')
    expect(stopped).toEqual([1])
    expect(speaker.speaking).toBe(false)
  })

  it('reports nothing said when stopped before any audio played', () => {
    const { speaker } = setup()
    speaker.update(1, 'Hello there.', true)
    expect(speaker.stop(1)).toBeNull()
  })

  it('says replies in order', async () => {
    const { speaker, played } = setup()
    speaker.update(1, 'First reply.', true)
    speaker.update(2, 'Second reply.', true)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(played.map((p) => [p.reply, p.text])).toEqual([
      [1, 'First reply.'],
      [2, 'Second reply.'],
    ])
  })

  it('ducks and comes back up, and stops ducking once it stops talking', async () => {
    const volumes: number[] = []
    const synth = fakeSynth()
    const speaker = new Speaker(synth, { audio: () => {}, stop: () => {}, volume: (v) => volumes.push(v) }, { now: () => Date.now() })
    speaker.duck(true)
    speaker.duck(true)
    speaker.duck(false)
    expect(volumes).toEqual([0.3, 1])
  })
})

describe('wordsUpTo', () => {
  it('keeps whole words only', () => {
    expect(wordsUpTo('hello there friend', 0.5)).toBe('hello')
    expect(wordsUpTo('hello there friend', 0.1)).toBe('')
    expect(wordsUpTo('hello there friend', 1)).toBe('hello there friend')
  })
})
