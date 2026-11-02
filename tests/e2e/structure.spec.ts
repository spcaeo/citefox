import type { CiteFoxApi } from '@shared/ipc'
import { expect, test, type Page } from '@playwright/test'
import { expectMainAccessible, openHash } from './screens-app'
import { openStructureApp, openStructurePart, saveShot } from './structure-app'

type Bridge = typeof globalThis & { citefox: CiteFoxApi }

/**
 * Opens a row's `⋯` menu and picks an item. The row is centred first: the menu
 * closes when the page scrolls, so it must open fully in view.
 */
async function rowAction(page: Page, row: string, item: string | RegExp): Promise<void> {
  const button = page.getByRole('button', { name: `Actions for ${row}`, exact: true })
  await button.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await button.click()
  await page.getByRole('menuitem', { name: item }).click()
}

async function overview(page: Page): Promise<{ found: number; tracked: number; sitemaps: number }> {
  return page.evaluate(async () => {
    const result = await (globalThis as Bridge).citefox['sitemaps:get']({ projectId: 'proj-1' })
    return {
      found: result.foundPageCount,
      tracked: result.trackedPageCount,
      sitemaps: result.sitemaps.length
    }
  })
}

test('Site structure finds sitemaps, syncs a change, clusters pages and keeps groups on real IPC', async () => {
  test.setTimeout(240_000)
  const { page, serveSite, close } = await openStructureApp('structure')
  try {
    // Site structure lives in All pages' Tree view; its sitemaps are one part of it.
    await openHash(page, '#/pages?view=tree&part=sitemaps')
    await expect(page.getByRole('heading', { level: 1, name: 'Pages' })).toBeVisible()
    await saveShot(page, 'structure-empty')
    await page.getByRole('button', { name: 'Find sitemaps' }).click()
    const sitemaps = page.getByRole('region', { name: 'Sitemaps' })
    await expect(sitemaps.getByText('post-sitemap.xml')).toBeVisible()
    await expect(sitemaps.getByRole('status')).toHaveText('2,014 pages from 6 sitemaps')
    expect(await overview(page)).toEqual({ found: 2014, tracked: 1, sitemaps: 8 })
    // The found and tracked counts (the old KPI tiles) are the Folders footer, and they drill.
    await openStructurePart(page, 'Folders')
    await expect(page.getByRole('button', { name: '2,014 pages in the whole site' })).toBeVisible()
    await expect(
      page.getByRole('button', { name: '1 tracked page in the whole site' })
    ).toBeVisible()
    await openStructurePart(page, 'Sitemaps')
    await expect(sitemaps.getByText('tag-sitemap.xml')).toBeVisible()
    await saveShot(page, 'structure-sitemaps')

    // A change on the site: 6 new, 1 removed, 14 changed.
    serveSite('next')
    await page.getByRole('button', { name: 'Sync now' }).click()
    // A finished sync opens the Last sync part.
    const report = page.getByRole('region', { name: /^Sync report/ })
    await expect(report.getByText('/blog/grafana-sms-alerts/')).toBeVisible()
    await expect(report).toContainText('6')
    await expect(report).toContainText('14')
    await rowAction(page, '/blog/grafana-sms-alerts/', /^Track ·/)
    await expect(report.getByText(/Tracked ·/).first()).toBeVisible()
    await saveShot(page, 'structure-sync-report')

    // Clusters by rules, without Claude.
    await openStructurePart(page, 'Clusters')
    await page.getByRole('button', { name: /Group by rules/ }).click()
    await expect(page.getByText(/Applied\./)).toBeVisible()
    await saveShot(page, 'structure-clusters')
    const clusters = page.getByRole('grid', { name: 'Clusters' })
    const firstName = (
      (await clusters
        .getByRole('button', { name: /^Show pages of / })
        .first()
        .getAttribute('aria-label')) ?? ''
    ).replace('Show pages of ', '')
    await rowAction(page, firstName, 'Rename')
    await page.getByLabel(`New name for ${firstName}`).fill('Carrier gateways (mine)')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    const renamed = page.getByRole('button', {
      name: 'Show pages of Carrier gateways (mine)',
      exact: true
    })
    await expect(renamed).toBeVisible()
    // Re-clustering keeps the manual rename (FR-19.4) and saves the old set for undo.
    await page.getByRole('button', { name: /Group by rules/ }).click()
    await expect(page.getByText(/manual edits are kept/)).toBeVisible()
    await expect(renamed).toBeVisible()
    await page.getByRole('button', { name: 'Re-cluster actions' }).click()
    await page.getByRole('menuitem', { name: 'Undo last re-cluster' }).click()
    await expect(renamed).toBeVisible()
    await page
      .getByRole('button', { name: /Show pages/ })
      .first()
      .click()
    // The cluster's pages open in its drawer (deep audit 8).
    await expect(page.getByRole('dialog').getByRole('grid', { name: /^Pages in / })).toBeVisible()
    await saveShot(page, 'structure-cluster-pages')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expectMainAccessible(page)

    // Folders (the old Silos) and groups.
    await openStructurePart(page, 'Folders')
    await expect(page.getByText('/blog/', { exact: true }).first()).toBeVisible()
    await saveShot(page, 'structure-silos')
    await openStructurePart(page, 'Groups')
    await page.getByRole('button', { name: 'New group' }).click()
    await page.getByLabel('Group name').fill('Money pages')
    await page.getByRole('button', { name: 'Create group' }).click()
    await expect(page.getByRole('button', { name: 'Show pages of Money pages' })).toBeVisible()
    await saveShot(page, 'structure-groups')
    await expectMainAccessible(page)
  } finally {
    await close()
  }
})

test('Import pages reads the sitemap, picks a folder, previews and estimates it, and tracks it staggered', async () => {
  test.setTimeout(240_000)
  const { page, close } = await openStructureApp('import')
  try {
    await openHash(page, '#/import-pages')
    await expect(page.getByRole('heading', { level: 1, name: 'Import pages' })).toBeVisible()
    await page.getByRole('button', { name: 'Read sitemap' }).click()
    await expect(page.getByText(/2,014/).first()).toBeVisible()
    await saveShot(page, 'import-source')
    await page
      .getByRole('checkbox', { name: /\/features\// })
      .first()
      .check()
    await expect(page.getByText(/96 pages|96 page/).first()).toBeVisible()
    await saveShot(page, 'import-choose')
    await page.getByRole('button', { name: /^Preview \d+ pages$/ }).click()
    const preview = page.getByRole('region', { name: 'Preview' })
    await preview
      .getByRole('searchbox', { name: 'Search the preview by title or path' })
      .fill('bulk-sms')
    await expect(preview.getByText('/features/bulk-sms/')).toBeVisible()
    await saveShot(page, 'import-preview')
    await page.getByRole('button', { name: 'Choose how to track' }).click()
    const estimate = page.getByRole('region', { name: 'Cost estimate' })
    await expect(estimate).toContainText('96 pages × 5 questions × 1 market')
    await expect(estimate).toContainText('480–960 searches per check')
    await estimate.scrollIntoViewIfNeeded()
    await saveShot(page, 'import-estimate')
    await page.getByRole('button', { name: /Track \d+ pages/ }).click()
    await expect(page.getByRole('status').filter({ hasText: /Tracking \d+ pages/ })).toBeVisible()
    await saveShot(page, 'import-tracked', true)
    const tracked = await overview(page)
    expect(tracked.tracked).toBeGreaterThanOrEqual(97)
    await expectMainAccessible(page)
  } finally {
    await close()
  }
})
