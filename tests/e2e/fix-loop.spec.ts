import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { drawerShots } from './drawer-helpers'
import { expectDrawerRows } from './drill-helpers'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'
import { expectMainAccessible, openHash, shot } from './screens-app'
import { openAllPages } from './nav-helpers'

/**
 * Fixes › fix → measure → repeat on the Progress seed (Fix 1 live Oct 8 on page-1,
 * full checks Oct 5 and Oct 19): Next round and Backlinks a link away from Did it
 * work?, the Changes ledger, a count that opens exactly
 * the rows it counts, the change drawer handing over to the fix drawer, and
 * "Check index" asking before it spends (the index channels are stubbed: no
 * SerpApi call leaves the container).
 */

async function openSeeded(): Promise<{
  app: ElectronApplication
  page: Page
  close: () => Promise<void>
}> {
  installRawMarkdown()
  const { seedProgressProject } = await import('./progress-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-fix-loop-'))
  await seedProgressProject(dir)
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1440, height: 900 }
  })
  await openAllPages(page)
  return {
    app,
    page,
    close: async () => {
      await app.close()
      await rm(dir, { recursive: true, force: true })
    }
  }
}

/** Every scroller under `root` (the root included) whose content is wider than it is. */
async function sidewaysScrollers(page: Page, root: string): Promise<string[]> {
  return page.evaluate((selector) => {
    const top = document.querySelector(selector)
    if (!top) return [`${selector} not found`]
    return [top, ...top.querySelectorAll('*')]
      .filter((node): node is HTMLElement => node instanceof HTMLElement)
      .filter((node) => {
        const scrolls = node === top || /auto|scroll/.test(getComputedStyle(node).overflowX)
        return scrolls && node.scrollWidth - node.clientWidth > 1
      })
      .map(
        (node) =>
          `${node.tagName.toLowerCase()}.${node.className} ${node.scrollWidth}>${node.clientWidth}`
      )
  }, root)
}

/** Main-pane shots at the owner's two board widths. */
async function screenShots(page: Page, name: string): Promise<void> {
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1134, height: 770 }
  ]) {
    await page.setViewportSize(size)
    await page.evaluate(() => document.querySelector('#main')?.scrollTo(0, 0))
    await shot(page, `${name}-${size.width}`)
    // Nothing on the screen scrolls sideways at either width, the grids included.
    const sideways = await sidewaysScrollers(page, '#main')
    expect(sideways, `${name} at ${size.width}px scrolls sideways`).toEqual([])
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}

