import { describe, expect, it } from 'vitest'
import type { Answer } from '@stanley/jev'
import { chooseScreen, describeScreen, HOME_OPTION, screenQuestions, validSides, type Sides } from '../src/screen'

const app = (id: string, title = id[0]!.toUpperCase() + id.slice(1)) => ({ id, title, description: '' })
const apps = ['email', 'tasks', 'music', 'weather', 'lights', 'settings', 'web'].map((id) => app(id))
const answer = (probabilities: Record<string, number>): Answer => {
  const [choice, confidence] = Object.entries(probabilities).sort(([, a], [, b]) => b - a)[0]!
  return { choice, confidence, probabilities }
}
const title = (id: string) => id[0]!.toUpperCase() + id.slice(1)

describe('screenQuestions', () => {
  it('offers home and every set of up to three apps, and every left side of one or two', () => {
    const ask = screenQuestions(apps, [['email']], 'tasks')
    expect(Object.keys(ask.show.options)).toHaveLength(1 + 7 + 21 + 35)
    expect(Object.keys(ask.left.options)).toHaveLength(7 + 21)
    expect(ask.sets.get(HOME_OPTION)).toEqual([])
    expect(ask.sets.get('Email, Tasks and Weather')).toEqual(['email', 'tasks', 'weather'])
    expect(ask.show.options['Email and Tasks']).toBe('Email and Tasks side by side')
    expect(ask.lefts.get('Email and Music')).toEqual(['email', 'music'])
  })

  it("keeps to Jev's 255 options, keeping the apps on the screen and the one worked on", () => {
    const many = Array.from({ length: 14 }, (_, i) => app(`app${i}`, `App ${i}`))
    const ask = screenQuestions(many, [['app13']], 'app12')
    expect(Object.keys(ask.show.options).length).toBeLessThanOrEqual(255)
    const offered = new Set([...ask.sets.values()].flat())
    expect(offered.has('app13') && offered.has('app12')).toBe(true)
    expect(offered.size).toBe(11)
  })

  it('tells apps with the same title apart', () => {
    const ask = screenQuestions([app('web', 'Web'), app('web2', 'Web')], [], null)
    expect(Object.keys(ask.show.options)).toContain('Web (web) and Web (web2)')
  })
})

describe('chooseScreen', () => {
  const ask = (before: Sides) => screenQuestions(apps, before, null)

  it('shows one app alone, or none', () => {
    expect(chooseScreen(ask([]), { show: answer({ Tasks: 0.8 }), left: answer({ Email: 0.9 }) }, 0.4)).toEqual({ sides: [['tasks']], confidence: 0.8, left: null })
    expect(chooseScreen(ask([['email']]), { show: answer({ [HOME_OPTION]: 0.7 }), left: answer({ Email: 0.9 }) }, 0.4).sides).toEqual([])
  })

  it('puts the likeliest left side the chosen apps can make on the left', () => {
    const choice = chooseScreen(ask([]), { show: answer({ 'Email, Tasks and Weather': 0.9 }), left: answer({ Music: 0.5, 'Email and Weather': 0.3, Tasks: 0.2 }) }, 0.4)
    // Music isn't on the screen, so of the sides these apps can make, Email and Weather is likeliest.
    expect(choice.sides).toEqual([['email', 'weather'], ['tasks']])
    expect(choice.left).toBe(0.3)
  })

  it('never puts all the apps on one side', () => {
    const choice = chooseScreen(ask([]), { show: answer({ 'Email and Tasks': 0.9 }), left: answer({ 'Email and Tasks': 0.9, Tasks: 0.1 }) }, 0.4)
    expect(choice.sides).toEqual([['tasks'], ['email']])
  })

  it('keeps the sides of apps already on the screen when unsure which goes left, and their stacking', () => {
    const before = [['tasks'], ['weather', 'email']]
    const unsure = chooseScreen(ask(before), { show: answer({ 'Email, Tasks and Weather': 0.9 }), left: answer({ Email: 0.3, Tasks: 0.25 }) }, 0.4)
    expect(unsure.sides).toEqual(before)
    const sure = chooseScreen(ask(before), { show: answer({ 'Email, Tasks and Weather': 0.9 }), left: answer({ Tasks: 0.9 }) }, 0.4)
    expect(sure.sides).toEqual([['tasks'], ['weather', 'email']])
  })
})

describe('validSides', () => {
  it('takes home, one app, and two sides of up to two, three at most', () => {
    expect([[], [['a']], [['a'], ['b']], [['a'], ['b', 'c']], [['a', 'b'], ['c']]].every(validSides)).toBe(true)
    expect([[['a', 'b']], [['a'], ['a']], [['a'], []], [['a', 'b'], ['c', 'd']], [['a'], ['b'], ['c']]].some(validSides)).toBe(false)
  })
})

describe('describeScreen', () => {
  it('reads as the screen does, left to right and top to bottom', () => {
    expect(describeScreen([], title)).toBe('The home screen.')
    expect(describeScreen([['email']], title)).toBe('Email, filling the screen.')
    expect(describeScreen([['email'], ['tasks', 'weather']], title)).toBe('Email (left), Tasks (top right), Weather (bottom right).')
  })
})
