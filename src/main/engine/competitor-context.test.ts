import { afterEach, describe, expect, test } from 'vitest'
import type { PageSummary } from '@shared/domain'
import type { CompanySuggestion, ProductSuggestion } from '@shared/ipc'
import { closeDatabase, openSqliteDatabase, type SqliteDatabase } from '../storage/database'
import { insertPage } from '../storage/pages'
import { setPageProduct } from '../storage/products'
import { ensureProjectSchema, writeProjectProfile } from '../storage/project-profile'
import { upsertTopic } from '../topics/records'
import { competitorContext, domainOf, namedCompetitor } from './competitor-context'
import { saveFillCatalog } from './products'

const open: SqliteDatabase[] = []

afterEach(() => {
  for (const db of open.splice(0)) closeDatabase(db)
})

function projectDb(profile?: {
  competitors: string[]
  switchingFrom?: string[]
  integrations?: string[]
}): SqliteDatabase {
  const db = openSqliteDatabase(':memory:')
  open.push(db)
  ensureProjectSchema(db)
  if (profile !== undefined) {
    writeProjectProfile(db, {
      includeSubdomains: false,
      brandNames: ['TextBolt'],
      competitors: profile.competitors,
      switchingFrom: profile.switchingFrom,
      integrations: profile.integrations,
      market: {
        id: 'mkt-us',
        country: 'US',
        language: 'en',
        location: null,
        device: 'desktop',
        localWording: false,
        serpapiLocation: null
      }
    })
  }
  return db
}

describe('competitorContext (project-wide fallback, contract C1)', () => {
  test('every saved competitor is direct; partial is empty; no product', () => {
    const db = projectDb({
      competitors: ['simpletexting.com', 'Twilio', 'https://www.Notifyre.com/pricing'],
      switchingFrom: ['AT&T email-to-text gateway'],
      integrations: ['WIN-911', 'Gmail']
    })
    expect(competitorContext(db, {})).toEqual({
      product: null,
      direct: [
        { name: 'simpletexting.com', domain: 'simpletexting.com' },
        { name: 'Twilio', domain: null },
        { name: 'https://www.Notifyre.com/pricing', domain: 'notifyre.com' }
      ],
      partial: [],
      switchingFrom: ['AT&T email-to-text gateway'],
      integrations: ['WIN-911', 'Gmail']
    })
  })

  test('a page, topic or product scope reads the same project-wide lists', () => {
    const db = projectDb({ competitors: ['Twilio'] })
    const whole = competitorContext(db, {})
    expect(competitorContext(db, { pageId: 'page-1' })).toEqual(whole)
    expect(competitorContext(db, { topicId: 'topic-1' })).toEqual(whole)
    expect(competitorContext(db, { productId: 'prod-1', pageId: 'page-1' })).toEqual(whole)
  })

  test('a project with no profile yet has empty lists', () => {
    expect(competitorContext(projectDb(), { pageId: 'page-1' })).toEqual({
      product: null,
      direct: [],
      partial: [],
      switchingFrom: [],
      integrations: []
    })
  })

  test('an empty id is a caller bug', () => {
    const db = projectDb({ competitors: [] })
    expect(() => competitorContext(db, { pageId: '' })).toThrow(/pageId must be a non-empty id/)
    expect(() => competitorContext(db, { topicId: '  ' })).toThrow(/topicId/)
  })
})

describe('domainOf and namedCompetitor', () => {
  test('a domain or a site address gives its host', () => {
    expect(domainOf('simpletexting.com')).toBe('simpletexting.com')
    expect(domainOf('www.Twilio.com/sms')).toBe('twilio.com')
    expect(domainOf('https://get-voip.com/')).toBe('get-voip.com')
    expect(domainOf('http://app.textmagic.co.uk:8080/x?y=1')).toBe('app.textmagic.co.uk')
  })

  test('a plain name gives null', () => {
    expect(domainOf('SimpleTexting')).toBeNull()
    expect(domainOf('Text Magic')).toBeNull()
    expect(domainOf('AT&T')).toBeNull()
    expect(domainOf('')).toBeNull()
  })

  test('the name is kept as written', () => {
    expect(namedCompetitor('  ClickSend ')).toEqual({ name: 'ClickSend', domain: null })
  })
})

