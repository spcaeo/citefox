import { afterEach, describe, expect, test } from 'vitest'
import type { PageResults, ProductCompetitor } from '@shared/domain'
import { insertBrandFact } from '../../storage/brand-records'
import { replaceProductCatalog, setPageProduct } from '../../storage/products'
import { listSentimentClaims, listSentimentReads } from '../../storage/sentiment-records'
import { closeSeeds, NOW } from '../checks/checks.test-helper'
import { createCheckEngine, type CheckEngine } from '../checks/engine'
import { isReading } from './activity'
import { readRunSentiment } from './read'
import {
  fixtureClaude,
  PRICING_FACT,
  seedSentiment,
  type SentimentSeed
} from './sentiment.test-helper'
import type { CheckJob } from '@shared/ipc'
import { fullRuns, loadSentimentView } from './view'

afterEach(() => {
  closeSeeds()
})

const START = {
  projectId: 'proj-1',
  pageIds: ['page-1'],
  marketIds: null,
  promptIds: null
} as const

function count(seeded: SentimentSeed, table: string): number {
  const row = seeded.projectDb
    .prepare<unknown[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)
    .get()
  return row?.n ?? 0
}

function runMetrics(results: PageResults): unknown {
  const run = results.run
  return {
    promptsChecked: run?.promptsChecked,
    promptsWithAio: run?.promptsWithAio,
    pageCited: run?.pageCited,
    visibilityScore: run?.visibilityScore,
    citations: run?.citationsThisPage,
    prompts: results.prompts.length
  }
}

/** A seeded project with Claude reading after each check, as production runs it. */
async function readingProject(
  seen: string[] = [],
  fail?: () => boolean
): Promise<{ seeded: SentimentSeed; engine: CheckEngine; job: CheckJob }> {
  const seeded = await seedSentiment({})
  const engine = createCheckEngine({
    ...seeded.checkDeps,
    claude: fixtureClaude(seen, fail === undefined ? {} : { fail }),
    readSentiment: true
  })
  const job = await engine.start(START)
  await engine.reportsIdle()
  return { seeded, engine, job }
}

describe('brand prompts in checks (FR-16.1)', () => {
  test('are searched in every market in its language and shown in the run plan', async () => {
    const queries: string[] = []
    const seeded = await seedSentiment({ queries })
    const job = await seeded.handlers['checks:start'](START)
    expect(job.status).toBe('finished')
    // 5 English prompts in US, 2 Spanish prompts in MX, 1 sample, up to 2 searches each.
    expect(job.brandSearchesMax).toBe(14)
    // 1 buyer prompt in 2 markets × 1 sample × 2, plus the brand prompts.
    expect(job.searchesMax).toBe(18)
    const brandQueries = queries.filter((q) => q.includes('TextBolt'))
    expect(brandQueries.sort()).toEqual(
      [
        'Is TextBolt good for staff alerts from Outlook',
        'TextBolt alternatives',
        'TextBolt opiniones',
        'TextBolt precios',
        'TextBolt pricing',
        'TextBolt reviews',
        'TextBolt vs SimpleTexting for staff alerts'
      ].sort()
    )
    expect(count(seeded, 'brand_captures')).toBe(7)
    // The buyer prompt only has US wording, so MX searches brand prompts only.
    expect(count(seeded, 'serp_results')).toBe(1)
    expect(job.searchesUsed).toBe(8)
  })

  test('never change visibility numbers', async () => {
    const withBrand = await seedSentiment({})
    await withBrand.handlers['checks:start'](START)
    const without = await seedSentiment({ brandPrompts: false })
    await without.handlers['checks:start'](START)
    const request = { projectId: 'proj-1', pageId: 'page-1', marketId: 'mkt-us', runId: null }
    const a = await withBrand.handlers['results:get'](request)
    const b = await without.handlers['results:get'](request)
    expect(runMetrics(a)).toEqual(runMetrics(b))
    expect(a.prompts.map((row) => row.promptId)).toEqual(['prompt-1'])
  })

  test('a follow-up check searches no brand prompts', async () => {
    const seeded = await seedSentiment({})
    await seeded.handlers['checks:start'](START)
    const followUp = await seeded.handlers['checks:start']({ ...START, promptIds: ['prompt-1'] })
    expect(followUp.status).toBe('finished')
    expect(followUp.brandSearchesMax).toBe(0)
    expect(count(seeded, 'brand_captures')).toBe(7)
  })
})

