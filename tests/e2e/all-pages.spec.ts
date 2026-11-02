import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'
import { expectMainAccessible, shot } from './screens-app'
import { openAllPages } from './nav-helpers'

/**
 * All pages (SRS 4.20) and the standard grid (4.21) against a seeded
 * TextBolt-sized project through the real IPC handlers. No live network: no
 * check is run from here; check and add-market stop at their cost estimate.
 */
test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page
let dir: string

async function launch(): Promise<void> {
  const launched = await launchCiteFox({ userDataDir: dir, viewport: { width: 1280, height: 900 } })
  app = launched.app
  page = launched.page
  await openAllPages(page)
  await expect(page.getByText(/^Showing 25 of 2,014 pages/)).toBeVisible()
}

test.beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-allpages-'))
  installRawMarkdown()
  const { seedScaleProject } = await import('./scale-seed')
  await seedScaleProject(dir)
  await launch()
})

test.afterAll(async () => {
  await app?.close()
  await rm(dir, { recursive: true, force: true })
})

function grid(): ReturnType<Page['getByRole']> {
  return page.getByRole('grid', { name: 'Pages' })
}

/** Over 50 rows Needs attention is one line (deep audit 7h): Review opens the list. */
async function openAttention(): Promise<void> {
  const review = page
    .getByRole('region', { name: 'Needs attention' })
    .getByRole('button', { name: /^Review/ })
  if ((await review.count()) > 0) await review.click()
}

