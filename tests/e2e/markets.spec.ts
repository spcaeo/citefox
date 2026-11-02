import type { CiteFoxApi } from '@shared/ipc'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { drawerShots } from './drawer-helpers'
import { expectMainAccessible, openTwoMarketApp, shot } from './screens-app'

interface RunNumbers {
  score: number | null
  pageCited: number
  promptsWithAio: number
  promptsChecked: number
  links: number
}

/** The header market picker's markets, without its last "+ New market…" option. */
function marketOptions(page: Page): Locator {
  return page
    .getByRole('combobox', { name: 'Market' })
    .locator('option:not([value="__citefox_new__"])')
}

/** The same `results:get` the Results screen reads, through the preload bridge. */
async function readRun(page: Page, marketId: string): Promise<RunNumbers> {
  return page.evaluate(async (id) => {
    const results = await (globalThis as typeof globalThis & { citefox: CiteFoxApi }).citefox[
      'results:get'
    ]({
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: id,
      runId: null
    })
    const run = results.run
    if (!run) throw new Error('no run')
    return {
      score: run.visibilityScore,
      pageCited: run.pageCited,
      promptsWithAio: run.promptsWithAio,
      promptsChecked: run.promptsChecked,
      links: run.citationsThisPage + run.citationsOtherOwn
    }
  }, marketId)
}

