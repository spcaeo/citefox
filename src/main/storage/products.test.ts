import { afterEach, describe, expect, test } from 'vitest'
import { inferProduct } from '@shared/domain'
import type { ProductCompetitor, ProjectProduct } from '@shared/domain'
import { closeDatabase, openSqliteDatabase, type SqliteDatabase } from './database'
import { migrate } from './migrate'
import { insertPage } from './pages'
import { ensureProjectSchema, readProjectProfile, writeProjectProfile } from './project-profile'
import { PROJECT_MIGRATIONS } from './project-schema'
import { PRODUCTS_VERSION } from './project-schema-products'
import {
  listProductCompetitors,
  readPageProductRow,
  readProductCatalog,
  replaceProductCatalog,
  setPageProduct
} from './products'
import { updateProjectProfile } from './project-profile'

const open: SqliteDatabase[] = []

afterEach(() => {
  for (const db of open.splice(0)) closeDatabase(db)
})

const MARKET = {
  id: 'mkt-us',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop' as const,
  localWording: false,
  serpapiLocation: null
}

const GATEWAY: ProjectProduct = {
  id: 'prod-gateway',
  name: 'Email-to-SMS gateway',
  job: 'Send SMS alerts from any email client or app',
  buyer: 'IT and facilities teams',
  evidencePath: '/email-to-sms/'
}
const BULK: ProjectProduct = {
  id: 'prod-bulk',
  name: 'Bulk SMS marketing',
  job: 'Send text campaigns to customer lists',
  buyer: 'Small business marketers',
  evidencePath: '/bulk-sms/'
}

function row(
  name: string,
  domain: string | null,
  productId: string | null,
  tier: 'direct' | 'partial' = 'direct'
): ProductCompetitor {
  return { name, domain, productId, tier, startingPrice: null, sources: [] }
}

function projectDb(competitors: string[] = []): SqliteDatabase {
  const db = openSqliteDatabase(':memory:')
  open.push(db)
  ensureProjectSchema(db)
  writeProjectProfile(db, {
    includeSubdomains: false,
    brandNames: ['TextBolt'],
    competitors,
    market: MARKET
  })
  return db
}

function addPage(db: SqliteDatabase, id: string, url: string, title: string | null = null): void {
  insertPage(db, {
    id,
    projectId: 'proj-1',
    url,
    title,
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
  })
}

describe('migration 034 (products)', () => {
  test('copies the flat competitor list into whole-business rows, once per name', () => {
    const db = openSqliteDatabase(':memory:')
    open.push(db)
    migrate(db, PROJECT_MIGRATIONS.slice(0, PRODUCTS_VERSION - 1))
    db.prepare(
      `INSERT INTO project_settings (id, include_subdomains, brand_names, competitors)
       VALUES (1, 0, '["TextBolt"]', ?)`
    ).run(JSON.stringify(['simpletexting.com', 'Twilio', 'twilio', 'https://www.Notifyre.com/']))
    migrate(db, PROJECT_MIGRATIONS)
    expect(listProductCompetitors(db)).toEqual([
      row('simpletexting.com', 'simpletexting.com', null),
      row('Twilio', null, null),
      row('https://www.Notifyre.com/', 'notifyre.com', null)
    ])
    expect(readProductCatalog(db).products).toEqual([])
  })

  test('a project with no profile yet migrates with no rows; pages gain product columns', () => {
    const db = openSqliteDatabase(':memory:')
    open.push(db)
    migrate(db, PROJECT_MIGRATIONS)
    expect(listProductCompetitors(db)).toEqual([])
    addPage(db, 'page-1', 'https://textbolt.com/a/')
    expect(readPageProductRow(db, 'page-1')).toMatchObject({ productId: null, pinned: false })
  })
})

