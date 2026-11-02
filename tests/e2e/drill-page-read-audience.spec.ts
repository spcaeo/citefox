import { expect, test } from '@playwright/test'
import { expectMainAccessible, openHash, openTwoMarketApp } from './screens-app'

/**
 * Page read and Buyer profile drill-downs on real IPC (seeded two-market
 * TextBolt project). Every prompt count opens a drawer whose total equals the
 * number clicked (NFR-14); Escape closes it and focus returns to the count.
 */
test('page read and buyer profile drill-downs open what they count', async () => {
  test.setTimeout(120_000)
  const { page, close } = await openTwoMarketApp('drill-read')
  try {
    await openHash(page, '#/pages/page-1/read')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Check what CiteFox read' })
    ).toBeVisible()

    const markets = page.getByRole('group', { name: 'Markets' }).getByRole('link')
    await expect(markets).toHaveCount(2)
    await expect(markets.first()).toHaveAttribute('href', /#\/pages\/page-1\/markets\?market=/)
    await expect(page.getByRole('link', { name: 'Compare content in History' })).toHaveAttribute(
      'href',
      '#/pages/page-1/history'
    )

    const count = page.locator('button[data-nfr-drill="read:promises"]')
    await expect(count).toBeVisible()
    const figure = (await count.locator('[data-nfr-figure="read:promises"]').textContent()) ?? ''
    expect(Number(figure)).toBeGreaterThan(0)
    await count.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText(
      new RegExp(`· ${figure} questions?$`)
    )
    await expect(dialog.locator('[data-drill-row]')).toHaveCount(Number(figure))
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(count).toBeFocused()

    const flag = page.getByRole('button', { name: /title tag$/ }).first()
    await flag.click()
    await expect(flag).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('note').first()).toContainText('H1')
    await page.keyboard.press('Escape')
    await expect(flag).toHaveAttribute('aria-expanded', 'false')
    await expectMainAccessible(page)

    await count.click()
    await dialog.locator('[data-drill-row="0"]').click()
    await expect
      .poll(() => page.evaluate(() => window.location.hash))
      .toMatch(/^#\/pages\/page-1\/prompt\/[^?]+\?market=/)

    await openHash(page, '#/pages/page-1/audience')
    await expect(page.getByRole('link', { name: 'all 2 markets' })).toHaveAttribute(
      'href',
      '#/pages/page-1/markets'
    )
  } finally {
    await close()
  }
})
