import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer, type ViteDevServer } from 'vite'
import { join, resolve } from 'node:path'
import { TEXTBOLT_TOPIC_CHECKS, TEXTBOLT_TOPIC_ID } from '../../src/shared/fixtures/textbolt-topic'
import { e2eArtifact } from './artifacts'
import { drawerRowCount } from './drill-helpers'
import { launchCiteFox } from './launch'
import { openAllPages } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { openHash } from './screens-app'

/**
 * NFR-14 through the production shell.
 * Charts expose a table (visible or screen-reader) whose segment cells carry
 * `data-nfr-segment` and whose total carries `data-nfr-total`. A repeated
 * check uses `data-nfr-chart-row` so each row sums on its own. Drill controls
 * carry `data-nfr-drill`, and the count they show carries `data-nfr-figure`
 * with the same id. A new `role="img"` chart that is not inside one of those
 * markers, and a new count button that is not marked, fails this spec.
 */

interface LoadedCheck {
  userDataDir: string
  projectId: string
  pageId: string
  marketId: string
}

interface ChartReading {
  name: string
  total: number
  segments: number[]
  score: number | null
}

interface StoreTotals {
  citationsThisPage: number
  citationsOtherOwn: number
  pageCited: number
  promptsWithAio: number
  pageScore: number | null
  projectScore: number | null
}

let server: ViteDevServer | undefined
let seeded: LoadedCheck | undefined

test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    appType: 'custom',
    server: { middlewareMode: true },
    resolve: { alias: { '@shared': resolve('src/shared') } },
    // nfr14-load → export/xlsx.ts imports exceljs, and createServer still
    // starts the client dep optimizer against the shared node_modules/.vite
    // cache. getConfigHash includes root and resolve.alias, so a cache written
    // by another spec — or the same checkout when a file URL encodes a space
    // as %20 — does not match. Vite then deletes deps/ ("Re-optimizing
    // dependencies because vite config has changed") while ssrLoadModule is
    // linking exceljs, and Node throws "request for './index.js' is not in
    // cache". This server only evaluates Node modules, so do not prebundle.
    cacheDir: resolve('node_modules/.vite-nfr14'),
    optimizeDeps: { noDiscovery: true },
    ssr: {
      external: ['better-sqlite3', 'electron', '@napi-rs/keyring', 'exceljs'],
      optimizeDeps: { noDiscovery: true }
    }
  })
  const loaded = await loadNfr14Module(server)
  seeded = await loaded.loadTextboltCheck()
})

test.afterAll(async () => {
  if (seeded) await rm(seeded.userDataDir, { recursive: true, force: true })
  await server?.close()
})