describe('replaceProductCatalog', () => {
  test('saves products and rows, and rewrites the flat list as their union', () => {
    const db = projectDb(['old.com'])
    replaceProductCatalog(db, {
      products: [GATEWAY, BULK],
      competitors: [
        { ...row('TXTImpact', 'txtimpact.com', GATEWAY.id), startingPrice: '$29/mo' },
        row('SimpleTexting', 'simpletexting.com', GATEWAY.id, 'partial'),
        row('SimpleTexting', 'simpletexting.com', BULK.id),
        row('Local rival', null, null)
      ]
    })
    const catalog = readProductCatalog(db)
    expect(catalog.products.map((item) => item.id)).toEqual([GATEWAY.id, BULK.id])
    expect(catalog.products[0]?.evidencePath).toBe('/email-to-sms/')
    expect(catalog.competitors.map((item) => [item.name, item.productId, item.tier])).toEqual([
      ['TXTImpact', GATEWAY.id, 'direct'],
      ['SimpleTexting', GATEWAY.id, 'partial'],
      ['SimpleTexting', BULK.id, 'direct'],
      ['Local rival', null, 'direct']
    ])
    expect(catalog.competitors[0]?.startingPrice).toBe('$29/mo')
    expect(readProjectProfile(db)?.competitors).toEqual([
      'txtimpact.com',
      'simpletexting.com',
      'Local rival'
    ])
  })

  test('keeps a page mapped to a kept product; a removed product unpins its pages', () => {
    const db = projectDb()
    replaceProductCatalog(db, { products: [GATEWAY, BULK], competitors: [] })
    addPage(db, 'page-1', 'https://textbolt.com/x/')
    addPage(db, 'page-2', 'https://textbolt.com/y/')
    setPageProduct(db, 'page-1', GATEWAY.id, true)
    setPageProduct(db, 'page-2', BULK.id, true)
    replaceProductCatalog(db, {
      products: [{ ...GATEWAY, name: 'Email to SMS' }],
      competitors: []
    })
    expect(readPageProductRow(db, 'page-1')).toMatchObject({ productId: GATEWAY.id, pinned: true })
    expect(readPageProductRow(db, 'page-2')).toMatchObject({ productId: null, pinned: false })
    expect(readProductCatalog(db).products[0]?.name).toBe('Email to SMS')
  })

  test('refuses a bad catalog and leaves the saved one as it was', () => {
    const db = projectDb()
    replaceProductCatalog(db, { products: [GATEWAY], competitors: [row('A', 'a.com', null)] })
    const bad = [
      { products: [GATEWAY, GATEWAY], competitors: [] },
      { products: [{ ...GATEWAY, id: 'bad id' }], competitors: [] },
      { products: [GATEWAY], competitors: [row('A', null, 'prod-unknown')] },
      { products: [GATEWAY], competitors: [row('', null, null)] },
      { products: [GATEWAY], competitors: [row('x'.repeat(81), null, null)] },
      {
        products: [GATEWAY],
        competitors: [{ ...row('A', null, null), tier: 'close' as 'direct' }]
      }
    ]
    for (const catalog of bad) {
      expect(() => replaceProductCatalog(db, catalog)).toThrow()
    }
    expect(readProductCatalog(db).competitors.map((item) => item.name)).toEqual(['A'])
  })

  test('tidies: one name per product, bare domains, http(s) sources only, clipped text', () => {
    const db = projectDb()
    replaceProductCatalog(db, {
      products: [{ ...GATEWAY, job: 'j'.repeat(400), evidencePath: 'not-a-path' }],
      competitors: [
        {
          ...row('Notifyre', 'https://www.Notifyre.com/pricing', GATEWAY.id),
          sources: [
            { url: 'https://notifyre.com/pricing', biased: true },
            { url: 'javascript:alert(1)', biased: false }
          ]
        },
        row('notifyre', 'notifyre.com', GATEWAY.id, 'partial')
      ]
    })
    const catalog = readProductCatalog(db)
    expect(catalog.products[0]?.job.length).toBe(300)
    expect(catalog.products[0]?.evidencePath).toBeNull()
    expect(catalog.competitors).toEqual([
      {
        ...row('Notifyre', 'notifyre.com', GATEWAY.id),
        sources: [{ url: 'https://notifyre.com/pricing', biased: true }]
      }
    ])
  })
})

