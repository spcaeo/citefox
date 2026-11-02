import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { animationsDone, DRAWER_SIZES } from './drawer-helpers'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { openAllPages, sidebarLink } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { chooseRowAction } from './row-menu'
import { expectMainAccessible, openHash } from './screens-app'

/**
 * Alerts (tracking.md §6) on the alerts seed (tests/e2e/alerts-seed.ts): the
 * Progress project with two rules, one of which fired after the Oct 19 check.
 * Every drawer and tab is on the URL; Slack goes to the offline transport
 * (CITEFOX_SLACK=off in launch.ts), so nothing is ever posted.
 */
const HOME = { width: 1440, height: 900 }

/** True while the seed's Oct 19 check is inside the dry run's 30-day window. */
const SEED_IN_WINDOW = Date.now() - Date.parse('2026-10-19T12:00:00.000Z') < 29 * 86_400_000

/** `alerts-<what>-<width>.png` at 1440x900 and 1134x770, then back to 1440x900. */
async function shots(page: Page, name: string, show?: Locator): Promise<void> {
  for (const size of DRAWER_SIZES) {
    await page.setViewportSize(size)
    await animationsDone(page)
    if (show) await show.scrollIntoViewIfNeeded()
    await page.screenshot({ path: await e2eArtifact(`${name}-${size.width}.png`) })
  }
  await page.setViewportSize(HOME)
  await animationsDone(page)
}

async function openSeeded(): Promise<{ page: Page; close: () => Promise<void> }> {
  installRawMarkdown()
  const { seedAlertsProject } = await import('./alerts-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-alerts-deep-'))
  await seedAlertsProject(dir)
  const { app, page } = await launchCiteFox({ userDataDir: dir, viewport: HOME })
  await openAllPages(page)
  return {
    page,
    close: async () => {
      await app.close()
      await rm(dir, { recursive: true, force: true })
    }
  }
}

function rulesGrid(page: Page): Locator {
  return page.getByRole('grid', { name: 'Alert rules' })
}

