import type { CiteFoxApi, PageDetail } from '@shared/ipc'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { drawerShots } from '../drawer-helpers'
import { expectMainAccessible, openHash, openTwoMarketApp } from '../screens-app'

const PROJECT = 'proj-1'
const PAGE = 'page-1'
const US = '🇺🇸 US · EN'
const UK = '🇬🇧 UK · EN'

/** The page as the engine has it, through the preload bridge. */
async function readPage(page: Page): Promise<PageDetail> {
  return page.evaluate(
    async ({ projectId, pageId }) =>
      (globalThis as typeof globalThis & { citefox: CiteFoxApi }).citefox['pages:get']({
        projectId,
        pageId
      }),
    { projectId: PROJECT, pageId: PAGE }
  )
}

async function openAlerts(page: Page): Promise<void> {
  await page.locator('#main').getByRole('link', { name: 'Alerts', exact: true }).first().click()
  await expect(page.getByRole('list', { name: 'Page settings' })).toBeVisible()
}

async function rowMenu(page: Page, row: string, item: string | RegExp): Promise<Locator> {
  await page.getByRole('button', { name: `Actions for ${row}`, exact: true }).click()
  return page.getByRole('menuitem', { name: item })
}

/** CRUD e2e: Page settings, Markets and Projects (items 5, 6, 7). Registered by tests/e2e/crud.spec.ts. */
export function pageMarketsProjectsCrud(): void {
  test('page settings from a header chip: label, schedule, default market, pause, Back/Forward', async () => {
    test.setTimeout(180_000)
    const { page, close } = await openTwoMarketApp('crud-page-settings')
    try {
      await openAlerts(page)
      const chips = page.getByRole('list', { name: 'Page settings' })
      await chips.getByRole('button', { name: /^Every 14 days: change in Page settings/ }).click()
      const drawer = page.getByRole('dialog', { name: 'Page settings' })
      await expect(drawer).toBeVisible()
      expect(await page.evaluate(() => window.location.hash)).toContain('ps.section=schedule')
      await expect(drawer.getByLabel('Check every')).toBeFocused()
      await expect(drawer.getByTestId('pset-cost')).toContainText('searches')
      await drawerShots(page, 'crud-page-settings')

      // Back closes the drawer, Forward opens it again.
      await page.goBack()
      await expect(drawer).toHaveCount(0)
      await page.goForward()
      await expect(drawer).toBeVisible()

      await drawer.getByLabel('Label').fill('Alerts for crews')
      await drawer.getByLabel('Check every').selectOption('30')
      await drawer.getByLabel('Samples per question').selectOption('2')
      await drawer.getByRole('radio', { name: new RegExp(UK) }).check()
      await drawer.getByRole('button', { name: 'Save settings' }).click()
      await expect(drawer).toHaveCount(0)
      await expect(page.getByText('Saved the page settings.')).toBeVisible()
      const saved = await readPage(page)
      expect(saved).toMatchObject({
        label: 'Alerts for crews',
        intervalDays: 30,
        samples: 2,
        defaultMarketId: 'mkt-uk'
      })
      await expect(chips.getByRole('button', { name: /^Every 30 days/ })).toBeVisible()

      // Pause from the drawer, Undo from the toast.
      await page.getByRole('button', { name: 'Page settings', exact: true }).click()
      await expect(drawer).toBeVisible()
      await drawer.getByRole('button', { name: 'Pause checks' }).click()
      await expect(page.getByText(/Paused checks of/)).toBeVisible()
      await expect(chips.getByRole('button', { name: 'Paused', exact: true })).toBeVisible()
      expect((await readPage(page)).status).toBe('paused')
      await page.getByRole('button', { name: 'Undo', exact: true }).click()
      await expect(chips.getByRole('button', { name: 'Paused', exact: true })).toHaveCount(0)
      expect((await readPage(page)).status).toBe('tracked')
      await expectMainAccessible(page)
    } finally {
      await close()
    }
  })

  test('project markets: make default, add an untracked market, remove with Undo', async () => {
    test.setTimeout(180_000)
    const { page, close } = await openTwoMarketApp('crud-markets')
    try {
      await openHash(page, '#/project-settings')
      await page.getByRole('tab', { name: 'Markets', exact: true }).click()
      const table = page.getByTestId('project-markets')
      const grid = table.getByRole('grid', { name: 'Project markets' })
      await expect(grid).toBeVisible()
      const row = (name: string): Locator => grid.getByRole('row').filter({ hasText: name })
      await expect(row(US)).toContainText('Default')

      // Make UK the default, also on the page; Undo puts US back.
      await (await rowMenu(page, UK, 'Make default…')).click()
      const makeDefault = page.getByTestId('pmk-confirm-default')
      await expect(makeDefault.getByRole('checkbox')).toBeChecked()
      await makeDefault.getByRole('button', { name: 'Make default' }).click()
      await expect(page.getByText(`${UK} is the default market now.`)).toBeVisible()
      await expect(row(UK)).toContainText('Default')
      expect((await readPage(page)).defaultMarketId).toBe('mkt-uk')
      await page.getByRole('button', { name: 'Undo', exact: true }).click()
      await expect(row(US)).toContainText('Default')
      await expect.poll(async () => (await readPage(page)).defaultMarketId).toBe('mkt-us')

      // Add market starts on a country the project does not track.
      await table.getByRole('button', { name: 'Add market' }).first().click()
      const add = page.getByTestId('add-market-drawer')
      await expect(add).toBeVisible()
      expect(await page.evaluate(() => window.location.hash)).toContain('drawer=add-market')
      const country = add.getByLabel('Country')
      await expect(country).toHaveValue('CA')
      await expect(
        country.locator('option', { hasText: /United States.*\(tracked\)/ })
      ).toHaveCount(1)
      await expect(add.getByTestId('add-market-cost')).toContainText('more searches per check')
      await drawerShots(page, 'crud-add-market')
      await add.getByRole('button', { name: 'Add market', exact: true }).click()
      await expect(add).toHaveCount(0)
      await expect(grid.getByRole('row')).toHaveCount(4)
      expect((await readPage(page)).markets.map((market) => market.country)).toContain('CA')

      // Remove it: Confirm, then Undo brings it back.
      const canada = '🇨🇦 CA · EN'
      await (await rowMenu(page, canada, 'Remove…')).click()
      const remove = page.getByTestId('pmk-confirm-remove')
      await expect(remove).toContainText('1 page stop checking in this market. Its history stays.')
      await remove.getByRole('button', { name: 'Remove market' }).click()
      await expect(grid.getByRole('row')).toHaveCount(3)
      expect((await readPage(page)).markets).toHaveLength(2)
      await page.getByRole('button', { name: 'Undo', exact: true }).click()
      await expect(grid.getByRole('row')).toHaveCount(4)
      expect((await readPage(page)).markets).toHaveLength(3)

      // The project default cannot be removed.
      await page.getByRole('button', { name: `Actions for ${US}`, exact: true }).click()
      await expect(page.getByRole('menuitem', { name: /Remove/ })).toBeDisabled()
      await page.keyboard.press('Escape')
      await expectMainAccessible(page)
    } finally {
      await close()
    }
  })

  test('projects: duplicate, rename inline, archive with Undo, pause icon, delete with Confirm', async () => {
    test.setTimeout(180_000)
    const { page, close } = await openTwoMarketApp('crud-projects')
    try {
      await openHash(page, '#/projects')
      const grid = page.getByRole('grid', { name: 'Projects' })
      await expect(grid).toBeVisible()

      // Pause has its own icon (not the close x); Pause then Undo.
      const pause = await rowMenu(page, 'TextBolt', 'Pause')
      await expect(pause.locator('path[d="M9 6v12"]')).toHaveCount(1)
      await pause.click()
      await expect(page.getByText('Paused TextBolt.')).toBeVisible()
      await page.getByRole('button', { name: 'Undo', exact: true }).click()
      await expect(grid.getByRole('row').filter({ hasText: 'TextBolt' }).first()).toContainText(
        'Active'
      )

      await (await rowMenu(page, 'TextBolt', 'Duplicate')).click()
      await expect(page.getByText('Created TextBolt (copy).')).toBeVisible()
      const copy = 'TextBolt (copy)'
      await expect(page.getByRole('button', { name: `Actions for ${copy}` })).toBeVisible()

      // Rename in place: Enter saves.
      await (await rowMenu(page, copy, 'Rename')).click()
      const field = page.getByRole('textbox', { name: `New name for ${copy}` })
      await expect(field).toBeFocused()
      await field.fill('TextBolt Labs')
      await field.press('Enter')
      await expect(page.getByText(`Renamed ${copy} to TextBolt Labs.`)).toBeVisible()
      const labs = grid.getByRole('row').filter({ hasText: 'TextBolt Labs' })
      await expect(labs).toHaveCount(1)

      // Archive, then Undo.
      await (await rowMenu(page, 'TextBolt Labs', 'Archive')).click()
      await expect(labs).toContainText('Archived')
      await page.getByRole('button', { name: 'Undo', exact: true }).click()
      await expect(labs).toContainText('Active')

      // Delete waits for the typed name; it is on the URL.
      await (await rowMenu(page, 'TextBolt Labs', 'Delete…')).click()
      const confirm = page.getByTestId('pj-confirm-delete')
      await expect(confirm).toBeVisible()
      expect(await page.evaluate(() => window.location.hash)).toContain('delete=')
      const button = confirm.getByRole('button', { name: 'Delete project' })
      await expect(button).toBeDisabled()
      await confirm.getByLabel(/to confirm/).fill('TextBolt Labs')
      await drawerShots(page, 'crud-project-delete')
      await button.click()
      await expect(confirm).toHaveCount(0)
      await expect(page.getByText('Deleted TextBolt Labs.')).toBeVisible()
      await expect(labs).toHaveCount(0)
      await expect(grid.getByRole('row').filter({ hasText: 'TextBolt' })).toHaveCount(1)
      await expectMainAccessible(page)
    } finally {
      await close()
    }
  })
}