describe('the flat list stays in step with the rows', () => {
  test('removing an entry deletes its rows for every product; a new entry is whole-business', () => {
    const db = projectDb()
    replaceProductCatalog(db, {
      products: [GATEWAY, BULK],
      competitors: [
        row('SimpleTexting', 'simpletexting.com', GATEWAY.id, 'partial'),
        row('SimpleTexting', 'simpletexting.com', BULK.id),
        row('TXTImpact', 'txtimpact.com', GATEWAY.id)
      ]
    })
    const profile = readProjectProfile(db)
    if (profile === null) throw new Error('no profile')
    updateProjectProfile(db, { ...profile, competitors: ['txtimpact.com', 'twilio.com'] })
    expect(listProductCompetitors(db).map((item) => [item.name, item.productId])).toEqual([
      ['TXTImpact', GATEWAY.id],
      ['twilio.com', null]
    ])
  })

  test('a rewrite of the whole profile (onboarding) keeps rows whose entry is kept', () => {
    const db = projectDb()
    replaceProductCatalog(db, {
      products: [GATEWAY],
      competitors: [row('TXTImpact', 'txtimpact.com', GATEWAY.id)]
    })
    writeProjectProfile(db, {
      includeSubdomains: false,
      brandNames: ['TextBolt'],
      competitors: ['TXTImpact'],
      market: MARKET
    })
    expect(listProductCompetitors(db).map((item) => [item.name, item.productId])).toEqual([
      ['TXTImpact', GATEWAY.id]
    ])
  })
})

describe('setPageProduct', () => {
  test('pins a product or the whole business, and goes back to automatic', () => {
    const db = projectDb()
    replaceProductCatalog(db, { products: [GATEWAY], competitors: [] })
    addPage(db, 'page-1', 'https://textbolt.com/x/')
    setPageProduct(db, 'page-1', null, true)
    expect(readPageProductRow(db, 'page-1')).toMatchObject({ productId: null, pinned: true })
    setPageProduct(db, 'page-1', GATEWAY.id, true)
    expect(readPageProductRow(db, 'page-1')).toMatchObject({ productId: GATEWAY.id, pinned: true })
    setPageProduct(db, 'page-1', GATEWAY.id, false)
    expect(readPageProductRow(db, 'page-1')).toMatchObject({ productId: null, pinned: false })
  })

  test('an unknown page or product is refused', () => {
    const db = projectDb()
    addPage(db, 'page-1', 'https://textbolt.com/x/')
    expect(() => setPageProduct(db, 'page-1', 'prod-none', true)).toThrow(/product was not found/)
    expect(() => setPageProduct(db, 'page-9', null, true)).toThrow(/page was not found/)
  })
})

describe('inferProduct (URL rules, Fill evidence paths, words)', () => {
  const products = [GATEWAY, BULK]

  test('a page under a product’s evidence path is that product', () => {
    expect(inferProduct(products, { url: 'https://textbolt.com/email-to-sms/' }).productId).toBe(
      GATEWAY.id
    )
    expect(
      inferProduct(products, { url: 'https://textbolt.com/email-to-sms/outlook/?a=1' }).productId
    ).toBe(GATEWAY.id)
    expect(inferProduct(products, { url: '/bulk-sms' }).productId).toBe(BULK.id)
  })

  test('else the product sharing the most distinctive words with the URL and title', () => {
    expect(
      inferProduct(products, {
        url: 'https://textbolt.com/blog/send-text-from-email-outlook/',
        title: 'How to send a text from email'
      }).productId
    ).toBe(GATEWAY.id)
    expect(
      inferProduct(products, { url: 'https://textbolt.com/blog/sms-marketing-campaign-ideas/' })
        .productId
    ).toBe(BULK.id)
    expect(inferProduct(products, { text: 'Text alerts from our email client' }).productId).toBe(
      GATEWAY.id
    )
  })

  test('no clear match is the whole business; one product is always that product', () => {
    expect(inferProduct(products, { url: 'https://textbolt.com/about/' }).productId).toBeNull()
    expect(inferProduct(products, { url: 'https://textbolt.com/sms/' }).productId).toBeNull()
    expect(inferProduct([GATEWAY], { url: 'https://textbolt.com/about/' }).productId).toBe(
      GATEWAY.id
    )
    expect(inferProduct([], { url: 'https://textbolt.com/email-to-sms/' }).productId).toBeNull()
  })
})
