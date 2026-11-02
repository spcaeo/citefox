import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { openAllPages } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { expectMainAccessible, openHash } from './screens-app'
import { openStructureApp } from './structure-app'

/**
 * v2 "Spruce & Fox" look of All pages and the Import pages wizard at 1280×900
 * (Mockups/v2/preview). Screenshots land in test-results/e2e/v2-*.png.
 */
test('All pages: KPI tiles, the pages list grid and its row menu (v2)', async () => {
  test.setTimeout(180_000)
  installRawMarkdown()
  const { seedScaleProject } = await import('./scale-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-v2-allpages-'))
  await seedScaleProject(dir)
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 900 }
  })
  try {
    await openAllPages(page)
    await expect(page.getByText(/^Showing 25 of 2,014 pages/)).toBeVisible()
    const tiles = page.locator('.ap-kpis .ui-kpi')
    await expect(tiles).toHaveCount(3)
    // Equal tiles on one row.
    const boxes = await tiles.evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect()
        return { top: Math.round(box.top), width: Math.round(box.width), height: box.height }
      })
    )
    expect(new Set(boxes.map((box) => box.top)).size).toBe(1)
    expect(
      Math.max(...boxes.map((box) => box.width)) - Math.min(...boxes.map((b) => b.width))
    ).toBeLessThanOrEqual(1)
    await page.screenshot({ path: await e2eArtifact('v2-all-pages-1280.png') })
    await page.screenshot({ path: await e2eArtifact('v2-all-pages-full.png'), fullPage: true })

    const grid = page.getByRole('grid', { name: 'Pages' })
    await grid.scrollIntoViewIfNeeded()
    await page.screenshot({ path: await e2eArtifact('v2-all-pages-grid.png') })
    await grid
      .getByRole('button', { name: /^Actions for / })
      .first()
      .click()
    await expect(page.getByRole('menu')).toBeVisible()
    await page.screenshot({ path: await e2eArtifact('v2-all-pages-row-menu.png') })
    await page.keyboard.press('Escape')

    await grid.locator('[data-row] input[type="checkbox"]').first().check()
    await expect(page.getByRole('region', { name: 'Bulk actions' })).toBeVisible()
    await page.screenshot({ path: await e2eArtifact('v2-all-pages-bulk.png') })
    await page
      .getByRole('region', { name: 'Bulk actions' })
      .getByRole('button', { name: 'Clear' })
      .click()

    const views = page.getByRole('button', { name: 'Views' })
    await views.evaluate((node) => node.scrollIntoView({ block: 'start' }))
    await views.click()
    await page.getByRole('menuitem', { name: /^Filters/ }).click()
    await expect(page.getByRole('region', { name: 'Page filters' })).toBeVisible()
    await page.screenshot({ path: await e2eArtifact('v2-all-pages-filters.png') })
    await expectMainAccessible(page)

    await page.setViewportSize({ width: 1024, height: 700 })
    await page.screenshot({ path: await e2eArtifact('v2-all-pages-1024.png') })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('Import pages: stepper, sticky wizard footer and the preview list grid (v2)', async () => {
  test.setTimeout(240_000)
  const { page, close } = await openStructureApp('v2-import')
  try {
    await openHash(page, '#/import-pages')
    await expect(page.getByRole('list', { name: 'Import steps' })).toBeVisible()
    await page.getByRole('button', { name: 'Read sitemap' }).click()
    await expect(page.getByText(/2,014/).first()).toBeVisible()
    await page.screenshot({ path: await e2eArtifact('v2-import-pages-step1.png') })
    await page
      .getByRole('checkbox', { name: /\/features\// })
      .first()
      .check()
    const footer = page.locator('.ui-wizard-foot')
    await expect(footer).toContainText(/searches per check/)
    // The footer stays on screen at the bottom while the step scrolls.
    const bottom = await footer.evaluate((node) => node.getBoundingClientRect().bottom)
    expect(Math.abs(bottom - 900)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: await e2eArtifact('v2-import-pages-step1-chosen.png') })

    await page.getByRole('button', { name: /^Preview \d+ pages$/ }).click()
    const grid = page.getByRole('grid', { name: 'Pages that match your choices' })
    await expect(grid).toBeVisible()
    await page.screenshot({ path: await e2eArtifact('v2-import-pages-step2.png') })

    await page.getByRole('button', { name: 'Choose how to track' }).click()
    await expect(page.getByRole('region', { name: 'Cost estimate' })).toBeVisible()
    await page.screenshot({ path: await e2eArtifact('v2-import-pages-step3.png') })
    await expectMainAccessible(page)
  } finally {
    await close()
  }
})
