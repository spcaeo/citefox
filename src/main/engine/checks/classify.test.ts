import { describe, expect, test } from 'vitest'
import { brandNamed, classifySample, type ClassifyInput } from './classify'
import { normalizeUrl } from './url'

const TARGET = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'

describe('classifySample', () => {
  test('marks the target page, a subdomain, an untracked own URL, and a competitor', () => {
    const classified = classifySample({
      failed: false,
      hasAio: true,
      aioText: 'TextBolt pricing is listed.',
      targetUrl: TARGET,
      ownDomain: 'textbolt.com',
      includeSubdomains: true,
      brandNames: ['TextBolt'],
      competitors: ['SimpleTexting'],
      trackedUrls: [normalizeUrl(TARGET) ?? ''],
      references: [
        {
          url: 'https://www.textbolt.com/blog/how-to-set-up-text-alerts-for-business/#cited',
          title: 'Target'
        },
        { url: 'https://help.textbolt.com/docs/', title: 'Help' },
        { url: 'https://textbolt.com/pricing/', title: 'Pricing' },
        { url: 'https://simpletexting.com/blog/text-employees/', title: 'Competitor' }
      ]
    })
    expect(classified.status).toBe('page_cited')
    expect(classified.named).toBe(true)
    expect(classified.position).toBe(1)
    expect(classified.references.map((reference) => reference.classification)).toEqual([
      'target',
      'own',
      'own',
      'competitor'
    ])
    expect(classified.references[1]?.untracked).toBe(true)
    expect(classified.references[2]?.untracked).toBe(true)
    expect(classified.references[0]?.untracked).toBe(false)
    expect(classified.references[3]?.sourceType).toBe('web')
  })

  test('names the brand without an own-domain link', () => {
    const classified = classifySample({
      failed: false,
      hasAio: true,
      aioText: 'People mention TextBolt.',
      targetUrl: TARGET,
      ownDomain: 'textbolt.com',
      includeSubdomains: false,
      brandNames: ['TextBolt'],
      competitors: [],
      trackedUrls: [],
      references: [
        { url: 'https://www.reddit.com/r/smallbusiness/comments/example', title: 'Thread' }
      ]
    })
    expect(classified.status).toBe('brand_mentioned')
    expect(classified.named).toBe(true)
    expect(classified.citedUrl).toBeNull()
    expect(classified.references[0]?.sourceType).toBe('reddit')
  })

  test('keeps a competitor citation as not cited when the brand is absent', () => {
    const classified = classifySample({
      failed: false,
      hasAio: true,
      aioText: 'Several vendors offer business texting.',
      targetUrl: TARGET,
      ownDomain: 'textbolt.com',
      includeSubdomains: false,
      brandNames: ['TextBolt'],
      competitors: ['SimpleTexting'],
      trackedUrls: [],
      references: [{ url: 'https://simpletexting.com/blog/text-employees/', title: null }]
    })
    expect(classified.status).toBe('not_cited')
    expect(classified.named).toBe(false)
    expect(classified.references[0]?.classification).toBe('competitor')
  })

  test('uses another own page when the target is absent', () => {
    const classified = classifySample({
      failed: false,
      hasAio: true,
      aioText: 'See the pricing page.',
      targetUrl: TARGET,
      ownDomain: 'textbolt.com',
      includeSubdomains: false,
      brandNames: ['TextBolt'],
      competitors: [],
      trackedUrls: [],
      references: [{ url: 'https://textbolt.com/pricing/?utm_source=aio', title: 'Pricing' }]
    })
    expect(classified.status).toBe('other_own_page')
    expect(classified.citedUrl).toContain('/pricing')
    expect(classified.references[0]?.normalizedUrl).toBe('https://textbolt.com/pricing')
  })

  test('stores no overview and a failed capture separately', () => {
    expect(
      classifySample({
        failed: false,
        hasAio: false,
        aioText: null,
        references: [],
        targetUrl: TARGET,
        ownDomain: 'textbolt.com',
        includeSubdomains: false,
        brandNames: ['TextBolt'],
        competitors: [],
        trackedUrls: []
      }).status
    ).toBe('no_aio')
    expect(
      classifySample({
        failed: true,
        hasAio: false,
        aioText: null,
        references: [],
        targetUrl: TARGET,
        ownDomain: 'textbolt.com',
        includeSubdomains: false,
        brandNames: [],
        competitors: [],
        trackedUrls: []
      })
    ).toMatchObject({ status: 'error', named: null })
  })
})

