import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { leaveFirstRun } from './first-run-helpers'
import {
  expectFirstQuestions,
  expectTopicLanding,
  FIRST_TOPIC,
  MOCK_LANDING_TOPIC
} from './setup-walk'

/**
 * Onboarding v2 (Docs/onboarding-v2.mockup.html): nine steps, each at
 * `#/setup/<step>`, in the mock build. Steps 4, 5, 6 and 9 are section cards; these
 * specs only walk through them (their own specs test the cards).
 */

const SAMPLE_KEY = 'citefox-sample-serpapi-b1f4'

async function openOnboarding(options?: {
  scenario?: string
  pace?: string
  width?: number
  height?: number
}): Promise<{ app: ElectronApplication; page: Page; dir: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-onboarding-'))
  const viewport = { width: options?.width ?? 1280, height: options?.height ?? 820 }
  const seeded = await launchCiteFox({ userDataDir: dir, viewport })
  try {
    await expect(
      seeded.page.getByRole('heading', { level: 1, name: /See whether Google/ })
    ).toBeVisible()
    await seeded.page.evaluate(
      ({ scenario, pace }) => {
        localStorage.setItem('citefox.client', 'mock')
        if (scenario) localStorage.setItem('citefox.mock.scenario', scenario)
        if (pace) localStorage.setItem('citefox.mock.pace', pace)
      },
      { scenario: options?.scenario ?? '', pace: options?.pace ?? '' }
    )
  } finally {
    await seeded.app.close()
  }
  const { app, page } = await launchCiteFox({ userDataDir: dir, viewport })
  await expect(page.getByRole('heading', { level: 1, name: /See whether Google/ })).toBeVisible()
  return { app, page, dir }
}

function screen(page: Page): Locator {
  return page.locator('#main')
}

async function closeApp(app: ElectronApplication, dir: string): Promise<void> {
  await app.close()
  await rm(dir, { recursive: true, force: true })
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.documentElement
    return Math.max(root.scrollWidth, document.body.scrollWidth) - root.clientWidth
  })
}

async function heading(page: Page, name: string | RegExp): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

async function hash(page: Page): Promise<string> {
  return page.evaluate(() => window.location.hash.split('?')[0] ?? '')
}

async function expectStep(page: Page, step: string): Promise<void> {
  await expect.poll(() => hash(page)).toBe(`#/setup/${step}`)
}

/** The radio cards keep the input visually hidden; a person clicks the card. */
async function pickSerpApi(page: Page): Promise<void> {
  await page.locator('label.obs-way', { hasText: 'SerpApi' }).click()
  await expect(page.getByRole('radio', { name: /SerpApi/ })).toBeChecked()
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: await e2eArtifact(`${name}.png`), fullPage: true })
}

/** Step 1, filled and continued. */
async function fillSite(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Get started' }).click()
  await heading(page, 'Which website should AI answers cite?')
  await expectStep(page, 'site')
  await page.getByLabel(/Your website/).fill('textbolt.com')
  await page.getByLabel(/Where are your buyers/).selectOption('US')
  await page.getByLabel(/^Language/).selectOption('en')
  await page.getByLabel(/Your name/).fill('Rakesh')
  await page.getByRole('button', { name: 'Continue' }).click()
  await heading(page, 'Let your AI do the reading and writing')
  await expectStep(page, 'claude')
}

/** Steps 2 and 3: Claude is ready in the mock; the website read runs and moves on. */
async function readSite(page: Page, capture?: string): Promise<void> {
  await expect(screen(page).getByText('Claude Code is ready.')).toBeVisible()
  if (capture) await shot(page, `${capture}-2-claude`)
  await page.getByRole('button', { name: 'Continue' }).click()
  await heading(page, 'How should CiteFox learn about textbolt.com?')
  await expectStep(page, 'read')
  if (capture) await shot(page, `${capture}-3a-read-choose`)
  await page.getByRole('button', { name: 'Read my website' }).click()
  if (capture) {
    await heading(page, 'Reading textbolt.com…').catch(() => undefined)
    await shot(page, `${capture}-3b-read-working`)
  }
  // The read runs on its own and moves to step 4 when it is done.
  await expectStep(page, 'brand')
}

