import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Walks onboarding v2 (Docs/onboarding-v2.mockup.html) through the real screens:
 * Site → AI → Read → Brand → Buyers → Competitors → Engines → Ask → Questions, each at
 * `#/setup/<step>`. With the production shell, Claude is the e2e stand-in
 * (`tests/e2e/claude-shim.mjs`, answering from `src/main/assist/fixtures/`), the site
 * read needs `CITEFOX_E2E_TOPICS=1`, and the SerpApi key test needs the account fixture
 * on `fetch`. The mock build (`citefox.client=mock`) walks the same screens.
 */

/**
 * The topic written when step 8 ("How do your buyers ask AI?") opens: the shim's `setup.topic.json` and the mock's
 * MOCK_TEXT.topic hold the same line.
 */
export const FIRST_TOPIC = 'Replacing a shut-down email-to-text gateway'

/**
 * The topic page the mock build's Finish opens: the mock has fixed topics, so it lands on
 * the carrier-gateway one (MOCK_CARRIER_TOPIC_ID), not on a topic named as written.
 */
export const MOCK_LANDING_TOPIC = 'Carrier gateway replacement'

export type SetupWalkStep =
  | 'welcome'
  | 'site'
  | 'claude'
  | 'read'
  | 'reading'
  | 'brand'
  | 'buyers'
  | 'competitors'
  | 'engines'
  | 'shapes'
  | 'questions'

export interface SetupWalkOptions {
  domain?: string
  userName?: string
  country?: string
  language?: string
  /** The SerpApi key typed and tested on step 7. */
  serpKey: string
  /** Competitor domains kept on step 6: ticked when the read found them, else typed in. */
  competitors?: readonly string[]
  /** Untick every other competitor, so only `competitors` are saved. */
  onlyThoseCompetitors?: boolean
  /** Prompts kept on step 9 (the rest are unticked). Unset keeps every prompt. */
  keepQuestions?: number
  /** Runs on each screen before it is left: screenshots, axe. */
  onStep?: (step: SetupWalkStep) => Promise<void>
  /** How long the Claude checkup may take (the shim can be slowed). */
  claudeTimeout?: number
  /** How long "Read my website" may take before step 4 opens. */
  readTimeout?: number
}

function main(page: Page): Locator {
  return page.locator('#main')
}

async function hash(page: Page): Promise<string> {
  return page.evaluate(() => window.location.hash.split('?')[0] ?? '')
}

export async function expectSetupStep(page: Page, step: string, timeout?: number): Promise<void> {
  await expect
    .poll(() => hash(page), timeout === undefined ? {} : { timeout })
    .toBe(`#/setup/${step}`)
}

function section(page: Page, id: string): Locator {
  return page.getByTestId(`section-${id}`)
}

/** Unticks rows from the end of a list card until `count` are kept (rows may move as they change). */
async function keepOnly(list: Locator, count: number): Promise<void> {
  const kept = list.getByRole('checkbox', { name: /^Keep /, checked: true })
  for (let left = await kept.count(); left > count; left -= 1) {
    await kept.last().uncheck()
    await expect(kept).toHaveCount(left - 1)
  }
}

/** Keeps the `wanted` competitor domains (typing in the ones the read missed). */
async function chooseCompetitors(
  list: Locator,
  wanted: readonly string[],
  only: boolean
): Promise<void> {
  for (const domain of wanted) {
    const row = list.locator('li', { hasText: domain })
    if ((await row.count()) === 0) {
      const add = list.getByLabel('Add a competitor')
      await add.fill(domain)
      await add.press('Enter')
    }
    await row.getByRole('checkbox', { name: /^Keep / }).check()
  }
  if (!only) return
  const labels = await list
    .getByRole('checkbox', { name: /^Keep / })
    .evaluateAll((boxes) => boxes.map((box) => box.getAttribute('aria-label') ?? ''))
  for (const label of labels) {
    const box = list.getByRole('checkbox', { name: label, exact: true })
    const row = list.locator('li', {
      has: list.page().getByRole('checkbox', { name: label, exact: true })
    })
    const text = await row.innerText()
    if (!wanted.some((domain) => text.includes(domain))) await box.uncheck()
  }
}

/** Step 1, filled and continued to step 2. */
export async function setupSite(page: Page, options: SetupWalkOptions): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: /See whether Google/ })).toBeVisible()
  await options.onStep?.('welcome')
  await page.getByRole('button', { name: 'Get started' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Which website should AI answers cite?' })
  ).toBeVisible()
  await expectSetupStep(page, 'site')
  await page.getByLabel(/Your website/).fill(options.domain ?? 'textbolt.com')
  await page.getByLabel(/Where are your buyers/).selectOption(options.country ?? 'US')
  await page.getByLabel(/^Language/).selectOption(options.language ?? 'en')
  await page.getByLabel(/Your name/).fill(options.userName ?? 'Rakesh')
  await options.onStep?.('site')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Let your AI do the reading and writing' })
  ).toBeVisible()
  await expectSetupStep(page, 'claude')
}

