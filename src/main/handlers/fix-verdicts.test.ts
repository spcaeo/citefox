import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { fixVerdict } from '@shared/fix-verdict'
import { GOOGLE_UPDATES } from '@shared/google-updates'
import type { ChangeLedger, ChangeRow } from '@shared/ipc'
import {
  buildFixLoopStory,
  FIX_LOOP_SEED,
  openFixLoopSeed,
  type FixLoopSeed
} from './fix-loop.test-helper'

/**
 * Did it work? on the fix-loop story: a fix measured on its page from searches another
 * page asks (as a page fix's topic searches are), a fix that names the page it is about,
 * the verdict of each, and the Activity note said once.
 */

const { projectId, marketId } = FIX_LOOP_SEED
const { alerts, pricing, schedule } = FIX_LOOP_SEED.pages
const NOW = Date.parse('2026-10-23T15:00:00.000Z')

let seed: FixLoopSeed
let directory: string
let crossFixId: string
let namedFixId: string

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'citefox-fix-verdicts-'))
  seed = openFixLoopSeed(directory, { now: NOW })
  await buildFixLoopStory(seed)
  // Live between the two full checks, on the pricing page, with two of the alerts
  // guide's searches (they moved to pricing in the second check).
  const liveAt = seed.daysAgo(15)
  const cross = await seed.handlers['fixes:create']({
    projectId,
    pageId: pricing.id,
    description: 'Moved the plan comparison onto the pricing page.',
    goLiveAt: liveAt,
    rule: 'next_scheduled',
    promptIds: ['alerts-4', 'alerts-5'],
    marketIds: [marketId],
    pageFixId: 'pfpricing'
  })
  crossFixId = cross.id
  // Stored on the schedule page, about the pricing page (as a topic fix names its page).
  const named = await seed.handlers['fixes:create']({
    projectId,
    pageId: schedule.id,
    description: 'Linked the schedule guide to pricing.',
    goLiveAt: liveAt,
    rule: 'next_scheduled',
    promptIds: ['alerts-4'],
    marketIds: [marketId],
    url: 'textbolt.com/pricing'
  })
  namedFixId = named.id
  seed.setClock(new Date(NOW).toISOString())
})

afterAll(() => {
  seed.close()
  rmSync(directory, { recursive: true, force: true })
})

async function ledger(): Promise<ChangeLedger> {
  return await seed.handlers['fixes:ledger']({ projectId })
}

function verdictOf(row: ChangeRow | undefined): ReturnType<typeof fixVerdict> {
  if (row === undefined) throw new Error('no row')
  return fixVerdict(row.measure, {
    liveSince: row.liveSince,
    now: new Date(NOW).toISOString(),
    updates: GOOGLE_UPDATES
  })
}

describe('a fix measured from searches another page asks', () => {
  test('each search is read from the checks of the page that asks it', async () => {
    const row = (await ledger()).rows.find((item) => item.fixId === crossFixId)
    expect(row?.url).toBe(pricing.url)
    const questions = row?.measure.questions ?? []
    expect(questions.map((question) => [question.promptId, question.sourceId])).toEqual([
      ['alerts-4', alerts.id],
      ['alerts-5', alerts.id]
    ])
    expect(questions.every((question) => question.before?.cited === false)).toBe(true)
    expect(questions.every((question) => question.now?.cited === true)).toBe(true)
    expect(questions[0]?.now?.position).toBe(1)
    expect(questions[1]?.now?.position).toBe(3)
  })

  test('worked: both searches cite pricing now; untouched searches went the other way', async () => {
    const view = verdictOf((await ledger()).rows.find((item) => item.fixId === crossFixId))
    expect(view).toMatchObject({
      state: 'worked',
      daysLive: 15,
      citedBefore: 0,
      citedNow: 2,
      won: ['alerts-4', 'alerts-5'],
      lost: []
    })
    expect(view.control).toBe('other')
  })

  test('the trend counts the searches citing the page at each check', async () => {
    const row = (await ledger()).rows.find((item) => item.fixId === crossFixId)
    expect(row?.measure.trend.map((point) => point.cited)).toEqual([0, 2])
    // The alerts guide's other four searches: three cited the site before, two now.
    expect(row?.measure.control).toEqual({ questions: 4, citedBefore: 3, citedNow: 2 })
  })

  test('the fix list carries the same measure, and the page fix it came from', async () => {
    const list = await seed.handlers['fixes:listProject']({ projectId })
    const fix = list.fixes.find((item) => item.fix.id === crossFixId)?.fix
    expect(fix?.pageFixId).toBe('pfpricing')
    expect(fix?.measure?.questions.map((question) => question.now?.cited)).toEqual([true, true])
  })
})

describe('a fix that names the page it is about', () => {
  test('the address is stored as the own site page, and the row shows that page', async () => {
    const row = (await ledger()).rows.find((item) => item.fixId === namedFixId)
    expect(row?.pageId).toBe(schedule.id)
    expect(row?.url).toBe('https://textbolt.com/pricing')
    expect(row?.title).toBe('Pricing')
    expect(verdictOf(row).state).toBe('worked')
  })

  test('an address on another site is refused', async () => {
    await expect(
      seed.handlers['fixes:create']({
        projectId,
        pageId: schedule.id,
        description: 'Elsewhere.',
        goLiveAt: seed.daysAgo(3),
        rule: 'next_scheduled',
        promptIds: ['alerts-4'],
        marketIds: [marketId],
        url: 'https://example.org/page'
      })
    ).rejects.toThrow('Use the address of a page on your own site')
  })
})

describe('the other story fixes', () => {
  test('the rewrite lost ground: worse; the newer fixes are too early', async () => {
    const rows = (await ledger()).rows
    const byPage = (pageId: string, kind: string): ChangeRow | undefined =>
      rows.find((row) => row.pageId === pageId && row.kind === kind && row.fixId !== crossFixId)
    const lost = verdictOf(byPage(alerts.id, 'rewrite'))
    expect(lost).toMatchObject({ state: 'worse', citedBefore: 5, citedNow: 1 })
    const pricingFix = verdictOf(byPage(pricing.id, 'fix'))
    expect(pricingFix).toMatchObject({ state: 'too_early', daysLeft: 2, citedNow: 3 })
  })
})

describe('Activity', () => {
  test('a working fix is noted once', async () => {
    // The notes went out on the first ledger built above; build two fresh ones.
    const fresh = mkdtempSync(join(tmpdir(), 'citefox-fix-verdicts-notes-'))
    const other = openFixLoopSeed(fresh, { now: NOW })
    try {
      await buildFixLoopStory(other)
      await other.handlers['fixes:create']({
        projectId,
        pageId: pricing.id,
        description: 'Moved the plan comparison onto the pricing page.',
        goLiveAt: other.daysAgo(15),
        rule: 'next_scheduled',
        promptIds: ['alerts-4', 'alerts-5'],
        marketIds: [marketId]
      })
      other.setClock(new Date(NOW).toISOString())
      const first = await other.handlers['fixes:ledger']({ projectId })
      expect(first.workingNotes).toEqual(['Fix 2 on /pricing/ is working: 2 more searches cite it'])
      const again = await other.handlers['fixes:ledger']({ projectId })
      expect(again.workingNotes).toEqual([])
    } finally {
      other.close()
      rmSync(fresh, { recursive: true, force: true })
    }
  })
})
