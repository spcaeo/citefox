import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { isCited } from '@shared/fix-loop'
import type { PromptCheckRow } from '@shared/domain'
import type { ChangeLedger } from '@shared/ipc'
import { usageMonth } from '../keys/present'
import { getKeyUsageForMonth } from '../storage/key-usage'
import { closeProjectDatabase } from '../storage/project-files'
import { writeProjectScheduleCap } from '../storage/project-schedule'
import {
  buildFixLoopStory,
  FIX_LOOP_SEED,
  openFixLoopSeed,
  type FixLoopSeed
} from './fix-loop.test-helper'

const { projectId } = FIX_LOOP_SEED
const { alerts, pricing, schedule, gmail } = FIX_LOOP_SEED.pages
const NOW = Date.parse('2026-10-23T15:00:00.000Z')

let seed: FixLoopSeed
let directory: string

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'citefox-fix-loop-'))
  seed = openFixLoopSeed(directory, { now: NOW })
  await buildFixLoopStory(seed)
})

afterAll(() => {
  seed.close()
  rmSync(directory, { recursive: true, force: true })
})

async function ledger(): Promise<ChangeLedger> {
  return await seed.handlers['fixes:ledger']({ projectId })
}

function cited(rows: readonly PromptCheckRow[] | undefined): number {
  return (rows ?? []).filter(isCited).length
}

describe('fixes:ledger on the seeded story', () => {
  test('one row per change, newest go-live first, with one change per status', async () => {
    const built = await ledger()
    expect(built.builtAt).toBe(new Date(NOW).toISOString())
    expect(built.rows.map((row) => [row.pageId, row.status])).toEqual([
      [gmail.id, 'too_new'],
      [schedule.id, 'not_cited'],
      [pricing.id, 'cited'],
      [alerts.id, 'lost']
    ])
    expect(built.rows.map((row) => row.daysLive)).toEqual([2, 11, 12, 15])
    expect(built.rows.map((row) => row.kind)).toEqual(['new_page', 'new_page', 'fix', 'rewrite'])
    expect(built.rows.every((row) => row.latestOnPage)).toBe(true)
    expect(built).toMatchObject({
      domain: 'textbolt.com',
      brand: 'TextBolt',
      trackedPages: 4,
      owners: { measure: 'CiteFox', reoptimise: 'You', publish: 'Your team' },
      anchors: [{ pageId: schedule.id, text: 'schedule text messages from email' }]
    })
    expect(built.markets.map((market) => market.id)).toEqual([FIX_LOOP_SEED.marketId])
    expect(built.schedule.lastCheckAt?.slice(0, 10)).toBe(seed.daysAgo(1).slice(0, 10))
  })

  test('counts come from the before and now rows of each check', async () => {
    const rows = (await ledger()).rows
    const byPage = new Map(rows.map((row) => [row.pageId, row]))
    const lost = byPage.get(alerts.id)
    expect(cited(lost?.before?.rows)).toBe(5)
    expect(cited(lost?.now?.rows)).toBe(1)
    expect(lost?.measuredSinceLive).toBe(true)
    expect(lost?.before?.checkedAt.slice(0, 10)).toBe(seed.daysAgo(18).slice(0, 10))
    expect(cited(byPage.get(pricing.id)?.before?.rows)).toBe(0)
    expect(cited(byPage.get(pricing.id)?.now?.rows)).toBe(3)
    expect(byPage.get(schedule.id)?.before).toBeNull()
    expect(cited(byPage.get(schedule.id)?.now?.rows)).toBe(0)
    expect(byPage.get(gmail.id)?.now?.rows).toHaveLength(2)
  })

  test('page dates, titles and index states', async () => {
    const byPage = new Map((await ledger()).rows.map((row) => [row.pageId, row]))
    expect(byPage.get(alerts.id)?.pageDates).toMatchObject({
      modifiedAt: seed.daysAgo(15),
      readAt: seed.daysAgo(14)
    })
    expect(byPage.get(schedule.id)?.pageDates?.publishedAt).toBe(seed.daysAgo(11))
    expect(byPage.get(alerts.id)?.title).toBe('Text alerts for business')
    expect(byPage.get(schedule.id)?.index).toEqual({
      state: 'not_indexed',
      checkedAt: seed.daysAgo(1),
      message: null
    })
    expect(byPage.get(gmail.id)?.index).toBeNull()
  })
})

