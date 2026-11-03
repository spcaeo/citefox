import AxeBuilder from '@axe-core/playwright'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TEXTBOLT_TOPIC_ID } from '../../src/shared/fixtures/textbolt-topic'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'
import { openAllPages } from './nav-helpers'

/**
 * Topic results in the built app with the real `topics` handlers, at the mock-up
 * size (1440 × 900): the two-market TextBolt project plus the TextBolt topic
 * fixture seeded as stored checks (`seedTextboltTopic`,
 * src/shared/fixtures/textbolt-topic.ts). The views build: Tree · Grid · List ·
 * Pages | Progress, and the drill page. Screenshots go to test-results/e2e/topic-*.png
 * for comparison with the TopicBig, TopicList and TopicBigDrill boards.
 */
const TOPIC_NAME = 'Text alerts for teams without a developer'

async function launch(): Promise<{ app: ElectronApplication; page: Page; dir: string }> {
  installRawMarkdown()
  const { seedTwoMarketProject, SEED } = await import('./screens-seed')
  const { openAppStorage } = await import('../../src/main/storage/app-storage')
  const { closeProjectDatabase, openProjectDatabase } =
    await import('../../src/main/storage/project-files')
  const { projectDatabaseRelativePath } = await import('../../src/main/storage/slug')
  const { seedTextboltTopic } = await import('../../src/main/topics/fixture-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-topic-'))
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
    // The seeded topic would come due in the window's first due pass and its
    // searches fail offline; hold the queue so the screen shows the seeded checks.
    storage.db
      .prepare(
        `INSERT OR REPLACE INTO queue_pause (id, state, paused_on) VALUES (1, 'paused_all', NULL)`
      )
      .run()
  } finally {
    closeProjectDatabase(db)
    storage.close()
  }
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1440, height: 900 }
  })
  await openAllPages(page)
  return { app, page, dir }
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250)
  await page.screenshot({ path: await e2eArtifact(`${name}.png`) })
}

async function expectAccessible(page: Page, include = '#main'): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include(include)
    .setLegacyMode()
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(
    results.violations.map(
      (item) =>
        `${item.id}: ${item.nodes.map((node) => `${node.target.join(' ')} (${node.any[0]?.message ?? node.failureSummary ?? ''})`).join(', ')}`
    )
  ).toEqual([])
}

async function hash(page: Page): Promise<string> {
  return page.evaluate(() => window.location.hash)
}

async function go(page: Page, to: string): Promise<void> {
  await page.evaluate((value) => {
    window.location.hash = value
  }, to)
}

