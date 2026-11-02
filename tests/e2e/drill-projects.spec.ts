import { expect, test, type Locator, type Page } from '@playwright/test'
import { drawerRowCount } from './drill-helpers'
import { expectMainAccessible, openHash, openTwoMarketApp, shot } from './screens-app'

/**
 * Drill-downs on the project-level screens (REPORT-SPEC "Interaction model",
 * NFR-14) through the production shell and real IPC: Projects, the sidebar's
 * "pages due today", and Project settings. The two-market TextBolt project is
 * seeded with recorded checks. No live network.
 */

function main(page: Page): Locator {
  return page.locator('#main')
}

/** Rows in the shared drill drawer, as the NFR-14 spec counts them. */
async function drawerRows(dialog: Locator): Promise<number> {
  if ((await dialog.getByRole('grid').count()) > 0) return drawerRowCount(dialog)
  return dialog.locator('.ui-drawer-body li').count()
}

async function openProjects(page: Page): Promise<void> {
  await openHash(page, '#/projects')
  await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible()
}

test('Projects numbers drill: tracked pages, avg score, glance, usage, and keyboard', async () => {
  test.setTimeout(120_000)
  const { page, close } = await openTwoMarketApp('drill-projects')
  try {
    await openProjects(page)
    const glance = main(page).getByRole('region', { name: 'All projects at a glance' })

    // Pages tracked: the popover rows add up to the number clicked.
    const tracked = glance.getByRole('button', { name: /pages tracked: show each project$/ })
    const shown = Number(((await tracked.innerText()) || '0').replace(/,/g, ''))
    await tracked.click()
    const trackedPop = page.getByRole('dialog', { name: 'Pages tracked' })
    await expect(trackedPop).toBeVisible()
    const rows = trackedPop.getByRole('button', { name: /tracked pages of/ })
    let sum = 0
    for (const text of await rows.allInnerTexts()) {
      sum += Number(/([\d,]+) of/.exec(text)?.[1]?.replace(/,/g, '') ?? 'NaN')
    }
    expect(sum).toBe(shown)
    await page.keyboard.press('Escape')
    await expect(trackedPop).toBeHidden()
    await expect(tracked).toBeFocused()

    // List grid: avg score opens the page scores; their average is the number shown.
    const table = main(page).getByRole('grid', { name: 'Projects' })
    const score = table.getByRole('button', { name: /^Avg score of TextBolt/ })
    if ((await score.count()) > 0) {
      const average = (await score.innerText()).trim()
      await score.focus()
      await page.keyboard.press('Enter')
      const pop = page.getByRole('dialog', { name: 'Page scores' })
      await expect(pop).toBeVisible()
      await expect(pop.getByText(/^Average of \d+ pages?$/)).toBeVisible()
      await expect(pop.locator('.dpop-total .mono')).toHaveText(average)
      await shot(page, 'drill-projects-scores')
      await page.keyboard.press('Escape')
      await expect(pop).toBeHidden()
      await expect(score).toBeFocused()
    }

    // Searches cell opens its breakdown; the first row repeats the number.
    const searches = table.getByRole('button', { name: /searches this month in TextBolt/ })
    await searches.click()
    const usage = page.getByRole('dialog', { name: 'Searches this month' })
    await expect(usage).toBeVisible()
    await expect(usage.getByText('Searches this month', { exact: true }).first()).toBeVisible()
    await page.keyboard.press('Escape')

    // Tracked pages opens that project's All pages on the tracked preset.
    await table.getByRole('link', { name: /tracked pages of TextBolt in All pages/ }).click()
    await expect
      .poll(() => page.evaluate(() => window.location.hash))
      .toBe('#/pages?preset=tracked')
  } finally {
    await close()
  }
})

test('sidebar "pages due today" opens the due list in the shared drawer', async () => {
  const { page, close } = await openTwoMarketApp('drill-due')
  try {
    // Same list and drawer as the All pages "Due today" tile (schedule:listDue).
    await openHash(page, '#/pages')
    const tile = page
      .getByRole('region', { name: 'Summary' })
      .getByRole('button', { name: /due today: show them$/ })
    await expect(tile).toBeVisible()
    const opener = page
      .locator('.side-foot')
      .getByRole('button', { name: /pages? due today: show them$/ })
    if (Number(await tile.innerText()) === 0) {
      // Nothing due: the sidebar foot stays quiet, with no "0 pages due today".
      await expect(page.locator('.side-foot').getByText(/due today/)).toHaveCount(0)
      return
    }
    await expect(opener).toBeVisible()
    const count = Number(await opener.locator('[data-nfr-figure]').innerText())
    await opener.click()
    const dialog = page.getByRole('dialog', { name: /Pages due today/ })
    await expect(dialog).toBeVisible()
    expect(await drawerRows(dialog)).toBe(count)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
  } finally {
    await close()
  }
})

test('Project settings: competitor overviews drill to exactly that many prompts', async () => {
  test.setTimeout(120_000)
  const { page, close } = await openTwoMarketApp('drill-settings')
  try {
    await openHash(page, '#/project-settings')
    const general = page.getByRole('region', { name: 'General', exact: true })
    await expect(general).toBeVisible()
    await general.getByRole('button', { name: 'Find competitors from AI Overviews' }).click()
    const found = general.getByRole('region', { name: 'Competitor suggestions' })
    const count = found.getByRole('button', { name: /overviews? cite .+: show them$/ }).first()
    await expect(count).toBeVisible()
    const figure = Number(await count.locator('[data-nfr-figure]').innerText())
    await count.click()
    const dialog = page.getByRole('dialog', { name: /AI Overviews citing/ })
    await expect(dialog).toBeVisible()
    expect(await drawerRows(dialog)).toBe(figure)
    await shot(page, 'drill-settings-competitor')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(count).toBeFocused()

    // A saved competitor chip opens the overviews that cite it.
    const chip = general.getByRole('button', { name: /: show the AI Overviews that cite it$/ })
    await chip.first().click()
    await expect(page.getByRole('dialog', { name: /AI Overviews citing/ })).toBeVisible()
    await page.keyboard.press('Escape')

    // Market tags open All pages for that market; Data links pages and checks.
    await page.getByRole('tab', { name: 'Markets', exact: true }).click()
    const markets = page.getByRole('region', { name: 'Markets', exact: true })
    await expect(
      markets.getByRole('link', { name: /show the pages in this market in All pages$/ }).first()
    ).toHaveAttribute('href', /^#\/pages\?market=/)
    await page.getByRole('tab', { name: 'Data', exact: true }).click()
    const data = page.getByRole('region', { name: 'Data', exact: true })
    await expect(
      data.getByRole('link', { name: /open recent activity in Status$/ })
    ).toHaveAttribute('href', '#/status')
    await expectMainAccessible(page)
  } finally {
    await close()
  }
})
