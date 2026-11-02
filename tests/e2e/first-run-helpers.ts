import { expect, type Page } from '@playwright/test'

/**
 * "How do you want to start?" (`#/start/choose`, owner feedback 6). Finish now lands on
 * the first topic when setup made one, so specs that start from that screen open it.
 */
export async function openStartChoice(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (window.location.hash !== '#/start/choose') window.location.hash = '#/start/choose'
  })
  await expect(
    page.getByRole('heading', { level: 1, name: 'How do you want to start?' })
  ).toBeVisible()
}

/**
 * Specs about other screens pick "I'll choose what to track myself" on "How do you want
 * to start?" (no setup runs), land on the chooser and open the Add page form, the screen
 * they test from.
 */
export async function leaveFirstRun(page: Page): Promise<void> {
  await openStartChoice(page)
  await page.getByRole('radio', { name: 'I’ll choose what to track myself' }).check()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'What do you want to track?' })
  ).toBeVisible()
  await page.evaluate(() => {
    window.location.hash = '#/add-page'
  })
  await expect(page.getByRole('heading', { level: 1, name: 'Add a page to track' })).toBeVisible()
}
