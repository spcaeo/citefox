import type { CiteFoxApi } from '@shared/ipc'
import { expect, test, type Page } from '@playwright/test'
import { expectMainAccessible, openHash, openTwoMarketApp, shot } from './screens-app'

/** Ids from tests/e2e/screens-seed.ts (imported lazily there, so not imported here). */
const SEED = { projectId: 'proj-1', pageId: 'page-1', us: 'mkt-us' } as const

/** The run ids of the US checks, oldest first, through the same bridge History uses. */
async function usRunIds(page: Page): Promise<string[]> {
  return page.evaluate(
    async ({ projectId, pageId, marketId }) => {
      const api = (globalThis as typeof globalThis & { citefox: CiteFoxApi }).citefox
      const history = await api['results:history']({ projectId, pageId, marketId })
      return history.points.map((point) => point.runId)
    },
    { projectId: SEED.projectId, pageId: SEED.pageId, marketId: SEED.us }
  )
}

test('History drills open the check that was clicked, with matching totals, on real IPC', async () => {
  test.setTimeout(180_000)
  const { page, close } = await openTwoMarketApp('drill-history')
  try {
    const runs = await usRunIds(page)
    expect(runs.length).toBeGreaterThanOrEqual(2)
    const oldest = runs[0] ?? ''

    await openHash(page, `#/pages/${SEED.pageId}/history?market=${SEED.us}`)
    const panel = page.locator('#page-tabpanel')
    await expect(panel.getByRole('grid', { name: 'Page history' })).toBeVisible()
    await panel.getByRole('tab', { name: /^Timeline/ }).click()
    const timeline = panel.locator('ol.hist-timeline')
    await expect(timeline).toBeVisible()

    // "N changed" on the newest check: the drawer lists exactly that many prompts.
    // A zero has nothing to open, so it is plain text, not a button.
    const changed = timeline.locator('.hist-changed').first()
    await expect(changed).toBeVisible()
    const figure = Number(await changed.locator('[data-nfr-figure]').textContent())
    const opener = changed.getByRole('button', {
      name: /changed since the previous check: show them$/
    })
    if (figure === 0) {
      await expect(opener).toHaveCount(0)
    } else {
      await opener.focus()
      await opener.press('Enter')
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('heading', { level: 2 })).toContainText(
        `Questions whose result changed`
      )
      await expect(dialog.locator('[data-drill-row]')).toHaveCount(figure)
      await shot(page, 'drill-history-changed')
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(opener).toBeFocused()
    }

    // The events grid keeps the score and change drills; a row opens the rest.
    await panel.getByRole('tab', { name: /^Events/ }).click()
    const grid = panel.getByRole('grid', { name: 'Page history' })
    await expect(
      grid.getByRole('link', { name: /^Score \d+: open the results/ }).first()
    ).toBeVisible()
    await expect(grid.getByRole('columnheader', { name: 'Questions changed' })).toBeVisible()
    await grid.locator('[data-row]').first().locator('.hist-cell-title').click()
    const details = page.getByRole('dialog')
    await expect(details.getByRole('link', { name: /^View results of the / })).toBeVisible()
    await shot(page, 'drill-history-event-panel')
    await page.keyboard.press('Escape')
    await expect(details).toHaveCount(0)
    await expectMainAccessible(page)
    await panel.getByRole('tab', { name: /^Timeline/ }).click()

    // "View results" on the oldest check opens Results pinned to that check.
    const viewResults = timeline.getByRole('link', { name: /^View results of the / })
    const oldestLink = viewResults.last()
    await expect(oldestLink).toHaveAttribute('href', new RegExp(`run=${oldest}`))
    await oldestLink.click()
    await expect.poll(() => page.evaluate(() => window.location.hash)).toContain(`run=${oldest}`)
    await expect(page.getByRole('tab', { name: 'Results', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(page.getByText(/Error invoking remote method/)).toHaveCount(0)
  } finally {
    await close()
  }
})
