import { expect, test, type Page } from '@playwright/test'
import { openHash, openTwoMarketApp, shot } from './screens-app'

/** Every page tab of a checked page at 1280 × 900, for the v2 audit. */
const TABS = [
  'results',
  'progress',
  'markets',
  'sentiment',
  'communities',
  'gaps',
  'prompts',
  'audience',
  'history'
] as const

async function settle(page: Page): Promise<void> {
  await expect(page.getByText(/^Loading/)).toHaveCount(0, { timeout: 20_000 })
  await page.waitForTimeout(400)
}

test('every page tab, for the v2 audit', async () => {
  test.setTimeout(240_000)
  const { page, close } = await openTwoMarketApp('tabs-v2')
  try {
    for (const tab of TABS) {
      await openHash(page, `#/pages/page-1/${tab}`)
      await settle(page)
      await page.evaluate(() => document.querySelector('#main')?.scrollTo(0, 0))
      await shot(page, `tabs-v2-${tab}`)
      await page.setViewportSize({ width: 1280, height: 2400 })
      await page.waitForTimeout(300)
      await shot(page, `tabs-v2-${tab}-tall`)
      await page.setViewportSize({ width: 1280, height: 900 })
    }
  } finally {
    await close()
  }
})
