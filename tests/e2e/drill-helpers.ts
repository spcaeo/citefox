import { expect, type Locator } from '@playwright/test'

/**
 * The shared drill drawer lists its rows in the kit ListGrid, whose
 * aria-rowcount counts the header row too. An empty drawer draws no grid,
 * only its "No … behind this number" line.
 */
export async function drawerRowCount(dialog: Locator): Promise<number> {
  const grid = dialog.getByRole('grid')
  if ((await grid.count()) === 0) return 0
  const value = await grid.first().getAttribute('aria-rowcount')
  return value === null ? Number.NaN : Number(value) - 1
}

/** Waits until the drawer lists exactly `count` rows (the number that opened it). */
export async function expectDrawerRows(dialog: Locator, count: number | string): Promise<void> {
  const rows = Number(String(count).replace(/,/g, ''))
  const grid = dialog.getByRole('grid')
  if (rows === 0) {
    await expect(grid).toHaveCount(0)
    return
  }
  await expect(grid.first()).toHaveAttribute('aria-rowcount', String(rows + 1))
}

/** Shows every row of a long drill list ("Show all N" past the first 100). */
export async function showAllRows(dialog: Locator): Promise<void> {
  const more = dialog.getByRole('button', { name: /^Show all \d/ })
  if ((await more.count()) > 0) await more.first().click()
}

/**
 * Every row the open drawer lists: the list drawer's grid (after "Show all"),
 * else the topic drawer's list items.
 */
export async function drawerRowsAll(dialog: Locator): Promise<number> {
  await showAllRows(dialog)
  if ((await dialog.getByRole('grid').count()) > 0) return drawerRowCount(dialog)
  return dialog.locator('.ui-drawer-body li').count()
}
