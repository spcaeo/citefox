import { afterEach, describe, expect, test } from 'vitest'
import { netSentiment, toneCounts } from '@shared/sentiment-metrics'
import { closeSeeds } from '../../engine/checks/checks.test-helper'
import { createCheckEngine } from '../../engine/checks/engine'
import {
  fixtureClaude,
  seedSentiment,
  type SentimentSeed
} from '../../engine/sentiment/sentiment.test-helper'
import { loadSentimentView } from '../../engine/sentiment/view'
import { createStorageExportSource } from '../source'
import { buildReputation, exportSentimentRows } from './reputation'

afterEach(() => {
  closeSeeds()
})

async function readProject(): Promise<SentimentSeed> {
  const seeded = await seedSentiment({})
  const engine = createCheckEngine({
    ...seeded.checkDeps,
    claude: fixtureClaude(),
    readSentiment: true
  })
  await engine.start({ projectId: 'proj-1', pageIds: ['page-1'], marketIds: null, promptIds: null })
  await engine.reportsIdle()
  return seeded
}

describe('export reputation block (REPORT-SPEC section 5)', () => {
  test('page scope matches the Sentiment tab for the same market', async () => {
    const seeded = await readProject()
    const view = loadSentimentView(seeded.projectDb, {
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: 'mkt-us',
      running: false
    })
    const section = buildReputation(seeded.projectDb, {
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: ['mkt-us']
    })
    const own = toneCounts(view.claims.filter((claim) => claim.isOwn))
    expect(section.counts).toEqual({
      claims: own.total,
      positive: own.positive,
      neutral: own.neutral,
      negative: own.negative,
      net: netSentiment(own),
      notEnoughData: false,
      overviews: 3,
      overviewsRead: 3,
      overviewsNamingBrand: 2
    })
    expect(
      section.split.positive.count + section.split.neutral.count + section.split.negative.count
    ).toBe(section.counts.claims)
    expect(section.rows.map((row) => [row.prompt, row.rankLabel])).toEqual([
      ['TextBolt reviews', '#1 of 3 brands named'],
      ['TextBolt pricing', '#2 of 2 brands named']
    ])
    expect(section.rows[0]?.reason).toBe(
      'Named first as the no-code email-to-SMS option, ahead of SimpleTexting and Twilio.'
    )
    expect(section.issues).toEqual([
      expect.objectContaining({
        prompt: 'TextBolt pricing',
        claim: 'TextBolt pricing starts at $19 a month for 500 texts.',
        basis: 'page',
        correction: 'TextBolt plans start at $29 a month.',
        sourceToFix: 'https://www.textbolt.com/pricing/'
      })
    ])
    expect(section.trend).toHaveLength(1)
    expect(section.trend[0]).toMatchObject({ total: own.total, net: netSentiment(own) })
    expect(section.share.find((row) => row.isOwn)?.mentions).toBe(2)
  })

  test('project scope adds every market, and each claim becomes an export row', async () => {
    const seeded = await readProject()
    const all = buildReputation(seeded.projectDb, {
      projectId: 'proj-1',
      pageIds: null,
      marketIds: null
    })
    // MX adds the Spanish reviews overview: 3 more own-brand claims.
    expect(all.counts.claims).toBe(8)
    expect(all.counts.overviews).toBe(4)
    expect(all.trend).toHaveLength(1)
    expect(all.trend[0]?.key).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(all.trend[0]?.total).toBe(8)
    const rows = exportSentimentRows(seeded.projectDb, 'proj-1', 'page-1', null)
    expect(rows).toHaveLength(all.claims.length)
    expect(rows.find((row) => row.factualProblem !== null)?.factualProblem).toContain(
      'Suggested correction: TextBolt plans start at $29 a month.'
    )
    const dataset = await createStorageExportSource({
      app: seeded.storage.db,
      projectsDirectory: seeded.storage.paths.projectsDirectory,
      now: () => new Date('2026-10-20T12:00:00.000Z')
    }).loadExportDataset({
      projectId: 'proj-1',
      scope: 'page',
      pageIds: ['page-1'],
      viewId: null,
      marketIds: [],
      checks: 'latest',
      from: null,
      to: null,
      timeZone: 'UTC'
    })
    expect(dataset.pages[0]?.sentiment).toHaveLength(rows.length)
  })

  test('a project with no checks has no data and says not enough data', async () => {
    const seeded = await seedSentiment({})
    const section = buildReputation(seeded.projectDb, {
      projectId: 'proj-1',
      pageIds: null,
      marketIds: null
    })
    expect(section.counts).toMatchObject({ claims: 0, net: null, notEnoughData: true })
    expect(section.rows).toEqual([])
    expect(section.trend).toEqual([])
  })
})