test('Alert rules: sidebar, list, drawer on the URL, dry run, create, duplicate, pause, delete, log', async () => {
  test.setTimeout(240_000)
  const { page, close } = await openSeeded()
  try {
    // The sidebar's Alerts & schedules opens the rules first, under the project's breadcrumb.
    await (await sidebarLink(page, 'Tracking', 'Alerts & schedules')).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Alerts & schedules' })).toBeVisible()
    await expect(page).toHaveURL(/#\/(p\/[^/]+\/)?alerts$/)
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect(crumbs).toContainText('TextBolt')
    await expect(crumbs).toContainText('Alerts & schedules')
    await expect(crumbs).not.toContainText('App settings')
    await expect(page.getByRole('tab', { name: 'Alert rules' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    // Check timing and Email accounts live in App settings now (one home each).
    await expect(page.getByRole('tab', { name: 'Alert log' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Check timing' })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'Email accounts' })).toHaveCount(0)
    const grid = rulesGrid(page)
    await expect(grid.getByRole('row')).toHaveCount(3)
    await expect(grid).toContainText('Money pages lose a citation')
    await expect(grid).toContainText('Score drops by 15')
    await expect(grid).toContainText('Paused')
    await expectMainAccessible(page)
    await shots(page, 'alerts-sidebar')
    await shots(page, 'alerts-rules')

    // A row opens its drawer on the URL; a reload keeps it; Back closes it.
    await grid.getByRole('row', { name: /Money pages lose a citation/ }).click()
    await expect(page).toHaveURL(/drawer=alert-rule&rule\.id=[^&]+/)
    let drawer = page.getByRole('dialog', { name: 'Edit alert rule' })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByRole('textbox', { name: 'Rule name' })).toHaveValue(
      'Money pages lose a citation'
    )
    const summary = drawer.getByTestId('rule-dry-summary')
    if (SEED_IN_WINDOW) {
      await expect(summary).toContainText('Would have fired once in the last 30 days')
      await expect(drawer.getByTestId('rule-dry-events')).toContainText(
        'Target page no longer cited on 1 question'
      )
    } else {
      await expect(summary).toContainText(/Would (have|not have) fired/)
    }
    await shots(page, 'alerts-rule-drawer')
    // Nothing in the drawer is wider than it (no sideways scroll).
    expect(
      await page.evaluate(() => {
        const body = document.querySelector<HTMLElement>('.ui-drawer-body')
        return body ? body.scrollWidth - body.clientWidth : -1
      })
    ).toBe(0)
    const editUrl = page.url()
    await page.reload()
    await expect(page).toHaveURL(editUrl)
    drawer = page.getByRole('dialog', { name: 'Edit alert rule' })
    await expect(drawer.getByRole('textbox', { name: 'Rule name' })).toHaveValue(
      'Money pages lose a citation'
    )
    await page.goBack()
    await expect(drawer).toHaveCount(0)
    await expect(page).not.toHaveURL(/drawer=alert-rule/)

    // New rule: score drop, an email chip, the dry run, Save.
    await page.getByRole('button', { name: 'New rule' }).first().click()
    await expect(page).toHaveURL(/drawer=alert-rule&rule\.id=new/)
    drawer = page.getByRole('dialog', { name: 'New alert rule' })
    await expect(drawer).toBeVisible()
    await drawer.getByRole('radio', { name: 'Score drops by N or more' }).check()
    await drawer.getByLabel('Points').fill('5')
    await drawer.getByRole('textbox', { name: 'Rule name' }).fill('Big score drop')
    const emailBox = drawer.getByLabel('Email', { exact: true })
    await emailBox.fill('ops@textbolt.com')
    await emailBox.press('Enter')
    await expect(drawer.getByRole('button', { name: 'Remove ops@textbolt.com' })).toBeVisible()
    await expect(drawer.getByTestId('rule-dry-summary')).toContainText(
      /Would (have|not have) fired/
    )
    await shots(page, 'alerts-dryrun')
    await drawer.getByTestId('rule-save').click()
    await expect(drawer).toHaveCount(0)
    await expect(grid.getByRole('row')).toHaveCount(4)
    await expect(grid).toContainText('Big score drop')

    // Duplicate from the row menu: a new rule copied from it.
    await chooseRowAction(page, grid, 'Big score drop', 'Duplicate rule')
    await expect(page).toHaveURL(/rule\.id=new&rule\.from=[^&]+/)
    drawer = page.getByRole('dialog', { name: 'Duplicate alert rule' })
    await expect(drawer.getByRole('textbox', { name: 'Rule name' })).toHaveValue(
      'Big score drop (copy)'
    )
    await drawer.getByTestId('rule-save').click()
    await expect(drawer).toHaveCount(0)
    await expect(grid.getByRole('row')).toHaveCount(5)

    // Pause one from its menu, then bulk delete two with a confirm.
    await chooseRowAction(page, grid, 'Big score drop (copy)', 'Pause rule')
    await expect(grid.getByRole('row', { name: /Big score drop \(copy\)/ })).toContainText('Paused')
    await grid.getByRole('checkbox', { name: /Select Big score drop$/ }).check()
    await grid.getByRole('checkbox', { name: /Select Big score drop \(copy\)/ }).check()
    await page.getByRole('button', { name: 'Delete 2' }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Delete 2 alert rules?' })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Delete rules' }).click()
    await expect(grid.getByRole('row')).toHaveCount(3)

    // What a rule sent: the Alert log, filtered to that rule on the URL.
    await chooseRowAction(page, grid, 'Money pages lose a citation', 'See what it sent')
    await expect(page).toHaveURL(/alerts\/log\?log\.f=[^&]+/)
    const log = page.getByRole('grid', { name: 'Alert log' })
    await expect(log).toContainText('Target page no longer cited on 1 question')
    await expect(log).toContainText('Desktop, 2 emails')
    await expect(page.getByRole('tab', { name: 'Alert log' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expectMainAccessible(page)
    await shots(page, 'alerts-log')
  } finally {
    await close()
  }
})

test('Notifications: every email address as a chip, a Slack test message, and the right columns', async () => {
  test.setTimeout(180_000)
  const { page, close } = await openSeeded()
  try {
    await openHash(page, '#/alerts/notifications')
    await expect(page.getByRole('tab', { name: 'Notifications' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    const emailSwitch = page.getByRole('switch', { name: 'Email a summary after each check' })
    await emailSwitch.click()
    const emailTo = page.getByRole('textbox', { name: 'Email to', exact: true })
    await emailTo.fill('ada@example.com, lin@example.com')
    await emailTo.press('Enter')
    const chips = page.getByTestId('n-email-chips')
    await expect(chips.getByRole('button', { name: 'Remove ada@example.com' })).toBeVisible()
    await expect(chips.getByRole('button', { name: 'Remove lin@example.com' })).toBeVisible()
    await expect(page.getByText('What you will get')).toBeVisible()
    await expect(page.getByTestId('reports-link')).toHaveText(
      'Scheduled report emails are in Reports.'
    )
    // Both addresses were saved: a reload shows them again.
    await page.reload()
    await expect(
      page.getByTestId('n-email-chips').getByRole('button', { name: 'Remove lin@example.com' })
    ).toBeVisible()
    await shots(page, 'alerts-notifications')

    // Slack: the test message goes to the offline transport and the result shows inline.
    await page.getByRole('switch', { name: 'Post to Slack' }).click()
    const hook = page.getByLabel('Slack webhook URL')
    await hook.fill('https://hooks.slack.com/services/T000/B000/fail')
    await page.getByTestId('slack-test').click()
    const result = page.getByTestId('slack-test-result')
    await expect(result).toContainText('404')
    await expect(result).not.toContainText('hooks.slack.com')
    await hook.fill('https://hooks.slack.com/services/T000/B000/abc123')
    await page.getByTestId('slack-test').click()
    await expect(result).toContainText('Posted to Slack')
    await shots(page, 'alerts-slack-test', result)
    // A test never saves the typed URL; clear it so leaving the field saves nothing either.
    await hook.fill('')

    // Re-check lives in Project settings › Schedule: the cadence on the left, the
    // next re-checks on the right. The old address still opens it.
    await openHash(page, '#/alerts/recheck')
    await expect(page).toHaveURL(/project-settings\?tab=schedule$/)
    await expect(page.getByRole('heading', { name: 'Next re-checks' })).toBeVisible()
    await shots(page, 'alerts-recheck')
  } finally {
    await close()
  }
})
