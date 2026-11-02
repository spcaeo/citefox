import { expect, test, type Page } from '@playwright/test'
import Database from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { keychainItemExists } from './keychain'
import { launchCiteFox } from './launch'
import { chooseRowAction } from './row-menu'

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: await e2eArtifact(`${name}.png`), fullPage: false })
}

test('schedule and alerts settings, including the unencrypted SMTP warning', async () => {
  test.setTimeout(180_000)
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-alerts-'))
  const viewport = { width: 1280, height: 900 }
  const seeded = await launchCiteFox({ userDataDir: dir, viewport })
  try {
    await expect(
      seeded.page.getByRole('heading', { level: 1, name: /See whether Google/ })
    ).toBeVisible()
  } finally {
    await seeded.app.close()
  }
  const db = new Database(path.join(dir, 'app.sqlite'))
  db.prepare('UPDATE app_state SET onboarding_finished = 1 WHERE id = 1').run()
  db.close()

  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport
  })
  try {
    await expect(page.getByRole('heading', { level: 1, name: 'Summary' })).toBeVisible()
    await page.getByRole('button', { name: /Switch project, No project/ }).click()
    await page
      .getByRole('group', { name: 'Projects' })
      .getByRole('link', { name: 'New project' })
      .click()
    await expect(page.getByRole('heading', { level: 1, name: 'New project' })).toBeVisible()
    await page.getByLabel('Project name').fill('Harbor')
    await page.getByLabel('Website domain').fill('harbor.example')
    await page.getByLabel('Brand names').fill('Harbor')
    await page.getByLabel('Default market').selectOption('CA-en')
    await page.getByRole('button', { name: 'Create project' }).click()
    await expect(page.getByText('Harbor is ready.')).toBeVisible()

    await page.evaluate(() => {
      window.location.hash = '#/alerts'
    })
    const screen = page.locator('.alerts')
    await expect(
      screen.getByRole('heading', { level: 1, name: 'Alerts & schedules' })
    ).toBeVisible()
    await expect(screen.getByRole('tab', { name: 'Alert rules' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    // Alerts keeps only its own three tabs; each other setting has one home.
    await expect(
      screen.getByRole('tablist', { name: 'Alerts sections' }).getByRole('tab')
    ).toHaveText(['Alert rules', 'Notifications', 'Alert log'])
    await screen.getByRole('tab', { name: 'Notifications' }).click()
    await expect(
      screen.getByRole('switch', { name: 'Email a summary after each check' })
    ).toBeVisible()
    await shot(page, 'alerts-notifications')

    // An old Check timing link opens App settings › General.
    await page.evaluate(() => {
      window.location.hash = '#/alerts?tab=schedule'
    })
    await expect(page).toHaveURL(/#\/settings\?tab=general$/)
    const settings = page.locator('.stg-page')
    await expect(page.getByRole('heading', { level: 1, name: 'App settings' })).toBeVisible()
    await expect(settings.getByRole('tab', { name: 'General' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(
      settings.getByRole('switch', { name: 'Start CiteFox at login and keep it in the tray' })
    ).toBeChecked()
    await shot(page, 'alerts-schedule-tab')

    // An old Re-check link opens Project settings › Schedule.
    await page.evaluate(() => {
      window.location.hash = '#/alerts/recheck'
    })
    await expect(page).toHaveURL(/#\/project-settings\?tab=schedule$/)
    const recheck = page.locator('.ps')
    await expect(recheck.getByRole('tab', { name: 'Schedule' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(recheck.getByRole('group', { name: 'Re-check every page' })).toBeVisible()
    await recheck.getByRole('radio', { name: /Every 30 days/ }).click()
    await expect(recheck.getByRole('radio', { name: /Every 30 days/ })).toBeChecked()
    await expect(recheck.getByLabel('Quiet hours from')).toBeVisible()
    await expect(recheck.getByText(/Error invoking remote method/)).toHaveCount(0)
    await expect(recheck.getByText(/Not implemented/)).toHaveCount(0)
    await shot(page, 'alerts-schedule')
    // Drill-downs: the open project's name in the cadence note opens its settings.
    await expect(
      recheck.getByRole('link', { name: 'Open Harbor Project settings › Schedule' })
    ).toHaveAttribute('href', '#/project-settings')

    // An old Email accounts link opens App settings › Email accounts.
    await page.evaluate(() => {
      window.location.hash = '#/alerts/email'
    })
    await expect(page).toHaveURL(/#\/settings\?tab=email$/)
    await expect(settings.getByRole('tab', { name: 'Email', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(settings.getByRole('radio', { name: /Send through SMTP/ })).toBeChecked()
    await settings.getByRole('button', { name: /Other SMTP/ }).click()
    const security = settings.getByLabel('Security')
    await security.scrollIntoViewIfNeeded()
    await security.selectOption('none')
    const warning = settings.getByText(
      'Not recommended: mail and the password are sent unencrypted.'
    )
    await expect(warning).toBeVisible()
    await expect(security).toHaveAttribute('aria-describedby', 'e-sec-warn')
    await expect(settings.getByLabel('Password', { exact: true })).toHaveAttribute(
      'type',
      'password'
    )
    await shot(page, 'alerts-smtp-none-warning')

    await settings.getByLabel('SMTP host').fill('smtp.example.com')
    await settings.getByLabel('From address').fill('reports@example.com')
    await settings.getByLabel('Username').fill('reports@example.com')
    await settings.getByLabel('Password', { exact: true }).fill('placeholder-not-a-secret')
    await settings.getByRole('button', { name: 'Save account' }).click()
    const actions = settings.getByRole('button', { name: 'Actions for reports@example.com' })
    await expect(actions).toBeVisible()
    expect(keychainItemExists(dir, readSmtpKeychainRef(dir))).toBe(true)
    // The last-test badge opens the account at its test, with the last result.
    await settings.getByRole('button', { name: /Last test of reports@example\.com/ }).click()
    await expect(settings.getByLabel('Send a test email to')).toBeFocused()
    await expect(settings.locator('#e-last-test')).toContainText('Not tested yet')
    await shot(page, 'alerts-email')
    await chooseRowAction(page, settings, 'reports@example.com', 'Remove SMTP account')
    const dialog = page.getByRole('alertdialog', { name: 'Remove this sending account?' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveClass('ui-confirm')
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await expect(dialog).not.toContainText('placeholder-not-a-secret')
    await shot(page, 'alerts-remove-account-dialog')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

/** The saved SMTP password's keychain item, read from the account row (the app keeps it open in WAL mode). */
function readSmtpKeychainRef(dir: string): string {
  const db = new Database(path.join(dir, 'app.sqlite'), { readonly: true, fileMustExist: true })
  try {
    const row = db
      .prepare<[], { keychain_ref: string }>('SELECT keychain_ref FROM email_accounts LIMIT 1')
      .get()
    if (row === undefined) throw new Error('No SMTP account row after Save account')
    return row.keychain_ref
  } finally {
    db.close()
  }
}
