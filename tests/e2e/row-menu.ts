import { expect, type Locator, type Page } from '@playwright/test'

/** Waits two animation frames, so scroll events from a focus move have fired. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
  )
}

/**
 * Picks one item from a list grid row's `⋯` menu ("Actions for <row>") with
 * the keyboard: focus the button, Enter opens the menu on its first item, the
 * arrows move, Enter chooses. Keyboard use is part of what this checks.
 *
 * The shared menu closes on any scroll, and focusing the button can scroll the
 * page a frame later, so the button is focused and left to settle first, and
 * the menu is opened again if a late scroll closed it.
 */
export async function chooseRowAction(
  page: Page,
  scope: Locator,
  rowName: string,
  item: string
): Promise<void> {
  const trigger = scope.getByRole('button', { name: `Actions for ${rowName}`, exact: true })
  const target = page.getByRole('menuitem', { name: item, exact: true })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await trigger.scrollIntoViewIfNeeded()
    await trigger.focus()
    await settle(page)
    await page.keyboard.press('Enter')
    await settle(page)
    if (await target.isVisible()) break
  }
  await expect(target).toBeVisible()
  for (let step = 0; step < 10; step += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) break
    await page.keyboard.press('ArrowDown')
  }
  await expect(target).toBeFocused()
  await page.keyboard.press('Enter')
}
