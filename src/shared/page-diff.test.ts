import { describe, expect, test } from 'vitest'
import type { PageBlock, PageBlockKind } from './ipc/fixLoop'
import {
  blockKey,
  changedSections,
  contentBlocks,
  diffBlocks,
  diffSentence,
  fixTextFor,
  isTrivial
} from './page-diff'

function page(...rows: [PageBlockKind, string][]): PageBlock[] {
  return rows.map(([kind, text], index) => ({ id: `b${index + 1}`, kind, text }))
}

const BEFORE = page(
  ['h1', 'AT&T email to text alternative'],
  ['p', 'Updated on Jun 4, 2026'],
  ['p', 'Send texts from your inbox.'],
  ['h2', 'Pricing'],
  ['p', 'Plans start at $10 a month.'],
  ['h2', 'How it works'],
  ['p', 'Write an email, we send a text.'],
  ['p', '© 2026 TextBolt. All rights reserved.']
)

describe('diffBlocks', () => {
  test('the same page is all same, and trivial', () => {
    const diff = diffBlocks(BEFORE, BEFORE)
    expect(diff.items.every((item) => item.op === 'same')).toBe(true)
    expect(isTrivial(diff)).toBe(true)
  })

  test('dates, spacing, case and curly quotes are noise', () => {
    const after = page(
      ['h1', 'AT&T  email to text alternative'],
      ['p', 'Updated on 28 October 2026'],
      ['p', 'send texts from your inbox.'],
      ['h2', 'Pricing'],
      ['p', 'Plans start at $10 a month.'],
      ['h2', 'How it works'],
      ['p', 'Write an email, we send a text.'],
      ['p', '© 2027 TextBolt. All rights reserved. Privacy']
    )
    expect(isTrivial(diffBlocks(BEFORE, after))).toBe(true)
    expect(blockKey('It’s “here” 2026-10-28')).toBe(blockKey('it\'s "here" 2026-09-01'))
  })

  test('the footer from its © line on is left out', () => {
    expect(contentBlocks(BEFORE).map((block) => block.text)).not.toContain(
      '© 2026 TextBolt. All rights reserved.'
    )
  })

  test('new sections, a reworded heading and changed text, each under its heading', () => {
    const after = page(
      ['h1', 'AT&T email to text alternative'],
      ['p', 'Updated on Oct 28, 2026'],
      ['p', 'Send texts from your inbox.'],
      ['h2', 'Pricing and plans'],
      ['p', 'Plans start at $12 a month, billed yearly.'],
      ['h2', 'How it works'],
      ['p', 'Write an email, we send a text.'],
      ['h2', 'Compare with AT&T'],
      ['p', 'AT&T closed its gateway in June.'],
      ['h2', 'FAQ'],
      ['li', 'Does it work with Gmail? Yes.']
    )
    const diff = diffBlocks(BEFORE, after)
    expect(diff.counts).toEqual({
      sectionsAdded: 2,
      sectionsRemoved: 0,
      headingsChanged: 1,
      textChanged: 1
    })
    const heading = diff.items.find((item) => item.op === 'changed' && item.kind === 'h2')
    expect(heading).toMatchObject({ before: 'Pricing', after: 'Pricing and plans' })
    const price = diff.items.find((item) => item.op === 'changed' && item.kind === 'p')
    expect(price).toMatchObject({
      before: 'Plans start at $10 a month.',
      after: 'Plans start at $12 a month, billed yearly.',
      section: 'Pricing and plans'
    })
    const added = diff.items.filter((item) => item.op === 'added').map((item) => item.section)
    expect(added).toEqual(['Compare with AT&T', 'Compare with AT&T', 'FAQ', 'FAQ'])
    expect(diffSentence(diff.counts)).toBe(
      '2 sections are new, 1 heading changed and text changed in 1 place.'
    )
    expect(changedSections(diff)).toEqual(['Pricing and plans', 'Compare with AT&T', 'FAQ'])
    expect(fixTextFor(diff)).toBe(
      '2 sections are new, 1 heading changed and text changed in 1 place. Changed: Pricing and plans, Compare with AT&T, FAQ.'
    )
  })

  test('a removed section counts once, and unlike blocks stay removed and added', () => {
    const after = page(
      ['h1', 'AT&T email to text alternative'],
      ['p', 'Updated on Jun 4, 2026'],
      ['p', 'A completely different opening line.'],
      ['h2', 'Pricing'],
      ['p', 'Plans start at $10 a month.']
    )
    const diff = diffBlocks(BEFORE, after)
    expect(diff.counts).toEqual({
      sectionsAdded: 0,
      sectionsRemoved: 1,
      headingsChanged: 0,
      textChanged: 2
    })
    expect(diff.items.map((item) => item.op)).toEqual([
      'same',
      'same',
      'removed',
      'added',
      'same',
      'same',
      'removed',
      'removed'
    ])
    expect(diffSentence(diff.counts)).toBe('1 section was removed and text changed in 2 places.')
  })

  test('a whole new page reads as added from an empty one', () => {
    const diff = diffBlocks([], BEFORE)
    expect(diff.items.every((item) => item.op === 'added')).toBe(true)
    expect(diff.counts.sectionsAdded).toBe(2)
    expect(diff.counts.headingsChanged).toBe(1)
  })

  test('the sentence for noise only', () => {
    expect(
      diffSentence({ sectionsAdded: 0, sectionsRemoved: 0, headingsChanged: 0, textChanged: 0 })
    ).toBe('Only small changes, such as dates or spacing.')
  })
})
