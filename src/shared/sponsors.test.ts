import { describe, expect, it } from 'vitest'
import { SPONSORS, SPONSOR_UTM, sponsorHref, sponsorOf } from './sponsors'

describe('sponsors', () => {
  it('has one gold sponsor (FoxCue) and one silver sponsor (FreshlyCited)', () => {
    expect(sponsorOf('gold').name).toBe('FoxCue')
    expect(sponsorOf('silver').name).toBe('FreshlyCited')
    expect(SPONSORS).toHaveLength(2)
  })

  it.each(SPONSORS.map((sponsor) => [sponsor.name, sponsor] as const))(
    '%s links to its own https home page with only the three utm parameters',
    (_name, sponsor) => {
      const url = new URL(sponsorHref(sponsor))
      expect(url.protocol).toBe('https:')
      expect(url.origin).toBe(new URL(sponsor.url).origin)
      expect(url.hash).toBe('')
      expect(Object.fromEntries(url.searchParams)).toEqual(SPONSOR_UTM)
    }
  )

  it('drops any other query or fragment, so no data can ride along', () => {
    const href = sponsorHref({ url: 'https://foxcue.com/?project=textbolt&user=ada#page' })
    expect(href).toBe('https://foxcue.com/?utm_source=citefox&utm_medium=app&utm_campaign=sponsor')
  })

  it('keeps text on the accent colour dark enough to read', () => {
    for (const sponsor of SPONSORS) {
      expect(sponsor.colors.onAccent).not.toMatch(/^#f{3,6}$/i)
    }
  })
})