/** Steps 4 to 6 (B's cards): confirm what the read found; leaving 6 saves the profile. */
async function confirmFound(page: Page, capture?: string): Promise<void> {
  if (capture) await shot(page, `${capture}-4-brand`)
  await page.getByRole('button', { name: /continue/i }).click()
  await expectStep(page, 'buyers')
  if (capture) await shot(page, `${capture}-5-buyers`)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expectStep(page, 'competitors')
  if (capture) await shot(page, `${capture}-6-competitors`)
  await page.getByRole('button', { name: 'Continue' }).click()
  await heading(page, 'Which AI answers should CiteFox check?')
  await expectStep(page, 'engines')
}

test('happy path: nine steps, each with its URL, end on the first check', async () => {
  const { app, page, dir } = await openOnboarding({ width: 1440, height: 900 })
  try {
    await shot(page, 'onboarding-v2-1440-0-welcome')
    await fillSite(page)
    // Back and Forward step through the steps.
    await page.goBack()
    await heading(page, 'Which website should AI answers cite?')
    await expect(page.getByLabel(/Your website/)).toHaveValue('textbolt.com')
    await page.goForward()
    await heading(page, 'Let your AI do the reading and writing')
    await readSite(page, 'onboarding-v2-1440')
    await confirmFound(page, 'onboarding-v2-1440')

    await pickSerpApi(page)
    await expect(screen(page).getByText(/≈ \d+ searches a month/)).toBeVisible()
    await page.getByLabel('SerpApi API key').fill(SAMPLE_KEY)
    await shot(page, 'onboarding-v2-1440-7-engines')
    await page.getByRole('button', { name: 'Continue' }).click()
    // Step 8: how buyers ask. The mix of keywords, questions and prompts sets the first check.
    await heading(page, 'How do your buyers ask AI?')
    await expectStep(page, 'shapes')
    await expect(page.locator('.ui-wizard-note')).toContainText(/\d+ prompts? × 1 answer/)
    await shot(page, 'onboarding-v2-1440-8-shapes')
    await page.getByRole('button', { name: 'Write my prompts' }).click()
    await heading(page, 'Your first topic and what buyers ask AI')
    await expectStep(page, 'questions')
    // Claude writes the topic from steps 4–6, then the prompts to step 8's mix, with no
    // click on step 9. (The mock writes each part in 400 ms, so it may be done already.)
    await expectFirstQuestions(page)
    const topic = page.getByTestId('section-topic')
    await expect(topic).toContainText(FIRST_TOPIC)
    // Written as a redo, so no row is marked new.
    const questions = page.getByTestId('section-questions')
    await expect(questions.locator('.osc-item-new')).toHaveCount(0)
    // ✦ Write more still adds more.
    const rows = questions.getByRole('checkbox', { name: /^Keep / })
    const written = await rows.count()
    await questions.getByRole('button', { name: 'Write more', exact: true }).click()
    await expect.poll(() => rows.count()).toBeGreaterThan(written)
    await expect(questions.locator('.osc-item-new').first()).toBeVisible()
    await expect(page.locator('.ui-wizard-note')).toContainText(
      /First check: \d+ prompts? × 1 answer/
    )
    await shot(page, 'onboarding-v2-1440-9-questions')
    // The stepper goes back to a done step.
    const steps = page.getByRole('navigation', { name: 'Setup steps' })
    await steps.getByRole('button', { name: /Site/ }).click()
    await expectStep(page, 'site')
    await page.goBack()
    await expectStep(page, 'questions')
    await page.getByRole('button', { name: 'Finish and run the first check' }).click()
    // Finish opens the topic setup made, its first check started.
    await expectTopicLanding(page, MOCK_LANDING_TOPIC)
    await leaveFirstRun(page)
  } finally {
    await closeApp(app, dir)
  }
})