test('Fixes: the change ledger, a drill that matches its count, and the hand-over to the fix drawer', async () => {
  test.setTimeout(180_000)
  const { page, close } = await openSeeded()
  try {
    await openHash(page, '#/fixes')
    const main = page.locator('#main')
    const tabs = main.getByRole('tablist', { name: 'Fixes views' })
    const didItWork = tabs.getByRole('tab', { name: 'Did it work?' })
    await didItWork.click()
    await expect(page).toHaveURL(/#\/fixes\?view=changes$/)

    // Next round is a link away from Did it work?, and sits under its tab.
    await main.getByRole('link', { name: 'Next round', exact: true }).click()
    await expect(page).toHaveURL(/#\/fixes\?view=round$/)
    await expect(didItWork).toHaveAttribute('aria-selected', 'true')
    await expect(main.getByRole('heading', { name: 'The next round', exact: true })).toBeVisible()
    await expect(main.getByRole('heading', { name: 'Google index' })).toBeVisible()
    await expectMainAccessible(page)
    await screenShots(page, 'fix-loop-round')

    await main.getByRole('link', { name: '← Did it work?' }).click()
    await expect(page).toHaveURL(/#\/fixes\?view=changes$/)
    const ledger = main.getByRole('grid', { name: 'Changes you made' })
    await expect(ledger.getByRole('row')).toHaveCount(2)
    await expect(ledger.getByText('Fix', { exact: true })).toBeVisible()
    await expectMainAccessible(page)
    await screenShots(page, 'fix-loop-changes')
    await page.emulateMedia({ colorScheme: 'dark' })
    await shot(page, 'fix-loop-changes-dark')
    await page.emulateMedia({ colorScheme: 'light' })

    // "Cited now" counts the stored rows of the latest check; its drill lists exactly those.
    const citedNow = ledger.getByRole('button', { name: /: Cited now · / })
    // The first-visit explainer card floats over the ledger's lower cells: close it.
    const explainer = page.getByTestId('guide-explainer')
    if (await explainer.isVisible()) {
      await explainer.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(explainer).toBeHidden()
    }
    const count = (await citedNow.innerText()).trim()
    await citedNow.click()
    const drill = page.getByRole('dialog', { name: /Cited now · / })
    await expect(page).toHaveURL(/drawer=drill/)
    await expectDrawerRows(drill, count)
    await page.keyboard.press('Escape')
    await expect(drill).toHaveCount(0)

    // A row opens the change drawer (in the URL); Edit hands over to the one fix drawer.
    await ledger.getByRole('row').nth(1).getByRole('gridcell').first().click()
    await expect(page).toHaveURL(/view=changes&row=/)
    const change = page.getByRole('dialog').filter({ hasText: 'Questions before and now' })
    await expect(change.getByRole('grid', { name: 'Questions before and now' })).toBeVisible()
    await drawerShots(page, 'fix-loop-change', { width: 1440, height: 900 })
    await page.setViewportSize({ width: 1134, height: 770 })
    expect(
      await sidewaysScrollers(page, '.ui-drawer[data-drawer="change"]'),
      'the change drawer at 1134px scrolls sideways'
    ).toEqual([])
    await page.setViewportSize({ width: 1440, height: 900 })
    await change.getByRole('button', { name: 'Edit the change' }).click()
    await expect(page).toHaveURL(/view=changes&drawer=fix&fix=[^&]+&fix\.mode=edit/)
    const edit = page.getByRole('dialog', { name: 'Edit Fix 1' })
    await expect(edit.getByLabel('Kind of change')).toHaveValue('fix')
    await edit.getByLabel('Kind of change').selectOption('rewrite')
    await edit.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('dialog', { name: 'Fix 1' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(ledger.getByText('Rewrite', { exact: true })).toBeVisible()

    await main.getByRole('link', { name: 'Backlinks', exact: true }).click()
    await expect(page).toHaveURL(/#\/fixes\?view=backlinks$/)
    await expect(didItWork).toHaveAttribute('aria-selected', 'true')
    await expect(
      main.getByRole('heading', { name: 'Build backlinks to these pages' })
    ).toBeVisible()
    await screenShots(page, 'fix-loop-backlinks')
    await expect(page.getByText(/Error invoking remote method/)).toHaveCount(0)
  } finally {
    await close()
  }
})

test('Check index shows what it spends and runs only after the confirm', async () => {
  test.setTimeout(120_000)
  const { app, page, close } = await openSeeded()
  try {
    await app.evaluate(({ ipcMain }) => {
      const calls: { preview: unknown[]; check: unknown[] } = { preview: [], check: [] }
      ;(globalThis as { __indexCalls?: typeof calls }).__indexCalls = calls
      ipcMain.removeHandler('fixes:indexPreview')
      ipcMain.handle('fixes:indexPreview', (_event, request: { pageIds: string[] }) => {
        calls.preview.push(request)
        const pages = request.pageIds.length
        return {
          pages,
          searchesMin: pages,
          searchesMax: pages * 2,
          left: 40,
          canRun: true,
          reason: null
        }
      })
      ipcMain.removeHandler('fixes:checkIndex')
      ipcMain.handle('fixes:checkIndex', (_event, request: { pageIds: string[] }) => {
        calls.check.push(request)
        return {
          results: request.pageIds.map((pageId) => ({
            pageId,
            check: { state: 'indexed', checkedAt: new Date().toISOString(), message: null }
          })),
          searchesUsed: request.pageIds.length,
          stoppedReason: null
        }
      })
    })
    const calls = (): Promise<{ preview: unknown[]; check: unknown[] }> =>
      app.evaluate(
        () =>
          (globalThis as { __indexCalls?: { preview: unknown[]; check: unknown[] } })
            .__indexCalls ?? { preview: [], check: [] }
      )

    // Check index lives in Next round, a link away from Did it work?.
    await openHash(page, '#/fixes?view=round')
    const main = page.locator('#main')
    await main.getByRole('button', { name: 'Check index' }).click()
    await expect(page).toHaveURL(/#\/fixes\?view=round&index=confirm$/)
    const confirm = page.getByRole('alertdialog', { name: 'Check the Google index?' })
    await expect(confirm).toContainText(
      /Checks 1 page with a Google site: search\. Uses 1–2 searches; 40 left this month\./
    )
    await shot(page, 'fix-loop-index-confirm')
    expect((await calls()).preview).toHaveLength(1)
    expect((await calls()).check).toHaveLength(0)

    // Cancel spends nothing.
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).toHaveCount(0)
    await expect(page).toHaveURL(/#\/fixes\?view=round$/)
    expect((await calls()).check).toHaveLength(0)

    await main.getByRole('button', { name: 'Check index' }).click()
    await page
      .getByRole('alertdialog', { name: 'Check the Google index?' })
      .getByRole('button', { name: 'Check index' })
      .click()
    await expect(main.getByText('Checked 1 page with Google · used 1 search.')).toBeVisible()
    const after = await calls()
    expect(after.check).toHaveLength(1)
    expect(after.check[0]).toMatchObject({ confirmedSearches: 2 })
  } finally {
    await close()
  }
})
