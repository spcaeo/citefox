import { afterEach, describe, expect, test } from 'vitest'
import type { ProductCompetitor, ProjectProduct, TopicDraft } from '@shared/domain'
import { closeDatabase, openSqliteDatabase, type SqliteDatabase } from '../storage/database'
import { replaceProductCatalog } from '../storage/products'
import { ensureProjectSchema, writeProjectProfile } from '../storage/project-profile'
import type { OpenedProject } from './env'
import { topicCompetitors, topicCompetitorScope } from './topic-context'

const open: SqliteDatabase[] = []

afterEach(() => {
  for (const db of open.splice(0)) closeDatabase(db)
})

const GATEWAY: ProjectProduct = {
  id: 'prod-gateway',
  name: 'Email to text',
  job: 'Turn alarm and alert emails into text messages',
  buyer: 'Facilities and IT teams',
  evidencePath: '/email-to-text/'
}
const BULK: ProjectProduct = {
  id: 'prod-bulk',
  name: 'Bulk SMS marketing',
  job: 'Send text campaigns to customer lists',
  buyer: 'Small business marketers',
  evidencePath: '/bulk-sms/'
}

function row(name: string, productId: string | null): ProductCompetitor {
  return { name, domain: null, productId, tier: 'direct', startingPrice: null, sources: [] }
}

function opened(): OpenedProject {
  const db = openSqliteDatabase(':memory:')
  open.push(db)
  ensureProjectSchema(db)
  writeProjectProfile(db, {
    includeSubdomains: false,
    brandNames: ['TextBolt'],
    competitors: [],
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
    products: [GATEWAY, BULK],
    competitors: [row('TXTImpact', GATEWAY.id), row('SlickText', BULK.id), row('TextBolt', null)]
  })
  return { db, project: { id: 'proj-1', domain: 'textbolt.com' } } as unknown as OpenedProject
}

function draft(patch: Partial<TopicDraft>): TopicDraft {
  return {
    topicId: null,
    name: '',
    seed: 'email to text for alarm systems',
    brandNames: ['TextBolt'],
    ...patch
  } as TopicDraft
}

describe('topic competitors by product (Docs/PROMPT-AUDIT.md PC)', () => {
  test('a picked product, the whole business, a saved topic, or inferred from the seed', () => {
    const project = opened()
    expect(topicCompetitorScope(project, draft({ productId: BULK.id }))).toEqual({
      productId: BULK.id
    })
    expect(topicCompetitorScope(project, draft({ productId: null }))).toEqual({})
    expect(topicCompetitorScope(project, draft({ topicId: 'topic-1' }))).toEqual({
      topicId: 'topic-1'
    })
    expect(topicCompetitorScope(project, draft({}))).toEqual({ productId: GATEWAY.id })
  })

  test("the product's competitors only, never the brand", () => {
    const project = opened()
    const names = (patch: Partial<TopicDraft>): string[] =>
      topicCompetitors(project, draft(patch)).direct.map((item) => item.name)
    expect(names({})).toEqual(['TXTImpact'])
    expect(names({ productId: BULK.id })).toEqual(['SlickText'])
  })
})
