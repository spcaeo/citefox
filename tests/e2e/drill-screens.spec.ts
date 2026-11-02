import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TEXTBOLT_TOPIC_ID } from '../../src/shared/fixtures/textbolt-topic'
import { drawerRowsAll } from './drill-helpers'
import { launchCiteFox } from './launch'
import { openAllPages } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { expectMainAccessible } from './screens-app'

/**
 * NFR-14 on the AI visibility screens through the real IPC handlers: on
 * Overview, Topics, a topic's results, Questions, Competitors, a page's
 * Results (with its Citations) and Check history, every drillable number
 * opens its list on the URL (`drawer=drill&drill=<id>`) and the list is as
 * long as the number clicked. Back closes a drill, and a copied link reopens
 * it. The seed is the two-market TextBolt project plus the TextBolt topic as
 * stored checks; nothing here searches.
 */
test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page
let dir: string

test.beforeAll(async () => {
  installRawMarkdown()
  const { seedTwoMarketProject, SEED } = await import('./screens-seed')
  const { openAppStorage } = await import('../../src/main/storage/app-storage')
  const { closeProjectDatabase, openProjectDatabase } =
    await import('../../src/main/storage/project-files')
  const { projectDatabaseRelativePath } = await import('../../src/main/storage/slug')
  const { seedTextboltTopic } = await import('../../src/main/topics/fixture-seed')
  dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-drill-screens-'))
  await seedTwoMarketProject(dir)
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
    // Hold the queue so the seeded topic is not checked (offline) in the first due pass.
    storage.db
      .prepare(
        `INSERT OR REPLACE INTO queue_pause (id, state, paused_on) VALUES (1, 'paused_all', NULL)`
      )
      .run()
  } finally {
    closeProjectDatabase(db)
    storage.close()
  }
  const launched = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 900 }
  })
  app = launched.app
  page = launched.page
  await openAllPages(page)
})

test.afterAll(async () => {
  await app?.close()
  await rm(dir, { recursive: true, force: true })
})

function main(): Locator {
  return page.locator('#main')
}

function drawer(): Locator {
  return page.locator('[role="dialog"][data-drawer="drill"]')
}

async function go(hash: string): Promise<void> {
  await page.evaluate((next) => {
    window.location.hash = next
  }, hash)
}

async function hash(): Promise<string> {
  return page.evaluate(() => decodeURIComponent(window.location.hash))
}

/** The drill ids drawn on screen (visible rows of long grids only). */
async function drillIds(root: Locator): Promise<string[]> {
  return root.evaluate((node) => [
    ...new Set(
      [...node.querySelectorAll('[data-nfr-drill]')].map(
        (item) => item.getAttribute('data-nfr-drill') ?? ''
      )
    )
  ])
}

/** Opens one drill: on the URL, as many rows as its number. Closes with Close. */
async function expectDrill(root: Locator, id: string): Promise<{ id: string; count: number }> {
  const control = root.locator(`[data-nfr-drill="${id}"]`).first()
  const figure = root.locator(`[data-nfr-figure="${id}"]`).first()
  await control.scrollIntoViewIfNeeded()
  const count = Number(((await figure.textContent()) ?? '').replace(/[,\s]/g, ''))
  expect(Number.isInteger(count), `${id} shows a number`).toBe(true)
  await control.click()
  await expect(drawer()).toBeVisible()
  await expect.poll(hash, { message: id }).toContain(`drawer=drill&drill=${id}`)
  expect(await drawerRowsAll(drawer()), id).toBe(count)
  const close = drawer().locator('.ui-drawer-foot').getByRole('button', { name: 'Close' })
  if ((await close.count()) > 0) await close.click()
  else await page.keyboard.press('Escape')
  await expect(drawer()).toHaveCount(0)
  await expect.poll(hash).not.toContain('drawer=drill')
  return { id, count }
}

/** Every drill on screen (up to `limit`), each checked. */
async function expectEveryDrill(
  root: Locator,
  minimum: number,
  limit = 40
): Promise<{ id: string; count: number }[]> {
  const ids = (await drillIds(root)).slice(0, limit)
  expect(ids.length, 'drillable numbers on screen').toBeGreaterThanOrEqual(minimum)
  const opened: { id: string; count: number }[] = []
  for (const id of ids) opened.push(await expectDrill(root, id))
  return opened
}

/** Back closes the open drill; a copied link to it reopens the same list. */
async function expectDrillOnUrl(root: Locator, id: string): Promise<void> {
  const control = root.locator(`[data-nfr-drill="${id}"]`).first()
  const count = Number(
    ((await root.locator(`[data-nfr-figure="${id}"]`).first().textContent()) ?? '').trim()
  )
  await control.click()
  await expect(drawer()).toBeVisible()
  await expect.poll(hash).toContain(`drawer=drill&drill=${id}`)
  const link = await page.evaluate(() => window.location.hash)
  await page.goBack()
  await expect(drawer()).toHaveCount(0)
  await expect.poll(hash).not.toContain('drawer=drill')
  // The copied link, pasted: the same list, as many rows.
  await go(link)
  await expect(drawer()).toBeVisible()
  expect(await drawerRowsAll(drawer())).toBe(count)
  await page.keyboard.press('Escape')
  await expect(drawer()).toHaveCount(0)
}