test('tiles, default-market note, citation review, and no axe violations', async () => {
  const summary = page.getByRole('region', { name: 'Summary' })
  await expect(summary.getByText('2,014', { exact: true })).toBeVisible()
  await expect(summary.getByText('186 tracked · 1,828 found, not tracked')).toBeVisible()
  await expect(summary.getByText(/left this month/)).toBeVisible()
  // The Score column's note says Default market; no line over the grid repeats it.
  await expect(page.getByText(/for each page's default market/)).toHaveCount(0)
  const attention = page.getByRole('region', { name: 'Needs attention' })
  await expect(attention).toBeVisible()
  await openAttention()
  // 65 wrong-page cases start collapsed; the one untracked page shows.
  await expect(attention.getByRole('button', { name: 'Wrong page cited' })).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  await expect(attention.getByRole('button', { name: 'Cited but not tracked' })).toHaveAttribute(
    'aria-expanded',
    'true'
  )
  await expectMainAccessible(page)
  await shot(page, 'all-pages-1280', true)
})

/** Picks an item from the ⋯ menu of the first "Needs attention" row that contains `text`. */
async function attentionAction(row: Locator, item: string): Promise<void> {
  await row.getByRole('button', { name: /^Actions for / }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

test('Point it here and Merge, each with Undo, from the row menu (FR-20.4)', async () => {
  await openAttention()
  const section = page.getByRole('region', { name: 'Needs attention' })
  const group = section.getByRole('button', { name: 'Wrong page cited' })
  if ((await group.getAttribute('aria-expanded')) === 'false') await group.click()
  const first = section
    .getByRole('row')
    .filter({ hasText: 'how-to-set-up-text-alerts-for-business' })
    .first()
  await attentionAction(first, 'Point it here')
  await expect(
    first.getByText(/now belongs to Text alerts for business from its next check/)
  ).toBeVisible()
  await attentionAction(first, 'Undo')
  await expect(first.getByText(/now belongs to/)).toHaveCount(0)
  await attentionAction(first, 'Merge')
  await expect(first.getByText(/^Fix #1 added to/)).toBeVisible()
  await shot(page, 'all-pages-wrong-page-merged')
  await attentionAction(first, 'Undo')
  await expect(first.getByText(/^Fix #1 added to/)).toHaveCount(0)
})

test('Track and Ignore an own page cited but not tracked, from the row menu (FR-20.5)', async () => {
  await openAttention()
  const section = page.getByRole('region', { name: 'Needs attention' })
  // Wrong-page rows can cite the same URL: fold them so the row is the untracked one.
  const wrong = section.getByRole('button', { name: 'Wrong page cited' })
  if ((await wrong.getAttribute('aria-expanded')) === 'true') await wrong.click()
  const row = section.getByRole('row').filter({ hasText: '/pricing/?utm_source=aio' }).first()
  await attentionAction(row, 'Ignore')
  await expect(row.getByText('Ignored', { exact: true })).toBeVisible()
  await attentionAction(row, 'Undo ignore')
  await expect(row.getByText('Ignored', { exact: true })).toHaveCount(0)
  await attentionAction(row, 'Track')
  await expect(row.getByText('Tracked · its first check runs after setup')).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Summary' }).getByText('2,015', { exact: true })
  ).toBeVisible()
  await attentionAction(row, 'Undo')
  await expect(
    page.getByRole('region', { name: 'Summary' }).getByText('2,014', { exact: true })
  ).toBeVisible()
})

function header(name: RegExp): ReturnType<Page['getByRole']> {
  return grid().getByRole('columnheader', { name })
}

/** Opens the list's Views menu (scrolled to the top, so the menu fits below it) and picks `name`. */
async function viewOption(name: RegExp | string): Promise<void> {
  const views = page.getByRole('button', { name: /^(Views|Tracked compact)$/ })
  await views.evaluate((node) => node.scrollIntoView({ block: 'start' }))
  await views.click()
  await page.getByRole('menuitem', { name }).click()
}

/** Group by through Views → Group and columns. */
async function groupBy(option: 'Folder' | 'Status' | 'None'): Promise<void> {
  await viewOption(/Group and columns/)
  const panel = page.getByRole('region', { name: 'Group and columns' })
  await panel.getByRole('group', { name: 'Group by' }).getByRole('button', { name: option }).click()
  await panel.getByRole('button', { name: 'Done' }).click()
}

test('sort, column filters, columns and keyboard on the v2 list', async () => {
  await expect(header(/^Score/)).toHaveAttribute('aria-sort', 'descending')
  await header(/^Score/)
    .getByRole('button')
    .focus()
  await page.keyboard.press('Enter')
  await expect(header(/^Score/)).toHaveAttribute('aria-sort', 'none')
  await page.keyboard.press('Enter')
  await expect(header(/^Score/)).toHaveAttribute('aria-sort', 'ascending')

  await viewOption(/^Filters/)
  const panel = page.getByRole('region', { name: 'Page filters' })
  await expect(panel.getByRole('group', { name: 'Status' })).toBeVisible()
  await panel
    .getByRole('group', { name: 'Status' })
    .getByRole('checkbox', { name: /^Tracked/ })
    .focus()
  await page.keyboard.press('Space')
  await expect(page.getByText(/^Showing 25 of 40 pages · 2,014 in all, filtered/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove filter Status: Tracked' })).toBeVisible()
  await shot(page, 'all-pages-filtered-status')
  await panel.getByRole('button', { name: 'Done' }).click()

  await viewOption(/Group and columns/)
  const picker = page.getByRole('region', { name: 'Group and columns' })
  await picker.getByRole('checkbox', { name: /^Links to this page/ }).uncheck()
  await expect(header(/^Links to this page/)).toHaveCount(0)
  await picker.getByRole('button', { name: 'Done' }).click()

  await grid().focus()
  await page.keyboard.press('ArrowDown')
  await expect(grid().locator('[data-line="0"]')).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(grid().locator('[data-line="1"]')).toBeFocused()
  await shot(page, 'all-pages-sorted')
})

test('a saved view keeps the view, filters, sort, grouping and columns across restarts', async () => {
  await viewOption(/Save this view/)
  await page.getByRole('textbox', { name: 'View name' }).fill('Tracked compact')
  await page.getByRole('button', { name: 'Save view' }).click()
  await expect(page.getByText(/^Saved as “Tracked compact”/)).toBeVisible()
  await app.close()
  await launch()
  await expect(page.getByRole('button', { name: 'Remove filter Status: Tracked' })).toHaveCount(0)
  await viewOption('Open view “Tracked compact”')
  await expect(page.getByRole('button', { name: 'Remove filter Status: Tracked' })).toBeVisible()
  await expect(header(/^Links to this page/)).toHaveCount(0)
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: /^All/ }).click()
  await expect(page.getByText(/^Showing 25 of 2,014 pages/)).toBeVisible()
})

test('Export CSV writes UTF-8 with a BOM, the rows shown, formula-safe (FR-21.8)', async () => {
  const target = path.join(dir, 'export.csv')
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath
    })) as typeof dialog.showSaveDialog
  }, target)
  await page.getByRole('searchbox', { name: 'Search pages by title or URL' }).fill('pricing')
  const status = page.getByText(
    /^Showing \d+ of \d+ pages · 2,014 in all, filtered|^Showing \d+ pages · 2,014 in all, filtered/
  )
  await expect(status).toBeVisible()
  const matching = Number(
    /of ([\d,]+) pages|Showing ([\d,]+) pages/
      .exec((await status.textContent()) ?? '')
      ?.slice(1)
      .find(Boolean)
      ?.replace(/,/g, '') ?? '0'
  )
  await viewOption('Export CSV')
  await expect(page.getByText(/^Exported [\d,]+ rows × \d+ columns to export\.csv/)).toBeVisible()
  const bytes = await readFile(target)
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  const lines = bytes.toString('utf8').slice(1).trimEnd().split('\r\n')
  expect(lines[0]?.startsWith('Page,Score,Change,Page cited')).toBe(true)
  expect(lines).toHaveLength(matching + 1)
  await page.getByRole('searchbox', { name: 'Search pages by title or URL' }).fill('')
})

test('bulk actions show their search cost before running (FR-20.3)', async () => {
  const views = page.getByRole('group', { name: 'View' })
  // Tracked counts like the "186 tracked" tile: tracked, setting up and paused.
  await views.getByRole('button', { name: /^Tracked/ }).click()
  await expect(page.getByText(/^Showing 25 of 186 pages/)).toBeVisible()
  const boxes = grid().locator('[data-row] input[type="checkbox"]')
  await boxes.nth(0).check()
  await boxes.nth(1).check()
  const bar = page.getByRole('region', { name: 'Bulk actions' })
  await expect(bar.getByText('2 selected')).toBeVisible()
  // Add to group always shows (no groups yet: it opens Move pages on "New group").
  await expect(bar.getByRole('button', { name: 'Add to group' })).toBeVisible()
  // Every picked page is tracked, so Track is left out.
  await expect(bar.getByRole('button', { name: 'Track', exact: true })).toHaveCount(0)

  // Check now opens the Check now drawer with the picked pages (deep audit 7b).
  await bar.getByRole('button', { name: 'Check now' }).click()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
        return `${params.get('drawer')} ${params.get('check.scope')} ${
          (params.get('check.ids') ?? '').split(',').length
        }`
      })
    )
    .toBe('check-now pages 2')
  await page.goBack()
  await expect.poll(() => page.evaluate(() => window.location.hash)).not.toContain('drawer=')
  await expect(bar.getByText('2 selected')).toBeVisible()

  await bar.getByRole('button', { name: 'Pause' }).click()
  const pause = bar.getByRole('group', { name: 'Pause: cost and confirm' })
  await expect(
    pause.getByText(/^Pausing 2 pages saves about \d+–\d+ searches a month/)
  ).toBeVisible()
  await pause.getByRole('button', { name: 'Run pause' }).click()
  await expect(page.getByText('Paused 2 pages. History is kept.')).toBeVisible()
  // Paused pages stay in Tracked; the Paused filter below finds them (6 + 2).
  await expect(page.getByText(/^Showing 25 of 186 pages/)).toBeVisible()

  await views.getByRole('button', { name: /^All/ }).click()
  await viewOption(/^Filters/)
  const panel = page.getByRole('region', { name: 'Page filters' })
  await panel
    .getByRole('group', { name: 'Status' })
    .getByRole('checkbox', { name: /^Paused/ })
    .check()
  await panel.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText(/^Showing 8 pages · 2,014 in all, filtered/)).toBeVisible()
  await grid().getByRole('checkbox', { name: 'Select every row on this page' }).check()
  await bar.getByRole('button', { name: 'Track' }).click()
  const track = bar.getByRole('group', { name: 'Track: cost and confirm' })
  await expect(track.getByText(/^Tracking 8 pages: their checks use about/)).toBeVisible()
  await track.getByRole('button', { name: 'Run track' }).click()
  await expect(page.getByText(/^8 pages set to track/)).toBeVisible()
  await page.getByRole('button', { name: 'Clear all' }).click()
})