describe('reading claims (FR-16.2, FR-16.5, FR-16.8)', () => {
  test('runs after the check and keeps only claims the overview backs', async () => {
    const seen: string[] = []
    const { seeded, job } = await readingProject(seen)
    expect(job.status).toBe('finished')
    const runs = fullRuns(seeded.projectDb, 'proj-1', 'page-1', 'mkt-us')
    const claims = listSentimentClaims(
      seeded.projectDb,
      runs.map((run) => run.id)
    )
    // Reviews: 5 of 6 kept ("never misses a message" is not in the overview). Pricing: 3.
    expect(claims).toHaveLength(8)
    expect(claims.some((claim) => claim.sentence.includes('never misses'))).toBe(false)
    const pricing = claims.find((claim) => claim.attribute === 'starts at $29 a month')
    expect(pricing?.brand).toBe('SimpleTexting')
    expect(pricing?.isOwn).toBe(false)
    const twilio = claims.find((claim) => claim.brand === 'Twilio')
    expect(twilio?.url).toBeNull()
    const problem = claims.find((claim) => claim.factProblem !== null)
    expect(problem?.factProblem).toEqual({
      basis: 'page',
      why: 'Your pricing page says plans start at $29 a month, not $19.',
      correction: 'TextBolt plans start at $29 a month.',
      sourceToFix: 'https://www.textbolt.com/pricing/'
    })
    const sentimentPrompts = seen.filter((prompt) =>
      prompt.startsWith('Template: sentiment_claims_v2.md')
    )
    // US: buyer overview, reviews, pricing. MX: the Spanish reviews overview.
    expect(sentimentPrompts).toHaveLength(4)
    const spanish = sentimentPrompts.filter((prompt) =>
      prompt.includes('The overview is in Spanish (es).')
    )
    expect(spanish).toHaveLength(1)
    expect(spanish[0]).toContain('Write themes and attributes in English.')
    // Claims only: no brand facts and no own pages; the overview is fenced as data.
    expect(sentimentPrompts[0]).not.toContain('Brand facts')
    expect(sentimentPrompts[0]).toContain('<overview>')
    expect(sentimentPrompts[0]).toContain('Direct competitors of this business: SimpleTexting')
    // The fact check runs only for overviews with a claim about TextBolt (not the
    // buyer overview), with the claims numbered and only the own-page passages that
    // speak to them.
    const checks = seen.filter((prompt) => prompt.startsWith('Template: sentiment_fact_check.md'))
    expect(checks).toHaveLength(3)
    const pricingCheck = checks.find((prompt) => prompt.includes('starts at $19'))
    expect(pricingCheck).toContain('0. [Pricing] starts at $19 a month')
    expect(pricingCheck).toContain('[https://textbolt.com/pricing/] TextBolt pricing')
    expect(pricingCheck).not.toContain('TextBolt page body')
    expect(pricingCheck).not.toContain('SimpleTexting starts at $29')
    expect(isReading('proj-1', 'page-1')).toBe(false)
  })

  test('re-reading unchanged overviews costs nothing; a new fact is read on the next pass', async () => {
    const seen: string[] = []
    const { seeded } = await readingProject(seen)
    const run = fullRuns(seeded.projectDb, 'proj-1', 'page-1', 'mkt-us').at(-1)
    if (run === undefined) throw new Error('no run')
    const deps = {
      db: seeded.projectDb,
      appDb: seeded.storage.db,
      claude: fixtureClaude(seen),
      logger: seeded.checkDeps.logger,
      now: () => NOW,
      createId: (() => {
        let n = 0
        return () => `re-${(n += 1)}`
      })()
    }
    const before = seen.length
    const again = await readRunSentiment(deps, { projectId: 'proj-1', runId: run.id })
    expect(again).toMatchObject({ overviews: 3, read: 0, reused: 3, failed: 0 })
    expect(seen.length).toBe(before)

    insertBrandFact(seeded.projectDb, {
      id: 'fact-1',
      text: PRICING_FACT,
      source: null,
      addedAt: NOW
    })
    const withFact = await readRunSentiment(deps, { projectId: 'proj-1', runId: run.id })
    // The claims calls come from the cache; only the two fact checks are new. The
    // buyer overview names no brand, so it costs nothing.
    expect(withFact).toMatchObject({ overviews: 3, read: 2, reused: 1, failed: 0, factChecks: 2 })
    expect(seen.length - before).toBe(2)
    const claims = listSentimentClaims(seeded.projectDb, [run.id])
    expect(claims.find((claim) => claim.factProblem !== null)?.factProblem?.basis).toBe('fact')
    expect(seen.at(-1)).toContain(`- ${PRICING_FACT}`)
  })

  test('a failed re-read keeps the earlier claims', async () => {
    let failing = false
    const { seeded } = await readingProject([], () => failing)
    const run = fullRuns(seeded.projectDb, 'proj-1', 'page-1', 'mkt-us').at(-1)
    if (run === undefined) throw new Error('no run')
    const before = listSentimentClaims(seeded.projectDb, [run.id]).length
    insertBrandFact(seeded.projectDb, {
      id: 'fact-2',
      text: PRICING_FACT,
      source: null,
      addedAt: NOW
    })
    failing = true
    const result = await readRunSentiment(
      {
        db: seeded.projectDb,
        appDb: seeded.storage.db,
        claude: fixtureClaude([], { fail: () => failing }),
        logger: seeded.checkDeps.logger,
        now: () => NOW,
        createId: () => `fail-${Math.random().toString(36).slice(2)}`
      },
      { projectId: 'proj-1', runId: run.id }
    )
    // The claims come from the cache; the two fact checks fail.
    expect(result.failed).toBe(2)
    expect(listSentimentClaims(seeded.projectDb, [run.id])).toHaveLength(before)
    expect(listSentimentReads(seeded.projectDb, [run.id]).every((read) => read.ok)).toBe(true)
  })

  test('a stop request ends the reading before the next Claude call', async () => {
    const seeded = await seedSentiment({})
    await seeded.handlers['checks:start'](START)
    const run = fullRuns(seeded.projectDb, 'proj-1', 'page-1', 'mkt-us').at(-1)
    if (run === undefined) throw new Error('no run')
    const seen: string[] = []
    const result = await readRunSentiment(
      {
        db: seeded.projectDb,
        appDb: seeded.storage.db,
        claude: fixtureClaude(seen),
        logger: seeded.checkDeps.logger,
        now: () => NOW,
        createId: () => 'stop-1',
        shouldStop: () => true
      },
      { projectId: 'proj-1', runId: run.id }
    )
    expect(result.stopped).toBe(true)
    expect(seen).toHaveLength(0)
  })
})