test('citations, scores, and reports agree on chart totals and drill rows', async () => {
  test.setTimeout(180_000)
  const fixture = requiredSeed()
  const { app, page } = await launchCiteFox({
    userDataDir: fixture.userDataDir,
    viewport: { width: 1280, height: 900 }
  })
  const coverage: {
    charts: ChartReading[]
    drills: { id: string; count: number; rows: number }[]
    series: string[]
    reportsCharts: number
    exportCharts: number
  } = { charts: [], drills: [], series: [], reportsCharts: 0, exportCharts: 0 }
  try {
    // The project opens on Overview; All pages is #/pages.
    await page.evaluate(() => {
      window.location.hash = '#/pages'
    })
    await expect(
      page
        .getByRole('grid', { name: 'Pages' })
        .getByRole('link', { name: 'Text alerts for business', exact: true })
    ).toBeVisible()
    await openPage(page, fixture.pageId, 'results')
    // The Results tab draws the links KPI once, in the page-results screen; the
    // citations screen in its "Who gets cited" tab keeps only "Sources Google listed".
    await openResultsTab(page, 'Who gets cited')
    const citations = page.locator('#page-tabpanel')
    await expect(
      citations.locator('[data-nfr-screen="citations"]').getByRole('heading', {
        name: 'Sources Google listed'
      })
    ).toBeVisible()
    const citationCharts = await readCharts(citations)
    expect(citationCharts.map((chart) => chart.name)).toContain('own-domain-links')
    coverage.charts.push(...citationCharts)
    await assertImages(citations)
    coverage.drills.push(...(await assertDrills(page, citations)))

    await openPage(page, fixture.pageId, 'progress')
    const scores = page.locator('#page-tabpanel')
    await expect(
      scores.getByRole('heading', { name: 'How often overviews cite this page' })
    ).toBeVisible()
    const scoreCharts = await readCharts(scores)
    expect(scoreCharts.some((chart) => chart.name === 'citation-rate')).toBe(true)
    coverage.charts.push(...scoreCharts)
    await assertImages(scores)
    coverage.series.push(...(await assertSeries(scores)))
    coverage.drills.push(...(await assertDrills(page, scores)))

    const store = await readStore(page, fixture)
    const links = citationCharts.find((chart) => chart.name === 'own-domain-links')
    expect(links?.segments).toEqual([store.citationsThisPage, store.citationsOtherOwn])
    expect(links?.total).toBe(store.citationsThisPage + store.citationsOtherOwn)
    const rate = scoreCharts.filter((chart) => chart.name === 'citation-rate')
    const latest = rate[rate.length - 1]
    expect(latest?.segments[0]).toBe(store.pageCited)
    expect(latest?.total).toBe(store.promptsWithAio)
    expect(latest?.score).toBe(store.pageScore)
    expect(store.projectScore).toBe(store.pageScore)
    if (store.pageScore !== null) {
      await expect(scores.getByText(`Visibility score ${store.pageScore}`)).toBeVisible()
    }

    await openSection(page, '/reports')
    await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible()
    const reports = page.locator('main')
    coverage.reportsCharts = await reports.locator('[data-nfr-chart]').count()
    expect(coverage.reportsCharts).toBe(0)
    await assertImages(reports)
    expect(await reports.locator('[data-nfr-drill]').count()).toBe(0)

    await openSection(page, '/export')
    await expect(page.getByRole('heading', { level: 1, name: 'Export a report' })).toBeVisible()
    const summary = page.locator('main')
    coverage.exportCharts = await summary.locator('[data-nfr-chart]').count()
    expect(coverage.exportCharts).toBe(0)
    await assertImages(summary)

    await writeFile(await e2eArtifact('nfr14-coverage.json'), JSON.stringify(coverage, null, 2))
  } finally {
    await app.close()
  }
})

