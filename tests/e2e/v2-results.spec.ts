import { expect, test, type Page } from '@playwright/test'
import { gridReports } from './grid-structure'
import { expectMainAccessible, openHash, openTwoMarketApp, shot } from './screens-app'

/**
 * The v2 page Results layout (Topic-Overview.png): source strip, four equal
 * KPI tiles in one row, the summary line with one AI menu, then the Results
 * tabs. Screenshots of every tab at 1280 and the Prompts tab at 1024 land in
 * test-results for review.
 */
const TABS = ['Questions', 'Breakdown', 'Who gets cited', 'Top actions', 'Checks'] as const

async function settle(page: Page): Promise<void> {
  await expect(page.getByText(/^Loading/)).toHaveCount(0)
  await page.waitForTimeout(250)
}

async function openTab(page: Page, name: string): Promise<void> {
  const tablist = page.getByRole('tablist', { name: 'Results sections' })
  await tablist.getByRole('tab', { name: new RegExp(`^${name}`) }).click()
  await settle(page)
}

test('Results: KPI row, summary line, tabs and the prompt list grid', async () => {
  test.setTimeout(180_000)
  const { page, close } = await openTwoMarketApp('v2-results')
  try {
    await openHash(page, '#/pages/page-1/results')
    await settle(page)
    const screen = page.locator('#page-tabpanel [data-nfr-screen="page-results"]')

    // Four tiles, one row, equal widths and tops at 1280.
    const tiles = screen.locator('.m3-kpis .ui-kpi')
    await expect(tiles).toHaveCount(4)
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
    expect(new Set(boxes.map((box) => Math.round(box.height))).size).toBe(1)

    // One AI menu for the summary; one primary (Check now) on the screen.
    await expect(screen.getByRole('button', { name: 'AI actions for the summary' })).toHaveCount(1)
    await expect(page.locator('#main .btn-primary, #main .ui-btn-primary')).toHaveCount(1)

    // The prompt grid: rows, group headers, ⋯ menus, aligned columns, no sideways scroll.
    const grid = screen.getByRole('grid', { name: /^Buyer questions from the/ })
    await expect(grid.locator('.ui-lg-row').first()).toBeVisible()
    expect(await grid.locator('.ui-lg-group').count()).toBeGreaterThan(0)
    await expect(grid.getByRole('button', { name: /^Actions for question/ }).first()).toBeAttached()
    for (const width of [1280, 1024]) {
      await page.setViewportSize({ width, height: width === 1280 ? 900 : 700 })
      await page.waitForTimeout(250)
      const reports = await gridReports(page, '#page-tabpanel [data-nfr-screen="page-results"]')
      const prompts = reports.find((report) => report.name.startsWith('Buyer questions from the'))
      expect(prompts?.rows ?? 0).toBeGreaterThan(0)
      expect(prompts?.misaligned).toEqual([])
      expect(prompts?.crushed).toEqual([])
      const fit = await grid.evaluate((node) => ({
        scroll: node.scrollWidth,
        client: node.clientWidth
      }))
      expect(fit.scroll, `prompt grid fits at ${width}`).toBeLessThanOrEqual(fit.client)
      await shot(page, `v2-results-prompts-${width}`)
    }
    await page.setViewportSize({ width: 1280, height: 900 })

    // A row's ⋯ menu lists the prompt's actions.
    await grid.scrollIntoViewIfNeeded()
    await page.waitForTimeout(250)
    const actions = grid.getByRole('button', { name: /^Actions for question/ }).first()
    await actions.click()
    await expect(actions).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('menu')).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Open question detail/ })).toBeVisible()
    await shot(page, 'v2-results-row-menu')
    await page.keyboard.press('Escape')

    for (const tab of TABS.slice(1)) {
      await openTab(page, tab)
      await expectMainAccessible(page)
      await shot(page, `v2-results-${tab.toLowerCase().replace(/\s+/g, '-')}`, true)
    }
    await openTab(page, 'Questions')
    await expectMainAccessible(page)
    await shot(page, 'v2-results-full', true)
  } finally {
    await close()
  }
})
