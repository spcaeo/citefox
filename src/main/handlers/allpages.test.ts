import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GridViewState } from '@shared/domain'
import type { BulkActionRequest, CheckProgress } from '@shared/ipc'
import { afterEach, describe, expect, test } from 'vitest'
import { citationNoise } from '../engine/allpages/noise'
import { closeSeeds, envelope, page, seed } from '../engine/checks/checks.test-helper'
import { configureExportSaveDialog, resetExportSaveDialog } from '../export/ipc'
import { getPage, insertPage } from '../storage/pages'
import { listSavedPromptSets } from '../storage/prompt-set-records'

const PRICING = 'https://textbolt.com/pricing/'
const directories: string[] = []

afterEach(() => {
  closeSeeds()
  resetExportSaveDialog()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** `own`: both pages' prompts cite /pricing/ instead. `target`: the fixture cites page-1's URL. */
async function seeded(body: 'own' | 'target' = 'own'): ReturnType<typeof seed> {
  const progress: CheckProgress[] = []
  const seededProject = await seed({
    progress,
    secondPage: true,
    http(request) {
      const url = new URL(request.url)
      if (url.searchParams.get('engine') === 'google') return envelope('google-page-token.json')
      return envelope(body === 'own' ? 'google-own-page.json' : 'google-ai-overview.json')
    }
  })
  insertPage(seededProject.projectDb, {
    ...page(),
    id: 'page-pricing',
    url: PRICING,
    title: 'Pricing',
    label: null,
    folder: null,
    status: 'not_tracked',
    setupStep: 'read'
  })
  const job = await seededProject.handlers['checks:start']({
    projectId: 'proj-1',
    pageIds: ['page-1', 'page-2'],
    marketIds: null,
    promptIds: null
  })
  expect(job.status).toBe('finished')
  return seededProject
}

function bulk(action: BulkActionRequest['action'], pageIds: string[]): BulkActionRequest {
  return { projectId: 'proj-1', pageIds, action, marketId: null, intervalDays: null, groupId: null }
}

describe('allpages:list (FR-20.1, FR-20.2, FR-20.7)', () => {
  test('lists every found page with default-market numbers that match Results', async () => {
    const { handlers } = await seeded('target')
    const data = await handlers['allpages:list']({ projectId: 'proj-1' })
    expect(data.foundPageCount).toBe(3)
    expect(data.trackedPageCount).toBe(2)
    expect(data.rows.map((row) => row.id)).toEqual(['page-1', 'page-2', 'page-pricing'])
    // Site structure's tables exist from project migration 018, so there is a
    // (still empty) group list rather than null.
    expect(data.groups).toEqual([])
    const first = data.rows[0]
    const results = await handlers['results:get']({
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: null,
      runId: null
    })
    expect(first?.score).toBe(results.run?.visibilityScore)
    expect(first?.pageCited).toBe(results.run?.pageCited)
    expect(first?.aioPrompts).toBe(results.run?.promptsWithAio)
    expect(first?.citations).toBe(results.run?.citationsThisPage)
    // Drill-downs load exactly this check, so the drawer total equals the cell (NFR-14).
    expect(first?.runId).toBe(results.run?.runId)
    expect(first?.marketIds).toEqual(['mkt-us'])
    expect(first?.promptCount).toBe(1)
    expect(first?.lastCheckedAt).not.toBeNull()
    expect(first?.clusters).toEqual([])
    const scores = await handlers['scores:listPages']({ projectId: 'proj-1' })
    expect(data.summary).toEqual(scores.summary)
    for (const row of data.rows) {
      const score = scores.pages.find((item) => item.pageId === row.id)
      expect(row.score).toBe(score?.score ?? null)
      expect(row.change).toBe(score?.change ?? null)
      expect(row.nextCheckAt).toBe(score?.nextCheckAt ?? null)
    }
    const pricing = data.rows[2]
    expect(pricing?.status).toBe('not_tracked')
    expect(pricing?.score).toBeNull()
    expect(pricing?.marketIds).toEqual([])
  })
})

describe('allpages:citations (FR-20.4, FR-20.5)', () => {
  test('lists the wrong-page case and the own page cited but not tracked', async () => {
    const { handlers } = await seeded('own')
    const review = await handlers['allpages:citations']({ projectId: 'proj-1' })
    expect(review.wrongPagePages).toBe(2)
    const caseOne = review.wrongPage.find((item) => item.pageId === 'page-1')
    expect(caseOne).toMatchObject({
      marketId: 'mkt-us',
      promptId: 'prompt-1',
      citedPageId: 'page-pricing',
      citedPageReady: false
    })
    expect(caseOne?.citedUrl).toContain('textbolt.com/pricing/')
    expect(review.untracked).toHaveLength(1)
    expect(review.untracked[0]).toMatchObject({
      pageId: 'page-pricing',
      citations: 2,
      citedFor: 2,
      noise: null,
      ignored: false
    })
    // The citations behind the counts, for the drawer (NFR-14).
    const refs = review.untracked[0]?.refs ?? []
    expect(refs).toHaveLength(review.untracked[0]?.citations ?? -1)
    expect(new Set(refs.map((ref) => ref.pageId)).size).toBe(review.untracked[0]?.citedFor)
    expect(refs[0]).toMatchObject({ marketId: 'mkt-us', promptId: 'prompt-1' })
    expect(refs[0]?.runId).toBeTruthy()
    await handlers['allpages:ignoreUrl']({
      projectId: 'proj-1',
      url: review.untracked[0]?.url ?? '',
      ignored: true
    })
    const after = await handlers['allpages:citations']({ projectId: 'proj-1' })
    expect(after.untracked[0]?.ignored).toBe(true)
    await handlers['allpages:ignoreUrl']({
      projectId: 'proj-1',
      url: review.untracked[0]?.url ?? '',
      ignored: false
    })
    expect(
      (await handlers['allpages:citations']({ projectId: 'proj-1' })).untracked[0]?.ignored
    ).toBe(false)
  })

  test('marks login, account, legal, cart and search pages as likely noise', () => {
    expect(citationNoise('https://textbolt.com/login/')).toBe('login')
    expect(citationNoise('https://textbolt.com/app/sign-in')).toBe('login')
    expect(citationNoise('https://textbolt.com/my-account/orders')).toBe('account')
    expect(citationNoise('https://textbolt.com/privacy-policy.html')).toBe('legal')
    expect(citationNoise('https://textbolt.com/checkout')).toBe('cart')
    expect(citationNoise('https://textbolt.com/search?q=sms')).toBe('search')
    expect(citationNoise('https://textbolt.com/blog/login-alerts/')).toBeNull()
    expect(citationNoise('not a url')).toBeNull()
  })

  test('Point it here moves the prompt to a set-up page from the next check, and Undo', async () => {
    const { handlers, projectDb } = await seeded('own')
    const notReady = await handlers['allpages:pointHere']({
      projectId: 'proj-1',
      fromPageId: 'page-1',
      promptId: 'prompt-1',
      toPageId: 'page-pricing'
    })
    expect(notReady.ok).toBe(false)
    if (!notReady.ok) expect(notReady.nextStep).toMatch(/finish its setup/)

    const moved = await handlers['allpages:pointHere']({
      projectId: 'proj-1',
      fromPageId: 'page-1',
      promptId: 'prompt-1',
      toPageId: 'page-2'
    })
    expect(moved.ok).toBe(true)
    const fromSet = await handlers['prompts:list']({ projectId: 'proj-1', pageId: 'page-1' })
    const toSet = await handlers['prompts:list']({ projectId: 'proj-1', pageId: 'page-2' })
    expect(fromSet.version).toBe(2)
    expect(fromSet.prompts.map((prompt) => prompt.variants[0]?.text)).not.toContain(
      'How do I alert the crew?'
    )
    expect(toSet.prompts.map((prompt) => prompt.variants[0]?.text)).toContain(
      'How do I alert the crew?'
    )
    if (!moved.ok) return
    await handlers['allpages:undoPoint']({ projectId: 'proj-1', ...moved.undo })
    const restored = await handlers['prompts:list']({ projectId: 'proj-1', pageId: 'page-1' })
    expect(restored.promptSetId).toBe('pset-1')
    expect(listSavedPromptSets(projectDb, 'page-2').find((set) => set.isActive)?.id).toBe('pset-2')
  })

  test('Merge adds a fix to the tracked page, and Undo removes it', async () => {
    const { handlers } = await seeded('own')
    const merged = await handlers['allpages:merge']({
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: 'mkt-us',
      promptId: 'prompt-1',
      citedUrl: PRICING
    })
    expect(merged.fixNumber).toBe(1)
    expect(merged.message).toMatch(/Fix #1/)
    await expect(
      handlers['allpages:undoMerge']({ projectId: 'proj-1', fixId: merged.fixId })
    ).resolves.toEqual({ fixId: merged.fixId })
    await expect(
      handlers['allpages:undoMerge']({ projectId: 'proj-1', fixId: merged.fixId })
    ).rejects.toThrow(/not found/)
  })
})

describe('bulk actions (FR-20.3)', () => {
  test('shows the search cost before each action and skips pages it cannot change', async () => {
    const { handlers } = await seeded('target')
    const ids = ['page-1', 'page-2', 'page-pricing']
    const check = await handlers['allpages:estimate'](bulk('check', ids))
    expect(check).toMatchObject({
      eligible: 2,
      minSearches: 2,
      maxSearches: 4,
      timing: 'now',
      skipped: [{ reason: 'not tracked', count: 1 }]
    })
    expect(check.summary).toMatch(/Checking 2 pages now uses about 2–4 searches/)
    const pause = await handlers['allpages:estimate'](bulk('pause', ids))
    expect(pause).toMatchObject({ eligible: 2, minSearches: 4, maxSearches: 9 })
    expect(pause.timing).toBe('saved_per_month')
    const track = await handlers['allpages:estimate'](bulk('track', ids))
    expect(track).toMatchObject({ eligible: 1, timing: 'first_checks', minSearches: 1 })
    const exported = await handlers['allpages:estimate'](bulk('export', ids))
    expect(exported).toMatchObject({ eligible: 3, minSearches: 0, timing: 'none' })
    const slower = await handlers['allpages:estimate']({
      ...bulk('change_schedule', ['page-1']),
      intervalDays: 30
    })
    expect(slower.timing).toBe('saved_per_month')
    expect(slower.minSearches).toBeGreaterThan(0)
  })

  test('runs track, pause, add market and change schedule', async () => {
    const { handlers, projectDb } = await seeded('target')
    const tracked = await handlers['allpages:run'](bulk('track', ['page-pricing']))
    expect(tracked.changed).toBe(1)
    expect(getPage(projectDb, 'page-pricing', 'proj-1')?.status).toBe('setting_up')
    const list = await handlers['allpages:list']({ projectId: 'proj-1' })
    expect(list.rows.find((row) => row.id === 'page-pricing')?.marketIds).toEqual(['mkt-us'])

    const paused = await handlers['allpages:run'](bulk('pause', ['page-1', 'page-2']))
    expect(paused).toMatchObject({ changed: 2, skipped: 0 })
    expect(getPage(projectDb, 'page-2', 'proj-1')?.status).toBe('paused')

    const schedule = await handlers['allpages:run']({
      ...bulk('change_schedule', ['page-1']),
      intervalDays: 60
    })
    expect(schedule.changed).toBe(1)
    expect(getPage(projectDb, 'page-1', 'proj-1')?.intervalDays).toBe(60)

    await expect(
      handlers['allpages:run']({ ...bulk('add_market', ['page-1']), marketId: 'mkt-none' })
    ).rejects.toThrow(/market was not found/)
    await expect(handlers['allpages:run'](bulk('add_to_group', ['page-1']))).rejects.toThrow(
      /group was not found/
    )
  })
})

describe('bulk resume, stop, pin and remove from group (crosscut §4.4 item 4)', () => {
  test('resume shows its monthly cost and turns paused pages back on', async () => {
    const { handlers, projectDb } = await seeded('target')
    await handlers['allpages:run'](bulk('pause', ['page-1']))
    const estimate = await handlers['allpages:estimate'](
      bulk('resume', ['page-1', 'page-2', 'page-pricing'])
    )
    expect(estimate).toMatchObject({
      eligible: 1,
      timing: 'per_month',
      skipped: [{ reason: 'not paused', count: 2 }]
    })
    expect(estimate.minSearches).toBeGreaterThan(0)
    expect(estimate.summary).toMatch(/^Resuming 1 page adds about/)
    const resumed = await handlers['allpages:run'](bulk('resume', ['page-1', 'page-2']))
    expect(resumed).toMatchObject({ changed: 1, skipped: 1 })
    expect(getPage(projectDb, 'page-1', 'proj-1')?.status).toBe('tracked')
  })

  test('stop keeps history, says what it saves, and Undo puts each page back', async () => {
    const { handlers, projectDb } = await seeded('target')
    await handlers['allpages:run'](bulk('pause', ['page-2']))
    await handlers['pages:pin']({ projectId: 'proj-1', pageId: 'page-1' })
    const ids = ['page-1', 'page-2', 'page-pricing']
    const estimate = await handlers['allpages:estimate'](bulk('stop', ids))
    expect(estimate).toMatchObject({
      eligible: 2,
      timing: 'saved_per_month',
      skipped: [{ reason: 'not tracked', count: 1 }]
    })
    expect(estimate.summary).toMatch(/^Stopping 2 pages saves about .* History stays/)
    const stopped = await handlers['allpages:run'](bulk('stop', ids))
    expect(stopped).toMatchObject({ changed: 2, skipped: 1 })
    expect(stopped.message).toBe(
      'Stopped tracking 2 pages. History stays; no more searches are used.'
    )
    expect(stopped.previous).toEqual([
      { pageId: 'page-1', previousStatus: 'tracked' },
      { pageId: 'page-2', previousStatus: 'paused' }
    ])
    expect(getPage(projectDb, 'page-1', 'proj-1')).toMatchObject({
      status: 'removed',
      pinned: false
    })
    const results = await handlers['results:get']({
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: null,
      runId: null
    })
    expect(results.run).not.toBeNull()
    for (const item of stopped.previous ?? []) {
      await handlers['allpages:undoTrack']({ projectId: 'proj-1', ...item })
    }
    expect(getPage(projectDb, 'page-1', 'proj-1')?.status).toBe('tracked')
    expect(getPage(projectDb, 'page-2', 'proj-1')?.status).toBe('paused')
    const paused = await handlers['allpages:estimate'](bulk('stop', ['page-2']))
    expect(paused).toMatchObject({ eligible: 1, timing: 'none', minSearches: 0 })
    expect(paused.summary).toBe('Stopping 1 page runs no search. History stays.')
  })

  test('pin skips pinned pages, and remove from group skips pages not in it', async () => {
    const { handlers, projectDb } = await seeded('target')
    await handlers['pages:pin']({ projectId: 'proj-1', pageId: 'page-1' })
    const pin = await handlers['allpages:estimate'](bulk('pin', ['page-1', 'page-2']))
    expect(pin).toMatchObject({
      eligible: 1,
      timing: 'none',
      skipped: [{ reason: 'already pinned', count: 1 }]
    })
    const pinned = await handlers['allpages:run'](bulk('pin', ['page-1', 'page-2']))
    expect(pinned.changed).toBe(1)
    expect(getPage(projectDb, 'page-2', 'proj-1')?.pinned).toBe(true)

    await expect(
      handlers['allpages:estimate'](bulk('remove_from_group', ['page-1']))
    ).rejects.toThrow(/group was not found/)
    projectDb
      .prepare(`INSERT INTO groups (id, name, created_at) VALUES ('g-q4', 'Q4', ?)`)
      .run('2026-10-20T12:00:00.000Z')
    await handlers['allpages:run']({ ...bulk('add_to_group', ['page-1']), groupId: 'g-q4' })
    const estimate = await handlers['allpages:estimate']({
      ...bulk('remove_from_group', ['page-1', 'page-2']),
      groupId: 'g-q4'
    })
    expect(estimate).toMatchObject({
      eligible: 1,
      timing: 'none',
      skipped: [{ reason: 'not in that group', count: 1 }]
    })
    const removed = await handlers['allpages:run']({
      ...bulk('remove_from_group', ['page-1', 'page-2']),
      groupId: 'g-q4'
    })
    expect(removed).toMatchObject({ changed: 1, message: 'Removed 1 page from the group.' })
    const list = await handlers['allpages:list']({ projectId: 'proj-1' })
    expect(list.rows.find((row) => row.id === 'page-1')?.groups).toEqual([])
  })
})

describe('Track and Ignore for cited own pages (FR-20.5)', () => {
  test('tracks a new own URL with the default market, refuses another domain, and undoes', async () => {
    const { handlers, projectDb } = await seeded('target')
    const result = await handlers['allpages:trackUrl']({
      projectId: 'proj-1',
      url: 'https://textbolt.com/features/two-way/'
    })
    expect(result.previousStatus).toBeNull()
    const added = getPage(projectDb, result.pageId, 'proj-1')
    expect(added).toMatchObject({
      status: 'setting_up',
      folder: 'features',
      defaultMarketId: 'mkt-us'
    })
    await handlers['allpages:undoTrack']({
      projectId: 'proj-1',
      pageId: result.pageId,
      previousStatus: null
    })
    expect(getPage(projectDb, result.pageId, 'proj-1')).toBeNull()
    await expect(
      handlers['allpages:trackUrl']({ projectId: 'proj-1', url: 'https://twilio.com/pricing' })
    ).rejects.toThrow(/Only pages on textbolt.com/)

    const existing = await handlers['allpages:trackUrl']({ projectId: 'proj-1', url: PRICING })
    expect(existing).toMatchObject({ pageId: 'page-pricing', previousStatus: 'not_tracked' })
    await handlers['allpages:undoTrack']({
      projectId: 'proj-1',
      pageId: 'page-pricing',
      previousStatus: 'not_tracked'
    })
    expect(getPage(projectDb, 'page-pricing', 'proj-1')?.status).toBe('not_tracked')
  })
})

describe('grid views and Export CSV (FR-21.1, FR-21.2, FR-21.8)', () => {
  const state: GridViewState = {
    search: '',
    filters: { status: ['tracked'] },
    ranges: {},
    sort: [{ key: 'score', dir: 'desc' }],
    hidden: [],
    widths: { page: 300 },
    density: 'comfortable',
    view: 'table',
    groupBy: null,
    treeBy: null,
    pageSize: 25
  }

  test('saves, renames, lists, and deletes a view per grid', async () => {
    const { handlers } = await seeded('target')
    const saved = await handlers['grid:saveView']({
      projectId: 'proj-1',
      grid: 'all-pages',
      id: null,
      name: '  Money pages ',
      state
    })
    expect(saved.name).toBe('Money pages')
    await expect(
      handlers['grid:saveView']({
        projectId: 'proj-1',
        grid: 'all-pages',
        id: null,
        name: 'money PAGES',
        state
      })
    ).rejects.toThrow(/already exists/)
    await handlers['grid:saveView']({
      projectId: 'proj-1',
      grid: 'all-pages',
      id: saved.id,
      name: 'Top pages',
      state: { ...state, density: 'compact' }
    })
    const list = await handlers['grid:listViews']({ projectId: 'proj-1', grid: 'all-pages' })
    expect(list.views.map((view) => [view.name, view.state.density])).toEqual([
      ['Top pages', 'compact']
    ])
    expect(
      (await handlers['grid:listViews']({ projectId: 'proj-1', grid: 'prompts' })).views
    ).toEqual([])
    await handlers['grid:deleteView']({ projectId: 'proj-1', viewId: saved.id })
    expect(
      (await handlers['grid:listViews']({ projectId: 'proj-1', grid: 'all-pages' })).views
    ).toEqual([])
  })

  test('remembers the last view of a screen per project', async () => {
    const { handlers } = await seeded('target')
    const read = async (screen: string): Promise<{ view: string | null }> =>
      await handlers['grid:getScreenView']({ projectId: 'proj-1', screen })
    expect(await read('topic')).toEqual({ view: null })
    await handlers['grid:setScreenView']({ projectId: 'proj-1', screen: 'topic', view: 'grid' })
    expect(await read('topic')).toEqual({ view: 'grid' })
    expect(await read('pages')).toEqual({ view: null })
    await expect(
      handlers['grid:setScreenView']({ projectId: 'proj-1', screen: 'topic', view: 'Grid view' })
    ).rejects.toThrow()
    await expect(
      handlers['grid:getScreenView']({ projectId: 'proj-1', screen: 'topic', extra: 1 } as never)
    ).rejects.toThrow()
  })

  test('writes UTF-8 with a BOM, neutralizes formula text, and honours Cancel', async () => {
    const { handlers } = await seeded('target')
    const directory = mkdtempSync(join(tmpdir(), 'citefox-grid-csv-'))
    directories.push(directory)
    const target = join(directory, 'pages.csv')
    configureExportSaveDialog(async () => ({ canceled: false, filePath: target }))
    const result = await handlers['grid:exportCsv']({
      fileName: 'textbolt-all-pages.csv',
      header: ['Page', 'Score'],
      rows: [
        ['=HYPERLINK("x")', 50],
        ['Café, "quoted"', null]
      ]
    })
    expect(result).toEqual({ ok: true, rowCount: 2, columnCount: 2, fileName: 'pages.csv' })
    const text = readFileSync(target, 'utf8')
    expect(text.charCodeAt(0)).toBe(0xfeff)
    expect(text.slice(1)).toBe('Page,Score\r\n"\'=HYPERLINK(""x"")",50\r\n"Café, ""quoted""",\r\n')
    configureExportSaveDialog(async () => ({ canceled: true }))
    const cancelled = await handlers['grid:exportCsv']({
      fileName: 'textbolt-all-pages.csv',
      header: ['Page'],
      rows: [['x']]
    })
    expect(cancelled).toMatchObject({ ok: false, reason: 'cancelled' })
    await expect(
      handlers['grid:exportCsv']({ fileName: '../evil.csv', header: ['Page'], rows: [] })
    ).rejects.toThrow()
  })
})

describe('Site structure memberships by data (FR-19.5, FR-19.7)', () => {
  test('reads clusters and groups from Site structure, and adds pages to a group', async () => {
    const { handlers, projectDb } = await seeded('target')
    const at = '2026-10-20T12:00:00.000Z'
    projectDb
      .prepare(
        `INSERT INTO clusters (id, name, made_by, created_at) VALUES ('c-alerts', 'Email-to-SMS & carrier gateways', 'user', ?)`
      )
      .run(at)
    projectDb
      .prepare(
        `INSERT INTO cluster_pages (cluster_id, page_id, role) VALUES ('c-alerts', 'page-1', 'pillar')`
      )
      .run()
    projectDb
      .prepare(`INSERT INTO groups (id, name, created_at) VALUES ('g-q4', 'Q4 money pages', ?)`)
      .run(at)
    const data = await handlers['allpages:list']({ projectId: 'proj-1' })
    expect(data.groups).toEqual([{ id: 'g-q4', name: 'Q4 money pages' }])
    expect(data.rows.find((row) => row.id === 'page-1')?.clusters).toEqual([
      { id: 'c-alerts', name: 'Email-to-SMS & carrier gateways' }
    ])
    expect(data.rows.find((row) => row.id === 'page-2')?.clusters).toEqual([])
    const estimate = await handlers['allpages:estimate']({
      ...bulk('add_to_group', ['page-1', 'page-2']),
      groupId: 'g-q4'
    })
    expect(estimate).toMatchObject({ eligible: 2, minSearches: 0, timing: 'none' })
    const added = await handlers['allpages:run']({
      ...bulk('add_to_group', ['page-1', 'page-2']),
      groupId: 'g-q4'
    })
    expect(added.changed).toBe(2)
    const again = await handlers['allpages:estimate']({
      ...bulk('add_to_group', ['page-1']),
      groupId: 'g-q4'
    })
    expect(again.skipped).toEqual([{ reason: 'already in that group', count: 1 }])
    const after = await handlers['allpages:list']({ projectId: 'proj-1' })
    expect(after.rows.find((row) => row.id === 'page-2')?.groups).toEqual([
      { id: 'g-q4', name: 'Q4 money pages' }
    ])
  })
})
