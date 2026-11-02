import { expect, test, type Page } from '@playwright/test'
import Database from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { sidebar } from './nav-helpers'

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: await e2eArtifact(`${name}.png`), fullPage: false })
}

test('scheduled reports shows the live empty catalog', async () => {
  test.setTimeout(180_000)
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-schedules-'))
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

  const { app, page } = await launchCiteFox({ userDataDir: dir, viewport })
  try {
    await expect(page.getByRole('heading', { level: 1, name: 'Summary' })).toBeVisible()
    await sidebar(page).getByRole('link', { name: 'Reports', exact: true }).click()
    const screen = page.locator('.rpt')
    await expect(screen.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible()
    await expect(screen.getByText("Scheduled reports aren't available yet.")).toHaveCount(0)
    await expect(screen.getByText('Try again after the next update.')).toHaveCount(0)
    await expect(screen.getByText('No schedules yet.')).toBeVisible()
    await expect(screen.getByText(/match this filter|match “/)).toHaveCount(0)
    await expect(screen.getByRole('button', { name: 'Clear search' })).toHaveCount(0)
    await shot(page, 'scheduled-reports-production')
    await screen.getByRole('tab', { name: /^Delivery history/ }).click()
    await expect(screen.getByText('No deliveries yet.')).toBeVisible()

    // The form opens in the side panel, with the email preview under it.
    await screen.getByRole('button', { name: 'New schedule' }).first().click()
    const form = page.getByRole('dialog', { name: 'New schedule' })
    await expect(form.getByLabel('Name')).toBeFocused()
    await expect(form.getByRole('heading', { level: 3, name: 'Email preview' })).toHaveCount(1)
    await expect(form.getByText('No markets yet.')).toBeVisible()
    await expect(form.getByLabel('Send from')).toHaveValue('')
    for (const mock of ['TextBolt', 'Acme', 'FieldPro', 'you@textbolt.com']) {
      await expect(screen.getByText(mock)).toHaveCount(0)
    }
    await expect(screen.getByText(/Error invoking remote method/)).toHaveCount(0)
    await expect(screen.getByText(/Not implemented/)).toHaveCount(0)
    await shot(page, 'scheduled-reports-form')
    await expect(form.getByRole('button', { name: 'Save schedule' })).toBeVisible()
    await form.getByLabel('Subject line').scrollIntoViewIfNeeded()
    await expect(form.getByLabel('Report format')).toBeVisible()
    await expect(form.getByLabel('Subject line')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(form).toHaveCount(0)
    await expect(screen.getByRole('button', { name: 'New schedule' }).first()).toBeFocused()
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
