import { expect, test, type Page } from '@playwright/test'
import { e2eArtifact } from './artifacts'
import { launchJourneyApp, onboardTextBolt, TEXTBOLT_PROMPTS, TEXTBOLT_URL } from './journey-app'
import { expectMainAccessible } from './screens-app'
import { leaveFirstRun } from './first-run-helpers'

/**
 * Owner feedback 5: adding a page sets it up by itself. The background runner
 * reads the page (Jina fixture), writes the buyer profile, the buyer prompts and
 * the content gaps (Claude shim, slowed so the live steps are visible), and the
 * page lands on a review screen with one primary, Start first check. No search
 * is made for the page until that click (onboarding's own first check is done before). Screenshots of every page tab land in test-results.
 */

const TABS = [
  'results',
  'progress',
  'markets',
  'sentiment',
  'communities',
  'gaps',
  'prompts',
  'audience',
  'history'
] as const

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.querySelector('#main')?.scrollTo(0, 0))
  await page.waitForTimeout(250)
  await page.screenshot({ path: await e2eArtifact(`${name}.png`) })
}

async function openTab(page: Page, pageId: string, tab: string): Promise<void> {
  await page.evaluate((hash) => {
    window.location.hash = hash
  }, `#/pages/${pageId}/${tab}`)
  await expect(page.getByText(/^Loading/)).toHaveCount(0, { timeout: 20_000 })
}

test('a new page sets itself up, then waits on one primary: Start first check', async () => {
  test.setTimeout(300_000)
  const journey = await launchJourneyApp('auto-setup', { setupRunner: true, shimDelayMs: 2500 })
  const { page } = journey
  // Onboarding's own first check (one question) is done before the page is added.
  let onboardingSearches = 0
  try {
    await test.step('onboarding, then Add page with one click', async () => {
      await onboardTextBolt(page)
      onboardingSearches = await journey.searches()
      await leaveFirstRun(page)
      await expect(page.getByRole('list', { name: 'Setup steps' })).toHaveCount(0)
      await page.getByLabel('Page URL').fill(TEXTBOLT_URL)
      await shot(page, 'auto-setup-add-page')
      await page.getByRole('button', { name: 'Add page' }).click()
      await expect(page).toHaveURL(/#\/pages\/[^/]+\/prompts$/)
    })

    const pageId = await page.evaluate(() => window.location.hash.split('/')[2] ?? '')
    expect(pageId).not.toBe('')

    await test.step('the setup runs by itself with live steps, no button to press', async () => {
      const panel = page.getByRole('region', { name: 'Setting up this page' })
      await expect(panel).toBeVisible()
      await expect(
        panel.getByRole('list', { name: 'Setup steps' }).getByRole('listitem')
      ).toHaveCount(5)
      await expect(panel.getByRole('button', { name: 'Stop' })).toBeVisible()
      await expect(page.getByRole('button', { name: /Generate/ })).toHaveCount(0)
      await expect(page.getByText(/before the prompts/)).toHaveCount(0)
      // A step in flight, with what Claude is doing right now.
      await expect(panel.locator('[aria-current="step"]')).toBeVisible({ timeout: 30_000 })
      await expect(panel.getByRole('region', { name: 'What CiteFox AI is doing' })).toBeVisible({
        timeout: 30_000
      })
      await shot(page, 'auto-setup-running-prompts')
      await expectMainAccessible(page)
      await openTab(page, pageId, 'results')
      await expect(page.getByRole('region', { name: 'Setting up this page' })).toBeVisible()
      await shot(page, 'auto-setup-running-results')
      expect(await journey.searches()).toBe(onboardingSearches)
      await openTab(page, pageId, 'prompts')
    })

    await test.step('review: the generated prompts, the profile rail, one primary', async () => {
      const grid = page.getByRole('grid', { name: 'Buyer questions' })
      await expect(grid).toBeVisible({ timeout: 90_000 })
      await expect(grid.locator('.ui-lg-row')).toHaveCount(10)
      await expect(grid.getByText(TEXTBOLT_PROMPTS[0] ?? '')).toBeVisible()
      await expect(page.getByRole('region', { name: 'About these questions' })).toContainText(
        'Written for'
      )
      const start = page.getByRole('button', { name: /^Start first check · ≈10–20 searches$/ })
      await expect(start).toBeVisible()
      await expect(page.locator('#main .ui-btn-primary, #main .btn-primary')).toHaveCount(1)
      await expect(page.getByText('Save prompt count')).toHaveCount(0)
      expect(await journey.searches()).toBe(onboardingSearches)
      await shot(page, 'auto-setup-review-prompts')
      await expectMainAccessible(page)

      await page.getByRole('button', { name: 'Question settings' }).click()
      await expect(page).toHaveURL(/drawer=pt-settings/)
      const settings = page.getByRole('dialog', { name: 'Question settings' })
      await expect(settings.getByLabel('Buyer questions to write')).toHaveValue('10')
      await shot(page, 'auto-setup-prompt-settings')
      await settings.getByRole('button', { name: 'Close Question settings' }).click()
      await expect(settings).toHaveCount(0)

      await grid
        .getByRole('button', { name: /^Actions for question / })
        .first()
        .click()
      await expect(page.getByRole('menuitem', { name: 'Rephrase like a buyer' })).toBeVisible()
      await shot(page, 'auto-setup-row-menu')
      await page.keyboard.press('Escape')
    })

    await test.step('every page tab in the review state', async () => {
      for (const tab of TABS) {
        await openTab(page, pageId, tab)
        await expect(page.getByRole('region', { name: 'Setting up this page' })).toHaveCount(0)
        await shot(page, `auto-setup-tab-${tab}`)
      }
      await openTab(page, pageId, 'gaps')
      await expect(page.getByRole('button', { name: 'Content gaps settings' })).toBeVisible()
      await openTab(page, pageId, 'audience')
      await expect(page.getByRole('grid', { name: 'Buyer profile points' })).toBeVisible()
      expect(await journey.searches()).toBe(onboardingSearches)
    })

    await test.step('Start first check runs the check: the first searches', async () => {
      await openTab(page, pageId, 'results')
      await expect(page.getByRole('heading', { name: 'Set up and ready to review' })).toBeVisible()
      await page.getByRole('button', { name: /^Start first check · / }).click()
      await expect(page).toHaveURL(/\/running$/)
      await expect(page.getByRole('progressbar', { name: 'Questions checked' })).toBeVisible({
        timeout: 60_000
      })
      await shot(page, 'auto-setup-first-check-running')
      await expect(page.getByRole('heading', { level: 1, name: 'Check finished' })).toBeVisible({
        timeout: 180_000
      })
      expect(await journey.searches()).toBeGreaterThan(onboardingSearches)
      await shot(page, 'auto-setup-first-check-finished')
    })
  } finally {
    await journey.close()
  }
})