test('markets tab compares markets and adds and removes one on real IPC', async () => {
  test.setTimeout(180_000)
  const { page, close } = await openTwoMarketApp('markets')
  try {
    await page.locator('#main').getByRole('link', { name: 'Alerts', exact: true }).first().click()
    await page.getByRole('tab', { name: 'Markets', exact: true }).click()
    const tab = page.getByTestId('markets-tab')
    await expect(tab).toBeVisible()
    await expect(page.getByText('Not available yet.')).toHaveCount(0)

    const grid = tab.getByRole('grid', { name: 'Markets' })
    const rowOf = (name: string): Locator =>
      grid.getByRole('row').filter({ has: page.getByRole('link', { name, exact: true }) })
    const headers = await grid.getByRole('columnheader').allTextContents()
    const cell = (row: Locator, header: string): Locator =>
      row.getByRole('gridcell').nth(headers.indexOf(header))
    await expect(grid.getByRole('row')).toHaveCount(3)
    for (const [name, id] of [
      ['🇺🇸 US · EN', 'mkt-us'],
      ['🇬🇧 UK · EN', 'mkt-uk']
    ] as const) {
      const row = rowOf(name)
      const run = await readRun(page, id)
      await expect(row.getByText(`Visibility score ${run.score ?? '—'}`)).toBeVisible()
      await expect(cell(row, 'Page cited')).toHaveText(`${run.pageCited} of ${run.promptsWithAio}`)
      await expect(cell(row, 'Citations (links)')).toHaveText(String(run.links))
      await expect(cell(row, 'AI Overview shown')).toHaveText(
        `${run.promptsWithAio} of ${run.promptsChecked}`
      )
      await expect(cell(row, 'Searches per check')).toContainText('2–4')
    }
    await expect(rowOf('🇺🇸 US · EN')).toContainText('Country · default')

    const table = tab.getByRole('grid', { name: 'Question results by market' })
    await expect(table.getByRole('row')).toHaveCount(3)
    await tab.getByRole('button', { name: /^Only where markets differ/ }).click()
    await expect(table.getByRole('row')).toHaveCount(2)
    await expect(table.getByRole('row').nth(1)).toContainText('Right page · 2')
    await expect(table.getByRole('row').nth(1)).toContainText('Not cited')
    await expect(tab.getByText(/Showing 1 of 2 questions · 1 differ/)).toBeVisible()
    await tab.getByRole('button', { name: /^All questions/ }).click()
    await expectMainAccessible(page)
    await shot(page, 'markets-tab', true)

    await tab.getByRole('tab', { name: 'Cited instead' }).click()
    expect(page.url()).toContain('view=cited')
    const cited = tab.getByRole('grid', { name: 'Cited instead of you, by market' })
    await expect(
      cited.getByRole('row').filter({ has: page.getByRole('link', { name: '🇺🇸 US · EN' }) })
    ).toContainText('simpletexting.com')
    await expectMainAccessible(page)
    await shot(page, 'markets-cited-instead')

    // One add action: Add market in the grid toolbar opens the Add a market drawer (on the URL).
    await expect(tab.getByRole('tab', { name: 'Add a market' })).toHaveCount(0)
    const addButton = tab.getByRole('button', { name: 'Add market', exact: true })
    await addButton.click()
    const panel = page.getByRole('dialog', { name: 'Add a market' })
    await expect(panel).toBeVisible()
    expect(page.url()).toContain('panel=add-market')
    // Back closes it, Forward opens it again; Escape closes it.
    await page.goBack()
    await expect(panel).toHaveCount(0)
    expect(page.url()).not.toContain('panel=add-market')
    await page.goForward()
    await expect(panel).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    expect(page.url()).not.toContain('panel=add-market')
    // A typed city asks before it is dropped.
    await addButton.click()
    await panel.getByLabel(/City or region/).fill('Leeds')
    await panel.getByRole('button', { name: 'Close Add a market' }).click()
    const ask = page.getByRole('alertdialog', { name: 'Discard changes?' })
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: 'Discard' }).click()
    await expect(panel).toHaveCount(0)

    await addButton.click()
    const form = panel.getByRole('form', { name: 'Add a market' })
    await form.getByLabel('Country').selectOption('CA')
    await form.getByRole('button', { name: 'Mobile' }).click()
    await expect(panel.getByTestId('mk-add-summary')).toContainText(/[\d,]+ searches left/)
    await expectMainAccessible(page)
    await shot(page, 'markets-add-form')
    await drawerShots(page, 'markets-add')
    await panel.getByRole('button', { name: 'Add without checking' }).click()
    await expect(panel).toHaveCount(0)
    await expect(
      tab.getByText('Market added. Its baseline starts on its first check.')
    ).toBeVisible()
    const added = rowOf('🇨🇦 CA · EN')
    await expect(added).toBeVisible()
    await expect(added).toContainText('Not checked yet')
    await expect(added).toContainText('Mobile')
    await expect(marketOptions(page)).toHaveCount(3)
    await addButton.click()
    await form.getByLabel('Country').selectOption('CA')
    await form.getByRole('button', { name: 'Mobile' }).click()
    await panel.getByRole('button', { name: 'Add without checking' }).click()
    await expect(panel.getByText('This page already tracks that market.')).toBeVisible()
    await page.keyboard.press('Escape')
    await ask.getByRole('button', { name: 'Discard' }).click()
    await expect(panel).toHaveCount(0)

    await tab.getByRole('tab', { name: 'Every question' }).click()
    await expect(table.getByRole('columnheader', { name: '🇨🇦 CA · EN' })).toBeVisible()
    await expect(table.getByRole('row').nth(1)).toContainText('Not checked')
    await shot(page, 'markets-added')

    await added.getByRole('button', { name: 'Actions for 🇨🇦 CA · EN' }).click()
    await page.getByRole('menuitem', { name: 'Remove 🇨🇦 CA · EN' }).click()
    await page
      .getByRole('alertdialog', { name: 'Remove 🇨🇦 CA · EN?' })
      .getByRole('button', { name: 'Remove market' })
      .click()
    await expect(grid.getByRole('row')).toHaveCount(3)
    await expect(marketOptions(page)).toHaveCount(2)
    await expect(page.getByRole('combobox', { name: 'Market' })).toHaveValue('mkt-us')

    await table.getByRole('link', { name: 'Crew alerts' }).click()
    await expect(page.getByTestId('prompt-detail')).toBeVisible()
  } finally {
    await close()
  }
})
