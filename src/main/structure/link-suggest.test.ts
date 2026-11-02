import { describe, expect, test } from 'vitest'
import { suggestInternalLinks } from './link-suggest'

const SITE = 'https://textbolt.com'
const pillar = {
  id: 'p',
  url: `${SITE}/blog/10dlc-registration-guide/`,
  title: '10DLC registration guide | TextBolt'
}

describe('suggestInternalLinks', () => {
  test('links orphans first, then supporting pages, to the pillar', () => {
    const links = suggestInternalLinks({
      pillar,
      pages: [
        { ...pillar, role: 'pillar' },
        { id: 's2', url: `${SITE}/blog/10dlc-fees/`, title: '10DLC fees', role: 'supporting' },
        { id: 's1', url: `${SITE}/blog/10dlc-vetting/`, title: null, role: 'supporting' },
        { id: 'o1', url: `${SITE}/blog/campaign-rejected/`, title: null, role: 'orphan' }
      ]
    })
    expect(links.map((link) => link.fromPageId)).toEqual(['o1', 's1', 's2'])
    expect(links[0]).toEqual({
      fromPageId: 'o1',
      fromUrl: `${SITE}/blog/campaign-rejected/`,
      toPageId: 'p',
      toUrl: pillar.url,
      anchor: '10DLC registration guide',
      where: 'In the first paragraph that mentions "10DLC registration"'
    })
  })

  test('adds a pillar-to-orphan link when there is room', () => {
    const links = suggestInternalLinks({
      pillar,
      pages: [
        { id: 'o1', url: `${SITE}/blog/campaign-rejected-errors/`, title: null, role: 'orphan' }
      ]
    })
    expect(links).toHaveLength(2)
    expect(links[1]).toMatchObject({
      fromPageId: 'p',
      toPageId: 'o1',
      anchor: 'campaign rejected errors',
      where: 'In the section closest to "Campaign rejected"'
    })
  })

  test('keeps an acronym at the start of a slug anchor', () => {
    const links = suggestInternalLinks({
      pillar: { id: 'p', url: `${SITE}/blog/sms-pricing-explained/`, title: null },
      pages: [{ id: 's', url: `${SITE}/blog/x/`, title: null, role: 'supporting' }]
    })
    expect(links[0]?.anchor).toBe('SMS pricing explained')
  })

  test('returns nothing without a pillar', () => {
    expect(
      suggestInternalLinks({ pillar: null, pages: [{ ...pillar, role: 'supporting' }] })
    ).toEqual([])
  })
})
