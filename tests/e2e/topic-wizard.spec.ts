import AxeBuilder from '@axe-core/playwright'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { openAdd, openAllPages } from './nav-helpers'

/**
 * The Add wizard (Docs/TOPICS-SPEC.md §3) in the e2e stub (mock client):
 * the seed path end to end with a restart in the middle, then My own
 * questions and A competitor's page. Each screen is saved as a PNG named
 * after its Mockups/v2/preview counterpart, and checked with axe.
 */

const VIEWPORT = { width: 1440, height: 900 }

async function launch(dir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const { app, page } = await launchCiteFox({ userDataDir: dir, viewport: VIEWPORT })
  await openAllPages(page)
  return { app, page }
}

async function launchMock(): Promise<{ app: ElectronApplication; page: Page; dir: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-topic-wizard-'))
  const seeded = await launchCiteFox({ userDataDir: dir, viewport: VIEWPORT })
  try {
    await seeded.page.evaluate(() => {
      localStorage.setItem('citefox.client', 'mock')
      localStorage.setItem('citefox.mock.catalog', 'textbolt')
      localStorage.setItem('citefox.mock.pace', '0')
      localStorage.removeItem('citefox.mock.topicDrafts')
    })
  } finally {
    await seeded.app.close()
  }
  const { app, page } = await launch(dir)
  return { app, page, dir }
}

async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include('#main')
    .setLegacyMode()
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations).toEqual([])
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(150)
  await page.screenshot({ path: await e2eArtifact(`topic-wizard-${name}.png`) })
}

function heading(page: Page, name: string): ReturnType<Page['getByRole']> {
  return page.getByRole('heading', { level: 1, name })
}

function primary(page: Page): ReturnType<Page['locator']> {
  return page.locator('.ui-wizard-foot .ui-btn-primary')
}

async function pick(page: Page, menu: string | RegExp, item: string | RegExp): Promise<void> {
  await page.getByRole('button', { name: menu }).click()
  await page.getByRole('menuitem', { name: item }).click()
}

async function openChooser(page: Page): Promise<void> {
  await openAdd(page, 'Topic')
  await expect(heading(page, 'What do you want to track?')).toBeVisible()
}

