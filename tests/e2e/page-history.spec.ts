import { expect, test, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { settle } from './a11y-helpers'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { openAllPages } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { openHash } from './screens-app'

/**
 * Page change history (phase 2b) on the Progress seed with three page reads: the
 * Pages banner "Is this a fix?" with its count, See what changed (inline and side by
 * side), Log as fix prefilled with the page, the day and a short summary, Not a fix
 * with Undo, the list drawer, the page's History › Page versions, the Pages filters
 * and the dashed "?" marker on the page's chart. Nothing spends a search or AI.
 */

const HIDE =
  '.gd-float,.gd-pop,.gd-coach,.gd-dim,.gd-mask,.gd-hint-layer,.gd-callout,[aria-label="CiteFox work console"],[data-testid="guide-explainer"]{display:none!important}'

async function shot(page: Page, name: string): Promise<void> {
  // A drawer slides in: wait until it sits inside the window.
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.ui-drawer')].every(
      (drawer) => drawer.getBoundingClientRect().right <= window.innerWidth + 0.5
    )
  )
  await page.screenshot({ path: await e2eArtifact(`page-history/${name}.png`) })
}

test('Is this a fix? banner, what changed, History versions, filters and the chart "?"', async () => {
  test.setTimeout(240_000)
  installRawMarkdown()
  const { seedPageHistory, HISTORY_SEED } = await import('./page-history-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-page-history-'))
  await seedPageHistory(dir)
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1440, height: 900 }
  })
  try {
    await openAllPages(page)
    await settle(page)
    await page.addStyleTag({ content: HIDE })

    // 1. The banner: the newest change, its words and a count.
    const banner = page.getByTestId('page-change-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('2 page changes nobody logged yet')
    await expect(banner).toContainText('changed on Oct 21')
    await expect(banner).toContainText('The page says "Updated Oct 21".')
    await expect(banner).toContainText('Is this a fix?')
    await shot(page, '1-banner')

    // 2. See what changed: the block diff in a drawer over Pages, with a URL.
    await banner.getByRole('button', { name: 'See what changed' }).click()
    const diff = page.getByTestId('page-change-drawer')
    await expect(diff).toBeVisible()
    await expect(page).toHaveURL(/#\/pages.*drawer=page-change.*pc\.id=/)
    await expect(diff.locator('del.pe-cut').first()).toBeVisible()
    await expect(diff.locator('ins.pe-add').first()).toBeVisible()
    await expect(diff).toContainText('Pricing for scheduled texts')
    await shot(page, '2-diff-inline')
    await diff.getByRole('button', { name: 'Side by side' }).click()
    await expect(page).toHaveURL(/pc\.view=side/)
    await shot(page, '2b-diff-side-by-side')
    await page.keyboard.press('Escape')
    await expect(diff).toHaveCount(0)

    // 3. Log as fix: the fix drawer prefilled with the page, the day and a summary.
    await banner.getByRole('button', { name: /^Log as fix, live Oct 21/ }).click()
    const form = page.getByRole('dialog', { name: 'Log a fix' })
    await expect(form).toBeVisible()
    await expect(page).toHaveURL(/fix\.live=2026-10-2[01]/)
    await expect(form.getByLabel('Goes live on')).toHaveValue(/2026-10-2[01]/)
    await expect(form.getByLabel('What changed')).toHaveValue(/sections? (is|are) new/)
    await shot(page, '3-log-as-fix-prefill')
    await page.keyboard.press('Escape')
    await expect(form).toHaveCount(0)

    // 4. Not a fix, then Undo brings it back.
    await banner.getByRole('button', { name: 'Not a fix' }).click()
    const undo = page.getByTestId('page-change-undo')
    await expect(undo).toBeVisible()
    await expect(banner).not.toContainText('2 page changes')
    await shot(page, '4-not-a-fix-undo')
    await undo.getByRole('button', { name: 'Undo' }).click()
    await expect(banner).toContainText('2 page changes nobody logged yet')

    // 5. Several waiting: one banner, and a list drawer.
    await banner.getByRole('button', { name: 'See all 2' }).click()
    const list = page.getByTestId('page-changes-drawer')
    await expect(list).toBeVisible()
    await expect(list.locator('.pc-list-item')).toHaveCount(2)
    await expect(page).toHaveURL(/drawer=page-changes/)
    await shot(page, '5-list-drawer')
    await page.keyboard.press('Escape')
    await expect(list).toHaveCount(0)

    // 6. History › Page versions.
    await openHash(page, `#/pages/${HISTORY_SEED.pageId}/history?view=versions`)
    await settle(page)
    const versions = page.getByRole('grid', { name: 'Page versions' })
    await expect(versions).toBeVisible()
    await expect(versions.getByRole('row')).toHaveCount(4)
    await expect(versions).toContainText('Changed, not logged')
    await shot(page, '6-history-versions')
    await versions.getByRole('button', { name: 'See what changed' }).first().click()
    await expect(page.getByTestId('page-change-drawer')).toBeVisible()
    await expect(page).toHaveURL(/history\?view=versions.*pc\.page=/)
    await shot(page, '6b-version-diff')
    await page.keyboard.press('Escape')

    // 7. Pages filters: Changed, not logged, and Not updated in 12 months.
    await openHash(page, '#/pages?preset=unlogged')
    await settle(page)
    const grid = page.getByRole('grid', { name: 'Pages', exact: true })
    await expect(grid).toContainText('Alerts')
    await expect(grid).not.toContainText('Pricing')
    await grid.scrollIntoViewIfNeeded()
    await shot(page, '7a-pages-changed-not-logged')
    await openHash(page, '#/pages?preset=stale')
    await settle(page)
    await expect(grid).toContainText('Pricing')
    await expect(grid).not.toContainText('Alerts')
    await grid.scrollIntoViewIfNeeded()
    await shot(page, '7b-pages-not-updated-12-months')

    // 8. The dashed "?" marker on the page's chart opens what changed.
    await openHash(page, `#/pages/${HISTORY_SEED.pageId}/progress`)
    await settle(page)
    const marker = page.locator('[data-marker-kind="page"]').first()
    await expect(marker).toBeVisible({ timeout: 20_000 })
    await marker.hover()
    await shot(page, '8-chart-marker')
    await marker.click()
    await expect(page.getByTestId('page-change-drawer')).toBeVisible()
    await shot(page, '8b-chart-marker-opens-diff')
    await expect(page.getByText(/Error invoking remote method/)).toHaveCount(0)
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
