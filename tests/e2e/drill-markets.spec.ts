import type { CiteFoxApi } from '@shared/ipc'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectMainAccessible, openHash, openTwoMarketApp, shot } from './screens-app'

/** `results:get` for one market, through the preload bridge, as the Markets tab reads it. */
async function pageCited(page: Page, marketId: string): Promise<number> {
  return page.evaluate(async (id) => {
    const results = await (globalThis as typeof globalThis & { citefox: CiteFoxApi }).citefox[
      'results:get'
    ]({ projectId: 'proj-1', pageId: 'page-1', marketId: id, runId: null })
    if (!results.run) throw new Error('no run')
    return results.run.pageCited
  }, marketId)
}

/** Clicks a count, checks the drawer lists exactly that many rows, closes it with Escape. */
async function expectDrawerTotal(page: Page, button: Locator): Promise<number> {
  const id = await button.getAttribute('data-nfr-drill')
  if (!id) throw new Error('count without data-nfr-drill')
  const shown = Number(await button.locator(`[data-nfr-figure="${id}"]`).innerText())
  await button.focus()
  await page.keyboard.press('Enter')
  const drawer = page.getByRole('dialog')
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('heading', { level: 2 })).toHaveText(
    new RegExp(` · ${shown} (question|questions|link|links)$`)
  )
  await expect(drawer.locator('[data-drill-row]')).toHaveCount(shown)
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await expect(button).toBeFocused()
  return shown
}

/** A count of zero is plain text (nothing to open); any other count drills as above. */
async function expectCount(page: Page, row: Locator, name: RegExp): Promise<number> {
  const button = row.getByRole('button', { name })
  if ((await button.count()) === 0) {
    await expect(row.locator('.drill-num-zero').first()).toBeVisible()
    return 0
  }
  return expectDrawerTotal(page, button)
}

test('every Markets number drills in its own market on real IPC (NFR-14)', async () => {
  test.setTimeout(180_000)
  const { page, close } = await openTwoMarketApp('drill-markets')
  try {
    await openHash(page, '#/pages/page-1/markets')
    const tab = page.getByTestId('markets-tab')
    const grid = tab.getByRole('grid', { name: 'Markets' })
    const uk = grid
      .getByRole('row')
      .filter({ has: page.getByRole('link', { name: '🇬🇧 UK · EN', exact: true }) })
    await expect(uk).toBeVisible()

    expect(await expectCount(page, uk, /questions? with this page cited in 🇬🇧 UK/)).toBe(
      await pageCited(page, 'mkt-uk')
    )
    await expectDrawerTotal(page, uk.getByRole('button', { name: /questions? checked in 🇬🇧 UK/ }))
    await expectCount(page, uk, /citations? of your domain in 🇬🇧 UK/)
    await expect(uk.getByRole('link', { name: /open History for 🇬🇧 UK/ })).toHaveAttribute(
      'href',
      '#/pages/page-1/history?market=mkt-uk'
    )

    await tab.getByRole('tab', { name: 'Cited instead' }).click()
    const citedInstead = tab.getByRole('grid', { name: 'Cited instead of you, by market' })
    const domains = citedInstead
      .getByRole('row')
      .filter({ has: page.getByRole('link', { name: '🇬🇧 UK · EN' }) })
      .getByRole('button', { name: /AI Overviews? in 🇬🇧 UK/ })
    expect(await domains.count()).toBeGreaterThan(0)
    await domains.first().click()
    const drawer = page.getByRole('dialog')
    await expect(drawer).toContainText('🇬🇧 UK · EN')
    await page.keyboard.press('Escape')
    await expectDrawerTotal(page, domains.first())

    await expectMainAccessible(page)
    await shot(page, 'drill-markets')

    await tab.getByRole('tab', { name: 'Every question' }).click()
    const table = tab.getByRole('grid', { name: 'Question results by market' })
    const ukCell = table.getByRole('link', { name: /question 2 in 🇬🇧 UK · EN$/ })
    await expect(ukCell).toHaveAttribute('href', /[?&]market=mkt-uk(&|$)/)
    await ukCell.click()
    await expect(page.getByTestId('prompt-detail')).toBeVisible()
    expect(await page.evaluate(() => window.location.hash)).toContain('market=mkt-uk')
  } finally {
    await close()
  }
})
