import { expect, test } from '@playwright/test'
import { openHash, openTwoMarketApp } from './screens-app'

/**
 * The welcome tour in the real app (src/renderer/src/intro/): the bundled film loads and
 * plays through the app's own media pipeline, Skip and Esc leave, and the URL is cleaned.
 * (Help › Watch the welcome tour opens the same `?dialog=intro` link.)
 */
test('the welcome tour film loads, plays, and Skip returns to the same screen', async () => {
  test.setTimeout(120_000)
  const seeded = await openTwoMarketApp('intro')
  const { page } = seeded
  try {
    await openHash(page, '#/overview')
    await openHash(page, '#/overview?dialog=intro')
    const dialog = page.getByRole('dialog', { name: 'Welcome to CiteFox' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Skip' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^(Mute|Unmute)$/ })).toBeVisible()

    // The film is the real bundled file: it decodes (H.264), has its 45 s, and moves.
    const video = dialog.locator('video')
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState), {
        timeout: 30_000
      })
      .toBeGreaterThanOrEqual(2)
    const duration = await video.evaluate((element: HTMLVideoElement) => element.duration)
    expect(duration).toBeGreaterThan(44)
    expect(duration).toBeLessThan(46)
    expect(await video.evaluate((element: HTMLVideoElement) => element.error)).toBeNull()
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), {
        timeout: 20_000
      })
      .toBeGreaterThan(0.5)

    await dialog.getByRole('button', { name: 'Skip' }).click()
    await expect(dialog).toHaveCount(0)
    expect(await page.evaluate(() => window.location.hash)).toBe('#/overview')

    // Esc leaves too, and the tour opens again from its link.
    await openHash(page, '#/overview?dialog=intro')
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  } finally {
    await seeded.close()
  }
})
