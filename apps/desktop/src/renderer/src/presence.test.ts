import { describe, expect, it } from 'vitest'
import { presence, Settler } from './presence'

const said = { finalized: ['open my'], partial: '' }
const ear: Parameters<typeof presence>[0] = {
  listening: true,
  speaking: false,
  utteranceOpen: false,
  transcript: { finalized: [], partial: '' },
  status: 'idle',
  stt: 'ready',
}

describe('presence', () => {
  it('follows the ear while the agent is not working', () => {
    expect(presence({ ...ear, listening: false })).toBe('off')
    expect(presence(ear)).toBe('armed')
    expect(presence({ ...ear, speaking: true, utteranceOpen: true })).toBe('hearing')
    expect(presence({ ...ear, utteranceOpen: true })).toBe('armed')
    expect(presence({ ...ear, utteranceOpen: true, transcript: said, status: 'listening' })).toBe('trailing')
  })

  it('shows work over the ear, so it still reads as working while you talk', () => {
    expect(presence({ ...ear, speaking: true, utteranceOpen: true, status: 'acting' })).toBe('acting')
    expect(presence({ ...ear, listening: false, status: 'thinking' })).toBe('thinking')
    expect(presence({ ...ear, speaking: true, utteranceOpen: true, status: 'guessing' })).toBe('guessing')
  })

  it('shows outcomes only once the person has stopped talking', () => {
    expect(presence({ ...ear, status: 'didnt-get-that' })).toBe('didnt-get-that')
    expect(presence({ ...ear, speaking: true, utteranceOpen: true, status: 'error' })).toBe('hearing')
  })
})

describe('Settler', () => {
  it('holds a guess through the gaps between guessing ticks', () => {
    const s = new Settler()
    expect(s.update('guessing', 0)).toBe('guessing')
    expect(s.update('hearing', 500)).toBe('guessing')
    expect(s.update('acting', 600)).toBe('acting')
    const t = new Settler()
    t.update('guessing', 0)
    expect(t.update('hearing', 2000)).toBe('hearing')
  })

  it('fades outcomes back to armed', () => {
    const s = new Settler()
    expect(s.update('done', 0)).toBe('done')
    expect(s.update('done', 1000)).toBe('done')
    expect(s.update('done', 1500)).toBe('armed')
    expect(s.update('done', 1600)).toBe('armed')
  })
})