describe('owners and change kinds', () => {
  test('renames an owner, trims it, and an empty label resets it', async () => {
    const renamed = await seed.handlers['fixes:setOwner']({
      projectId,
      step: 'publish',
      label: '  Priya  '
    })
    expect(renamed.publish).toBe('Priya')
    expect((await ledger()).owners.publish).toBe('Priya')
    const reset = await seed.handlers['fixes:setOwner']({ projectId, step: 'publish', label: '' })
    expect(reset.publish).toBe('Your team')
    await expect(
      seed.handlers['fixes:setOwner']({ projectId, step: 'publish', label: 'x'.repeat(41) })
    ).rejects.toThrow('Keep the owner to 40 characters or fewer')
    await expect(
      seed.handlers['fixes:setOwner']({ projectId, step: 'ship' as 'publish', label: 'Me' })
    ).rejects.toThrow('fixes:setOwner')
  })

  test('sets a change kind', async () => {
    const row = (await ledger()).rows.find((item) => item.pageId === pricing.id)
    if (row === undefined) throw new Error('no pricing row')
    await expect(
      seed.handlers['fixes:setKind']({ projectId, fixId: row.fixId, kind: 'rewrite' })
    ).resolves.toEqual({ fixId: row.fixId, kind: 'rewrite' })
    expect((await ledger()).rows.find((item) => item.fixId === row.fixId)?.kind).toBe('rewrite')
    await seed.handlers['fixes:setKind']({ projectId, fixId: row.fixId, kind: 'fix' })
    await expect(
      seed.handlers['fixes:setKind']({ projectId, fixId: 'nope', kind: 'fix' })
    ).rejects.toThrow('That change was not found')
  })
})

describe('fixes:lostGround', () => {
  test('buckets the questions the guide lost, with where each went', async () => {
    const view = await seed.handlers['fixes:lostGround']({
      projectId,
      pageId: alerts.id,
      vsRunId: null
    })
    expect(view.buckets).toEqual({
      still_cited: ['alerts-1'],
      moved_tracked: ['alerts-4', 'alerts-5'],
      moved_own: ['alerts-3'],
      not_cited: ['alerts-2']
    })
    expect(view.notCheckedNow).toEqual([])
    expect(view.movedToPage).toEqual({ 'alerts-4': pricing.id, 'alerts-5': pricing.id })
    expect(view.movedTo['alerts-3']).toBe(FIX_LOOP_SEED.featuresUrl)
    expect(view.change).toMatchObject({
      kind: 'rewrite',
      liveSince: seed.daysAgo(15),
      description: 'Rewrote the guide as a short platform list.'
    })
    expect(view.checks.map((check) => check.cited)).toEqual([1, 5])
    expect(view.beforeRead?.fetchedAt).toBe(seed.daysAgo(20))
    expect(view.nowRead?.fetchedAt).toBe(seed.daysAgo(14))
    expect(view.outline).toMatchObject({ removed: 2, added: 2 })
    expect(view.plan).toBeNull()
  })

  test('needs two full checks, and refuses a check that is not older', async () => {
    await expect(
      seed.handlers['fixes:lostGround']({ projectId, pageId: gmail.id, vsRunId: null })
    ).rejects.toThrow('Lost ground needs two full checks of this page.')
    const view = await seed.handlers['fixes:lostGround']({
      projectId,
      pageId: alerts.id,
      vsRunId: null
    })
    await expect(
      seed.handlers['fixes:lostGround']({ projectId, pageId: alerts.id, vsRunId: view.now.runId })
    ).rejects.toThrow('Pick an older full check of this page to compare with.')
  })

  test('saves an edited recovery plan and shows it for the same two checks only', async () => {
    const view = await seed.handlers['fixes:lostGround']({
      projectId,
      pageId: alerts.id,
      vsRunId: null
    })
    const inputKey = `${view.before.runId}|${view.now.runId}`
    const saved = await seed.handlers['fixes:saveRecoveryPlan']({
      projectId,
      pageId: alerts.id,
      inputKey,
      text: '  1. Restore the setup steps.\n2. Link to pricing.  '
    })
    expect(saved).toMatchObject({
      text: '1. Restore the setup steps.\n2. Link to pricing.',
      edited: true,
      inputKey
    })
    const again = await seed.handlers['fixes:lostGround']({
      projectId,
      pageId: alerts.id,
      vsRunId: view.before.runId
    })
    expect(again.plan).toEqual(saved)
    await expect(
      seed.handlers['fixes:saveRecoveryPlan']({ projectId, pageId: alerts.id, inputKey, text: ' ' })
    ).rejects.toThrow('Write the plan first')
  })
})