describe('competitorContext by product (package PC)', () => {
  const fill = {
    products: [
      product(
        'prod-gateway',
        'Email-to-SMS gateway',
        'Send SMS alerts from email',
        '/email-to-sms/'
      ),
      product('prod-bulk', 'Bulk SMS marketing', 'Text campaigns to customer lists', '/bulk-sms/'),
      product('prod-api', 'SMS API', 'Programmable messaging for developers', null)
    ],
    competitors: [
      company('TXTImpact', 'txtimpact.com', 'prod-gateway', 'direct'),
      company('Notifyre', 'notifyre.com', 'prod-gateway', 'direct'),
      company('SimpleTexting', 'simpletexting.com', 'prod-gateway', 'partial'),
      company('SimpleTexting', 'simpletexting.com', 'prod-bulk', 'direct'),
      company('Textedly', 'textedly.com', 'prod-bulk', 'direct'),
      company('Not kept', 'notkept.com', 'prod-bulk', 'direct')
    ]
  }

  function savedProject(): SqliteDatabase {
    const db = projectDb({
      competitors: [
        'txtimpact.com',
        'notifyre.com',
        'simpletexting.com',
        'textedly.com',
        'Typed rival'
      ],
      switchingFrom: ['AT&T email-to-text gateway'],
      integrations: ['Gmail']
    })
    saveFillCatalog(db, fill)
    insertPage(db, pageRow('page-gw', 'https://textbolt.com/email-to-sms/'))
    insertPage(db, pageRow('page-bulk', 'https://textbolt.com/blog/bulk-sms-marketing-tips/'))
    insertPage(db, pageRow('page-about', 'https://textbolt.com/about/'))
    return db
  }

  test('an email-to-SMS page reads that product’s direct and partial lists plus whole-business rows', () => {
    const db = savedProject()
    const context = competitorContext(db, { pageId: 'page-gw' })
    expect(context.product?.id).toBe('prod-gateway')
    expect(context.direct.map((item) => item.name)).toEqual([
      'TXTImpact',
      'Notifyre',
      'Typed rival'
    ])
    expect(context.partial).toEqual([{ name: 'SimpleTexting', domain: 'simpletexting.com' }])
    expect(context.switchingFrom).toEqual(['AT&T email-to-text gateway'])
    expect(context.integrations).toEqual(['Gmail'])
  })

  test('the same company is direct for one product and partial for another', () => {
    const db = savedProject()
    const context = competitorContext(db, { pageId: 'page-bulk' })
    expect(context.product?.id).toBe('prod-bulk')
    expect(context.direct.map((item) => item.name)).toEqual([
      'SimpleTexting',
      'Textedly',
      'Typed rival'
    ])
    expect(context.partial).toEqual([])
  })

  test('no saved competitors for the product, an unmapped page, or no scope: the project-wide list', () => {
    const db = savedProject()
    const whole = competitorContext(db, {})
    expect(whole.product).toBeNull()
    expect(whole.direct.map((item) => item.name)).toEqual([
      'TXTImpact',
      'Notifyre',
      'SimpleTexting',
      'Textedly',
      'Typed rival'
    ])
    expect(whole.partial).toEqual([])
    const api = competitorContext(db, { productId: 'prod-api' })
    expect(api.product?.name).toBe('SMS API')
    expect(api.direct).toEqual(whole.direct)
    expect(competitorContext(db, { pageId: 'page-about' }).direct).toEqual(whole.direct)
    expect(competitorContext(db, { pageId: 'page-missing' }).product).toBeNull()
  })

  test('a pinned product wins over the URL; productId wins over the page', () => {
    const db = savedProject()
    setPageProduct(db, 'page-gw', 'prod-bulk', true)
    expect(competitorContext(db, { pageId: 'page-gw' }).product?.id).toBe('prod-bulk')
    expect(
      competitorContext(db, { pageId: 'page-gw', productId: 'prod-gateway' }).product?.id
    ).toBe('prod-gateway')
    setPageProduct(db, 'page-gw', null, true)
    expect(competitorContext(db, { pageId: 'page-gw' }).product).toBeNull()
  })

  test('a topic reads the product its seed is about', () => {
    const db = savedProject()
    insertPage(db, { ...pageRow('topic-1', null), kind: 'topic', title: 'Alerts' })
    upsertTopic(db, {
      pageId: 'topic-1',
      seed: 'Send SMS alerts to the on-call team from our email client',
      source: 'seed',
      competitorUrl: null,
      website: null,
      about: null,
      generate: 'questions',
      depth: {},
      bands: { questions: { lo: 50, hi: 70 }, keywords: { lo: 25, hi: 40 } },
      draftId: null,
      createdAt: '2026-10-22T00:00:00.000Z',
      updatedAt: '2026-10-22T00:00:00.000Z'
    })
    expect(competitorContext(db, { topicId: 'topic-1' }).product?.id).toBe('prod-gateway')
  })
})

function product(id: string, name: string, job: string, path: string | null): ProductSuggestion {
  return {
    id,
    name,
    job,
    buyer: 'Buyers',
    evidence: path === null ? null : { path, quote: name },
    searchNote: null
  }
}

function company(
  name: string,
  domain: string,
  productId: string,
  tier: 'direct' | 'partial'
): CompanySuggestion {
  return {
    id: `c-${name}-${productId}`,
    name,
    domain,
    domainSource: 'search',
    reason: 'r',
    evidence: null,
    checkDomain: false,
    product: productId,
    tier,
    startingPrice: null,
    sources: []
  }
}

function pageRow(id: string, url: string | null): PageSummary {
  return {
    id,
    projectId: 'proj-1',
    url,
    title: null,
    label: null,
    folder: null,
    status: 'not_tracked',
    setupStep: 'read',
    intervalDays: 14,
    samples: 1,
    promptCount: 10,
    defaultMarketId: null,
    pinned: false,
    score: null,
    promptSetVersion: null
  }
}
