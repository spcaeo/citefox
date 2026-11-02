import type { CiteFoxApi } from '@shared/ipc'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { DRAWER_SIZES } from './drawer-helpers'
import { launchCiteFox } from './launch'
import { openAllPages } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { expectMainAccessible, openHash, pickFilter } from './screens-app'

type Bridge = typeof globalThis & { citefox: CiteFoxApi }

/**
 * A check's moment as formatMoment shows it on this computer: "Oct 12, 3:12 PM"
 * in en-US, "12 Oct, 15:12" in en-GB. Matches the day either way, as regex source.
 */
function onDay(day: number): string {
  return `(?:Oct ${day}|${day} Oct)\\b`
}

/**
 * Check history in depth (tracking.md §2) on the Progress seed: Oct 5 baseline
 * in US and UK, the Oct 12 partial follow-up in the US, the page read again on
 * Oct 15, and the Oct 19 check in both markets, all on the real IPC handlers.
 * Every state is in the URL and survives a reload.
 */
async function openSeeded(): Promise<{
  app: ElectronApplication
  page: Page
  dir: string
  close: () => Promise<void>
}> {
  installRawMarkdown()
  const { seedProgressProject } = await import('./progress-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-deep-history-'))
  await seedProgressProject(dir)
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1440, height: 900 }
  })
  await openAllPages(page)
  return {
    app,
    page,
    dir,
    close: async () => {
      await app.close()
      await rm(dir, { recursive: true, force: true })
    }
  }
}

/**
 * Waits for the finite animations running now (a drawer's slide-in, a menu's
 * fade). A resize can cancel one, which rejects its `finished`, so this waits
 * for them to settle either way.
 */
async function animationsDone(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
    await Promise.allSettled(finite.map((animation) => animation.finished))
  })
}

/** `history-<what>-<width>.png` at both board sizes; `prepare` runs again after each resize. */
async function bothSizes(
  page: Page,
  what: string,
  prepare?: () => Promise<void>,
  restore = { width: 1440, height: 900 }
): Promise<void> {
  for (const size of DRAWER_SIZES) {
    await page.setViewportSize(size)
    await animationsDone(page)
    if (prepare) await prepare()
    await animationsDone(page)
    await page.screenshot({ path: await e2eArtifact(`history-${what}-${size.width}.png`) })
  }
  await page.setViewportSize(restore)
  await animationsDone(page)
}

async function hash(page: Page): Promise<string> {
  return page.evaluate(() => decodeURIComponent(window.location.hash))
}

/**
 * The grid never scrolls sideways: every column fits the window. Polled: after a
 * resize the window-width media query swaps the default columns a frame or two later.
 */
async function expectNoSidewaysScroll(grid: Locator): Promise<void> {
  await expect
    .poll(() => grid.evaluate((node) => node.scrollWidth - node.clientWidth))
    .toBeLessThanOrEqual(1)
}

function rowMenu(grid: Locator, row: RegExp): Locator {
  return grid.getByRole('button', { name: row })
}

const US_OCT_19 = new RegExp(`^Actions for Alerts · .*US · EN · ${onDay(19)}`)
const UK_OCT_5 = new RegExp(`^Actions for Alerts · .*UK · EN · ${onDay(5)}`)