describe('saved page fix briefs', () => {
  test('saves a brief per page fix, lists it, and refuses one that is not a brief', async () => {
    expect(await seed.handlers['fixes:briefs']({ projectId })).toEqual({ projectId, briefs: [] })
    const brief = {
      title: 'Fix brief',
      summary: 'Add a setup checklist.',
      items: [{ id: 'step-0', label: 'Step', text: 'Add the checklist.' }],
      text: 'Add a setup checklist.',
      writeWithUrl: null,
      note: 'CiteFox AI · about 6 s · no searches'
    }
    const saved = await seed.handlers['fixes:saveBrief']({ projectId, fixId: 'pf1abc', brief })
    expect(saved).toEqual({ fixId: 'pf1abc', brief, savedAt: new Date(NOW).toISOString() })
    expect(await seed.handlers['fixes:briefs']({ projectId })).toEqual({
      projectId,
      briefs: [saved]
    })
    await expect(
      seed.handlers['fixes:saveBrief']({
        projectId,
        fixId: 'pf1abc',
        brief: { ...brief, writeWithUrl: 'javascript:alert(1)' }
      })
    ).rejects.toThrow()
  })
})

describe('index checks', () => {
  test('previews the searches against the key room and the project cap', async () => {
    const preview = await seed.handlers['fixes:indexPreview']({
      projectId,
      pageIds: [alerts.id, schedule.id, 'page-missing']
    })
    // The key reported 40 of 250 used, more than CiteFox's own count, so 210 are left.
    const used = monthUsage()
    expect(used).toBeLessThan(40)
    expect(preview).toEqual({
      pages: 2,
      searchesMin: 2,
      searchesMax: 4,
      left: 210,
      canRun: true,
      reason: null
    })
    const db = seed.openProject()
    try {
      writeProjectScheduleCap(db, { cap: used + 3, capRule: 'pause', dedicatedKeyId: null })
    } finally {
      closeProjectDatabase(db)
    }
    const capped = await seed.handlers['fixes:indexPreview']({
      projectId,
      pageIds: [alerts.id, schedule.id]
    })
    expect(capped).toMatchObject({ left: 3, canRun: false })
    expect(capped.reason).toContain('needs up to 4 searches and 3 are left')
    await expect(
      seed.handlers['fixes:checkIndex']({
        projectId,
        pageIds: [alerts.id, schedule.id],
        confirmedSearches: 4
      })
    ).rejects.toThrow('needs up to 4 searches')
    const db2 = seed.openProject()
    try {
      writeProjectScheduleCap(db2, { cap: null, capRule: 'pause', dedicatedKeyId: null })
    } finally {
      closeProjectDatabase(db2)
    }
  })

  test('runs only for the confirmed figure, charges each search and stores the states', async () => {
    await expect(
      seed.handlers['fixes:checkIndex']({
        projectId,
        pageIds: [alerts.id, schedule.id],
        confirmedSearches: 2
      })
    ).rejects.toThrow('The number of searches changed')
    const before = monthUsage()
    const sent = seed.requests.length
    const run = await seed.handlers['fixes:checkIndex']({
      projectId,
      pageIds: [alerts.id, schedule.id],
      confirmedSearches: 4
    })
    expect(run.searchesUsed).toBe(2)
    expect(run.stoppedReason).toBeNull()
    expect(run.results.map((result) => [result.pageId, result.check.state])).toEqual([
      [alerts.id, 'indexed'],
      [schedule.id, 'not_indexed']
    ])
    expect(seed.requests.slice(sent).map((url) => url.searchParams.get('q'))).toEqual([
      'site:textbolt.com/blog/how-to-set-up-text-alerts-for-business',
      'site:textbolt.com/blog/schedule-text-messages'
    ])
    expect(monthUsage()).toBe(before + 2)
    const byPage = new Map((await ledger()).rows.map((row) => [row.pageId, row]))
    expect(byPage.get(alerts.id)?.index?.state).toBe('indexed')
  })
})

/** Searches this project used this month, from `key_usage`. */
function monthUsage(): number {
  const month = usageMonth(seed.host.now())
  let total = 0
  for (const key of getKeyUsageForMonth(seed.storage.db, month).keys) {
    for (const project of key.projects)
      if (project.projectId === projectId) total += project.searches
  }
  return total
}
