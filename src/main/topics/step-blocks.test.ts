import { afterEach, describe, expect, test } from 'vitest'
import { competitorContext } from '../engine/competitor-context'
import { closeDatabase, openSqliteDatabase, type SqliteDatabase } from '../storage/database'
import { replaceProductCatalog } from '../storage/products'
import { ensureProjectSchema, writeProjectProfile } from '../storage/project-profile'
import { topicScope } from './step-blocks'

const open: SqliteDatabase[] = []

afterEach(() => {
  for (const db of open.splice(0)) closeDatabase(db)
})

function projectDb(): SqliteDatabase {
  const db = openSqliteDatabase(':memory:')
  open.push(db)
  ensureProjectSchema(db)
  writeProjectProfile(db, {
    includeSubdomains: false,
    brandNames: ['TextBolt'],
    competitors: ['TXTImpact', 'SimpleTexting'],
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
  replaceProductCatalog(db, {
    products: [
      { id: 'prod-gw', name: 'Email to SMS', job: 'email to text alerts', buyer: 'IT teams' },
      { id: 'prod-bulk', name: 'Bulk SMS', job: 'mass texting campaigns', buyer: 'marketers' }
    ],
    competitors: [
      {
        name: 'TXTImpact',
        domain: 'txtimpact.com',
        productId: 'prod-gw',
        tier: 'direct',
        startingPrice: null,
        sources: []
      },
      {
        name: 'SimpleTexting',
        domain: 'simpletexting.com',
        productId: 'prod-bulk',
        tier: 'direct',
        startingPrice: null,
        sources: []
      }
    ]
  })
  return db
}

describe('topicScope (P4 keywords read the topic’s product, PC)', () => {
  test('a draft before its topic exists reads the product its seed points to', () => {
    const db = projectDb()
    const scope = topicScope(db, { topicId: null, seed: 'email to text alerts for alarm systems' })
    expect(scope).toEqual({ productId: 'prod-gw' })
    const context = competitorContext(db, scope)
    expect(context.product?.name).toBe('Email to SMS')
    expect(context.direct.map((item) => item.name)).toEqual(['TXTImpact'])
  })

  test('a picked product wins; a picked "whole business" reads every competitor', () => {
    const db = projectDb()
    const seed = 'email to text alerts for alarm systems'
    expect(topicScope(db, { topicId: 't1', productId: 'prod-bulk', seed })).toEqual({
      productId: 'prod-bulk'
    })
    expect(topicScope(db, { topicId: null, productId: null, seed })).toEqual({})
    expect(topicScope(db, { topicId: 't1', seed })).toEqual({ topicId: 't1' })
  })
})
