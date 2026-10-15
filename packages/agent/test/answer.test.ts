import type { DecisionClient } from '@stanley/jev'
import { describe, expect, it } from 'vitest'
import { answer, blocksOf, chunk, sourceOf, speakable } from '../src/answer'
import { defaultConfig } from '../src/config'

const read = (text: string, cs: { start: number; end: number }[]) => cs.map((c) => text.slice(c.start, c.end))

/**
 * Jev that puts `weights` on the passages containing each key and the rest on "not here", gives
 * `answers` as P(the top passage answers it) and `when` as P(it is about the time asked), and
 * answers agreement checks with `agree`.
 */
function fakeJev(weights: Record<string, number>, agree: 'same' | 'different' = 'same', answers = 0.95, when = 0.9, cell = 'c1'): DecisionClient & { calls: number } {
  const jev = {
    calls: 0,
    async choose({ options }: { options: Record<string, string | null> }) {
      jev.calls++
      const probabilities: Record<string, number> = {}
      let left = 1
      for (const [name, text] of Object.entries(options)) {
        const key = Object.keys(weights).find((k) => text?.includes(k))
        probabilities[name] = key ? weights[key]! : 0
        left -= probabilities[name]!
      }
      probabilities['not here'] = Math.max(0, left)
      const choice = Object.entries(probabilities).sort(([, a], [, b]) => b - a)[0]![0]
      return { choice, probabilities, confidence: probabilities[choice]!, latencyMs: 0 }
    },
    async decide({ questions }: { questions: Record<string, unknown> }) {
      jev.calls++
      const out = Object.fromEntries(
        Object.keys(questions).map((id) =>
          id === 'answers'
            ? [id, { choice: answers >= 0.5 ? 'yes' : 'no', probabilities: { yes: answers, no: 1 - answers }, confidence: Math.max(answers, 1 - answers) }]
            : id === 'when'
              ? [id, { choice: when >= 0.5 ? 'yes' : 'no', probabilities: { yes: when, no: 1 - when }, confidence: Math.max(when, 1 - when) }]
              : id === 'cell'
                ? [id, { choice: cell, probabilities: { [cell]: 0.9 }, confidence: cell === 'c9' ? 0.4 : 0.9 }]
            : [id, { choice: agree, probabilities: { [agree]: 1 }, confidence: 1 }],
        ),
      )
      return { answers: out, latencyMs: 0 }
    },
  }
  return jev
}

const ask = (text: string, jev: DecisionClient) =>
  answer({ jev, text, title: 'Page', onScreen: true, conversation: '## Conversation\nUser: question', today: 'Thursday, 15 October 2026', config: defaultConfig.answer })

describe('chunk', () => {
  it('cuts an article into sentences, keeping a citation-marked sentence end', () => {
    const text = '# Life\nHe was inaugurated on April 30, 1789, at Federal Hall. [j] [180] His coach was led by militia. Crowds followed.'
    expect(read(text, chunk(text, blocksOf(text), 150, 4))).toEqual(['# Life', 'He was inaugurated on April 30, 1789, at Federal Hall.', '[j] [180] His coach was led by militia.', 'Crowds followed.'])
  })

  it('cuts a short page into clauses, but not before a number', () => {
    const text = 'Marco is 3 minutes away in a white Toyota Camry, plate 8XYZ123, arriving May 3, 2026.'
    expect(read(text, chunk(text, blocksOf(text), 150, 2, true))).toEqual(['Marco is 3 minutes away in a white Toyota Camry,', 'plate 8XYZ123,', 'arriving May 3, 2026.'])
  })

  it('merges neighbouring blocks when there are more than the budget', () => {
    const text = Array.from({ length: 10 }, (_, i) => `Line number ${i} here.`).join('\n')
    const cs = chunk(text, blocksOf(text), 4, 4)
    expect(cs.length).toBeLessThanOrEqual(4)
    expect(read(text, cs).join('\n')).toBe(text)
  })
})

describe('speakable', () => {
  it('drops citation marks, markup and control brackets, and joins list lines', () => {
    expect(speakable('Born February 22, 1732 [a] at Popes Creek . [3]')).toBe('Born February 22, 1732 at Popes Creek.')
    expect(speakable('### [Private Vehicle $35.00: collapsed]')).toBe('Private Vehicle $35.00')
    expect(speakable('$ brew install ripgrep')).toBe('brew install ripgrep')
    expect(speakable('you might also have:\n- a high temperature\n- loss of appetite')).toBe('you might also have: a high temperature; loss of appetite')
  })
})

describe('sourceOf', () => {
  it('takes the site name a page title ends with', () => {
    expect(sourceOf('George Washington - Wikipedia')).toBe('Wikipedia')
    expect(sourceOf('Easy pancakes recipe | Good Food')).toBe('Good Food')
    expect(sourceOf('Fees & Passes - Yosemite National Park (U.S. National Park Service)')).toBe('Yosemite National Park')
    expect(sourceOf('Your ride')).toBeUndefined()
  })
})