test('seed path: chooser to Start, surviving a restart', async () => {
  test.setTimeout(240_000)
  const started = await launchMock()
  const dir = started.dir
  let { app, page } = started
  try {
    await openChooser(page)
    // Claude is not checked yet, so CiteFox asks before it runs Claude for a suggestion.
    await expect(page.getByText('Suggested start')).toBeVisible()
    await page.getByRole('button', { name: 'Check the AI and suggest' }).click()
    await expect(page.getByRole('button', { name: 'Use this start' })).toBeVisible()
    await expectAccessible(page)
    await shot(page, 'Main')

    await page.getByRole('button', { name: 'Use this start' }).click()
    await expect(heading(page, 'Start from a problem')).toBeVisible()
    await pick(page, 'AI actions for your business', /Discover from website/)
    await expect(page.getByRole('button', { name: 'Use as seed' })).toBeVisible()
    await expectAccessible(page)
    await shot(page, 'Seed-Input')

    await primary(page).click()
    await expect(heading(page, 'Buyer profile')).toBeVisible()
    await page.getByRole('button', { name: 'Fill gaps' }).click()
    await expect(page.getByRole('heading', { name: 'Fill gaps from your site' })).toBeVisible()
    await expectAccessible(page)
    await shot(page, 'Seed-Profile')

    await primary(page).click()
    await expect(heading(page, 'Buyer journey questions')).toBeVisible()
    await pick(page, 'AI actions for questions', /Find gaps in the journey/)
    await expect(page.getByText(/overlapping pairs/)).toBeVisible()
    const hash = await page.evaluate(() => window.location.hash)
    expect(hash).toMatch(/^#\/add\/draft-/)
    await page.waitForTimeout(700)

    // Restart: the draft reopens at the same step.
    await app.close()
    ;({ app, page } = await launch(dir))
    await page.evaluate((next) => {
      window.location.hash = next
    }, hash)
    await expect(heading(page, 'Buyer journey questions')).toBeVisible()
    await pick(page, 'AI actions for questions', /Find gaps in the journey/)
    await expect(page.getByText(/overlapping pairs/)).toBeVisible()
    await expectAccessible(page)
    await shot(page, 'Seed-Questions')

    await primary(page).click()
    await expect(heading(page, 'Keywords and groups')).toBeVisible()
    await expect(page.getByRole('grid', { name: 'Keywords' })).toBeVisible()
    await expectAccessible(page)
    await shot(page, 'Keywords-Groups')
    await page.getByRole('tab', { name: /Depth settings/ }).click()
    await expect(page.getByRole('group', { name: 'How deep' })).toBeVisible()
    await shot(page, 'Keywords-Depth')

    await primary(page).click()
    await expect(heading(page, 'Which page answers each question')).toBeVisible()
    await pick(page, 'AI actions for target pages', /Draft a brief for/)
    const writer = page.getByRole('link', { name: /Write with 1000AIOverviews/ })
    await expect(writer).toHaveAttribute('href', 'https://1000aioverviews.com')
    await expectAccessible(page)
    await shot(page, 'Seed-Pages')

    await primary(page).click()
    await expect(heading(page, 'Estimate and start')).toBeVisible()
    await expect(
      page.getByRole('radio', { name: /CiteFox AI's plan: likeliest wins first/ })
    ).toBeChecked()
    await expect(page.getByText('Over budget')).toBeVisible()
    await expectAccessible(page)
    await shot(page, 'Seed-Estimate')

    await expect(primary(page)).toHaveText(/Start: \d+ likeliest today/)
    await primary(page).click()
    await expect
      .poll(() => page.evaluate(() => window.location.hash))
      .toMatch(/^#\/topics\/topic-draft-/)
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('my own questions: paste and CSV, clean up with Claude, match pages', async () => {
  test.setTimeout(180_000)
  const { app, page, dir } = await launchMock()
  try {
    await openChooser(page)
    await page.getByRole('radio', { name: /My own questions/ }).check()
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(heading(page, 'Add your own questions')).toBeVisible()
    await page
      .getByLabel('One question per line')
      .fill(
        [
          'How do I text staff from Outlook?',
          "Alerts don't reach whoever is on call at night",
          'sms alerts',
          'Do we need 10DLC registration just to text our own employees?',
          'do we need 10DLC registration just to text our own employees',
          'Is TextBolt cheaper than SimpleTexting for 30 staff?',
          'Can replies come back to my inbox?'
        ].join('\n')
      )
    await page.getByLabel('CSV file', { exact: true }).setInputFiles({
      name: 'sales-and-support-questions.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'question,channel,notes\n"Server alerts sit unread over the weekend",Support,\n"Will carriers block 50 identical texts?",Support,\n"How fast can we switch off vtext.com?",Sales call,\n'
      )
    })
    await expect(page.getByLabel('Question column')).toHaveValue('0')
    await expectAccessible(page)
    await shot(page, 'Questions-Add')

    await primary(page).click()
    await expect(page.getByRole('grid', { name: 'Imported questions' })).toBeVisible()
    await expect(page.getByText(/duplicates merged/)).toBeVisible()
    await pick(page, 'AI actions for imported questions', /Clean up and tag/)
    await page.getByRole('button', { name: 'Apply changes' }).click()
    await expect(page.getByText(/lines cleaned/)).toBeVisible()
    await expectAccessible(page)
    await shot(page, 'Questions-Import')

    await primary(page).click()
    await expect(heading(page, 'Which page answers each question')).toBeVisible()
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test("a competitor's page: read once, questions from their page, match my pages", async () => {
  test.setTimeout(180_000)
  const { app, page, dir } = await launchMock()
  try {
    await openChooser(page)
    await page.getByRole('radio', { name: /A competitor's page/ }).check()
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(heading(page, "Track a competitor's page")).toBeVisible()
    await page
      .getByLabel('Their page URL')
      .fill('https://www.simpletexting.com/sms-alerts-for-business/')
    await page.getByRole('button', { name: 'Read their page' }).click()
    await expect(
      page.getByText('Business SMS alerts: send urgent texts to staff and customers')
    ).toBeVisible()
    await expectAccessible(page)
    await shot(page, 'Competitor-Read')

    await primary(page).click()
    await expect(page.getByRole('grid', { name: 'Questions from their page' })).toBeVisible()
    await expect(page.getByRole('heading', { name: "5 claims you don't make" })).toBeVisible()
    await expectAccessible(page)
    await shot(page, 'Competitor-Page')

    await primary(page).click()
    await expect(heading(page, 'Which page answers each question')).toBeVisible()
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('A page URL opens the existing Add page flow', async () => {
  const { app, page, dir } = await launchMock()
  try {
    await openChooser(page)
    await page.getByRole('radio', { name: /A page URL/ }).check()
    await page.getByRole('button', { name: 'Open Add a page' }).click()
    await expect(heading(page, 'Add a page to track')).toBeVisible()
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
