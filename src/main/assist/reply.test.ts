import { describe, expect, test } from 'vitest'
import { claimsEditCausedCitation, readAssistReply } from './reply'

function item(text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { text, ...extra }
}

describe('readAssistReply', () => {
  test('fills missing optional keys and trims text', () => {
    const read = readAssistReply(
      { items: [item('  Add an FAQ.  ', { detail: ' ', tag: 'high' })] },
      { maxItems: 3 }
    )
    expect(read).toEqual({
      reply: {
        summary: null,
        caution: null,
        items: [{ text: 'Add an FAQ.', detail: null, tag: 'high', verify: null, sign: null }]
      }
    })
  })

  test('rejects a reply outside the schema', () => {
    expect(readAssistReply({ items: [{ text: '' }] }, {})).toEqual({
      problem: 'The reply did not match the schema.'
    })
    expect(readAssistReply({ items: [], extra: true }, {})).toEqual({
      problem: 'The reply did not match the schema.'
    })
    expect(readAssistReply(null, {})).toEqual({ problem: 'The reply did not match the schema.' })
  })

  test('applies the item limits', () => {
    const three = { items: [item('a'), item('b'), item('c')] }
    expect(readAssistReply(three, { minItems: 4 })).toEqual({ problem: 'Give at least 4 items.' })
    expect(readAssistReply(three, { maxItems: 2 })).toEqual({ problem: 'Give at most 2 items.' })
    expect(readAssistReply(three, { minItems: 3, maxItems: 3 })).toHaveProperty('reply')
    const many = { items: Array.from({ length: 13 }, (_, index) => item(`line ${index}`)) }
    expect(readAssistReply(many, {})).toEqual({ problem: 'Give at most 12 items.' })
  })

  test('signed items need add or remove on every line', () => {
    const mixed = { items: [item('New line', { sign: 'add' }), item('Old line')] }
    expect(readAssistReply(mixed, { signedItems: true })).toEqual({
      problem: 'Mark every line "add" or "remove".'
    })
    const signed = { items: [item('New line', { sign: 'add' }), item('Old', { sign: 'remove' })] }
    expect(readAssistReply(signed, { signedItems: true })).toHaveProperty('reply')
    expect(readAssistReply({ items: [item('x', { sign: 'keep' })] }, {})).toEqual({
      problem: 'The reply did not match the schema.'
    })
  })

  test('rejects a claim that an edit caused a citation change anywhere in the reply', () => {
    const problem = { problem: 'Do not say that a page edit caused a citation change.' }
    expect(
      readAssistReply({ summary: 'The new FAQ led to the citation on Oct 19.', items: [] }, {})
    ).toEqual(problem)
    expect(
      readAssistReply({ items: [item('Prompt 4', { detail: 'Cited because of the update.' })] }, {})
    ).toEqual(problem)
    expect(
      readAssistReply({ caution: 'The rewrite earned the AI Overview spot.', items: [] }, {})
    ).toEqual(problem)
    expect(
      readAssistReply(
        { summary: 'Cited on Oct 19. The FAQ went live on Oct 12. Both are shown.', items: [] },
        {}
      )
    ).toHaveProperty('reply')
  })
})

describe('claimsEditCausedCitation', () => {
  test.each([
    ['The edit caused the citation.', true],
    ['Adding the FAQ resulted in visibility in AI Overview.', true],
    ['Visibility went up due to the changes.', true],
    ['The page is cited at #2. The FAQ went live Oct 10.', false],
    ['Add an FAQ because buyers ask about price.', false]
  ])('%s -> %s', (text, expected) => {
    expect(claimsEditCausedCitation(text)).toBe(expected)
  })
})
