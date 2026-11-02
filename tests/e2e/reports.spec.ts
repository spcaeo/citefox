import { expect, test, type Page } from '@playwright/test'
import Database from 'better-sqlite3'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { REPORT_SECTION_COPY } from '../../src/shared/report-copy'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: await e2eArtifact(`${name}.png`), fullPage: false })
}

test('export reads the real project and the real export handlers', async () => {
  test.setTimeout(180_000)
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-reports-'))
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
      window.location.hash = '#/export'
    })
    const screen = page.locator('.xpt')
    await expect(screen.getByRole('heading', { level: 1, name: 'Export a report' })).toBeVisible()
    await expect(screen.getByRole('link', { name: 'Harbor' })).toBeVisible()
    await expect(screen.getByText('No pages yet.').first()).toBeVisible()
    // The only market shows in What to include and again in the summary.
    await expect(screen.getByText(/CA · EN/).first()).toBeVisible()
    await expect(screen.getByText(REPORT_SECTION_COPY.content_gaps.description)).toBeVisible()
    await expect(screen.getByRole('group', { name: 'What to export' })).toBeVisible()
    await expect(screen.getByRole('radiogroup', { name: 'Data window' })).toBeVisible()
    await expect(screen.getByText(/Saved views?/)).toHaveCount(0)
    await expect(screen.getByText(/AI Mode/)).toHaveCount(0)
    // FR-22.6: the automatic-export card is real. A folder comes only from main's dialog.
    const auto = screen.locator('section[aria-labelledby="auto-h"]')
    await expect(auto.getByRole('heading', { name: 'Send it automatically' })).toBeVisible()
    await expect(auto.getByText('No folder chosen yet')).toBeVisible()
    const toggle = auto.getByRole('switch', { name: 'Export after every scheduled check' })
    await toggle.click()
    await expect(auto.getByText(/Choose a folder for automatic exports first\./)).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(screen.getByRole('radio', { name: 'Email', exact: true })).toHaveCount(0)
    const exportsFolder = path.join(dir, 'auto-exports')
    await mkdir(exportsFolder)
    await app.evaluate(({ dialog }, folder: string) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [folder]
      })) as unknown as typeof dialog.showOpenDialog
    }, exportsFolder)
    await auto.getByRole('button', { name: 'Choose folder' }).click()
    await expect(auto.getByText(exportsFolder)).toBeVisible()
    // This project has no pages yet, so a page export can't be repeated; the whole project can.
    await toggle.click()
    await expect(
      auto.getByText(/These export settings can't be repeated automatically\./)
    ).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    // The scope chips hide their radio under the label: check it through the label.
    await screen.getByRole('radio', { name: /Whole project/ }).check({ force: true })
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(auto.getByLabel('Filename pattern')).toBeVisible()
    await expect(auto.getByText(/Saved: HTML · \d+ sections/)).toBeVisible()
    await shot(page, 'export-auto-on')
    // Stored in the project file: leaving and reopening Export shows the same state.
    await page.evaluate(() => {
      window.location.hash = '#/reports'
    })
    await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible()
    await page.evaluate(() => {
      window.location.hash = '#/export'
    })
    await expect(auto.getByText(exportsFolder)).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(screen.getByText("Automatic exports aren't available yet.")).toHaveCount(0)
    await expect(screen.getByText('Try again after the next update.')).toHaveCount(0)
    await expect(screen.getByText('Text alerts for business')).toHaveCount(0)
    await expect(screen.getByText('Money pages')).toHaveCount(0)
    await expect(screen.getByText(/Austin/)).toHaveCount(0)
    await expect(screen.getByText(/UK · EN/)).toHaveCount(0)
    await expect(screen.getByText(/MX · ES/)).toHaveCount(0)
    await expect(screen.getByText(/Error invoking remote method/)).toHaveCount(0)
    await expect(screen.getByText(/Not implemented/)).toHaveCount(0)
    await expect(screen.getByText('About 2 MB · 14 pages')).toHaveCount(0)
    await expect(screen.getByText(/from the Oct 19 analysis/)).toHaveCount(0)

    // The scope chips hide their radio under the label: check it through the label.
    await screen.getByRole('radio', { name: /Whole project/ }).check({ force: true })
    await expect(screen.getByRole('checkbox', { name: /^Content gaps/ })).toBeDisabled()
    await screen.getByRole('radio', { name: /Excel/ }).click()
    await expect(screen.getByText('0 checks')).toBeVisible()
    await expect(
      screen.getByRole('button', {
        name: /^Save (HTML report|PDF|Excel workbook|CSV tables|JSON)$/
      })
    ).toBeEnabled()
    await shot(page, 'export-production')
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
