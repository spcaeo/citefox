import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { launchJourneyApp } from './journey-app'
import { expectFirstQuestions, expectTopicLanding, FIRST_TOPIC } from './setup-walk'

/**
 * Onboarding v2 end to end on the real engine (Docs/onboarding-v2.mockup.html): Claude is
 * the shim on PATH and answers every section from `src/main/assist/fixtures/setup.*.json`,
 * Jina answers from its fixture, and cloro answers from `src/main/providers/fixtures/cloro`
 * inside the main process. Nothing reaches the network.
 *
 * The walk: site (no name) → Claude → read → brand (edit a row, + Add, Find more) →
 * buyers (Redo with words) → competitors (Edit the prompt, Run again) → engines (cloro) →
 * how buyers ask (the mix) → questions (the topic, then its prompts) → finish, which opens
 * the new topic and runs its first check.
 */

const ROOT = process.cwd()
const CLORO_FIXTURES = path.join(ROOT, 'src/main/providers/fixtures/cloro')
const CLORO_KEY = 'cloro-fixture-key-textbolt'

interface CloroCalls {
  credits: number
  monitor: string[]
}

/** Answers cloro from the recorded fixtures; counts the calls. */
async function installCloroFetch(app: ElectronApplication): Promise<void> {
  const google = readFileSync(path.join(CLORO_FIXTURES, 'google-overview.json'), 'utf8')
  const chatgpt = readFileSync(path.join(CLORO_FIXTURES, 'chatgpt.json'), 'utf8')
  await app.evaluate(
    (_electron, bodies: { google: string; chatgpt: string }) => {
      const store = globalThis as unknown as { __cloroCalls?: CloroCalls }
      store.__cloroCalls = { credits: 0, monitor: [] }
      const previous = globalThis.fetch.bind(globalThis)
      const respond = (status: number, body: string): Response =>
        new Response(body, { status, headers: { 'content-type': 'application/json' } })
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (!url.startsWith('https://api.cloro.dev/')) return previous(input, init)
        const calls = store.__cloroCalls ?? { credits: 0, monitor: [] }
        if (url.endsWith('/v1/credits')) {
          calls.credits += 1
          return respond(200, JSON.stringify({ remaining: 4800, perCycle: 5000 }))
        }
        const engine = url.split('/v1/monitor/')[1] ?? ''
        calls.monitor.push(engine)
        if (engine === 'google') return respond(200, bodies.google)
        if (engine === 'chatgpt') return respond(200, bodies.chatgpt)
        return respond(500, JSON.stringify({ success: false, error: 'no cloro fixture' }))
      }
    },
    { google, chatgpt }
  )
}

async function cloroCalls(app: ElectronApplication): Promise<CloroCalls> {
  return app.evaluate(() => {
    const store = globalThis as unknown as { __cloroCalls?: CloroCalls }
    return store.__cloroCalls ?? { credits: 0, monitor: [] }
  })
}

async function heading(page: Page, name: string | RegExp): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

async function expectStep(page: Page, step: string): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.location.hash.split('?')[0] ?? ''))
    .toBe(`#/setup/${step}`)
}

function card(page: Page, section: string): Locator {
  return page.getByTestId(`section-${section}`)
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: await e2eArtifact(`${name}.png`), fullPage: true })
}