/** Steps 2 and 3: the Claude checkup passes, then "Read my website" runs and moves on. */
export async function setupRead(page: Page, options: SetupWalkOptions): Promise<void> {
  const domain = options.domain ?? 'textbolt.com'
  await expect(main(page).getByText('Claude Code is ready.')).toBeVisible({
    timeout: options.claudeTimeout ?? 45_000
  })
  await options.onStep?.('claude')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: `How should CiteFox learn about ${domain}?` })
  ).toBeVisible()
  await expectSetupStep(page, 'read')
  await options.onStep?.('read')
  await page.getByRole('button', { name: 'Read my website' }).click()
  if (options.onStep) {
    const working = page.getByRole('heading', { level: 1, name: `Reading ${domain}…` })
    if (await working.isVisible().catch(() => false)) await options.onStep('reading')
  }
  // The read runs on its own and opens step 4 when it is done.
  await expectSetupStep(page, 'brand', options.readTimeout ?? 120_000)
}

/** Steps 4 to 6: confirm what the read found; leaving step 6 saves the profile. */
export async function setupConfirm(page: Page, options: SetupWalkOptions): Promise<void> {
  await expect(
    section(page, 'brands')
      .getByRole('button', { name: /^Remove / })
      .first()
  ).toBeVisible()
  await options.onStep?.('brand')
  await page.getByRole('button', { name: 'Looks right, continue' }).click()
  await expectSetupStep(page, 'buyers')
  await expect(section(page, 'buyers').getByRole('checkbox').first()).toBeVisible()
  await options.onStep?.('buyers')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expectSetupStep(page, 'competitors')
  await chooseCompetitors(
    section(page, 'competitors'),
    options.competitors ?? [],
    options.onlyThoseCompetitors ?? false
  )
  await options.onStep?.('competitors')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Which AI answers should CiteFox check?' })
  ).toBeVisible()
  await expectSetupStep(page, 'engines')
}

/** Step 7: SerpApi (Google AI Overviews), its key tested, then saved. */
export async function setupEngines(page: Page, options: SetupWalkOptions): Promise<void> {
  // The radio cards keep the input visually hidden; a person clicks the card.
  await page.locator('label.obs-way', { hasText: 'SerpApi' }).click()
  await expect(page.getByRole('radio', { name: /SerpApi/ })).toBeChecked()
  await page.getByLabel('SerpApi API key').fill(options.serpKey)
  await page.getByRole('button', { name: 'Test key' }).click()
  await expect(page.locator('#s7-key-message')).toContainText('Key works')
  await options.onStep?.('engines')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'How do your buyers ask AI?' })
  ).toBeVisible()
  await expectSetupStep(page, 'shapes')
}

/**
 * Step 8, "How do your buyers ask AI?": keeps the suggested mix of keywords, questions
 * and prompts. Claude starts writing the topic and prompts as the step opens.
 */
export async function setupShapes(page: Page, options: SetupWalkOptions): Promise<void> {
  await options.onStep?.('shapes')
  await page.getByRole('button', { name: 'Write my prompts' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your first topic and what buyers ask AI' })
  ).toBeVisible()
  await expectSetupStep(page, 'questions')
}

/**
 * Step 9's topic and prompts, written by usePromptWriter from step 8 on (the topic from
 * steps 4–6, then the prompts to step 8's mix). Waits until both are in and the footer
 * shows the first check again.
 */
export async function expectFirstQuestions(page: Page, timeout = 45_000): Promise<void> {
  await expect(section(page, 'topic').getByRole('button', { name: 'Write one' })).toHaveCount(0, {
    timeout
  })
  await expect(
    section(page, 'questions')
      .getByRole('checkbox', { name: /^Keep / })
      .first()
  ).toBeVisible({ timeout })
  await expect(page.locator('.ui-wizard-note')).not.toContainText('Claude is writing', { timeout })
}

/**
 * Step 9: the topic and the prompts Claude wrote, then "Finish and run the first check".
 */
export async function setupQuestions(page: Page, options: SetupWalkOptions): Promise<void> {
  await expectFirstQuestions(page)
  const questions = section(page, 'questions')
  if (options.keepQuestions !== undefined) await keepOnly(questions, options.keepQuestions)
  await expect(page.locator('.ui-wizard-note')).toContainText(/First check: \d+ prompts? × /)
  await options.onStep?.('questions')
  await page.getByRole('button', { name: 'Finish and run the first check' }).click()
}

/**
 * Where Finish lands when setup made a topic: that topic's page
 * (`#/p/<project>/topics/<id>`, or `#/topics/<id>` once the project is open), its name as
 * the heading, with its first check started.
 */
export async function expectTopicLanding(
  page: Page,
  topic: string,
  timeout = 30_000
): Promise<void> {
  await expect.poll(() => hash(page), { timeout }).toMatch(/^#\/(p\/[^/]+\/)?topics\/[^/?]+$/)
  await expect(page.getByRole('heading', { level: 1, name: topic })).toBeVisible({ timeout })
}

/** The whole walk, from the welcome screen to Finish. */
export async function walkSetup(page: Page, options: SetupWalkOptions): Promise<void> {
  await setupSite(page, options)
  await setupRead(page, options)
  await setupConfirm(page, options)
  await setupEngines(page, options)
  await setupShapes(page, options)
  await setupQuestions(page, options)
}
