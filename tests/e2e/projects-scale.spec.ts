import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectMainAccessible, openHash, openTwoMarketApp, pickFilter, shot } from './screens-app'

/**
 * FR-10.4–10.7 on the production shell with real IPC: the two-market TextBolt project is
 * seeded with two recorded checks, then Projects is driven end to end. Screenshots land in
 * `CITEFOX_E2E_ARTIFACTS` (default `test-results/e2e`) as `projects-*.png`.
 */

function main(page: Page): Locator {
  return page.locator('#main')
}

function projectTable(page: Page): Locator {
  return main(page).getByRole('grid', { name: 'Projects' })
}

/** Opens the Usage by project tab and returns its grid. */
async function usageTable(page: Page): Promise<Locator> {
  await main(page).getByRole('tab', { name: 'Usage by project' }).click()
  return main(page).getByRole('grid', { name: 'Usage by project this month' })
}

/** Runs one row-menu action, such as Pause, for a project row. */
async function rowAction(row: Locator, project: string, action: string): Promise<void> {
  await row.getByRole('button', { name: `Actions for ${project}` }).click()
  await row.page().getByRole('menuitem', { name: action }).click()
}

async function openProjects(page: Page): Promise<void> {
  await openHash(page, '#/projects')
  await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible()
}

test('projects at scale: list grid, usage by project, and a client project copied from TextBolt', async () => {
  // Searches count this calendar month: one more check now keeps the list's number above 0
  // whatever month the suite runs in (the seeded two are in October 2026).
  const { START, SECOND } = await import('./screens-seed')
  const seeded = await openTwoMarketApp('projects-scale', {
    checksAt: [START, SECOND, thisMonthCheckAt()]
  })
  const { page } = seeded
  try {
    await openProjects(page)

    // The list grid with the mock-up columns and sortable headers.
    const table = projectTable(page)
    await expect(table).toBeVisible()
    for (const column of [
      'Project',
      'Tracked',
      'Avg score',
      'Change',
      'Markets',
      'Searches',
      'Status'
    ]) {
      await expect(table.getByRole('columnheader', { name: column, exact: true })).toBeVisible()
    }
    const row = table.getByRole('row').filter({ hasText: 'textbolt.com' })
    await expect(row.getByText('🇺🇸 US · EN')).toBeVisible()
    await expect(row.getByRole('link', { name: /^1 more: 🇬🇧 UK · EN/ })).toBeVisible()
    expect(await table.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    const rowSearches = (await row.locator('.pj-searches .num').innerText()).trim()
    const used = rowSearches.split(' ')[0] ?? ''
    expect(Number(used.replace(/,/g, ''))).toBeGreaterThan(0)
    const nameHeader = table.getByRole('columnheader', { name: 'Project', exact: true })
    await expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')
    await nameHeader.getByRole('button').click()
    await expect(nameHeader).toHaveAttribute('aria-sort', 'descending')
    await expectMainAccessible(page)
    await shot(page, 'projects-table', true)

    // Usage by project: the same searches the list and Results count (NFR-14).
    const usage = await usageTable(page)
    await expect(usage).toBeVisible()
    const usageRow = usage.getByRole('row').filter({ hasText: 'TextBolt' })
    await expect(usageRow.getByRole('gridcell').nth(1)).toHaveText(used)
    await expect(usageRow).toContainText('Shared keys')
    await expect(usageRow).toContainText('Claude Code')
    await expect(main(page).getByText(/^All projects:/)).toBeVisible()
    await expectMainAccessible(page)

    // New project: a client project that copies TextBolt's settings, with a cap and rule.
    await openHash(page, '#/projects/new')
    const form = main(page).getByRole('form', { name: 'New project' })
    await form.getByLabel('Project name').fill('Acme Clinics')
    await form.getByLabel('Website domain').fill('acme-clinics.example')
    await form.getByLabel('Brand names').fill('Acme Clinics')
    await form.getByLabel('Client name').fill('Acme Inc.')
    await form.getByLabel('Copy settings from').selectOption({ label: 'TextBolt' })
    await form.getByLabel(/Cap for this project/).fill('500')
    await form.getByLabel('When the cap is reached').selectOption('allow_10')
    await form.getByLabel('Claude connection').selectOption('claude_code')
    await expect(form.getByText(/For client work, use an Anthropic API key/)).toBeVisible()
    await shot(page, 'projects-new-client', true)
    await form.getByLabel('Claude connection').selectOption('app_default')
    await form.getByRole('button', { name: 'Create project' }).click()
    await expect(page.getByText('Acme Clinics is ready.')).toBeVisible()
    // Create opens the new project's start screen (an empty project's landing comes back
    // here too), so go on to the Projects screen in the app.
    await expect(
      page.getByRole('heading', { level: 1, name: 'How do you want to start?' })
    ).toBeVisible()
    await page.evaluate(() => {
      window.location.hash = '#/projects'
    })
    await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible()

    // The switcher shows the client's name (FR-10.7).
    await page.getByRole('button', { name: /Switch project, Acme Clinics/ }).click()
    const menu = page.getByRole('group', { name: 'Projects' })
    await expect(
      menu.getByText(/acme-clinics\.example · Client: Acme Inc\. · Active/)
    ).toBeVisible()
    await shot(page, 'projects-switcher-client')
    await page.keyboard.press('Escape')

    // Pause and resume the new project from its row menu.
    await openProjects(page)
    const acme = projectTable(page).getByRole('row').filter({ hasText: 'acme-clinics.example' })
    await expect(acme).toContainText('Acme Inc.')
    await rowAction(acme, 'Acme Clinics', 'Pause')
    await expect(acme).toContainText('Paused')
    await rowAction(acme, 'Acme Clinics', 'Resume')
    await expect(acme).toContainText('Active')

    // The Kind filter keeps only client projects.
    await pickFilter(page, 'Kind', /^Client$/)
    await expect(projectTable(page).getByRole('row')).toHaveCount(2)
    await pickFilter(page, 'Kind', /^Any kind$/)

    // Usage shows the new project's shared cap with the 10% extra.
    const acmeUsage = (await usageTable(page)).getByRole('row').filter({ hasText: 'Acme Clinics' })
    await expect(acmeUsage).toContainText('500 (+10%: 550)')
    await expect(acmeUsage).toContainText('Acme Inc.')
    await expect(main(page).locator('.usage-note')).toContainText('Shared keys: My plan')
    await expectMainAccessible(page)
    await shot(page, 'projects-usage', true)
  } finally {
    await seeded.close()
  }
})

/** An hour ago, or a minute into this month when the month is younger than an hour. */
function thisMonthCheckAt(): string {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 1).getTime()
  return new Date(Math.max(monthStart, now.getTime() - 3_600_000)).toISOString()
}