test('grouping, the row menu and pinning', async () => {
  await expect(
    grid().getByRole('button', { name: '/blog/', exact: true, expanded: true })
  ).toBeVisible()
  await expect(grid().getByText(/1,420 pages · avg score/)).toBeVisible()
  await shot(page, 'all-pages-grouped')
  await groupBy('Status')
  await expect(grid().getByRole('button', { name: 'Tracked', expanded: true })).toBeVisible()
  await groupBy('None')
  await expect(grid().getByRole('button', { name: '/blog/', exact: true })).toHaveCount(0)
  await groupBy('Folder')

  const nav = page.getByRole('navigation', { name: 'CiteFox' })
  await page
    .getByRole('searchbox', { name: 'Search pages by title or URL' })
    .fill('Text alerts for business')
  // The first-visit "What is All pages?" card floats over the row's ⋯: close it.
  const explainer = page.getByTestId('guide-explainer')
  if (await explainer.isVisible()) {
    await explainer.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(explainer).toBeHidden()
  }
  await grid().getByRole('button', { name: 'Actions for Text alerts for business' }).first().click()
  await page.getByRole('menuitem', { name: /^(Unpin|Pin) Text alerts for business/ }).click()
  await expect(nav).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search pages by title or URL' }).fill('')
  await expectMainAccessible(page)
})
