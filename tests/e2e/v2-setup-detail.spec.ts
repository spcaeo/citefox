import { expect, test, type Page } from '@playwright/test'
import { expectMainAccessible, openHash, openTwoMarketApp, shot } from './screens-app'

/**
 * The v2 look of Add page, Page read and Prompt detail in the built app (real
 * CSS bundle) at 1280 × 900: the wizard stepper and sticky footer, list grids,
 * the KPI row and tabs. Screenshots land in test-results for review.
 */

async function top(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelector('#main')?.scrollTo(0, 0))
  await page.waitForTimeout(200)
}

/**
 * The sticky wizard footer sits at the bottom of the main column's visible
 * content area, edge to edge (main's own scrollbar is not part of that area).
 */
async function expectFooterAtBottom(page: Page): Promise<void> {
  const fit = await page.evaluate(() => {
    const foot = document.querySelector('.ui-wizard-foot')?.getBoundingClientRect()
    const main = document.querySelector<HTMLElement>('#main')
    if (!foot || !main) return null
    const box = main.getBoundingClientRect()
    const left = box.left + main.clientLeft
    const top = box.top + main.clientTop
    return {
      bottom: Math.abs(foot.bottom - (top + main.clientHeight)),
      left: Math.abs(foot.left - left),
      width: Math.abs(foot.width - main.clientWidth)
    }
  })
  expect(fit).not.toBeNull()
  expect(fit?.bottom).toBeLessThanOrEqual(2)
  expect(fit?.left).toBeLessThanOrEqual(2)
  expect(fit?.width).toBeLessThanOrEqual(2)
}

test('Add page, Page read and Prompt detail in the v2 look', async () => {
  test.setTimeout(180_000)
  const { page, close } = await openTwoMarketApp('v2-setup')
  try {
    await test.step('Add page: panels, cost rail, sticky footer', async () => {
      await openHash(page, '#/add-page')
      await expect(
        page.getByRole('heading', { level: 1, name: 'Add a page to track' })
      ).toBeVisible()
      // Setup is automatic now (owner feedback 5): no stepper on the form.
      await expect(page.getByRole('list', { name: 'Setup steps' })).toHaveCount(0)
      await expect(page.getByLabel('Page URL')).toBeVisible()
      await expect(page.getByText('1 market', { exact: true })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'What each check costs' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Add page' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Back' })).toBeVisible()
      await top(page)
      await shot(page, 'v2-add-page-1280')
      await expectFooterAtBottom(page)
      await expectMainAccessible(page)

      await page.getByRole('button', { name: 'Add market' }).click()
      await expect(page.getByText('2 markets', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Add page' }).click()
      await expect(page.getByRole('alert')).toHaveText(
        'Enter the page’s public http or https address.'
      )
    })

    await test.step('Page read: 8 + 4, outline and FAQ grids, one AI menu', async () => {
      await openHash(page, '#/pages/page-1/read')
      await expect(
        page.getByRole('heading', { level: 1, name: 'Check what CiteFox read' })
      ).toBeVisible()
      await expect(page.getByRole('heading', { name: 'What Google sees first' })).toBeVisible()
      const outline = page.getByRole('region', { name: 'Outline' })
      // The seeded read has no headings: the grid shows its empty state.
      await expect(outline.getByText('No H2 or H3 headings found')).toBeVisible()
      await expect(page.getByRole('region', { name: 'FAQs' })).toBeVisible()
      await expect(page.getByRole('region', { name: 'Read status' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'AI actions for this page' })).toBeVisible()
      await expect(
        page.getByRole('button', { name: 'Continue: build buyer profile' })
      ).toBeVisible()
      await top(page)
      await shot(page, 'v2-page-read-1280')
      await expectFooterAtBottom(page)
      await expectMainAccessible(page)
      await shot(page, 'v2-page-read-1280-full', true)
    })

    await test.step('Prompt detail: KPI row, tabs, list grids', async () => {
      await openHash(page, '#/pages/page-1/prompt/prompt-1')
      const screen = page.getByTestId('prompt-detail')
      await expect(screen.getByRole('heading', { level: 1 })).toBeVisible()
      const kpis = screen.getByRole('region', { name: 'This question in numbers' })
      await expect(kpis.locator('.ui-kpi')).toHaveCount(4)
      const tops = await kpis
        .locator('.ui-kpi')
        .evaluateAll((tiles) => tiles.map((tile) => Math.round(tile.getBoundingClientRect().top)))
      expect(new Set(tops).size).toBe(1)
      const tabs = screen.getByRole('tablist', { name: 'Question sections' })
      await expect(tabs.getByRole('tab')).toHaveCount(5)
      await expectMainAccessible(page)
      await top(page)
      await shot(page, 'v2-prompt-detail-1280')

      await tabs.getByRole('tab', { name: /^Sources/ }).click()
      await expect(
        screen.getByRole('grid', { name: 'Sources in the order Google listed them' })
      ).toBeVisible()
      await expectMainAccessible(page)
      await shot(page, 'v2-prompt-detail-sources-1280')

      await tabs.getByRole('tab', { name: /^Markets/ }).click()
      await expect(
        screen.getByRole('grid', { name: 'This question in other markets' })
      ).toBeVisible()
      await screen.getByRole('button', { name: 'Actions for 🇬🇧 UK · EN' }).click()
      await expect(
        page.getByRole('menuitem', { name: /Show this question in this market/ })
      ).toBeVisible()
      await shot(page, 'v2-prompt-detail-markets-1280')
      await page.keyboard.press('Escape')
    })
  } finally {
    await close()
  }
})