test('page Results and Running charts and drills', async () => {
  test.setTimeout(180_000)
  const fixture = requiredSeed()
  const { app, page } = await launchCiteFox({
    userDataDir: fixture.userDataDir,
    viewport: { width: 1280, height: 900 }
  })
  const coverage: {
    charts: ChartReading[]
    drills: { id: string; count: number; rows: number }[]
    runningCharts: number
    runningDrills: number
  } = { charts: [], drills: [], runningCharts: 0, runningDrills: 0 }
  try {
    // The project opens on Overview; All pages is #/pages.
    await page.evaluate(() => {
      window.location.hash = '#/pages'
    })
    await expect(
      page
        .getByRole('grid', { name: 'Pages' })
        .getByRole('link', { name: 'Text alerts for business', exact: true })
    ).toBeVisible()
    await openPage(page, fixture.pageId, 'results')
    const screen = page.locator('#page-tabpanel [data-nfr-screen="page-results"]')
    await expect(screen.getByRole('heading', { name: 'What this report covers' })).toBeVisible()
    // The KPI row and summary stay above the tabs; each tab's panel adds its own
    // charts and drills, so read the screen once, then each other tab's panel.
    await openResultsTab(page, 'Questions')
    const charts = await readCharts(screen)
    await assertImages(screen)
    coverage.drills.push(...(await assertDrills(page, screen)))
    for (const tab of ['Breakdown', 'Who gets cited', 'Top actions', 'Checks']) {
      await openResultsTab(page, tab)
      const panel = screen.locator('.m3-results-panel')
      charts.push(...(await readCharts(panel)))
      await assertImages(panel)
      coverage.drills.push(...(await assertDrills(page, panel, 0)))
    }
    coverage.charts.push(...charts)
    expect(new Set(charts.map((chart) => chart.name))).toEqual(
      new Set(['own-domain-links', 'funnel', 'opportunities', 'buyer-stage'])
    )

    const store = await readPageIdentity(page, fixture)
    // SRS §7 hand totals (score 56 from 15/27, outcomes 4/2/1/2/1, funnel
    // 10/9/6/4/3, citation rate 4 of 9) come from fixtures/textbolt/serp-*.json.
    // This run replays the cycled serpapi bodies, so the screen is compared
    // to this check's results:get instead of those literals.
    const opportunities = charts.find((chart) => chart.name === 'opportunities')
    expect(store.bucketIds).toEqual(['winning', 'cited_only', 'named_not_linked', 'invisible'])
    expect(opportunities?.segments).toEqual([
      store.alreadyWinning,
      store.pageCited + store.otherOwnPage - store.alreadyWinning,
      store.brandMentioned,
      store.notCited
    ])
    expect(opportunities?.total).toBe(store.promptsWithAio)
    expect(
      store.pageCited + store.otherOwnPage + store.brandMentioned + store.notCited + store.noAio
    ).toBe(store.promptsChecked)
    const funnel = charts.filter((chart) => chart.name === 'funnel')
    const expectedFunnel = store.funnel.flatMap((step, index) => {
      const previous = store.funnel[index - 1]
      if (!previous || step.drop === null) return []
      return [{ segments: [step.count, step.drop], total: previous.count }]
    })
    expect(funnel.map((row) => ({ segments: row.segments, total: row.total }))).toEqual(
      expectedFunnel
    )
    expect(countOf(store.funnel, 'checked')).toBe(store.promptsChecked)
    expect(countOf(store.funnel, 'aio_shown')).toBe(store.promptsWithAio)
    expect(countOf(store.funnel, 'own_domain')).toBe(store.pageCited + store.otherOwnPage)
    expect(countOf(store.funnel, 'this_page')).toBe(store.pageCited)
    expect(countOf(store.funnel, 'cited_and_named')).toBe(store.citedAndNamed)
    expect(store.funnel.find((step) => step.id === 'aio_shown')?.drop).toBe(store.noAio)
    expect(drillCount(coverage.drills, 'bucket:winning')).toBe(store.alreadyWinning)
    expect(drillCount(coverage.drills, 'bucket:cited_only')).toBe(
      store.pageCited + store.otherOwnPage - store.alreadyWinning
    )
    expect(drillCount(coverage.drills, 'bucket:named_not_linked')).toBe(store.brandMentioned)
    expect(drillCount(coverage.drills, 'bucket:invisible')).toBe(store.notCited)
    expect(drillCount(coverage.drills, 'funnel:checked')).toBe(store.promptsChecked)
    expect(drillCount(coverage.drills, 'funnel:aio_shown')).toBe(store.promptsWithAio)
    expect(drillCount(coverage.drills, 'drop:aio_shown')).toBe(store.noAio)
    expect(drillCount(coverage.drills, 'funnel:own_domain')).toBe(
      store.pageCited + store.otherOwnPage
    )
    expect(drillCount(coverage.drills, 'funnel:this_page')).toBe(store.pageCited)
    expect(drillCount(coverage.drills, 'funnel:cited_and_named')).toBe(store.citedAndNamed)
    expect(drillCount(coverage.drills, 'kpi:page')).toBe(store.pageCited)
    expect(drillCount(coverage.drills, 'kpi:aio')).toBe(store.promptsWithAio)
    expect(store.visibilityScore).toBe(
      store.pointsPossible === 0 ? null : Math.round((store.points / store.pointsPossible) * 100)
    )
    const cited = charts
      .filter((chart) => chart.name === 'buyer-stage')
      .reduce((sum, row) => sum + (row.segments[0] ?? 0), 0)
    expect(cited).toBe(store.pageCited)
    expect(await headline(screen, 'score')).toBe(store.visibilityScore)
    expect(await headline(screen, 'page-cited')).toBe(store.pageCited)
    expect(await headline(screen, 'links')).toBe(store.citationsThisPage + store.citationsOtherOwn)
    expect(await headline(screen, 'aio')).toBe(store.promptsWithAio)
    expect(store.pageScore).toBe(store.visibilityScore)

    await openRunning(page, fixture.pageId)
    const running = page.locator('main .m3-screen')
    // The page already has a finished check, so this is a repeat check.
    await expect(running.getByRole('heading', { level: 1, name: 'Check now' })).toBeVisible()
    await expect(running.getByText('No check is running.')).toBeVisible()
    coverage.runningCharts = await running.locator('[data-nfr-chart]').count()
    expect(coverage.runningCharts).toBe(0)
    await assertImages(running)
    const runningDrills = await assertDrills(page, running, 0)
    coverage.runningDrills = runningDrills.length
    expect(coverage.runningDrills).toBe(0)

    await writeFile(await e2eArtifact('nfr14-page-results.json'), JSON.stringify(coverage, null, 2))
  } finally {
    await app.close()
  }
})

