import { expect, test, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { drawerShots } from './drawer-helpers'
import { launchCiteFox } from './launch'
import { openAllPages } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { expectMainAccessible, openHash, pickFilter, shot } from './screens-app'

/**
 * A check's moment as formatMoment shows it on this computer: "Oct 12, 3:12 PM"
 * in en-US, "12 Oct, 15:12" in en-GB. Matches the day either way, as regex source.
 */
function onDay(day: number): string {
  return `(?:Oct ${day}|${day} Oct)\\b`
}

/**
 * Check history (`#/history`) on the Progress seed (tests/e2e/progress-seed.ts):
 * the Oct 5 baseline in 🇺🇸 US and 🇬🇧 UK, the Oct 12 partial follow-up in the US,
 * and the Oct 19 full check in both, all through the real IPC handlers.
 */
async function openSeeded(): Promise<{ page: Page; close: () => Promise<void> }> {
  installRawMarkdown()
  const { seedProgressProject } = await import('./progress-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-check-history-'))
  await seedProgressProject(dir)
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 900 }
  })
  await openAllPages(page)
  return {
    page,
    close: async () => {
      await app.close()
      await rm(dir, { recursive: true, force: true })
    }
  }
}

test('Check history lists every check, filters on the URL, opens results and compares', async () => {
  test.setTimeout(180_000)
  const { page, close } = await openSeeded()
  try {
    await openHash(page, '#/history')
    await expect(page.getByRole('heading', { level: 1, name: 'Check history' })).toBeVisible()
    const grid = page.getByRole('treegrid', { name: 'Check history' })
    await expect(grid).toBeVisible()
    // Five check rows under their Day rows: two markets on Oct 5 and Oct 19, one partial on Oct 12.
    await expect(grid.locator('[role="row"][data-row]')).toHaveCount(5)
    await expect(page.getByText(/^5 checks across 1 page, \d+ searches used\./)).toBeVisible()
    await expect(grid.getByRole('gridcell', { name: 'Partial' })).toHaveCount(1)
    await expect(
      grid.getByRole('button', { name: /^Copy \/blog\/how-to-set-up-text-alerts/ }).first()
    ).toBeAttached()
    await expectMainAccessible(page)
    await shot(page, 'check-history')

    // Filters live in the URL; Back undoes them.
    const status = page.getByRole('group', { name: 'Show checks by status' })
    await status.getByRole('button', { name: /^Partial/ }).click()
    await expect(page).toHaveURL(/#\/history\?status=partial$/)
    await expect(grid.locator('[role="row"][data-row]')).toHaveCount(1)
    await page.goBack()
    await expect(page).toHaveURL(/#\/history$/)
    await expect(grid.locator('[role="row"][data-row]')).toHaveCount(5)
    await pickFilter(page, 'Market', /UK/)
    await expect(page).toHaveURL(/#\/history\?market=mkt-uk$/)
    await expect(grid.locator('[role="row"][data-row]')).toHaveCount(2)
    await page.goBack()
    await expect(grid.locator('[role="row"][data-row]')).toHaveCount(5)

    // Two checks of the page that read different versions of it: Compare, then Page content.
    await grid
      .getByRole('checkbox', { name: new RegExp(`^Select Alerts · .*US · EN · ${onDay(12)}`) })
      .check()
    await grid
      .getByRole('checkbox', { name: new RegExp(`^Select Alerts · .*US · EN · ${onDay(19)}`) })
      .check()
    await page
      .getByRole('region', { name: 'Bulk actions' })
      .getByRole('button', { name: 'Compare', exact: true })
      .click()
    await expect(page).toHaveURL(/drawer=compare-checks&cmp\.a=[^&]+&cmp\.b=[^&]+$/)
    const dialog = page.getByRole('dialog', {
      name: new RegExp(`^Compare ${onDay(12)}.* vs ${onDay(19)}`)
    })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('tab', { name: 'Page content' }).click()
    await expect(dialog.getByRole('heading', { name: 'FAQs' })).toBeVisible()
    await shot(page, 'check-history-compare')
    await drawerShots(page, 'compare')
    await dialog.getByRole('button', { name: 'Close', exact: true }).first().click()
    await expect(dialog).toHaveCount(0)
    await expect(page).toHaveURL(/#\/history\?sel=[^&]+$/)
    await page
      .getByRole('region', { name: 'Bulk actions' })
      .getByRole('button', { name: 'Clear' })
      .click()
    await expect(page).toHaveURL(/#\/history$/)

    // A check row (not its Day row) opens that check's results, pinned to its market and run.
    await grid
      .locator('[role="row"][data-row]')
      .filter({ hasText: new RegExp(onDay(12)) })
      .getByRole('gridcell', { name: new RegExp(`^${onDay(12)}`) })
      .click()
    await expect(page).toHaveURL(/#\/pages\/page-1\/results\?market=mkt-us&run=[^&]+$/)
    await expect(page.locator('#page-tabpanel')).toBeVisible()
    await page.goBack()
    await expect(page.getByRole('treegrid', { name: 'Check history' })).toBeVisible()
  } finally {
    await close()
  }
})