function input(overrides: Partial<ClassifyInput>): ClassifyInput {
  return {
    failed: false,
    hasAio: true,
    aioText: null,
    references: [],
    targetUrl: TARGET,
    ownDomain: 'textbolt.com',
    includeSubdomains: false,
    brandNames: ['TextBolt'],
    competitors: [],
    trackedUrls: [],
    ...overrides
  }
}

describe('classifySample URL matching (FR-6.1)', () => {
  test('a target typed as http with www matches an https citation with tracking params', () => {
    const classified = classifySample(
      input({
        targetUrl: 'http://www.textbolt.com/blog/how-to-set-up-text-alerts-for-business',
        references: [
          {
            url: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/?srsltid=AfmB&ved=1&sa=X#:~:text=alerts',
            title: 'Target'
          }
        ]
      })
    )
    expect(classified.status).toBe('page_cited')
    expect(classified.references[0]?.normalizedUrl).toBe(
      'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business'
    )
  })

  test('a Google redirect citation resolves to the target page', () => {
    const classified = classifySample(
      input({
        references: [
          { url: `https://www.google.com/url?q=${encodeURIComponent(TARGET)}`, title: 'Target' }
        ]
      })
    )
    expect(classified.status).toBe('page_cited')
    expect(classified.references[0]?.domain).toBe('textbolt.com')
  })

  test('the same page cited over http and https counts once', () => {
    const classified = classifySample(
      input({
        references: [
          { url: 'http://textbolt.com/pricing', title: 'Pricing' },
          { url: 'https://www.textbolt.com/pricing/', title: 'Pricing again' }
        ]
      })
    )
    expect(classified.status).toBe('other_own_page')
    expect(classified.references).toHaveLength(1)
  })

  test('a subdomain is own only when the project counts subdomains', () => {
    const references = [{ url: 'https://help.textbolt.com/docs', title: 'Help' }]
    expect(classifySample(input({ references, includeSubdomains: true })).status).toBe(
      'other_own_page'
    )
    const without = classifySample(input({ references, includeSubdomains: false }))
    expect(without.status).toBe('not_cited')
    expect(without.references[0]?.classification).toBe('other')
  })
})

describe('classifySample competitors by product (prompt audit P9)', () => {
  const references = [
    { url: 'https://www.simpletexting.com/blog/text-employees/', title: 'SimpleTexting' },
    { url: 'https://blog.twilio.com/sms', title: 'Twilio blog' },
    { url: 'https://www.clicksend.com.au/pricing', title: 'ClickSend' }
  ]
  const emailToSms = {
    direct: [{ name: 'SimpleTexting', domain: 'simpletexting.com' }],
    partial: [{ name: 'ClickSend', domain: null }]
  }
  const massTexting = { direct: [{ name: 'Twilio', domain: 'twilio.com' }], partial: [] }
  const classesFor = (lists: typeof emailToSms | typeof massTexting): string[] =>
    classifySample(
      input({ references, competitors: [...lists.direct, ...lists.partial] })
    ).references.map((reference) => reference.classification)

  test("a domain is a competitor on product A's page and other on product B's", () => {
    expect(classesFor(emailToSms)).toEqual(['competitor', 'other', 'competitor'])
    expect(classesFor(massTexting)).toEqual(['other', 'competitor', 'other'])
  })

  test("a competitor's subdomain is that competitor, whatever the own-subdomain setting", () => {
    for (const includeSubdomains of [true, false]) {
      const classified = classifySample(
        input({ references, includeSubdomains, competitors: massTexting.direct })
      )
      expect(classified.references[1]?.classification).toBe('competitor')
    }
  })

  test('the flat list still matches by name or domain, as before', () => {
    const classified = classifySample(
      input({ references, competitors: ['SimpleTexting', 'twilio.com'] })
    )
    expect(classified.references.map((reference) => reference.classification)).toEqual([
      'competitor',
      'competitor',
      'other'
    ])
  })
})