test('step 1 asks only the basics and Continue stays off until they are valid', async () => {
  const { app, page, dir } = await openOnboarding()
  try {
    await page.getByRole('button', { name: 'Get started' }).click()
    await heading(page, 'Which website should AI answers cite?')
    const go = page.getByRole('button', { name: 'Continue' })
    await expect(go).toBeDisabled()
    // The market starts on the United States and English, so only the website is missing.
    await expect(page.getByLabel(/Where are your buyers/)).toHaveValue('US')
    await expect(page.getByLabel(/^Language/)).toHaveValue('en')
    const domain = page.getByLabel(/Your website/)
    await domain.focus()
    await domain.blur()
    await expect(domain).toHaveAttribute('aria-invalid', 'true')
    await expect(domain).toHaveAttribute('aria-describedby', 's1-domain-error')
    await domain.fill('textbolt')
    await expect(go).toBeDisabled()
    await domain.fill('textbolt.com/pricing?x=1')
    await expect(go).toBeEnabled()
    // The name is optional.
    await expect(page.getByLabel(/Your name/)).toHaveValue('')
    // The United Kingdom is offered once, as GB.
    const country = page.getByLabel(/Where are your buyers/)
    await expect(country.locator('option', { hasText: 'United Kingdom' })).toHaveCount(1)
    // A later step cannot be opened before the earlier ones are done: the URL falls
    // back to the furthest open step (Claude is optional, so that is Read).
    await page.evaluate(() => {
      window.location.hash = '#/setup/engines'
    })
    await expectStep(page, 'read')
    // The redirect replaced the typed URL, so one Back returns to step 1.
    await page.goBack()
    await expectStep(page, 'site')
    await page.getByLabel(/Your website/).fill('')
    await page.evaluate(() => {
      window.location.hash = '#/setup/claude'
    })
    await expectStep(page, 'site')
  } finally {
    await closeApp(app, dir)
  }
})

test('"Skip and use your own ChatGPT" leads to one prompt and a pasted answer', async () => {
  const { app, page, dir } = await openOnboarding()
  try {
    await fillSite(page)
    await page.getByRole('button', { name: 'Skip and use your own ChatGPT instead' }).click()
    await heading(page, 'How should CiteFox learn about textbolt.com?')
    await expect(page.getByRole('radio', { name: /Use my own ChatGPT/ })).toBeChecked()
    await page.getByRole('button', { name: 'Get the prompt' }).click()
    await heading(page, 'Ask your own ChatGPT about textbolt.com')
    await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('paste=1')
    await expect(screen(page).getByText(/AI-search tracking for textbolt\.com/)).toBeVisible()
    await page.getByLabel('Paste its answer below').fill('### PRODUCTS\nname,url,job')
    await page.getByRole('button', { name: 'Read the answer' }).click()
    await expectStep(page, 'brand')
    await expect(screen(page)).toContainText('Email-to-SMS gateway')
  } finally {
    await closeApp(app, dir)
  }
})

test('a rejected SerpApi key at step 7 says why, leaves the field and keeps the user there', async () => {
  const { app, page, dir } = await openOnboarding({ scenario: 'serpapi-fail' })
  try {
    await fillSite(page)
    await readSite(page)
    await confirmFound(page)
    await pickSerpApi(page)
    const secret = 'shortkey'
    await page.getByLabel('SerpApi API key').fill(secret)
    await page.getByRole('button', { name: 'Test key' }).click()
    await expect(page.locator('#s7-key-message')).toContainText('SerpApi rejected this key')
    // The tested key leaves the field; Continue stays off until a key works.
    await expect(page.getByLabel('SerpApi API key')).toHaveValue('')
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await expectStep(page, 'engines')
    // The secret is never shown as text.
    expect(await page.locator('body').innerText()).not.toContain(secret)
  } finally {
    await closeApp(app, dir)
  }
})