/**
 * Audit2 #1: one cited rule on every screen. The TextBolt topic is seeded as real checks
 * (three engines); Summary, the topic's Pages, Check history, Questions › Pages and
 * Citations › Pages each count "cited" and must give the same numbers.
 */
test('Summary, the topic, Check history, Questions and Citations agree on cited', async () => {
  test.setTimeout(180_000)
  const dir = await seedTopicScreens()
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 900 }
  })
  try {
    await openAllPages(page)

    // Summary: the headline "You’re cited" is the same number on Google AI Overview.
    await openHash(page, '#/overview')
    const headlineCited = page
      .getByRole('region', { name: 'Headline numbers' })
      .getByRole('region', { name: 'You’re cited' })
      .locator('.ui-kpi-value')
    await expect(headlineCited).toBeVisible()
    const allCited = firstNumber(await headlineCited.innerText())
    await openHash(page, '#/overview?engine=google_aio')
    await expect(headlineCited).toBeVisible()
    expect(firstNumber(await headlineCited.innerText())).toBe(allCited)

    // The topic's Pages: its cited searches are the latest topic check's Cited in history.
    await openHash(page, `#/topics/${TEXTBOLT_TOPIC_ID}?view=pages`)
    const topicCited = await footerCited(page)
    expect(topicCited).toBeGreaterThan(0)
    await openHash(page, '#/history')
    const latest = TEXTBOLT_TOPIC_CHECKS[TEXTBOLT_TOPIC_CHECKS.length - 1]?.runId
    const historyCited = page.locator(`[data-nfr-figure="history:cited:${latest}"]`)
    await expect(historyCited).toBeVisible()
    expect(firstNumber(await historyCited.innerText())).toBe(topicCited)

    // Questions › Pages and Citations › Pages read every search of the project the same way.
    await openHash(page, '#/questions?view=pages')
    const questionsCited = await footerCited(page)
    await openHash(page, '#/citations?view=pages')
    expect(await footerCited(page)).toBe(questionsCited)
    expect(questionsCited).toBeGreaterThanOrEqual(topicCited)
  } finally {
    await app.close().catch(() => undefined)
    await rm(dir, { recursive: true, force: true })
  }
})

/** TextBolt with three engines and the seeded topic; no queued check runs. */
async function seedTopicScreens(): Promise<string> {
  installRawMarkdown()
  const { seedEnginesProject } = await import('./engines-seed')
  const { SEED } = await import('./screens-seed')
  const { openAppStorage } = await import('../../src/main/storage/app-storage')
  const { closeProjectDatabase, openProjectDatabase } =
    await import('../../src/main/storage/project-files')
  const { projectDatabaseRelativePath } = await import('../../src/main/storage/slug')
  const { seedTextboltTopic } = await import('../../src/main/topics/fixture-seed')
  const dir = await mkdtemp(join(tmpdir(), 'citefox-nfr14-cited-'))
  await seedEnginesProject(dir)
  const storage = openAppStorage(dir)
  const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  try {
    seedTextboltTopic(db, {
      id: SEED.projectId,
      name: 'TextBolt',
      slug: 'textbolt',
      domain: 'textbolt.com',
      dbPath: projectDatabaseRelativePath('textbolt'),
      clientName: null,
      status: 'active'
    })
    storage.db
      .prepare(
        `INSERT OR REPLACE INTO queue_pause (id, state, paused_on) VALUES (1, 'paused_all', NULL)`
      )
      .run()
  } finally {
    closeProjectDatabase(db)
    storage.close()
  }
  return dir
}