describe('brandNamed (FR-6.4)', () => {
  test('matches the brand as a whole word, not inside another word', () => {
    expect(brandNamed('Check your inbox for the code.', ['Box'])).toBe(false)
    expect(brandNamed('Dropbox and others store files.', ['Box'])).toBe(false)
    expect(brandNamed('Box stores files.', ['Box'])).toBe(true)
    expect(brandNamed('Try box, then decide.', ['Box'])).toBe(true)
    expect(brandNamed('Boxes are cheap.', ['Box'])).toBe(false)
  })

  test('folds case and accents in both directions', () => {
    expect(brandNamed('Reve makes it easy.', ['Rêve'])).toBe(true)
    expect(brandNamed('RÊVE makes it easy.', ['reve'])).toBe(true)
    expect(brandNamed('Zoë and Zoe are different spellings.', ['ZOE'])).toBe(true)
    expect(brandNamed('Crème brûlée', ['Brule'])).toBe(false)
  })

  test('keeps brands with punctuation working', () => {
    expect(brandNamed('Teams book trips on Booking.com today.', ['Booking.com'])).toBe(true)
    expect(brandNamed('See you at the booking desk.', ['Booking.com'])).toBe(false)
    expect(brandNamed("AT&T's network covers the area.", ['AT&T'])).toBe(true)
    expect(brandNamed('BAT&TOWER is a building.', ['AT&T'])).toBe(false)
    expect(brandNamed('Ask about C++ tooling.', ['C++'])).toBe(true)
  })

  test('matches multi-word brands across spacing and ignores blank names', () => {
    expect(brandNamed('Use Simple  Texting today.', ['Simple Texting'])).toBe(true)
    expect(brandNamed('Anything at all.', ['  '])).toBe(false)
    expect(brandNamed(null, ['TextBolt'])).toBe(false)
  })

  test('matches non-Latin scripts on word boundaries', () => {
    expect(brandNamed('Мы используем Яндекс каждый день.', ['Яндекс'])).toBe(true)
    expect(brandNamed('Мы используем Яндексом.', ['Яндекс'])).toBe(false)
  })
})

describe('classifySample for a topic', () => {
  const topic = (targetPage: string | null): ClassifyInput => ({
    failed: false,
    hasAio: true,
    aioText: 'Plans start at $29.',
    targetUrl: null,
    targetPage,
    ownDomain: 'textbolt.com',
    includeSubdomains: false,
    brandNames: ['TextBolt'],
    competitors: [],
    trackedUrls: [],
    references: [
      { url: 'https://textbolt.com/blog/sms-guide/', title: 'Guide' },
      { url: 'http://www.textbolt.com/Pricing/?ref=aio#plans', title: 'Pricing' }
    ]
  })

  test('without a target page, any own page is the cited page', () => {
    for (const input of [topic(null), { ...topic(null), targetPage: undefined }]) {
      const classified = classifySample(input)
      expect(classified.status).toBe('page_cited')
      expect(classified.citedUrl).toBe('https://textbolt.com/blog/sms-guide/')
      expect(classified.references.map((reference) => reference.classification)).toEqual([
        'own',
        'own'
      ])
    }
  })

  test('the target page counts as page cited, ignoring scheme, www, case, slash, query and hash', () => {
    const classified = classifySample(topic('https://textbolt.com/pricing'))
    expect(classified.status).toBe('page_cited')
    expect(classified.position).toBe(2)
    expect(classified.citedUrl).toBe('http://www.textbolt.com/Pricing/?ref=aio#plans')
    expect(classified.references.map((reference) => reference.classification)).toEqual([
      'own',
      'target'
    ])
  })

  test("a question's own pages (Primary + Also OK) replace the topic's page", () => {
    const also = classifySample({
      ...topic('https://textbolt.com/features'),
      targetPages: ['https://textbolt.com/features', 'https://textbolt.com/blog/sms-guide']
    })
    expect(also.status).toBe('page_cited')
    expect(also.citedUrl).toBe('https://textbolt.com/blog/sms-guide/')
    expect(also.references.map((reference) => reference.classification)).toEqual([
      'target',
      'own'
    ])
    // An empty list: the question has no target yet, so any own page counts.
    expect(
      classifySample({ ...topic('https://textbolt.com/features'), targetPages: [] }).status
    ).toBe('page_cited')
  })

  test('a target page that was not cited leaves the other own page', () => {
    const classified = classifySample(topic('https://textbolt.com/features'))
    expect(classified.status).toBe('other_own_page')
    expect(classified.citedUrl).toBe('https://textbolt.com/blog/sms-guide/')
  })
})
