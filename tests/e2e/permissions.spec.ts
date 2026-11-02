import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { leaveFirstRun } from './first-run-helpers'
import { launchOnboardedMock } from './onboarded'
import { expectSetupStep } from './setup-walk'

/**
 * Owner feedback #2: Claude's connection is shown wherever AI runs, it is checked
 * before the first AI step, and one list says everything CiteFox needs. Onboarding
 * v2 checks Claude on step 2, before step 3 reads the site; Settings › What CiteFox
 * needs keeps the list. Runs on the mock build (no Claude, no keychain, no OS job).
 */

const viewport = { width: 1280, height: 860 }

async function openOnboarding(
  scenario = '',
  pace = '250'
): Promise<{ app: ElectronApplication; page: Page; dir: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-permissions-'))
  const seeded = await launchCiteFox({ userDataDir: dir, viewport })
  try {
    await expect(
      seeded.page.getByRole('heading', { level: 1, name: /See whether Google/ })
    ).toBeVisible()
    await seeded.page.evaluate(
      ({ scenario, pace }) => {
        localStorage.setItem('citefox.client', 'mock')
        if (scenario) localStorage.setItem('citefox.mock.scenario', scenario)
        localStorage.setItem('citefox.mock.pace', pace)
      },
      { scenario, pace }
    )
  } finally {
    await seeded.app.close()
  }
  const { app, page } = await launchCiteFox({ userDataDir: dir, viewport })
  await expect(page.getByRole('heading', { level: 1, name: /See whether Google/ })).toBeVisible()
  return { app, page, dir }
}

async function closeApp(app: ElectronApplication, dir: string): Promise<void> {
  await app.close()
  await rm(dir, { recursive: true, force: true })
}

/** A viewport shot: the setup steps have a sticky footer that a full-page shot would overlap. */
async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  await page.screenshot({ path: await e2eArtifact(`${name}.png`), fullPage })
}

/** Step 1 filled; Continue opens step 2, which checks Claude. */
async function startSetup(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Get started' }).click()
  await page.getByLabel(/Your website/).fill('textbolt.com')
  await page.getByLabel(/Where are your buyers/).selectOption('US')
  await page.getByLabel(/^Language/).selectOption('en')
  await page.getByLabel(/Your name/).fill('Rakesh')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Let your AI do the reading and writing' })
  ).toBeVisible()
}

test('Claude is checked on step 2, before step 3 reads the website', async () => {
  const { app, page, dir } = await openOnboarding('', '400')
  try {
    await startSetup(page)
    // The checkup starts by itself and says what it is doing.
    const live = page.locator('.setup-live')
    await expect.poll(async () => live.getAttribute('data-announcements')).toContain('Checking')
    await shot(page, 'permissions-claude-checking')
    await expect(page.locator('#main').getByText('Claude Code is ready.')).toBeVisible({
      timeout: 15_000
    })
    await shot(page, 'permissions-claude-connected')
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step 3 names the connection the read runs on, then the read runs.
    await expectSetupStep(page, 'read')
    const read = page.getByRole('radio', { name: /Read my website/ })
    await expect(read).toBeChecked()
    await expect(read).toBeEnabled()
    await expect(page.locator('label.obs-way', { hasText: 'Read my website' })).toContainText(
      'on your AI plan'
    )
    await page.getByRole('button', { name: 'Read my website' }).click()
    await expectSetupStep(page, 'brand')
  } finally {
    await closeApp(app, dir)
  }
})

test('Claude not available: step 2 explains, step 3 offers your own ChatGPT, Back returns', async () => {
  const { app, page, dir } = await openOnboarding('checkup-missing', '100')
  try {
    await startSetup(page)
    await expect(page.locator('#main')).toContainText('Not found on PATH', { timeout: 15_000 })
    await shot(page, 'permissions-claude-missing')

    await page.getByRole('button', { name: 'Skip and use your own ChatGPT instead' }).click()
    await expectSetupStep(page, 'read')
    // The read cannot run without Claude: it says why and the ChatGPT way is picked.
    await expect(page.getByRole('radio', { name: /Read my website/ })).toBeDisabled()
    await expect(page.locator('label.obs-way', { hasText: 'Read my website' })).toContainText(
      'Claude is not set up. Use your own ChatGPT instead (free).'
    )
    await expect(page.getByRole('radio', { name: /Use my own ChatGPT/ })).toBeChecked()
    await shot(page, 'permissions-read-no-claude')

    // Back to step 2 to set Claude up; step 1 still holds the site.
    await page.getByRole('button', { name: 'Back' }).click()
    await expectSetupStep(page, 'claude')
    await expect(page.getByRole('button', { name: 'Check again' })).toBeVisible()
    await page.getByRole('button', { name: 'Back' }).click()
    await expectSetupStep(page, 'site')
    await expect(page.getByLabel(/Your website/)).toHaveValue('textbolt.com')
  } finally {
    await closeApp(app, dir)
  }
})

test('Settings lists what CiteFox needs with live states, and turns a step on', async () => {
  const { app, page, dir } = await launchOnboardedMock('permissions', { viewport })
  try {
    await leaveFirstRun(page)
    await expect(page.locator('.status-pill')).toHaveAttribute('aria-label', /CiteFox AI connected/)

    await page.evaluate(() => {
      window.location.hash = '#/permissions/notifications'
    })
    await expect(page.getByRole('heading', { level: 1, name: 'What CiteFox needs' })).toBeVisible()
    const grid = page.getByRole('grid', { name: 'What CiteFox needs' })
    await expect(grid).toBeVisible()
    // Onboarding left Claude and the SerpApi key working; notifications are still off.
    await expect(grid.getByRole('row', { name: /^Claude/ }).first()).toContainText('Ready')
    await expect(grid.getByRole('row', { name: /^SerpApi/ }).first()).toContainText('Ready')
    const notifications = grid.getByRole('row', { name: /^Notifications/ })
    await expect(notifications).toContainText('Off')

    // The row's ⋯ menu turns it on, after saying what the system will show.
    await notifications.getByRole('button', { name: 'Actions for Notifications' }).click()
    await page.getByRole('menuitem', { name: 'Turn on' }).click()
    await expect(page.getByText(/would like to send you notifications/).first()).toBeVisible()
    await shot(page, 'permissions-settings-confirm')
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(notifications).toContainText('Ready')

    await page.evaluate(() => {
      window.location.hash = '#/permissions/background'
    })
    await expect(page.getByRole('heading', { level: 2, name: 'Background checks' })).toBeVisible()
    await expect(page.getByText(/LaunchAgent \(app\.citefox\.checkdue\)/).first()).toBeVisible()
    await shot(page, 'permissions-settings', true)
  } finally {
    await closeApp(app, dir)
  }
})
