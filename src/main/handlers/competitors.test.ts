import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { CitedSiteRow, CompetitorsOverview } from '@shared/ipc'
import { openProgressSeed, PROGRESS_SEED, type ProgressSeed } from './progress.test-helper'

const opened: ProgressSeed[] = []
const directories: string[] = []

afterEach(() => {
  for (const seed of opened.splice(0)) seed.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const [ONE, TWO, THREE] = PROGRESS_SEED.prompts
const base = { projectId: PROGRESS_SEED.projectId }

/**
 * The first check (Oct 5) uses the default bodies:
 * US: Q1 cites SimpleTexting, the page and Twilio; Q2 an own page; Q3 SimpleTexting.
 * UK: Q1 SimpleTexting; Q2 an own page; Q3 SimpleTexting.
 */
async function checked(): Promise<ProgressSeed> {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-competitors-'))
  directories.push(directory)
  const seed = openProgressSeed(directory)
  opened.push(seed)
  await seed.check(PROGRESS_SEED.first)
  return seed
}

function row(overview: CompetitorsOverview, name: string): CitedSiteRow {
  const found = overview.rows.find((item) => item.name === name)
  if (found === undefined) throw new Error(`no row ${name}`)
  return found
}

describe('competitors:overview on a real project file', () => {
  test('counts who the latest overviews cite, with shares, gaps and opaque ids', async () => {
    const seed = await checked()
    seed.setClock('2026-10-06T12:00:00.000Z')
    const overview = await seed.handlers['competitors:overview']({ ...base, period: 30 })
    expect(overview).toMatchObject({
      period: 30,
      periodStart: '2026-09-06T12:00:00.000Z',
      marketId: null,
      productId: null,
      ownDomain: 'textbolt.com',
      checks: 2,
      citations: 8,
      questions: 3,
      // Nothing was checked before the period, so nothing counts as new.
      newSites: null
    })
    expect(overview.markets.map((market) => market.id)).toEqual(['mkt-us', 'mkt-uk'])
    // You first, then by citations.
    expect(overview.rows.map((item) => [item.name, item.kind])).toEqual([
      ['TextBolt', 'you'],
      ['simpletexting.com', 'competitor'],
      ['twilio.com', 'competitor']
    ])
    const you = row(overview, 'TextBolt')
    expect(you).toMatchObject({
      domain: 'textbolt.com',
      citations: 3,
      questions: 2,
      share: 3 / 8,
      named: 0,
      startCitations: null,
      shareChange: null,
      gaps: []
    })
    const simple = row(overview, 'simpletexting.com')
    expect(simple).toMatchObject({
      tier: 'direct',
      citations: 4,
      questions: 2,
      share: 4 / 8,
      isNew: false,
      byProduct: []
    })
    expect(simple.firstSeenAt).not.toBeNull()
    // Cited and you are not: Q1 in the UK, Q3 in both markets.
    const gaps = [...simple.gaps].sort((left, right) => left.promptId.localeCompare(right.promptId))
    expect(gaps).toHaveLength(2)
    expect(gaps[0]).toMatchObject({
      id: `${PROGRESS_SEED.pageId}|${ONE.id}`,
      pageId: PROGRESS_SEED.pageId,
      pageKind: 'page',
      promptId: ONE.id,
      promptText: ONE.text,
      marketId: 'mkt-uk',
      marketIds: ['mkt-uk'],
      position: 1
    })
    expect(gaps[0]?.url).toContain('simpletexting.com')
    expect(gaps[0]?.runId).toBeTruthy()
    expect(gaps[1]).toMatchObject({ promptId: THREE.id })
    expect([...(gaps[1]?.marketIds ?? [])].sort()).toEqual(['mkt-uk', 'mkt-us'])
    // Twilio is cited next to you only, so it has no gap.
    expect(row(overview, 'twilio.com')).toMatchObject({ citations: 1, questions: 1, gaps: [] })
    // Ids are opaque: never the domain or the name, and stable between calls.
    for (const item of overview.rows) {
      expect(item.id).toMatch(/^s[0-9a-f]{15}$/)
      expect(item.id).not.toContain('textbolt')
    }
    const again = await seed.handlers['competitors:overview']({ ...base, period: 30 })
    expect(again.rows.map((item) => item.id)).toEqual(overview.rows.map((item) => item.id))
  })

  test('the market filter keeps one market', async () => {
    const seed = await checked()
    const uk = await seed.handlers['competitors:overview']({
      ...base,
      marketId: PROGRESS_SEED.uk,
      period: 7
    })
    expect(uk).toMatchObject({ marketId: 'mkt-uk', checks: 1, citations: 3, questions: 3 })
    expect(row(uk, 'TextBolt')).toMatchObject({ citations: 1, share: 1 / 3 })
    expect(row(uk, 'simpletexting.com')).toMatchObject({ citations: 2, questions: 2 })
    // A saved competitor that is not cited still has its row.
    expect(row(uk, 'twilio.com')).toMatchObject({ citations: 0, share: 0, gaps: [] })
    await expect(
      seed.handlers['competitors:overview']({ ...base, marketId: 'mkt-xx', period: 7 })
    ).rejects.toThrow('That market is not in this project')
    await expect(
      seed.handlers['competitors:overview']({ ...base, period: 14 as 7 })
    ).rejects.toThrow('competitors:overview')
  })

  test('the trend compares with the check as of the period start, and names new sites', async () => {
    const seed = await checked()
    // Oct 19: US Q2 now names TextBolt and cites Reddit instead of the own page.
    seed.bodies.set(`us|${TWO.text}`, 'google-brand-named.json')
    await seed.check(PROGRESS_SEED.second)
    const week = await seed.handlers['competitors:overview']({ ...base, period: 7 })
    // The seed clock moves a second per id, so the start is a few seconds after noon.
    expect(week.periodStart).toMatch(/^2026-10-12T12:0/)
    expect(week.citations).toBe(8)
    const you = row(week, 'TextBolt')
    expect(you).toMatchObject({ citations: 2, named: 1, startCitations: 3 })
    expect(you.shareChange).toBeCloseTo(2 / 8 - 3 / 8)
    const reddit = row(week, 'reddit.com')
    expect(reddit).toMatchObject({ kind: 'other', named: null, isNew: true, startCitations: 0 })
    expect(reddit.gaps.map((gap) => gap.promptId)).toEqual([TWO.id])
    expect(week.newSites).toBe(1)
    // A period that starts before the first check has no trend.
    const quarter = await seed.handlers['competitors:overview']({ ...base, period: 90 })
    expect(quarter.newSites).toBeNull()
    expect(row(quarter, 'TextBolt').shareChange).toBeNull()
  })

  test('products split the numbers and filter by the product’s competitors', async () => {
    const seed = await checked()
    await seed.handlers['products:save']({
      ...base,
      products: [
        { id: 'prod-alerts', name: 'Alerts', job: 'staff text alerts', buyer: 'IT teams' },
        { id: 'prod-market', name: 'Marketing', job: 'SMS marketing', buyer: 'shops' }
      ],
      competitors: [
        {
          name: 'SimpleTexting',
          domain: 'simpletexting.com',
          productId: 'prod-alerts',
          tier: 'direct',
          startingPrice: null,
          sources: []
        },
        {
          name: 'Klaviyo',
          domain: 'klaviyo.com',
          productId: 'prod-market',
          tier: 'partial',
          startingPrice: null,
          sources: []
        }
      ]
    })
    await seed.handlers['products:setPage']({
      ...base,
      pageId: PROGRESS_SEED.pageId,
      mode: 'pick',
      productId: 'prod-alerts'
    })
    const all = await seed.handlers['competitors:overview']({ ...base, period: 30 })
    expect(all.products).toEqual([
      { id: 'prod-alerts', name: 'Alerts' },
      { id: 'prod-market', name: 'Marketing' }
    ])
    const simple = row(all, 'SimpleTexting')
    expect(simple).toMatchObject({ kind: 'competitor', tier: 'direct', citations: 4 })
    expect(simple.byProduct).toEqual([
      { productId: 'prod-alerts', citations: 4, questions: 2, share: 4 / 8 },
      { productId: 'prod-market', citations: 0, questions: 0, share: null }
    ])
    expect(row(all, 'Klaviyo')).toMatchObject({ tier: 'partial', citations: 0 })
    // Twilio is no longer saved; the check stored it as a competitor, so it stays one.
    expect(row(all, 'twilio.com')).toMatchObject({ kind: 'competitor', tier: null })

    const marketing = await seed.handlers['competitors:overview']({
      ...base,
      productId: 'prod-market',
      period: 30
    })
    expect(marketing).toMatchObject({ productId: 'prod-market', checks: 0, citations: 0 })
    expect(marketing.rows.map((item) => item.name)).toEqual(['TextBolt', 'Klaviyo'])
  })
})