describe('sentiment view (FR-16.3, FR-16.4)', () => {
  test('counts own-brand claims and keeps follow-up checks out of the trend', async () => {
    const { seeded } = await readingProject()
    const first = loadSentimentView(seeded.projectDb, {
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: null,
      running: false
    })
    expect(first.marketId).toBe('mkt-us')
    expect(first.brand).toBe('TextBolt')
    expect(first.competitors).toEqual(['SimpleTexting', 'Twilio'])
    expect(first.overviews).toHaveLength(3)
    expect(first.overviews.every((overview) => overview.readState === 'read')).toBe(true)
    expect(first.claims).toHaveLength(8)
    expect(first.trend).toHaveLength(1)
    expect(first.trend[0]).toMatchObject({ positive: 2, neutral: 1, negative: 2, overviews: 3 })
    // One full check: its claims are `claims`, and nothing is earlier.
    expect(first.earlierClaims).toEqual([])
    expect(first.earlierOverviews).toEqual([])
    expect(first.reading).toEqual({ pending: 0, failed: 0, running: false })
    const reviews = first.overviews.find((overview) => overview.promptText === 'TextBolt reviews')
    expect(reviews?.brandsNamed).toEqual(['TextBolt', 'SimpleTexting', 'Twilio'])
    expect(reviews?.promptLabel).toBe('Reviews')
    const g2 = first.claims.find(
      (claim) => claim.url === 'https://www.g2.com/products/textbolt/reviews'
    )
    expect(g2?.sourceKind).toBe('review')
    expect(first.brandPrompts.estimate).toEqual({
      prompts: 7,
      markets: 2,
      minSearches: 7,
      maxSearches: 14
    })

    await seeded.handlers['checks:start']({ ...START, promptIds: ['prompt-1'] })
    const after = loadSentimentView(seeded.projectDb, {
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: 'mkt-us',
      running: false
    })
    expect(after.trend).toHaveLength(1)
    expect(after.latestRunId).toBe(first.latestRunId)
  })

  test("lists the page product's competitors, plus any an older read named (P9)", async () => {
    const { seeded } = await readingProject()
    const row = (name: string, productId: string): ProductCompetitor => ({
      name,
      domain: null,
      productId,
      tier: 'direct',
      startingPrice: null,
      sources: []
    })
    replaceProductCatalog(seeded.projectDb, {
      products: [
        { id: 'prod-a', name: 'Email to SMS', job: 'texts from email', buyer: 'IT' },
        { id: 'prod-b', name: 'Mass texting', job: 'bulk SMS', buyer: 'marketers' }
      ],
      competitors: [row('Twilio', 'prod-a'), row('SimpleTexting', 'prod-b')]
    })
    setPageProduct(seeded.projectDb, 'page-1', 'prod-a', true)
    const view = loadSentimentView(seeded.projectDb, {
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: null,
      running: false
    })
    // Twilio is this product's; SimpleTexting stays only because the stored claims name it.
    expect(view.competitors).toEqual(['Twilio', 'SimpleTexting'])
  })

  test('an unread overview is pending', async () => {
    const seeded = await seedSentiment({ queries: [] })
    await seeded.handlers['checks:start'](START)
    const view = loadSentimentView(seeded.projectDb, {
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: 'mkt-us',
      running: true
    })
    expect(view.reading).toEqual({ pending: 3, failed: 0, running: true })
    expect(view.claims).toHaveLength(0)
  })
})