/** The cited searches a pages view adds up in its footer: "Your pages: 3 + 2 cited". */
async function footerCited(page: Page): Promise<number> {
  const footer = page
    .locator('#main')
    .getByText(/Your pages: [\d,+ ]+ cited/)
    .first()
  await expect(footer).toBeVisible()
  const parts = /Your pages: ([\d,+ ]+) cited/.exec(await footer.innerText())?.[1] ?? '0'
  return parts
    .split('+')
    .map((part) => Number(part.replace(/[^\d]/g, '')))
    .reduce((sum, value) => sum + value, 0)
}

function firstNumber(text: string): number {
  const match = /\d[\d,]*/.exec(text)
  if (!match) throw new Error(`no number in "${text}"`)
  return Number(match[0].replace(/,/g, ''))
}

async function loadNfr14Module(
  devServer: ViteDevServer
): Promise<{ loadTextboltCheck: () => Promise<LoadedCheck> }> {
  const file = resolve('tests/e2e/nfr14-load.ts')
  const load = (): Promise<{ loadTextboltCheck: () => Promise<LoadedCheck> }> =>
    devServer.ssrLoadModule(file) as Promise<{ loadTextboltCheck: () => Promise<LoadedCheck> }>
  try {
    return await load()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
    const stale =
      code === 'ERR_OUTDATED_OPTIMIZED_DEP' ||
      code === 'ERR_FILE_NOT_FOUND_IN_OPTIMIZED_DEP_DIR' ||
      /not in the cache|not in cache|pre-bundle|outdated optimized/i.test(message)
    if (!stale) throw error
    return load()
  }
}

function requiredSeed(): LoadedCheck {
  if (!seeded) throw new Error('TextBolt check was not loaded')
  return seeded
}

async function openPage(page: Page, pageId: string, tab: 'results' | 'progress'): Promise<void> {
  await page.evaluate(
    ({ id, next }) => {
      window.location.hash = `#/pages/${encodeURIComponent(id)}/${next}`
    },
    { id: pageId, next: tab }
  )
}

/** Opens one of the page Results tabs (Prompts, Breakdown, Who gets cited, Top actions, Checks). */
async function openResultsTab(page: Page, name: string): Promise<void> {
  const tab = page
    .getByRole('tablist', { name: 'Results sections' })
    .getByRole('tab', { name: new RegExp(`^${name}`) })
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
}

async function openRunning(page: Page, pageId: string): Promise<void> {
  await page.evaluate((id) => {
    window.location.hash = `#/pages/${encodeURIComponent(id)}/running`
  }, pageId)
}

async function openSection(page: Page, path: string): Promise<void> {
  await page.evaluate((next) => {
    window.location.hash = `#${next}`
  }, path)
}

interface FunnelStepCount {
  id: string
  count: number
  drop: number | null
}

interface PageIdentity {
  promptsChecked: number
  promptsWithAio: number
  pageCited: number
  otherOwnPage: number
  brandMentioned: number
  notCited: number
  noAio: number
  citedAndNamed: number
  /** Own page cited AND brand named, counted from the prompt rows (REPORT-SPEC). */
  alreadyWinning: number
  points: number
  pointsPossible: number
  citationsThisPage: number
  citationsOtherOwn: number
  visibilityScore: number | null
  pageScore: number | null
  bucketIds: string[]
  funnel: FunnelStepCount[]
}

function countOf(steps: readonly FunnelStepCount[], id: string): number {
  return steps.find((step) => step.id === id)?.count ?? -1
}

function drillCount(
  drills: readonly { id: string; count: number; rows: number }[],
  id: string
): number {
  return drills.find((drill) => drill.id === id)?.rows ?? -1
}

async function headline(root: Locator, name: string): Promise<number | null> {
  const text = ((await root.locator(`[data-nfr-headline="${name}"]`).textContent()) ?? '').trim()
  if (text === '—') return null
  const value = Number(text)
  expect(Number.isInteger(value), name).toBe(true)
  return value
}

