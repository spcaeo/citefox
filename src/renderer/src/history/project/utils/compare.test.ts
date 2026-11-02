import { describe, expect, test } from 'vitest'
import type { AioReference } from '@shared/domain'
import { promptRow } from '../ProjectHistory.fixtures'
import { countRows, isCited } from './compare'

const own: AioReference = {
  id: 'own-1',
  position: 2,
  url: 'https://textbolt.com/pricing/',
  normalizedUrl: 'textbolt.com/pricing',
  domain: 'textbolt.com',
  title: 'Pricing',
  classification: 'own',
  untracked: true,
  sourceType: 'web'
}

describe('Check history: cited follows the one rule (audit2 #1)', () => {
  test('a topic counts a search cited only when its AI Overview links a page of the site', () => {
    const linked = promptRow('p1', 1, 'other_own_page', {
      references: [own]
    })
    // Saved as "your other page" but no link to the site in the AI Overview.
    const unlinked = promptRow('p2', 2, 'other_own_page')
    const named = promptRow('p3', 3, 'brand_mentioned', { references: [own] })
    const none = promptRow('p4', 4, 'no_aio', { references: [own] })
    expect(isCited(linked, true)).toBe(true)
    expect(isCited(unlinked, true)).toBe(false)
    expect(isCited(named, true)).toBe(true)
    expect(isCited(none, true)).toBe(false)
    expect(countRows([linked, unlinked, named, none], 'cited', true)).toEqual([linked, named])
  })

  test('a page counts only its own page', () => {
    expect(isCited(promptRow('p1', 1, 'page_cited'), false)).toBe(true)
    expect(isCited(promptRow('p2', 2, 'other_own_page', { references: [own] }), false)).toBe(false)
  })
})
