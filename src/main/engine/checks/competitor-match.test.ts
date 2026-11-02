import { describe, expect, test } from 'vitest'
import { classifySample } from './classify'
import {
  competitorFor,
  competitorLabel,
  hostIsCompetitor,
  isCompetitorHost,
  storedCompetitor
} from './competitor-match'

describe('hostIsCompetitor', () => {
  test('a saved domain matches the domain and its subdomains, never a lookalike', () => {
    const twilio = { name: 'Twilio', domain: 'twilio.com' }
    expect(hostIsCompetitor('twilio.com', twilio)).toBe(true)
    expect(hostIsCompetitor('www.twilio.com', twilio)).toBe(true)
    expect(hostIsCompetitor('blog.twilio.com', twilio)).toBe(true)
    expect(hostIsCompetitor('nottwilio.com', twilio)).toBe(false)
    expect(hostIsCompetitor('twilio.com.evil.io', twilio)).toBe(false)
  })

  test("a name matches the host's site label, across country domains and spacing", () => {
    expect(hostIsCompetitor('simpletexting.com', 'SimpleTexting')).toBe(true)
    expect(
      hostIsCompetitor('blog.simpletexting.com', { name: 'Simple Texting', domain: null })
    ).toBe(true)
    expect(hostIsCompetitor('textmagic.co.uk', 'Textmagic')).toBe(true)
    expect(hostIsCompetitor('att.com', 'AT&T')).toBe(true)
    expect(hostIsCompetitor('simpletextingreviews.com', 'SimpleTexting')).toBe(false)
    expect(hostIsCompetitor('ab.com', 'AB')).toBe(false)
  })

  test('a name that is a domain matches only as that domain', () => {
    expect(hostIsCompetitor('twilio.com', 'twilio.com')).toBe(true)
    expect(hostIsCompetitor('twilio.co.uk', 'twilio.com')).toBe(false)
    expect(hostIsCompetitor('', 'twilio.com')).toBe(false)
  })
})

describe('competitorFor and storedCompetitor', () => {
  const lists = {
    direct: [{ name: 'SimpleTexting', domain: 'simpletexting.com' }],
    partial: [{ name: 'Twilio', domain: 'twilio.com' }]
  }

  test('names the competitor and its tier, direct first', () => {
    expect(competitorFor('simpletexting.com', lists)).toEqual({
      name: 'SimpleTexting',
      tier: 'direct'
    })
    expect(competitorFor('help.twilio.com', lists)).toEqual({ name: 'Twilio', tier: 'partial' })
    expect(competitorFor('reddit.com', lists)).toBeNull()
  })

  test('follows the stored class: other stays other, an unlisted competitor keeps no tier', () => {
    expect(storedCompetitor({ domain: 'twilio.com', classification: 'other' }, lists)).toBeNull()
    expect(
      storedCompetitor({ url: 'https://www.twilio.com/sms', classification: 'competitor' }, lists)
    ).toEqual({ name: 'Twilio', tier: 'partial' })
    const old = storedCompetitor({ domain: 'clicksend.com', classification: 'competitor' }, lists)
    expect(old).toEqual({ name: 'clicksend.com', tier: null })
    expect(competitorLabel(old ?? { name: '', tier: null })).toBe('competitor: clicksend.com')
    expect(competitorLabel({ name: 'Twilio', tier: 'partial' })).toBe('competitor: Twilio, partial')
  })

  test('the classification and the report label never disagree', () => {
    const hosts = [
      'simpletexting.com',
      'blog.simpletexting.com',
      'twilio.com',
      'twilio.co.uk',
      'help.twilio.com',
      'reddit.com',
      'textbolt.com',
      'clicksend.com'
    ]
    const competitors = [...lists.direct, ...lists.partial]
    const classified = classifySample({
      failed: false,
      hasAio: true,
      aioText: null,
      targetUrl: null,
      ownDomain: 'textbolt.com',
      includeSubdomains: false,
      brandNames: [],
      competitors,
      trackedUrls: [],
      references: hosts.map((host) => ({ url: `https://${host}/page`, title: null }))
    })
    for (const reference of classified.references) {
      const labelled = storedCompetitor(reference, lists) !== null
      expect(labelled).toBe(reference.classification === 'competitor')
      expect(isCompetitorHost(reference.domain, competitors)).toBe(
        reference.classification === 'competitor'
      )
    }
  })
})