async function readPageIdentity(page: Page, fixture: LoadedCheck): Promise<PageIdentity> {
  return page.evaluate(async (ids) => {
    const citefox = (
      window as unknown as {
        citefox: {
          'results:get': (request: {
            projectId: string
            pageId: string
            marketId: string
            runId: null
          }) => Promise<{
            run: {
              promptsChecked: number
              promptsWithAio: number
              pageCited: number
              otherOwnPage: number
              brandMentioned: number
              notCited: number
              noAio: number
              citedAndNamed: number
              points: number
              pointsPossible: number
              citationsThisPage: number
              citationsOtherOwn: number
              visibilityScore: number | null
            } | null
            buckets: { id: string; count: number }[]
            funnel: { id: string; count: number; drop: { count: number } | null }[]
            prompts: { status: string; named: boolean | null }[]
          }>
          'scores:listPages': (request: { projectId: string }) => Promise<{
            pages: { pageId: string; score: number | null }[]
          }>
        }
      }
    ).citefox
    const results = await citefox['results:get']({
      projectId: ids.projectId,
      pageId: ids.pageId,
      marketId: ids.marketId,
      runId: null
    })
    const pages = await citefox['scores:listPages']({ projectId: ids.projectId })
    const run = results.run
    return {
      promptsChecked: run?.promptsChecked ?? -1,
      promptsWithAio: run?.promptsWithAio ?? -1,
      pageCited: run?.pageCited ?? -1,
      otherOwnPage: run?.otherOwnPage ?? -1,
      brandMentioned: run?.brandMentioned ?? -1,
      notCited: run?.notCited ?? -1,
      noAio: run?.noAio ?? -1,
      citedAndNamed: run?.citedAndNamed ?? -1,
      alreadyWinning: results.prompts.filter(
        (row) =>
          (row.status === 'page_cited' || row.status === 'other_own_page') && row.named === true
      ).length,
      points: run?.points ?? -1,
      pointsPossible: run?.pointsPossible ?? -1,
      citationsThisPage: run?.citationsThisPage ?? -1,
      citationsOtherOwn: run?.citationsOtherOwn ?? -1,
      visibilityScore: run?.visibilityScore ?? null,
      pageScore: pages.pages.find((item) => item.pageId === ids.pageId)?.score ?? null,
      bucketIds: results.buckets.map((bucket) => bucket.id),
      funnel: results.funnel.map((step) => ({
        id: step.id,
        count: step.count,
        drop: step.drop ? step.drop.count : null
      }))
    }
  }, fixture)
}

async function readStore(page: Page, fixture: LoadedCheck): Promise<StoreTotals> {
  return page.evaluate(async (ids) => {
    const citefox = (
      window as unknown as {
        citefox: {
          'results:get': (request: {
            projectId: string
            pageId: string
            marketId: string
            runId: null
          }) => Promise<{
            run: {
              citationsThisPage: number
              citationsOtherOwn: number
              pageCited: number
              promptsWithAio: number
            } | null
          }>
          'scores:listPages': (request: { projectId: string }) => Promise<{
            pages: { pageId: string; score: number | null }[]
          }>
          'scores:listProjects': () => Promise<{
            projects: { averageScore: number | null }[]
          }>
        }
      }
    ).citefox
    const results = await citefox['results:get']({
      projectId: ids.projectId,
      pageId: ids.pageId,
      marketId: ids.marketId,
      runId: null
    })
    const pages = await citefox['scores:listPages']({ projectId: ids.projectId })
    const projects = await citefox['scores:listProjects']()
    return {
      citationsThisPage: results.run?.citationsThisPage ?? -1,
      citationsOtherOwn: results.run?.citationsOtherOwn ?? -1,
      pageCited: results.run?.pageCited ?? -1,
      promptsWithAio: results.run?.promptsWithAio ?? -1,
      pageScore: pages.pages.find((item) => item.pageId === ids.pageId)?.score ?? null,
      projectScore: projects.projects[0]?.averageScore ?? null
    }
  }, fixture)
}