test('Claude checkup announces progress and a logged-out failure', async () => {
  const { app, page, dir } = await openOnboarding({ scenario: 'checkup-logged-out', pace: '160' })
  try {
    await fillSite(page)
    const live = page.locator('.setup-live')
    await expect.poll(async () => live.getAttribute('data-announcements')).toContain('Checking')
    await expect(screen(page).getByText('Not logged in')).toBeVisible()
    await expect(screen(page).getByText('Log in from your terminal.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled()
    await expect(live).toHaveAttribute('data-announcements', /Claude Code installed: Checking/)
  } finally {
    await closeApp(app, dir)
  }
})

test('an API-key Claude login is labelled API key only', async () => {
  const { app, page, dir } = await openOnboarding({ scenario: 'checkup-api-key' })
  try {
    await fillSite(page)
    await expect(screen(page).getByText('API key only', { exact: true })).toBeVisible()
    await expect(screen(page).getByText('Claude Code is ready.')).toHaveCount(0)
    await expect(screen(page).getByText('Model · Default (Sonnet)')).toBeVisible()
  } finally {
    await closeApp(app, dir)
  }
})

test('a failed Claude round trip shows the engine message', async () => {
  const { app, page, dir } = await openOnboarding({ scenario: 'checkup-fail', pace: '40' })
  try {
    await fillSite(page)
    await expect(screen(page).getByText('The test call did not get a reply.').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Check again' })).toBeEnabled()
  } finally {
    await closeApp(app, dir)
  }
})

test('keyboard only gets through steps 1 to 3', async () => {
  const { app, page, dir } = await openOnboarding()
  try {
    await page.getByRole('button', { name: 'Get started' }).focus()
    await page.keyboard.press('Enter')
    await heading(page, 'Which website should AI answers cite?')
    await page.locator('#s1-domain').focus()
    await page.keyboard.type('textbolt.com')
    await page.keyboard.press('Tab')
    await expect(page.locator('#s1-country')).toBeFocused()
    await page.locator('#s1-country').selectOption('US')
    await page.keyboard.press('Tab')
    await expect(page.locator('#s1-language')).toBeFocused()
    await page.locator('#s1-language').selectOption('en')
    await page.locator('#s1-name').focus()
    // Enter in a field submits the step.
    await page.keyboard.press('Enter')
    await heading(page, 'Let your AI do the reading and writing')
    await expect(screen(page).getByText('Claude Code is ready.')).toBeVisible()
    await page.getByRole('button', { name: 'Continue' }).focus()
    await page.keyboard.press('Enter')
    await heading(page, 'How should CiteFox learn about textbolt.com?')
    await page.getByRole('radio', { name: /Read my website/ }).focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('radio', { name: /I’ll type it myself/ })).toBeChecked()
    await page.getByRole('button', { name: 'Continue with empty steps' }).focus()
    await page.keyboard.press('Enter')
    await expectStep(page, 'brand')
  } finally {
    await closeApp(app, dir)
  }
})

for (const size of [
  { width: 1134, height: 800 },
  { width: 1024, height: 700 }
]) {
  test(`onboarding fits ${size.width} by ${size.height} without horizontal overflow`, async () => {
    const { app, page, dir } = await openOnboarding(size)
    const name = `onboarding-v2-${size.width}`
    try {
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1)
      await fillSite(page)
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1)
      await readSite(page, name)
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1)
      await confirmFound(page)
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1)
      await shot(page, `${name}-7-engines`)
      // The footer stays in view at the bottom of the window.
      const footer = await page.locator('.ui-wizard-foot').boundingBox()
      expect(Math.round((footer?.y ?? 0) + (footer?.height ?? 0))).toBeLessThanOrEqual(size.height)
    } finally {
      await closeApp(app, dir)
    }
  })
}