test('the whole setup on the real engine: every step, its section actions, cloro and the first check', async () => {
  test.setTimeout(360_000)
  // Step 8's own writing is slowed, so its status lines stay up long enough to see.
  const journey = await launchJourneyApp('onboarding-v2', {
    shimSlow: 'Assist: setup.topic=2500;Assist: setup.questions=2500'
  })
  const { app, page } = journey
  try {
    await installCloroFetch(app)
    await page.setViewportSize({ width: 1440, height: 900 })

    // 1. Site: the name is optional and stays empty.
    await heading(page, /See whether Google/)
    await page.getByRole('button', { name: 'Get started' }).click()
    await page.getByLabel(/Your website/).fill('textbolt.com')
    await page.getByLabel(/Where are your buyers/).selectOption('US')
    await page.getByLabel(/^Language/).selectOption('en')
    await expect(page.getByLabel(/Your name/)).toHaveValue('')
    await page.getByRole('button', { name: 'Continue' }).click()

    // 2. Claude: the shim is logged in.
    await heading(page, 'Let your AI do the reading and writing')
    await expect(page.locator('#main').getByText('Claude Code is ready.')).toBeVisible({
      timeout: 45_000
    })
    await page.getByRole('button', { name: 'Continue' }).click()

    // 3. Read: the website read, then buyers and triggers; it moves on by itself.
    await heading(page, 'How should CiteFox learn about textbolt.com?')
    await page.getByRole('button', { name: 'Read my website' }).click()
    await heading(page, 'Reading textbolt.com…')
    await expect(page.getByRole('note')).toContainText('This runs on its own')
    await expectStep(page, 'brand')
    await heading(page, /^Is this right about /)

    // 4. Brand: edit a product, add one, and ✦ Find more.
    const products = card(page, 'products')
    const firstProduct = products.locator('.osc-items > li').first()
    await expect(firstProduct).toBeVisible()
    await products
      .getByRole('button', { name: /^Edit / })
      .first()
      .click()
    await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('edit=')
    const editor = products.getByTestId('section-row-edit')
    await editor.getByLabel('Product name').fill('Email to SMS for alerts')
    await editor.getByRole('button', { name: 'Save' }).click()
    await expect(products).toContainText('Email to SMS for alerts')
    await products.getByLabel('Add a product').fill('Two-way texting')
    await products.getByLabel('Add a product').press('Enter')
    await expect(products).toContainText('Two-way texting')
    await products.getByRole('button', { name: /Find more/ }).click()
    await expect(products).toContainText('SMS API', { timeout: 30_000 })
    await expect(products).toContainText('Shared team inbox')
    // Find more keeps the user's own rows.
    await expect(products).toContainText('Email to SMS for alerts')
    await expect(products).toContainText('Two-way texting')
    await shot(page, 'onboarding-v2-journey-4-brand')
    await page.getByRole('button', { name: 'Looks right, continue' }).click()

    // 5. Buyers: ✦ Redo this section with the user's words.
    await expectStep(page, 'buyers')
    const buyers = card(page, 'buyers')
    await buyers.getByRole('button', { name: 'AI actions for Buyers' }).click()
    await buyers.getByTestId('menu-redo').click()
    await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('open=buyers.redo')
    const redo = buyers.getByTestId('redo-box')
    await redo.getByRole('textbox').fill('Only small businesses in the US')
    await redo.getByRole('button', { name: /Redo buyers/ }).click()
    await expect(redo).toBeHidden({ timeout: 30_000 })
    await expect(buyers).toContainText('IT managers at small businesses')
    await page.getByRole('button', { name: 'Continue' }).click()

    // 6. Competitors: ✎ Edit the prompt, then ✦ Run again.
    await expectStep(page, 'competitors')
    const competitors = card(page, 'competitors')
    await competitors.getByRole('button', { name: 'AI actions for Competitors' }).click()
    await competitors.getByTestId('menu-prompt').click()
    const prompt = competitors.getByTestId('prompt-editor')
    const box = prompt.getByRole('textbox')
    await expect(box).not.toHaveValue('')
    await box.fill(`${await box.inputValue()}\nOnly self-serve tools for small teams.`)
    await prompt.getByRole('button', { name: /Run again/ }).click()
    await expect(prompt).toBeHidden({ timeout: 30_000 })
    await expect(competitors).toContainText('Notifyre')
    await expect(competitors).toContainText('txtimpact.com')
    await shot(page, 'onboarding-v2-journey-6-competitors')
    // Leaving step 6 saves the profile, with no name.
    await page.getByRole('button', { name: 'Continue' }).click()

    // 7. Engines: cloro, tested before it is saved.
    await heading(page, 'Which AI answers should CiteFox check?')
    await expect(page.getByRole('radio', { name: /cloro/ })).toBeChecked()
    await page.getByLabel('cloro API key').fill(CLORO_KEY)
    // New setups: Google AI Overview only, every 7 days. ChatGPT is ticked here by hand.
    await expect(page.getByRole('checkbox', { name: /^Google AI Overview/ })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: /^ChatGPT/ })).not.toBeChecked()
    await expect(page.getByLabel('Checks run')).toHaveValue('7')
    await expect(page.locator('#main')).toContainText(/1 answer every 7 days ≈ \d+ credits a month/)
    await page.getByRole('checkbox', { name: /^ChatGPT/ }).check()
    await expect(page.locator('#main')).toContainText(
      /2 answers every 7 days ≈ \d+ credits a month/
    )
    await page.getByRole('button', { name: 'Continue' }).click()

    // 8. How buyers ask: Claude starts on the topic and prompts as the step opens.
    await heading(page, 'How do your buyers ask AI?')
    await expectStep(page, 'shapes')
    // The key was tested (cloro's free credits call) before it was saved.
    expect((await cloroCalls(app)).credits).toBeGreaterThanOrEqual(1)
    // The secret never shows as text.
    expect(await page.locator('body').innerText()).not.toContain(CLORO_KEY)
    await shot(page, 'onboarding-v2-journey-8-shapes')
    await page.getByRole('button', { name: 'Write my prompts' }).click()

    // 9. The topic, then its prompts to step 8's mix, with no click here.
    await heading(page, 'Your first topic and what buyers ask AI')
    const writing = page.locator('#main .osc-running .ui-busy-label')
    await expectFirstQuestions(page)
    await expect(writing).toHaveCount(0)
    await expect(card(page, 'topic')).toContainText(FIRST_TOPIC)
    const questions = card(page, 'questions')
    await expect(questions).toContainText('How do we keep texting staff phones?')
    // Written as a redo: no row is marked new.
    await expect(questions.locator('.osc-item-new')).toHaveCount(0)
    await expect(page.locator('.ui-wizard-note')).toContainText(
      /First check: \d+ prompts? × 2 answers/
    )
    await shot(page, 'onboarding-v2-journey-9-questions')
    await page.getByRole('button', { name: 'Finish and run the first check' }).click()

    // The app opens on the new topic and its first check asks cloro for both engines.
    await expectTopicLanding(page, FIRST_TOPIC)
    await expect
      .poll(async () => new Set((await cloroCalls(app)).monitor).size, { timeout: 120_000 })
      .toBe(2)
    expect([...new Set((await cloroCalls(app)).monitor)].sort()).toEqual(['chatgpt', 'google'])
  } finally {
    await journey.close()
  }
})