async function readCharts(root: Locator): Promise<ChartReading[]> {
  const charts = root.locator('[data-nfr-chart]')
  const count = await charts.count()
  const readings: ChartReading[] = []
  for (let index = 0; index < count; index += 1) {
    const chart = charts.nth(index)
    await show(chart, 'Table')
    const name = (await chart.getAttribute('data-nfr-chart')) ?? `chart-${index}`
    const rows = chart.locator('[data-nfr-chart-row]')
    const rowCount = await rows.count()
    if (rowCount > 0) {
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        readings.push(await readPart(name, rows.nth(rowIndex)))
      }
    } else {
      readings.push(await readPart(name, chart))
    }
    await show(chart, 'Chart')
  }
  return readings
}

async function readPart(name: string, root: Locator): Promise<ChartReading> {
  const segments = await numbers(root.locator('[data-nfr-segment]'))
  const totals = await numbers(root.locator('[data-nfr-total]'))
  expect(segments.length, name).toBeGreaterThan(0)
  expect(totals, name).toHaveLength(1)
  const total = totals[0] ?? 0
  expect(
    segments.reduce((sum, value) => sum + value, 0),
    `${name} segments`
  ).toBe(total)
  const scoreNode = root.locator('[data-nfr-score]')
  const score = (await scoreNode.count()) === 0 ? null : ((await numbers(scoreNode))[0] ?? null)
  return { name, total, segments, score }
}

async function numbers(locator: Locator): Promise<number[]> {
  const texts = await locator.evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ''))
  return texts.map((text) => {
    const match = text.replace(/,/g, '').match(/-?\d+/)
    if (!match) throw new Error(`No number in chart cell "${text}"`)
    return Number(match[0])
  })
}

async function show(chart: Locator, which: 'Table' | 'Chart'): Promise<void> {
  const button = chart.getByRole('button', { name: which, exact: true })
  if ((await button.count()) === 0) return
  if ((await button.getAttribute('aria-pressed')) === 'true') return
  await button.click()
}

async function assertImages(root: Locator): Promise<void> {
  const images = root.locator('[role="img"]')
  const count = await images.count()
  for (let index = 0; index < count; index += 1) {
    const image = images.nth(index)
    const decorative = await image.getAttribute('data-nfr-decorative')
    const marked = await image.evaluate((node) =>
      Boolean(node.closest('[data-nfr-chart], [data-nfr-series]'))
    )
    const name = (await image.getAttribute('aria-label')) ?? 'chart image'
    expect(decorative !== null || marked, name).toBe(true)
  }
}

async function assertSeries(root: Locator): Promise<string[]> {
  const series = root.locator('[data-nfr-series]')
  const count = await series.count()
  const names: string[] = []
  for (let index = 0; index < count; index += 1) {
    const row = series.nth(index)
    const label = (await row.locator('[role="img"]').getAttribute('aria-label')) ?? ''
    expect(label.length).toBeGreaterThan(0)
    names.push(label)
    const values = await row.locator('[data-nfr-series-value]').allTextContents()
    for (const value of values) {
      const text = value.trim()
      if (text === '' || text === '—') continue
      expect(label, text).toContain(text)
    }
  }
  return names
}

