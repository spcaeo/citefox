import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import Database from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { openAdd } from './nav-helpers'

const VIEWPORT = { width: 1280, height: 900 }

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => {
    document.querySelector('#main')?.scrollTo(0, 0)
  })
  await page.screenshot({
    path: await e2eArtifact(`${name}.png`),
    fullPage: false
  })
}

async function expectMainAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include('#main')
    .setLegacyMode()
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations).toEqual([])
}

test('running and results mount through the shell on real IPC', async () => {
  test.setTimeout(180_000)
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-running-'))
  const seeded = await launchCiteFox({ userDataDir: dir, viewport: VIEWPORT })
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

  const { app, page } = await launchCiteFox({ userDataDir: dir, viewport: VIEWPORT })
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
    // Create opens the new project's start screen (an empty project's landing comes back
    // here too), so go on to the Projects screen in the app.
    await expect(
      page.getByRole('heading', { level: 1, name: 'How do you want to start?' })
    ).toBeVisible()
    await page.evaluate(() => {
      window.location.hash = '#/projects'
    })
    await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible()

    await openAdd(page, 'Topic')
    await expect(
      page.getByRole('heading', { level: 1, name: 'What do you want to track?' })
    ).toBeVisible()
    await page.getByRole('radio', { name: /A page URL/ }).check()
    await page.getByRole('button', { name: 'Open Add a page' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Add a page to track' })).toBeVisible()
    await page.getByLabel('Page URL').fill('https://harbor.example/alerts')
    await page.getByRole('button', { name: 'Add page' }).click()
    // Owner feedback 5: the page sets itself up; this launch keeps the runner off,
    // so the tab shows the setup panel waiting, with Start setup and no manual steps.
    await expect(page).toHaveURL(/\/prompts$/)
    const setup = page.getByRole('region', { name: 'Setting up this page' })
    await expect(setup).toBeVisible()
    await expect(setup.getByRole('button', { name: 'Start setup' })).toBeVisible()
    await page.getByRole('tab', { name: 'Results', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Setting up this page' })).toBeVisible()
    await expect(page.getByText(/harbor\.example\/alerts/).first()).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Results', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(page.getByText('Checking 10 prompts in 4 markets')).toHaveCount(0)
    await expect(page.getByText('Timed out once, retried')).toHaveCount(0)
    await expect(page.getByText('Text alerts for business')).toHaveCount(0)
    await expect(page.getByText(/Error invoking remote method/)).toHaveCount(0)
    await expect(page.getByText('Not available yet.')).toHaveCount(0)
    await expectMainAccessible(page)
    await page.getByRole('tab', { name: 'Results', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('tab', { name: 'Progress', exact: true })).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByRole('tab', { name: 'Results', exact: true })).toBeFocused()
    await shot(page, 'results-mounted')

    await page.getByRole('link', { name: 'Check now' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'First check' })).toBeVisible()
    await expect(page.getByText('No check is running.')).toBeVisible()
    await expect(page.getByText(/1 market/)).toBeVisible()
    await expect(page.getByText(/1 sample per question/)).toBeVisible()
    await expect(page.getByRole('link', { name: 'First check' })).toHaveAttribute(
      'aria-current',
      'step'
    )
    await expect(page.getByRole('button', { name: 'Cancel check' })).toHaveCount(0)
    await expect(page.getByText('Checking 10 prompts in 4 markets')).toHaveCount(0)
    await expect(page.getByText('Timed out once, retried')).toHaveCount(0)
    await expect(page.getByText(/Error invoking remote method/)).toHaveCount(0)
    const start = page.getByRole('button', { name: 'Start first check' })
    await expect(start).toBeVisible()
    await expect(start).toBeEnabled()
    await start.focus()
    await expect(start).toBeFocused()
    await expectMainAccessible(page)
    await shot(page, 'running-idle')
    await start.click()
    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible()
    await expect(alert).not.toHaveText(/Error invoking remote method/)
    await expect(alert).toHaveText(/.+/)
    await expect(start).toBeEnabled()
    await expect(start).toBeFocused()
    await shot(page, 'running-mounted')
    // View results so far sits under the header's ⋯.
    await page.locator('.m3-run-head').getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: 'View results so far' }).click()
    // Back on Results: the page has never been checked, so it shows its setup.
    await expect(page.getByRole('region', { name: 'Setting up this page' })).toBeVisible()
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
