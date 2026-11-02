import type { CiteFoxApi } from '@shared/ipc'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectMainAccessible, openHash } from './screens-app'
import { openStructureApp, openStructurePart, saveShot } from './structure-app'

/**
 * Site structure and Import pages drill-downs on real IPC (REPORT-SPEC
 * "Interaction model", NFR-14): every number opens the shared drawer, and the
 * drawer total equals the number clicked. No network: sitemaps come from the
 * recorded fixture folder.
 */

type Bridge = typeof globalThis & { citefox: CiteFoxApi }

/** Clicks a drill count and checks the drawer heading states the same total. */
async function expectDrawerTotal(page: Page, opener: Locator): Promise<number> {
  const id = await opener.getAttribute('data-nfr-drill')
  expect(id).not.toBeNull()
  const figureText = await opener.locator(`[data-nfr-figure="${id ?? ''}"]`).innerText()
  const figure = Number(figureText.replace(/,/g, ''))
  await opener.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { level: 2 })).toHaveText(
    new RegExp(`· ${figure} [a-z]+$`)
  )
  const rows = await dialog.locator('[data-drill-row]').count()
  expect(rows).toBe(Math.min(figure, 100))
  return figure
}

async function closeDrawer(page: Page, opener: Locator): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(opener).toBeFocused()
}

test('Site structure numbers open drawers whose totals match, and deep links open the cluster drawer', async () => {
  test.setTimeout(240_000)
  const { page, close } = await openStructureApp('drill-structure')
  try {
    // Site structure lives in All pages' Tree view; its sitemaps are one part of it.
    await openHash(page, '#/pages?view=tree&part=sitemaps')
    await page.getByRole('button', { name: 'Find sitemaps' }).click()
    const sitemaps = page.getByRole('region', { name: 'Sitemaps' })
    await expect(sitemaps.getByText('post-sitemap.xml')).toBeVisible()

    // A sitemap index opens the sitemaps it lists; a sitemap's URL count opens its pages.
    const index = sitemaps.locator('button[data-nfr-drill^="sitemap:"]').first()
    await expectDrawerTotal(page, index)
    await closeDrawer(page, index)
    await sitemaps.getByRole('button', { name: /URLs in post-sitemap\.xml/ }).click()
    await expect(page.getByRole('dialog').getByRole('heading', { level: 2 })).toContainText(
      'Pages in post-sitemap.xml'
    )
    await page.keyboard.press('Escape')

    // Clusters by rules, then each row number drills.
    await openStructurePart(page, 'Clusters')
    await page.getByRole('button', { name: /Group by rules/ }).click()
    await expect(page.getByText(/Applied\./)).toBeVisible()
    const table = page.getByRole('grid', { name: 'Clusters' })
    const card = table.locator('[data-row]').first()
    const pages = card.locator('button[data-nfr-drill^="cluster-pages:"]')
    const total = await expectDrawerTotal(page, pages)
    expect(total).toBeGreaterThan(0)
    await saveShot(page, 'drill-structure-cluster-pages')
    await closeDrawer(page, pages)
    // Keyboard: Enter on the focused count opens the drawer too.
    const tracked = card.locator('button[data-nfr-drill^="cluster-tracked:"]')
    await tracked.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toBeVisible()
    await closeDrawer(page, tracked)

    // The name opens the cluster's pages in its drawer (deep audit 8).
    const nameButton = table.getByRole('button', { name: /^Show pages of / }).first()
    const name = ((await nameButton.getAttribute('aria-label')) ?? '').replace('Show pages of ', '')
    await nameButton.click()
    const clusterDrawer = page.getByRole('dialog', { name })
    await expect(clusterDrawer.getByRole('grid', { name: `Pages in ${name}` })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // Folders (the old Silos and the found and tracked tiles): the footer counts every
    // page and every tracked one.
    await openStructurePart(page, 'Folders')
    const root = page.getByRole('button', { name: '2,014 pages in the whole site' })
    expect(await expectDrawerTotal(page, root)).toBe(2014)
    await closeDrawer(page, root)
    const siteTracked = page.getByRole('button', { name: '1 tracked page in the whole site' })
    expect(await expectDrawerTotal(page, siteTracked)).toBe(1)
    await closeDrawer(page, siteTracked)
    await expectMainAccessible(page)

    // #/structure/<cluster id> opens that cluster's drawer.
    const cluster = await page.evaluate(async () => {
      const view = await (globalThis as Bridge).citefox['structure:get']({ projectId: 'proj-1' })
      const first = view.clusters[0]
      return first ? { id: first.id, name: first.name } : null
    })
    expect(cluster).not.toBeNull()
    await openHash(page, '#/pages')
    await openHash(page, `#/structure/${encodeURIComponent(cluster?.id ?? '')}`)
    await expect(page.getByRole('dialog', { name: cluster?.name ?? '' })).toBeVisible()
    await expect
      .poll(() => page.evaluate(() => window.location.hash))
      .toContain(`drawer=cluster&cluster.id=${encodeURIComponent(cluster?.id ?? '')}`)
    await saveShot(page, 'drill-structure-focus')
  } finally {
    await close()
  }
})

test('Import pages folder and cluster counts open drawers whose totals match', async () => {
  test.setTimeout(240_000)
  const { page, close } = await openStructureApp('drill-import')
  try {
    await openHash(page, '#/import-pages')
    await page.getByRole('button', { name: 'Read sitemap' }).click()
    await expect(page.getByText(/2,014/).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /already tracked/ })).toHaveAttribute(
      'href',
      '#/pages?preset=tracked'
    )
    const folder = page.locator('button[data-nfr-drill^="import-folder-all:"]').first()
    await expectDrawerTotal(page, folder)
    await closeDrawer(page, folder)
    const tracked = page.locator('button[data-nfr-drill^="import-folder-tracked:"]').first()
    await expectDrawerTotal(page, tracked)
    await closeDrawer(page, tracked)

    // A preview row toggles on click, like Enter.
    await page
      .getByRole('checkbox', { name: /\/features\// })
      .first()
      .check()
    await page.getByRole('button', { name: /^Preview \d+ pages?$/ }).click()
    const preview = page.getByRole('region', { name: 'Preview' })
    const box = preview.getByRole('checkbox', { name: /^Track / }).first()
    await expect(box).toBeChecked()
    await box.locator('xpath=ancestor::*[@data-row][1]').locator('.imp-path').click()
    await expect(box).not.toBeChecked()
    await expectMainAccessible(page)
  } finally {
    await close()
  }
})