test('Check history: columns, row menu, compare drawer by URL, CSV, delete, selection in the URL', async () => {
  test.setTimeout(300_000)
  const { app, page, dir, close } = await openSeeded()
  try {
    await openHash(page, '#/history')
    const grid = page.getByRole('treegrid', { name: 'Check history' })
    await expect(grid).toBeVisible()
    await expect(grid.locator('[role="row"][data-row]')).toHaveCount(5)
    // The first-visit "What is Check history?" card floats over the lower rows
    // (Day and total rows push them down), so it is closed once, as a person would.
    const explainer = page.getByTestId('guide-explainer')
    await expect(explainer).toBeVisible()
    await explainer.getByRole('button', { name: 'Got it' }).click()
    await expect(explainer).toHaveCount(0)

    // Columns at 1440: market, score, change and cited. Type, Questions, Named,
    // Credits and Cost wait in the Columns menu (audit #10). Beside the wide
    // Day › Check column, Overviews, Searches and then Engines give way so the grid fits.
    const wideColumns = ['Market', 'Score', 'Change', 'Cited']
    for (const name of wideColumns) {
      await expect(grid.getByRole('columnheader', { name, exact: true })).toBeVisible()
    }
    for (const name of ['Type', 'Named', 'Credits', 'Cost']) {
      await expect(grid.getByRole('columnheader', { name, exact: true })).toHaveCount(0)
    }
    await expectNoSidewaysScroll(grid)
    await expectMainAccessible(page)
    await bothSizes(page, 'grid', () => expectNoSidewaysScroll(grid))

    // A wider window has room for every default column: Engines, Overviews and Searches too.
    await page.setViewportSize({ width: 1920, height: 1000 })
    for (const name of [...wideColumns, 'Engines', 'Overviews', 'Searches']) {
      await expect(grid.getByRole('columnheader', { name, exact: true })).toBeVisible()
    }
    await expectNoSidewaysScroll(grid)

    // At 1134 the narrower default still fits and keeps Score and Cited;
    // Market and Change give way to the wide Day › Check column.
    await page.setViewportSize({ width: 1134, height: 770 })
    for (const name of ['Day › Check', 'Page or topic', 'Score', 'Cited', 'Status']) {
      await expect(grid.getByRole('columnheader', { name, exact: true })).toBeVisible()
    }
    await expectNoSidewaysScroll(grid)
    // The toolbar stays on one row: search, status, market, Export CSV and Columns.
    const columnsBox = await page.getByRole('button', { name: 'Columns' }).boundingBox()
    const searchBox = await page.getByRole('searchbox', { name: 'Search checks' }).boundingBox()
    expect(Math.abs((columnsBox?.y ?? 0) - (searchBox?.y ?? 100))).toBeLessThan(8)
    await page.setViewportSize({ width: 1440, height: 900 })

    // Columns choice: in the URL, kept on reload, and back to the default.
    await page.getByRole('button', { name: 'Columns' }).click()
    await page.getByRole('menuitem', { name: /^Questions/ }).click()
    await page.keyboard.press('Escape')
    await expect.poll(() => hash(page)).toMatch(/cols=/)
    // A ticked column shows even where the defaults fill the row: a default one gives way.
    await expect(grid.getByRole('columnheader', { name: 'Questions', exact: true })).toBeVisible()
    await expectNoSidewaysScroll(grid)
    await page.reload()
    await expect(grid).toBeVisible()
    await expect(grid.getByRole('columnheader', { name: 'Questions', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Columns' }).click()
    await page.getByRole('menuitem', { name: /^Questions/ }).click()
    await page.keyboard.press('Escape')
    await expect.poll(() => hash(page)).not.toMatch(/cols=/)

    // Overviews / Cited / Named drill to the questions behind them.
    await grid
      .getByRole('button', {
        name: new RegExp(`questions?: Questions whose AI Overview cited you, ${onDay(19)}`)
      })
      .first()
      .click()
    const drill = page.getByRole('dialog')
    await expect(drill).toBeVisible()
    await expect(drill.getByRole('heading', { level: 2 })).toContainText('cited you')
    await page.keyboard.press('Escape')
    await expect(drill).toHaveCount(0)

    // Row menu: every action for a finished check.
    const openMenu = async (): Promise<void> => {
      // A menu left open by the last step closes first, so the click opens it fresh.
      const open = page.getByRole('menuitem', { name: 'Open results' })
      if (await open.isVisible()) {
        await page.keyboard.press('Escape')
        await expect(open).toHaveCount(0)
      }
      const trigger = rowMenu(grid, US_OCT_19)
      await trigger.scrollIntoViewIfNeeded()
      await trigger.click()
      await expect(page.getByRole('menuitem', { name: 'Open results' })).toBeVisible()
    }
    await openMenu()
    for (const item of [
      'Open results',
      'Compare with previous',
      'Re-run',
      'Copy link',
      'Delete check'
    ]) {
      await expect(page.getByRole('menuitem', { name: item })).toBeVisible()
    }
    await expect(page.getByRole('menuitem', { name: 'Stop this check' })).toHaveCount(0)
    await bothSizes(page, 'rowmenu', openMenu)

    // Re-run asks first, with its search cost; cancelling starts nothing.
    await openMenu()
    await page.getByRole('menuitem', { name: 'Re-run' }).click()
    const rerun = page.getByTestId('history-rerun-confirm')
    await expect(rerun).toBeVisible()
    await expect(rerun).toContainText(/Uses about \d+(–\d+)? searches/)
    await rerun.getByRole('button', { name: 'Cancel' }).click()
    await expect(rerun).toHaveCount(0)

    // Compare with previous: the Oct 12 follow-up against Oct 19, results first.
    await openMenu()
    await page.getByRole('menuitem', { name: 'Compare with previous' }).click()
    const compare = page.getByRole('dialog', {
      name: new RegExp(`^Compare ${onDay(12)}.* vs ${onDay(19)}`)
    })
    await expect(compare).toBeVisible()
    await expect.poll(() => hash(page)).toMatch(/drawer=compare-checks/)
    const url = await hash(page)
    const a = /cmp\.a=([^&]+)/.exec(url)?.[1] ?? ''
    const b = /cmp\.b=([^&]+)/.exec(url)?.[1] ?? ''
    expect(a).not.toBe('')
    expect(b).not.toBe('')
    const crumbs = compare.getByRole('navigation', { name: 'Drawer breadcrumb' })
    await expect(crumbs).toContainText('Check history')
    await expect(crumbs).not.toContainText('Compare')
    await expect(compare.getByTestId('compare-totals')).toBeVisible()
    await expect(compare.getByRole('grid', { name: 'Questions in both checks' })).toBeVisible()
    await expect(compare.getByRole('tab', { name: 'Page content' })).toBeVisible()
    await bothSizes(page, 'compare-results')

    // The drawer opens by URL and survives a reload.
    await page.reload()
    await expect(compare).toBeVisible()
    await expect(compare.getByTestId('compare-totals')).toBeVisible()

    // Page content: the two reads of the page (Oct 5 and Oct 15), on its own tab in the URL.
    await compare.getByRole('tab', { name: 'Page content' }).click()
    await expect.poll(() => hash(page)).toMatch(/cmp\.tab=content/)
    await expect(compare.getByRole('heading', { name: 'FAQs' })).toBeVisible()
    await bothSizes(page, 'compare-content')
    await page.reload()
    await expect(compare.getByRole('heading', { name: 'FAQs' })).toBeVisible()
    await page.goBack()
    await expect.poll(() => hash(page)).not.toMatch(/cmp\.tab=content/)
    await expect(compare.getByTestId('compare-totals')).toBeVisible()
    await compare.getByRole('button', { name: 'Close', exact: true }).first().click()
    await expect(compare).toHaveCount(0)
    await expect.poll(() => hash(page)).toBe('#/history')

    // Old "Compare content" links open the drawer on its content tab.
    await openHash(page, `#/history?compare=${a},${b}`)
    await expect(compare).toBeVisible()
    await expect.poll(() => hash(page)).toMatch(/drawer=compare-checks/)
    expect(await hash(page)).toMatch(/cmp\.tab=content/)
    expect(await hash(page)).not.toMatch(/compare=/)
    await expect(compare.getByRole('heading', { name: 'FAQs' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(compare).toHaveCount(0)

    // Selection lives in the URL; two checks of the page compare from the bulk bar.
    await grid
      .getByRole('checkbox', { name: new RegExp(`^Select Alerts · .*US · EN · ${onDay(5)}`) })
      .check()
    await grid
      .getByRole('checkbox', { name: new RegExp(`^Select Alerts · .*UK · EN · ${onDay(5)}`) })
      .check()
    await expect.poll(() => hash(page)).toMatch(/sel=/)
    await page.reload()
    await expect(grid).toBeVisible()
    const bar = page.getByRole('region', { name: 'Bulk actions' })
    await expect(bar.getByText('2 selected')).toBeVisible()
    await bar.getByRole('button', { name: 'Compare', exact: true }).click()
    const sameDay = page.getByRole('dialog', {
      name: new RegExp(`^Compare ${onDay(5)}.* vs ${onDay(5)}`)
    })
    await expect(sameDay).toBeVisible()
    // Both checks read the same version of the page, so there is no content tab.
    await expect(sameDay.getByRole('tab', { name: 'Page content' })).toHaveCount(0)
    await expect(sameDay).toContainText('Page content:')
    await page.keyboard.press('Escape')
    await expect(sameDay).toHaveCount(0)
    await bar.getByRole('button', { name: /^Clear/ }).click()
    await expect.poll(() => hash(page)).not.toMatch(/sel=/)

    // Export CSV of the rows shown (the US filter keeps three).
    const target = path.join(dir, 'history.csv')
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath
      })) as typeof dialog.showSaveDialog
    }, target)
    await pickFilter(page, 'Market', /US/)
    await expect(grid.locator('[role="row"][data-row]')).toHaveCount(3)
    await page.getByRole('button', { name: 'Export CSV' }).click()
    await expect(page.getByText(/^Saved 3 checks to /)).toBeVisible()
    const bytes = await readFile(target)
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const lines = bytes.subarray(3).toString('utf8').trimEnd().split('\r\n')
    expect(lines[0]?.startsWith('Date,Time,Page or topic,URL,Type,Market')).toBe(true)
    expect(lines).toHaveLength(4)
    await page.goBack()
    await expect(grid.locator('[role="row"][data-row]')).toHaveCount(5)

    // Delete a check: the Confirm names it and what it costs; the row leaves history.
    const openUkMenu = async (): Promise<void> => {
      if (await page.getByTestId('history-delete-confirm').isVisible()) return
      await rowMenu(grid, UK_OCT_5).click()
      await page.getByRole('menuitem', { name: 'Delete check' }).click()
      await expect(page.getByTestId('history-delete-confirm')).toBeVisible()
    }
    await openUkMenu()
    const confirm = page.getByTestId('history-delete-confirm')
    await expect(confirm).toContainText(new RegExp(`Delete the ${onDay(5)}.* check\\?`))
    await expect(confirm).toContainText(
      'Its results leave history and trends. Searches already used are not refunded.'
    )
    await page.keyboard.press('Escape')
    await expect(confirm).toHaveCount(0)
    await bothSizes(page, 'delete-confirm', openUkMenu)
    await confirm.getByRole('button', { name: 'Delete check' }).click()
    await expect(confirm).toHaveCount(0)
    await expect(grid.locator('[role="row"][data-row]')).toHaveCount(4)
    await expect(page.getByText('Deleted 1 check.')).toBeVisible()
    await page.reload()
    await expect(grid.locator('[role="row"][data-row]')).toHaveCount(4)
    await expect(page.getByText(/^4 checks across 1 page/)).toBeVisible()
  } finally {
    await close()
  }
})

test('Check history in a project with no tracked pages points to Add a page and Import pages', async () => {
  test.setTimeout(180_000)
  const { page, close } = await openSeeded()
  try {
    const acme = await page.evaluate(() =>
      (globalThis as Bridge).citefox['projects:create']({
        name: 'Acme Clinics',
        domain: 'acmeclinics.com',
        includeSubdomains: false,
        brandNames: ['Acme Clinics'],
        competitors: [],
        clientName: 'Acme Clinics',
        country: 'US',
        language: 'en',
        location: null,
        device: 'desktop'
      })
    )
    await page.reload()
    await openHash(page, `#/p/${acme.id}/history`)
    const empty = page.getByTestId('history-empty')
    await expect(empty).toBeVisible()
    await expect(empty).toContainText('No checks yet. Add a page to track first')
    await expect(empty.getByRole('button', { name: 'Add a page' })).toBeVisible()
    await expect(empty.getByRole('link', { name: 'Import pages' })).toBeVisible()
    await expectMainAccessible(page)
    await bothSizes(page, 'empty')
    await empty.getByRole('button', { name: 'Add a page' }).click()
    await expect.poll(() => hash(page)).toMatch(/drawer=add-page/)
  } finally {
    await close()
  }
})