test('topic results: views, the drill page and the fix brief match the views mock-ups', async () => {
  test.setTimeout(180_000)
  const { app, page, dir } = await launch()
  try {
    await go(page, `#/topics/${TEXTBOLT_TOPIC_ID}`)
    await expect(page.getByRole('heading', { level: 1, name: TOPIC_NAME })).toBeVisible()
    // A topic opens on its List view; its tabs read List · Tree · Grid · Pages.
    const views = page.getByRole('tablist', { name: 'Topic views' })
    await expect(views.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true')
    await expect(views.getByRole('tab')).toHaveText([
      /^List/,
      /^Tree/,
      /^Grid/,
      /^Pages/,
      /^Progress/
    ])
    await expect(page.getByRole('grid', { name: `${TOPIC_NAME}: every search` })).toBeVisible()
    await views.getByRole('tab', { name: 'Tree' }).click()
    const tree = page.getByRole('treegrid', { name: `${TOPIC_NAME}: searches by stage and result` })
    await expect(tree).toBeVisible()

    // The sidebar keeps one Topics item, current inside a topic, with no topic list under it.
    const nav = page.getByRole('navigation').first()
    await expect(nav.getByRole('link', { name: /^Topics\b/ })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await expect(nav.getByText(TOPIC_NAME, { exact: false })).toHaveCount(0)

    await shot(page, 'topic-tree')
    await expectAccessible(page)

    // The top bar's breadcrumb keeps the project and section whole at 1440; only the
    // topic name (the last crumb) may be cut.
    const crumbs = page
      .getByRole('banner')
      .getByRole('navigation', { name: 'Breadcrumb' })
      .locator('li > *:last-child')
    const cut = await crumbs.evaluateAll((nodes) =>
      nodes.map((node) => node.scrollWidth > node.clientWidth + 1)
    )
    expect(cut.length).toBeGreaterThanOrEqual(3)
    expect(cut.slice(0, -1)).toEqual(cut.slice(0, -1).map(() => false))
    // The top bar still fits: nothing runs past the window's right edge.
    expect(
      await page.locator('.topbar').evaluate((node) => node.scrollWidth - node.clientWidth)
    ).toBeLessThanOrEqual(1)

    // At 1280 wide (about 1060 px of content) the Tree still fits: Win odds in view and
    // no sideways scrolling.
    await page.setViewportSize({ width: 1280, height: 800 })
    const treeBox = await tree.boundingBox()
    const oddsBox = await tree.getByRole('columnheader', { name: /Win odds/ }).boundingBox()
    expect(treeBox && oddsBox && oddsBox.x + oddsBox.width <= treeBox.x + treeBox.width).toBe(true)
    expect(await tree.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(
      1
    )
    await shot(page, 'topic-tree-1280')

    // At 1024 the Tree's toolbar (search, filters, Expand all, Columns) keeps one row (audit2 #7).
    await page.setViewportSize({ width: 1024, height: 768 })
    await expect(page.getByRole('button', { name: /^(Expand|Collapse) all$/ })).toBeVisible()
    // The toolbar re-fits a frame after the resize (filters move into Filter ▾), so
    // wait for it. Items of different heights sit centred: one row means tops within 16px.
    const spread = (): Promise<number> =>
      page
        .locator('.ui-lg-bar')
        .first()
        .evaluate((bar) => {
          const tops = Array.from(bar.children)
            .filter((item) => item instanceof HTMLElement && item.offsetWidth > 0)
            .filter((item) => !item.classList.contains('ui-lg-spacer'))
            .map((item) => item.getBoundingClientRect().top)
          return Math.max(...tops) - Math.min(...tops)
        })
    await expect
      .poll(spread, { message: 'the Tree toolbar keeps one row at 1024' })
      .toBeLessThan(16)
    await shot(page, 'topic-tree-1024')
    await page.setViewportSize({ width: 1440, height: 900 })

    // A summary count opens its searches in a drawer over the view (board TopicBigDrill):
    // its filter on the URL, a chip with ✕, the What to do line, as many rows as the count,
    // and the Tree still behind it.
    const summary = page.getByRole('region', { name: 'Topic summary' })
    const notCited = summary.getByRole('link', { name: /^\d+ not cited$/ })
    const count = Number((await notCited.innerText()).replace(/[^\d]/g, ''))
    expect(count).toBeGreaterThan(0)
    await notCited.click()
    await expect.poll(() => hash(page)).toContain('drawer=search-drill&result=not_cited')
    const main = page.locator('#main')
    const drawer = page.getByRole('dialog', { name: 'Searches where you are not cited' })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByText(`Showing all ${count}`)).toBeVisible()
    await expect(drawer.getByText(/^What to do: Improve the target page/)).toBeVisible()
    await expect(drawer.getByRole('button', { name: 'Remove filter Not cited' })).toBeVisible()
    await expect(drawer.getByRole('link', { name: /^Back to all/ })).toHaveCount(0)
    await expect(tree).toBeAttached()
    await shot(page, 'topic-drill')
    await expectAccessible(page)

    // Close (or Back) returns to the view as it was; Forward reopens the drawer.
    await drawer.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(drawer).toHaveCount(0)
    await expect(tree).toBeVisible()
    await expect.poll(() => hash(page)).not.toContain('result=')
    expect(await hash(page)).toContain('view=tree')
    await page.goForward()
    const drillGrid = drawer.getByRole('grid', {
      name: `${TOPIC_NAME}: Searches where you are not cited`
    })
    await expect(drillGrid).toBeVisible()

    // A row opens its question: Google's answer and who is cited.
    await drillGrid.getByRole('row').nth(1).getByRole('gridcell').first().click()
    await expect.poll(() => hash(page)).toMatch(/\/prompt\//)
    await expect(page.getByRole('region', { name: 'This question in numbers' })).toBeVisible()
    await page.goBack()
    await expect(drillGrid).toBeVisible()

    // Get fix brief, the drawer's button, opens the page fix drawer on top: the topic and
    // its searches drawer stay under it, and closing it returns to them.
    await drawer.getByRole('button', { name: `Get fix brief for these ${count}` }).click()
    await expect.poll(() => hash(page)).toMatch(/&drawer=page-fix&pfx\.id=pf\w+/)
    expect(await hash(page)).toMatch(new RegExp(`^#/topics/${TEXTBOLT_TOPIC_ID}\\?`))
    const pageFix = page.getByRole('dialog', {
      name: /^(Improve a page|Pick which page|Write a new page)/
    })
    await expect(pageFix).toBeVisible()
    await shot(page, 'topic-drill-page-fix')
    await pageFix.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(pageFix).toHaveCount(0)
    await expect(drillGrid).toBeVisible()

    // Every view tab: selected, on the URL, accessible.
    await go(page, `#/topics/${TEXTBOLT_TOPIC_ID}`)
    await expect(views).toBeVisible()
    for (const [name, file] of [
      ['Grid', 'topic-grid'],
      ['List', 'topic-list'],
      ['Pages', 'topic-pages'],
      ['Progress', 'topic-progress']
    ] as const) {
      const tab = views.getByRole('tab', { name: new RegExp(`^${name}`) })
      await tab.click()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
      await expect.poll(() => hash(page)).toContain(`view=${name.toLowerCase()}`)
      if (name === 'List') {
        // Ticked rows get the bulk bar: Get fix brief, Change target, Move, Export.
        const list = main.getByRole('grid', { name: `${TOPIC_NAME}: every search` })
        await list
          .getByRole('checkbox', { name: /^Select (?!every)/ })
          .first()
          .check()
        // Get fix brief is the bar's one word button; the others are named icon buttons.
        const bulk = page.getByRole('region', { name: 'Bulk actions' })
        for (const name of ['Get fix brief', 'Change target', 'Move to topic…', 'Download CSV']) {
          await expect(bulk.getByRole('button', { name, exact: true })).toBeVisible()
        }
      }
      await shot(page, file)
      await expectAccessible(page)
    }

    // Progress: hovering a check shows the tooltip.
    const plot = page.locator('.tr-progress .ui-chart-plot')
    // The chart sits under the KPI rows: scroll it in, then hover near the last check.
    await plot.scrollIntoViewIfNeeded()
    const box = await plot.boundingBox()
    if (box) {
      await plot.hover({ position: { x: box.width - 60, y: box.height / 3 } })
      await plot.hover({ position: { x: box.width - 70, y: box.height / 3 } })
    }
    await expect(page.locator('.tr-progress .ui-chart-card')).toBeVisible()
    await shot(page, 'topic-progress-hover')
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
