import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { drawerRowsAll } from './drill-helpers'
import { launchCiteFox } from './launch'
import { openAllPages } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { expectMainAccessible, shot } from './screens-app'

/**
 * The project Citations screen (#/citations) through the real IPC handlers:
 * every page the latest AI Overviews cite, whose it is, Pages / Domains, the
 * Whose filter and the open row on the URL, numbers that open what they count,
 * a row's questions linking to their prompt detail, and "Add as competitor"
 * with Undo on someone else's site. The seed is the two-market TextBolt
 * project plus the TextBolt topic as stored checks; nothing here searches.
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
  dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-citations-'))
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

function grid(name: 'Cited pages' | 'Cited domains'): Locator {
  return main().getByRole('grid', { name })
}

function rows(list: Locator): Locator {
  return list.locator('[role="row"][data-line-key^="row:"]')
}

test('lists every cited page with whose it is, and the Whose filter is on the URL', async () => {
  // Every cited page and whose it is: the List view (Pages is the main one).
  await go('#/citations?view=list')
  await expect(main().getByRole('heading', { level: 1, name: 'Citations' })).toBeVisible()
  const list = grid('Cited pages')
  await expect(list).toBeVisible()
  await expect(rows(list).first()).toBeVisible()
  await expect(list).toContainText('Yours')
  await expect(list).toContainText('Other')
  // A saved competitor reads by its name.
  await expect(list.getByText('simpletexting.com', { exact: true }).first()).toBeVisible()
  const filter = main().getByRole('group', { name: 'Whose' })
  await filter.getByRole('button', { name: /Others/ }).click()
  await expect.poll(hash).toContain('cit.whose=other')
  await expect(list).not.toContainText('Yours')
  await shot(page, 'citations-others')
  // Back steps the filter off again.
  await page.goBack()
  await expect.poll(hash).not.toContain('cit.whose')
  await expect(list).toContainText('Yours')
  await expectMainAccessible(page)
})

test('every number opens exactly what it counts', async () => {
  test.setTimeout(240_000)
  // Every cited page and whose it is: the List view (Pages is the main one).
  await go('#/citations?view=list')
  const list = grid('Cited pages')
  await expect(rows(list).first()).toBeVisible()
  const ids = (
    await list.evaluate((node) => [
      ...new Set(
        [...node.querySelectorAll('[data-nfr-drill]')].map(
          (item) => item.getAttribute('data-nfr-drill') ?? ''
        )
      )
    ])
  ).slice(0, 9)
  expect(ids.length).toBeGreaterThanOrEqual(3)
  for (const id of ids) {
    const count = Number(
      ((await list.locator(`[data-nfr-figure="${id}"]`).first().textContent()) ?? '').trim()
    )
    await list.locator(`[data-nfr-drill="${id}"]`).first().click()
    await expect(drawer()).toBeVisible()
    await expect.poll(hash, { message: id }).toContain(`drawer=drill&drill=${id}`)
    expect(await drawerRowsAll(drawer()), id).toBe(count)
    await page.keyboard.press('Escape')
    await expect(drawer()).toHaveCount(0)
  }
})

test('a row opens to the questions that cited it; a question opens its prompt detail', async () => {
  // Every cited page and whose it is: the List view (Pages is the main one).
  await go('#/citations?view=list')
  const list = grid('Cited pages')
  await expect(rows(list).first()).toBeVisible()
  await rows(list)
    .first()
    .getByRole('button', { name: /^Show the searches citing/ })
    .click()
  await expect.poll(hash).toContain('cit.open=s')
  const questions = main().getByRole('list', { name: 'Searches citing it' })
  await expect(questions).toBeVisible()
  const link = await hash()
  // A copied link reopens the same row.
  await go('#/overview')
  await expect(main().getByRole('region', { name: 'Headline numbers' })).toBeVisible()
  await go(link)
  await expect(questions).toBeVisible()
  await questions.getByRole('link').first().click()
  await expect.poll(hash).toMatch(/#\/pages\/[^/]+\/prompt\//)
})

test('Domains groups the rows; an other site is added as a competitor, with Undo', async () => {
  // Every cited page and whose it is: the List view (Pages is the main one).
  await go('#/citations?view=list')
  await expect(grid('Cited pages')).toBeVisible()
  await main().getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Domains' }).click()
  await expect.poll(hash).toContain('cit.by=domains')
  const list = grid('Cited domains')
  await expect(list).toBeVisible()
  // A known platform (G2, Reddit) is never a competitor; a neutral site can become one.
  const g2 = rows(list).filter({ hasText: 'g2.com' })
  await expect(g2).toContainText('Review site')
  await g2.getByRole('button', { name: 'Actions for g2.com' }).click()
  await expect(page.getByRole('menuitem', { name: 'Add as competitor' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  const site = rows(list).filter({ hasText: 'textedly.com' })
  await expect(site).toHaveCount(1)
  // A domain row is a site: its Type column names the kind of site, as every site list.
  await expect(site).toContainText('Neutral')
  await site.getByRole('button', { name: 'Actions for textedly.com' }).click()
  await page.getByRole('menuitem', { name: 'Add as competitor' }).click()
  // The list reloads: textedly.com is now a saved competitor.
  await expect(site).toContainText('Competitor')
  await expect(page.getByText('textedly.com is now a saved competitor.').first()).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(site).toContainText('Neutral')
})

test('fits without sideways scroll at 1134 px wide', async () => {
  await page.setViewportSize({ width: 1134, height: 770 })
  for (const view of ['#/citations', '#/citations?cit.by=domains']) {
    await go(view)
    const list = main().getByRole('grid').last()
    await expect(list).toBeVisible()
    const over = await list.evaluate((node) => {
      const scroller = node.closest<HTMLElement>('.ui-lg-scroll') ?? (node as HTMLElement)
      return scroller.scrollWidth - scroller.clientWidth
    })
    expect(over, view).toBeLessThanOrEqual(1)
  }
  await page.setViewportSize({ width: 1280, height: 900 })
})