async function assertDrills(
  page: Page,
  root: Locator,
  minimum = 1
): Promise<{ id: string; count: number; rows: number }[]> {
  await expandLists(root)
  const missed = new Set<string>()
  const ids = new Set<string>()
  const harvest = async (): Promise<void> => {
    const found = await root.evaluate((node) => {
      const marked: string[] = []
      const plain: string[] = []
      for (const button of node.querySelectorAll('button')) {
        // A chart marker names an event ("You added 10 questions"), not a count to drill.
        if (button.classList.contains('ui-chart-marker')) continue
        const id = button.getAttribute('data-nfr-drill')
        if (id) {
          marked.push(id)
          continue
        }
        const text = (button.getAttribute('aria-label') ?? button.innerText)
          .replace(/\s+/g, ' ')
          .trim()
        plain.push(`${text} :: ${button.outerHTML.slice(0, 180)}`)
      }
      return { marked, plain }
    })
    for (const id of found.marked) ids.add(id)
    for (const text of found.plain) {
      const label = text.slice(0, text.indexOf(' :: '))
      if (looksLikeCountDrill(label)) missed.add(text)
    }
  }
  await harvest()
  const scrollers = root.locator('.vscroll, .ui-lg-scroll')
  const scrollerCount = await scrollers.count()
  for (let index = 0; index < scrollerCount; index += 1) {
    const scroller = scrollers.nth(index)
    await scroller.evaluate((node) => {
      node.scrollTop = 0
    })
    for (let step = 0; step < 40; step += 1) {
      await harvest()
      const moved = await scroller.evaluate((node) => {
        const before = node.scrollTop
        node.scrollTop += Math.max(48, node.clientHeight - 16)
        return node.scrollTop !== before
      })
      if (!moved) break
    }
  }
  expect([...missed], 'count controls missing data-nfr-drill').toEqual([])
  expect(ids.size).toBeGreaterThanOrEqual(minimum)
  const opened: { id: string; count: number; rows: number }[] = []
  for (const id of ids) {
    opened.push(await openDrill(page, root, id))
  }
  return opened
}

async function expandLists(root: Locator): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    const button = root.getByRole('button', { name: /^Show all / })
    if ((await button.count()) === 0) return
    await button.first().click()
  }
}

function looksLikeCountDrill(text: string): boolean {
  if (/^\d+$/.test(text)) return true
  if (/\d+\s+(questions?|prompts?|links?|checks?|overviews?)/i.test(text)) return true
  if (/page cited in \d+/i.test(text)) return true
  if (/\d+\s+of\s+\d+/i.test(text)) return true
  return false
}

async function openDrill(
  page: Page,
  root: Locator,
  id: string
): Promise<{ id: string; count: number; rows: number }> {
  const drill = await reveal(root, `[data-nfr-drill="${id}"]`)
  const figure = await reveal(root, `[data-nfr-figure="${id}"]`)
  const figureText = ((await figure.textContent()) ?? '').trim()
  const count = Number(figureText)
  expect(Number.isInteger(count), `${id} figure "${figureText}"`).toBe(true)
  const aria = await drill.getAttribute('aria-label')
  const shown = (aria ?? (await drill.innerText()) ?? '').replace(/\s+/g, ' ').trim()
  if (aria !== null || /\d/.test(shown)) expect(shown, id).toMatch(boundary(count))
  expect(((await figure.textContent()) ?? '').replace(/\s+/g, ' '), id).toMatch(boundary(count))
  await drill.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const rows = await drawerRows(dialog)
  expect(rows, id).toBe(count)
  const foot = dialog.locator('.ui-drawer-foot').getByRole('button', { name: 'Close' })
  if ((await foot.count()) > 0) await foot.click()
  else await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  return { id, count, rows }
}

async function drawerRows(dialog: Locator): Promise<number> {
  if ((await dialog.getByRole('grid').count()) > 0) return drawerRowCount(dialog)
  return dialog.locator('.ui-drawer-body li').count()
}

async function reveal(root: Locator, selector: string): Promise<Locator> {
  const target = root.locator(selector).first()
  if ((await root.locator(selector).count()) > 0) {
    await target.scrollIntoViewIfNeeded()
    return target
  }
  const scrollers = root.locator('.vscroll, .ui-lg-scroll')
  const count = await scrollers.count()
  for (let index = 0; index < count; index += 1) {
    const scroller = scrollers.nth(index)
    // Virtual lists render rows after the scroll event, so wait two frames
    // after each scroll before reading or using a row.
    await scroller.evaluate(async (node) => {
      node.scrollTop = 0
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
    })
    for (let step = 0; step < 40; step += 1) {
      if ((await root.locator(selector).count()) > 0) {
        await target.scrollIntoViewIfNeeded()
        return target
      }
      const moved = await scroller.evaluate(async (node) => {
        const before = node.scrollTop
        node.scrollTop += Math.max(48, node.clientHeight - 16)
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
        return node.scrollTop !== before
      })
      if (!moved) break
    }
  }
  throw new Error(`Missing ${selector}`)
}

function boundary(count: number): RegExp {
  return new RegExp(`(?<![\\d])${count}(?![\\d])`)
}