describe('answer', () => {
  it('says where the answer is from when the page is not on screen', async () => {
    const page = { jev: fakeJev({ 'Hand wash': 0.9 }), text: '## Details\nHand wash only, please.', title: 'Enamel mug - Trailhead Supply', conversation: '', today: '', config: defaultConfig.answer }
    expect(await answer({ ...page, onScreen: false })).toMatchObject({ text: 'Hand wash only, please.', say: 'Trailhead Supply says: Hand wash only, please.' })
    expect(await answer({ ...page, onScreen: true })).toMatchObject({ say: 'Hand wash only, please.' })
  })

  it("says a table row as the value of the cell that answers, or declines when unsure which", async () => {
    const text = 'Apply by post; Card: Yes; Cash: No\nApply online; Card: Yes; Cheque: Yes; Cash: No'
    expect((await ask(text, fakeJev({ 'Apply online': 0.9 }, 'same', 0.95, 0.9, 'c3'))).text).toBe('No')
    expect((await ask('Friday; Hours: 10 am-9 pm', fakeJev({ Friday: 0.9 }))).text).toBe('10 am-9 pm')
    expect(await ask(text, fakeJev({ 'Apply online': 0.9 }, 'same', 0.95, 0.9, 'c9'))).toMatchObject({ outcome: 'decline' })
  })

  it('leaves out a short sentence that answers its own heading, unless it is ranked', async () => {
    const text = '### Can I send it back?\nYes. You have a month from delivery to send it back for a refund.'
    expect((await ask(text, fakeJev({ 'a month': 0.9 }))).text).toBe('You have a month from delivery to send it back for a refund.')
    expect((await ask(text, fakeJev({ 'Yes.': 0.4, 'a month': 0.5 }))).text).toBe('Yes. You have a month from delivery to send it back for a refund.')
  })

  it('reads out the whole sentence around the passage Jev picks', async () => {
    const r = await ask('# Hours\nFriday 10 am–9 pm\nSaturday 10 am–9 pm', fakeJev({ Friday: 0.9 }))
    expect(r).toMatchObject({ outcome: 'speak', text: 'Friday 10 am–9 pm' })
  })

  it('adds the sentence before one that opens with a pronoun', async () => {
    const text = 'Washington was born at Popes Creek in Virginia. He was the first of six children. His father was a justice.'
    const r = await ask(text, fakeJev({ 'six children': 0.9 }))
    expect(r.text).toBe('Washington was born at Popes Creek in Virginia. He was the first of six children.')
  })

  it('declines when the passage, heard alone, does not answer what was meant', async () => {
    const text = '## The 1889 exposition\nTickets cost 2 francs for the first level and 5 for the top.'
    const r = await ask(text, fakeJev({ 'Tickets cost': 0.9 }, 'same', 0.1))
    expect(r).toMatchObject({ outcome: 'decline', reason: 'not the answer' })
  })

  it('declines a passage about another time than the one asked about', async () => {
    const text = '## History\nAt the top, there was a post office for visitors.'
    const r = await ask(text, fakeJev({ 'post office': 0.9 }, 'same', 0.99, 0.03))
    expect(r).toMatchObject({ outcome: 'decline', reason: 'not the answer' })
  })

  it('declines when Jev says it is not on the page', async () => {
    const r = await ask('# Mug\nDishwasher safe and microwave safe.', fakeJev({}))
    expect(r).toMatchObject({ outcome: 'decline', reason: 'not here' })
  })

  it('pools the same fact said in two places when they agree', async () => {
    const text = '- Free returns within 30 days\n## Details\nMade in Portugal by hand.\n## Questions\nYou have a month from delivery to send it back.'
    const r = await ask(text, fakeJev({ '30 days': 0.45, 'a month': 0.4 }))
    expect(r).toMatchObject({ outcome: 'speak', text: 'Free returns within 30 days', agreed: [true] })
    expect(r.mass).toBeCloseTo(0.85)
  })

  it('declines when a strong runner-up gives a different answer', async () => {
    const text = 'Doors 7:00 PM and show 8:00 PM.\n## Venue\nThe Fillmore is on Geary Blvd.\n## Update\nDoors now open at 6:30 PM instead.'
    const r = await ask(text, fakeJev({ '7:00': 0.45, '6:30': 0.4 }, 'different'))
    expect(r).toMatchObject({ outcome: 'decline', reason: 'conflict' })
  })

  it('never joins passages from different parts of a long page into one run', async () => {
    const filler = Array.from({ length: 200 }, (_, i) => `Filler sentence number ${i} says nothing much.`).join('\n')
    const text = `- 300ml milk\n- 2 large eggs\n${filler}\nWhisk 300ml milk into the flour slowly until smooth.`
    const r = await ask(text, fakeJev({ '300ml milk': 0.45 }))
    expect(r.runs.map((x) => x.text)).toEqual(['300ml milk', 'Whisk 300ml milk into the flour slowly until smooth.'])
  })
})