test('Overview: every number opens its list, the citation share too', async () => {
  test.setTimeout(240_000)
  await go('#/overview')
  await expect(main().getByRole('region', { name: 'Headline numbers' })).toBeVisible()
  const opened = await expectEveryDrill(main(), 5)
  const ids = opened.map((item) => item.id)
  // The tiles' counts drill; Citation share's percentage opens every link, yours first.
  expect(ids).toEqual(expect.arrayContaining(['kpi:tracked', 'kpi:aio']))
  expect(ids.some((id) => id.startsWith('site:'))).toBe(true)
  // The share's links: own first.
  const share = main().getByRole('region', { name: 'Citation share' })
  await share.getByRole('button', { name: /citation share: open the/ }).click()
  await expect(drawer()).toBeVisible()
  const first = drawer().locator('[data-drill-row="0"]')
  await expect(first).toContainText('textbolt.com')
  await page.keyboard.press('Escape')
  await expect(drawer()).toHaveCount(0)
  await expectDrillOnUrl(main(), 'kpi:aio')
  await expectMainAccessible(page)
})

test('Topics: KPIs, grid cells and Results by open lists as long as their numbers', async () => {
  test.setTimeout(240_000)
  // The List view keeps the per-topic counts; the KPI strip sits above every view.
  await go('#/topics?view=list')
  await expect(main().getByRole('grid', { name: 'Topics' })).toBeVisible()
  const opened = await expectEveryDrill(main(), 4)
  expect(opened.map((item) => item.id)).toEqual(
    expect.arrayContaining(['topics:kpi:target', 'topics:kpi:work'])
  )
  // A grid cell's drill is on the URL too: a copied link reopens it.
  const cell = opened.find((item) => /^topics:[^:]+:questions$/.test(item.id) && item.count > 0)
  expect(cell).toBeDefined()
  await expectDrillOnUrl(main(), cell?.id ?? '')
})

test('a topic’s results: every number opens its list', async () => {
  test.setTimeout(240_000)
  await go(`#/topics/${TEXTBOLT_TOPIC_ID}?view=tree`)
  const tree = main().getByRole('treegrid', { name: /searches by stage and result/ })
  await expect(tree).toBeVisible()
  // A stage count opens its searches in a drawer over the Tree: its filter is on the URL
  // and it lists as many rows. (The All row is the whole tree, so its link is the tree.)
  const stage = tree.getByRole('link', { name: /^Problem: open these (\d+) searches$/ })
  const count = Number(/(\d+) searches/.exec((await stage.getAttribute('aria-label')) ?? '')?.[1])
  expect(count).toBeGreaterThan(0)
  await stage.click()
  await expect.poll(hash).toContain('drawer=search-drill')
  await expect.poll(hash).toContain('stage=problem')
  const drawer = page.getByRole('dialog', { name: /^Problem searches/ })
  await expect(drawer.getByText(`Showing all ${count}`)).toBeVisible()
  await expect(tree).toBeAttached()
  // The summary bar's "not cited" part opens the same drawer cut to that result.
  await go(`#/topics/${TEXTBOLT_TOPIC_ID}?view=tree`)
  const bar = main().getByRole('region', { name: 'Topic summary' })
  await bar
    .getByRole('link', { name: /not cited/i })
    .first()
    .click()
  await expect.poll(hash).toContain('result=not_cited')
  await expect(
    page
      .getByRole('dialog', { name: 'Searches where you are not cited' })
      .getByText(/^Showing (all )?\d+/)
  ).toBeVisible()
})

test('Questions: the KPI strip and every group header count', async () => {
  test.setTimeout(240_000)
  await go('#/questions')
  await expect(main().getByRole('grid', { name: 'Questions' })).toBeVisible()
  const opened = await expectEveryDrill(main(), 4)
  expect(opened.some((item) => item.id.startsWith('questions:group:'))).toBe(true)
  await expectDrillOnUrl(main(), 'questions:tracked')
})

test('Competitors: the share, its total, the kinds and every row count', async () => {
  test.setTimeout(240_000)
  await go('#/competitors')
  await expect(main().getByRole('grid', { name: 'Cited sites' })).toBeVisible()
  const opened = await expectEveryDrill(main(), 3)
  expect(opened.map((item) => item.id)).toEqual(expect.arrayContaining(['cmp:links']))
  await expectDrillOnUrl(main(), 'cmp:links')
})

test('a page’s Results and its Citations: every number opens its list', async () => {
  test.setTimeout(240_000)
  await go('#/pages/page-1/results')
  const screen = page.locator('#page-tabpanel [data-nfr-screen="page-results"]')
  await expect(screen.getByRole('heading', { name: 'What this report covers' })).toBeVisible()
  await expectEveryDrill(page.locator('#page-tabpanel'), 4)
})

test('Check history: each count opens its check’s questions, and a copied link reopens', async () => {
  test.setTimeout(240_000)
  await go('#/history')
  const grid = main().getByRole('treegrid', { name: 'Check history' })
  await expect(grid).toBeVisible()
  const opened = await expectEveryDrill(grid, 1, 12)
  const id = opened.find((item) => item.count > 0)?.id ?? ''
  await expectDrillOnUrl(grid, id)
})
