import { expect, type Locator } from '@playwright/test'

/**
 * A ready report's section tabs are grouped (src/renderer/src/reports/review/ReportTabs.tsx):
 * one line of top tabs ("Report sections"), and pill sub-tabs ("<Top tab> sections") when
 * the picked top tab holds several sections. Opens the section whose name starts with
 * `label`, as a person would: its top tab, or the top tab holding it and then its pill.
 */
export async function openReportSection(main: Locator, label: string): Promise<void> {
  const name = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
  const top = main.getByRole('tablist', { name: 'Report sections' })
  await expect(top).toBeVisible()
  const pill = (): Locator =>
    main
      .getByRole('tablist', { name: /^(?!Report sections$).+ sections$/ })
      .getByRole('tab', { name })
  // Already in the open group's pills (Pages › Pages, for example)?
  if ((await pill().count()) > 0) {
    await pill().first().click()
    await expect(pill().first()).toHaveAttribute('aria-selected', 'true')
    return
  }
  const direct = top.getByRole('tab', { name })
  if ((await direct.count()) > 0) {
    await direct.first().click()
    await expect(direct.first()).toHaveAttribute('aria-selected', 'true')
    return
  }
  const groups = await top.getByRole('tab').all()
  for (const group of groups) {
    await group.click()
    if ((await pill().count()) > 0) {
      await pill().first().click()
      await expect(pill().first()).toHaveAttribute('aria-selected', 'true')
      return
    }
  }
  throw new Error(`No report section named "${label}"`)
}
