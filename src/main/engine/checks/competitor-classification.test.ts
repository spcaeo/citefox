import type { ProductCompetitor } from '@shared/domain'
import type { CheckProgress } from '@shared/ipc'
import { afterEach, describe, expect, test } from 'vitest'
import { listStoredAioReferences } from '../../storage/check-records'
import { setPageProduct, replaceProductCatalog } from '../../storage/products'
import { tagReferences } from '../../prompts/citations'
import { insertPage } from '../../storage/pages'
import { closeSeeds, envelope, page, runFilter, seed } from './checks.test-helper'
import { checkCompetitors } from './competitor-match'
import { pageCompetitorText } from './report-context'

/**
 * Prompt audit P9: a check classifies a cited domain as "competitor" by the competitors
 * of the page's product, so the same domain is a competitor on one product's page and
 * "other" on another's. Old runs keep what they stored.
 *
 * The SerpApi fixture cites simpletexting.com, the page itself, and twilio.com.
 */

afterEach(() => {
  closeSeeds()
})

function row(
  name: string,
  domain: string,
  productId: string | null,
  tier: 'direct' | 'partial'
): ProductCompetitor {
  return { name, domain, productId, tier, startingPrice: null, sources: [] }
}

const PRODUCTS = [
  { id: 'prod-email', name: 'Email to SMS', job: 'send texts from email', buyer: 'IT teams' },
  { id: 'prod-mass', name: 'Mass texting', job: 'bulk SMS campaigns', buyer: 'marketers' }
]

async function twoProductProject(): Promise<Awaited<ReturnType<typeof seed>>> {
  const seeded = await seed({
    progress: [] as CheckProgress[],
    secondPage: true,
    http(request) {
      const url = new URL(request.url)
      return url.searchParams.get('engine') === 'google_ai_overview'
        ? envelope('google-ai-overview.json')
        : envelope('google-page-token.json')
    }
  })
  replaceProductCatalog(seeded.projectDb, {
    products: PRODUCTS,
    competitors: [
      // SimpleTexting competes with the email-to-SMS product only; Twilio with mass texting.
      row('SimpleTexting', 'simpletexting.com', 'prod-email', 'direct'),
      row('Twilio', 'twilio.com', 'prod-mass', 'partial')
    ]
  })
  setPageProduct(seeded.projectDb, 'page-1', 'prod-email', true)
  setPageProduct(seeded.projectDb, 'page-2', 'prod-mass', true)
  return seeded
}

function classes(
  db: Awaited<ReturnType<typeof seed>>['projectDb'],
  pageId: string,
  runId: string | null = null
): Record<string, string> {
  const references = listStoredAioReferences(db, { ...runFilter(runId), pageIds: [pageId] })
  return Object.fromEntries(
    references.map((reference) => [reference.domain, reference.classification])
  )
}

