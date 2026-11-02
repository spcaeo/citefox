import { describe, expect, it } from 'vitest'
import {
  checkOverviewRead,
  overviewReadFromReply,
  overviewReadReply,
  quoteFound,
  readStoredOverviewRead,
  type ReadFacts,
  type ReadReplyLike
} from './overview-read'

const TEXT = [
  'The permanent shutdown of AT&T’s email-to-text gateway has broken legacy workflows.',
  'How it works: You subscribe to a service like TextBolt or . They give you a unique routing domain.',
  'Twilio Integration · Very low per-message cost; robust open-source library support.'
].join('\n')

const FACTS: ReadFacts = {
  overviewText: TEXT,
  brandNames: ['TextBolt'],
  knownNames: ['Twilio', 'MessageBee', 'Unique Library', 'uniquelibrary.com'],
  sourceNames: ['TextBolt', 'textbolt.com', 'Twilio', 'github.com']
}

function item(tag: string, text: string, detail: string | null): ReadReplyLike['items'][number] {
  return { tag, text, detail }
}

const GOOD: ReadReplyLike = {
  summary: 'TextBolt is offered as one drop-in middleware option, after the API routes.',
  items: [
    item('tone', 'neutral', 'You subscribe to a service like TextBolt or .'),
    item('competitor: twilio', 'Low cost and open-source support.', 'Very low per-message cost'),
    item('competitor: Plivo', 'Not in the list.', null),
    item('action', 'Add a Koha setup section.', 'They give you a unique routing domain.'),
    item('action', 'Answer the AT&T shutdown first.', 'textbolt.com'),
    item('action', 'Invented passage.', 'Koha loves TextBolt more than anyone'),
    item('note', 'Something else.', null)
  ],
  caution: 'Confidence: medium. One sample only.'
}

describe('checkOverviewRead', () => {
  it('keeps checked items and drops the rest', () => {
    const result = checkOverviewRead(GOOD, FACTS)
    if (!('read' in result)) throw new Error(result.problem)
    expect(result.read.tone).toEqual({
      value: 'neutral',
      quote: 'You subscribe to a service like TextBolt or .'
    })
    expect(result.read.competitors).toEqual([
      {
        name: 'Twilio',
        reason: 'Low cost and open-source support.',
        quote: 'Very low per-message cost'
      }
    ])
    expect(result.read.actions.map((action) => action.text)).toEqual([
      'Add a Koha setup section.',
      'Answer the AT&T shutdown first.'
    ])
    expect(result.read.confidence).toEqual({ level: 'medium', reason: 'One sample only.' })
    expect(result.dropped).toBe(3)
  })

  it('rejects a tone quote the overview does not have', () => {
    const reply = {
      ...GOOD,
      items: [item('tone', 'positive', 'TextBolt is the best choice.'), ...GOOD.items.slice(1)]
    }
    expect(checkOverviewRead(reply, FACTS)).toEqual({
      problem: 'Quote the sentence that names the brand exactly as the overview has it.'
    })
  })

  it('wants tone "absent" when the brand is not named, and not otherwise', () => {
    const facts = { ...FACTS, overviewText: 'Twilio only. Very low per-message cost.' }
    const absent = {
      ...GOOD,
      items: [item('tone', 'absent', null), item('action', 'Get listed.', 'Twilio')]
    }
    expect('read' in checkOverviewRead(absent, facts)).toBe(true)
    const named = { ...absent, items: [item('tone', 'neutral', 'Twilio only.'), absent.items[1]!] }
    expect(checkOverviewRead(named, facts)).toEqual({
      problem: 'The overview does not name the brand, so tone is "absent".'
    })
    expect(checkOverviewRead(absent, FACTS)).toEqual({
      problem: 'The overview names the brand; give its tone and quote the sentence.'
    })
  })

  it('rejects a reply with no confidence, no tone or no tied action', () => {
    expect(checkOverviewRead({ ...GOOD, caution: 'Unsure.' }, FACTS)).toHaveProperty('problem')
    expect(checkOverviewRead({ ...GOOD, items: GOOD.items.slice(1) }, FACTS)).toEqual({
      problem: 'Give exactly one tone item.'
    })
    expect(
      checkOverviewRead({ ...GOOD, items: [GOOD.items[0]!, GOOD.items[5]!] }, FACTS)
    ).toHaveProperty('problem')
    expect(checkOverviewRead({ ...GOOD, summary: null }, FACTS)).toHaveProperty('problem')
  })

  it('keeps 3 actions at most', () => {
    const reply = {
      ...GOOD,
      items: [
        GOOD.items[0]!,
        ...[1, 2, 3, 4].map((n) => item('action', `Action ${n}`, 'textbolt.com'))
      ]
    }
    const result = checkOverviewRead(reply, FACTS)
    if (!('read' in result)) throw new Error(result.problem)
    expect(result.read.actions).toHaveLength(3)
    expect(result.dropped).toBe(1)
  })
})

describe('quoteFound', () => {
  it('ignores case, curly quotes, spacing and citation markers', () => {
    expect(quoteFound('"the permanent shutdown of AT&T\'s email-to-text gateway"', TEXT)).toBe(true)
    expect(quoteFound('a service like TextBolt [3] or .', TEXT)).toBe(true)
    expect(quoteFound('The permanent shutdown … broken legacy workflows', TEXT)).toBe(true)
  })

  it('rejects text that is not there, parts out of order, and tiny quotes', () => {
    expect(quoteFound('TextBolt is the best', TEXT)).toBe(false)
    expect(quoteFound('broken legacy workflows … The permanent shutdown', TEXT)).toBe(false)
    expect(quoteFound('AT&T', TEXT)).toBe(false)
  })
})

describe('reply and stored shapes', () => {
  it('round-trips a read through the reply shape and stored JSON', () => {
    const result = checkOverviewRead(GOOD, FACTS)
    if (!('read' in result)) throw new Error(result.problem)
    const reply = overviewReadReply(result.read)
    expect(overviewReadFromReply(reply)).toEqual(result.read)
    expect(readStoredOverviewRead(JSON.parse(JSON.stringify(result.read)))).toEqual(result.read)
  })

  it('reads nothing from a broken stored value', () => {
    expect(readStoredOverviewRead({ positioning: 'x' })).toBeNull()
    expect(readStoredOverviewRead(null)).toBeNull()
    expect(overviewReadFromReply({ summary: 'x', items: [], caution: null })).toBeNull()
  })
})