describe('per-product competitor classification (P9)', () => {
  test('one domain is a competitor on product A’s page and other on product B’s', async () => {
    const { handlers, projectDb } = await twoProductProject()
    const job = await handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1', 'page-2'],
      marketIds: null,
      promptIds: null
    })
    expect(job.status).toBe('finished')
    expect(classes(projectDb, 'page-1')).toEqual({
      'simpletexting.com': 'competitor',
      'textbolt.com': 'target',
      'twilio.com': 'other'
    })
    expect(classes(projectDb, 'page-2')).toMatchObject({
      'simpletexting.com': 'other',
      'twilio.com': 'competitor'
    })

    // Results show the product's competitors: the leaderboard badge follows the class.
    const first = await handlers['results:get']({
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: null,
      runId: null
    })
    const badges = Object.fromEntries(first.leaderboard.map((item) => [item.domain, item.badge]))
    expect(badges).toMatchObject({ 'simpletexting.com': 'tracked', 'twilio.com': 'observed' })
    const second = await handlers['results:get']({
      projectId: 'proj-1',
      pageId: 'page-2',
      marketId: null,
      runId: null
    })
    expect(
      Object.fromEntries(second.leaderboard.map((item) => [item.domain, item.badge]))
    ).toMatchObject({ 'simpletexting.com': 'observed', 'twilio.com': 'tracked' })

    // The report prompts and the explanations label sources exactly as the numbers count them.
    for (const pageId of ['page-1', 'page-2']) {
      const references = listStoredAioReferences(projectDb, { ...runFilter(), pageIds: [pageId] })
      const { competitorOf } = pageCompetitorText(projectDb, pageId)
      for (const reference of references) {
        const label = competitorOf({
          url: reference.url,
          classification:
            reference.classification === 'target' ? 'this page' : reference.classification
        })
        expect(label !== null).toBe(reference.classification === 'competitor')
      }
    }
    const pageOne = listStoredAioReferences(projectDb, { ...runFilter(), pageIds: ['page-1'] })
    const context = {
      direct: [{ name: 'SimpleTexting', domain: 'simpletexting.com' }],
      partial: []
    }
    expect(tagReferences(pageOne, context, 'textbolt.com').map((item) => item.tag)).toEqual([
      'direct',
      'own',
      'other'
    ])
    expect(
      pageCompetitorText(projectDb, 'page-2').competitorOf({
        url: 'https://www.twilio.com/en-us/blog/employee-sms-notifications',
        classification: 'competitor'
      })
    ).toBe('competitor: Twilio, partial')
  })

  test('an old run keeps its stored classification; only a new run changes', async () => {
    const { handlers, projectDb } = await twoProductProject()
    await handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    const before = await handlers['results:get']({
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: null,
      runId: null
    })
    const oldRunId = before.run?.runId ?? null
    expect(oldRunId).not.toBeNull()

    // The owner moves SimpleTexting to the other product and gives this one Twilio.
    replaceProductCatalog(projectDb, {
      products: PRODUCTS,
      competitors: [
        row('SimpleTexting', 'simpletexting.com', 'prod-mass', 'direct'),
        row('Twilio', 'twilio.com', 'prod-email', 'direct')
      ]
    })

    // Reading the old run after the change: same stored classes, same badges, same text.
    expect(classes(projectDb, 'page-1', oldRunId)).toMatchObject({
      'simpletexting.com': 'competitor',
      'twilio.com': 'other'
    })
    const reread = await handlers['results:get']({
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: null,
      runId: oldRunId
    })
    expect(reread.leaderboard).toEqual(before.leaderboard)
    expect(reread.prompts[0]?.references).toEqual(before.prompts[0]?.references)
    const { competitorOf } = pageCompetitorText(projectDb, 'page-1')
    expect(
      competitorOf({
        url: 'https://simpletexting.com/blog/text-employees/',
        classification: 'competitor'
      })
    ).toBe('competitor: simpletexting.com')
    expect(
      competitorOf({ url: 'https://www.twilio.com/en-us/blog/x', classification: 'other' })
    ).toBeNull()

    // A new run classifies with the new list.
    await handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    const after = await handlers['results:get']({
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: null,
      runId: null
    })
    expect(after.run?.runId).not.toBe(oldRunId)
    expect(classes(projectDb, 'page-1', after.run?.runId ?? null)).toMatchObject({
      'simpletexting.com': 'other',
      'twilio.com': 'competitor'
    })
    expect(
      Object.fromEntries(after.leaderboard.map((item) => [item.domain, item.badge]))
    ).toMatchObject({ 'simpletexting.com': 'observed', 'twilio.com': 'tracked' })
  })

  test('a page with no product reads the project-wide list', async () => {
    const { handlers, projectDb } = await twoProductProject()
    setPageProduct(projectDb, 'page-1', null, true)
    await handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    expect(classes(projectDb, 'page-1')).toMatchObject({
      'simpletexting.com': 'competitor',
      'twilio.com': 'competitor'
    })
  })

  test("a topic's check reads the topic's product", async () => {
    const { projectDb } = await twoProductProject()
    insertPage(projectDb, {
      ...page(),
      id: 'topic-1',
      kind: 'topic',
      url: null,
      title: 'Bulk SMS campaigns for churches',
      label: null
    })
    setPageProduct(projectDb, 'topic-1', 'prod-mass', true)
    expect(checkCompetitors(projectDb, { id: 'topic-1', kind: 'topic' })).toEqual({
      direct: [],
      partial: [{ name: 'Twilio', domain: 'twilio.com' }]
    })
  })
})
