import AxeBuilder from '@axe-core/playwright'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifactsDir } from './artifacts'
import { launchCiteFox } from './launch'
import { onboardThroughBridge } from './onboarded'

/**
 * Owner feedback #1: "Fill from my website" shows what Claude is doing while it runs,
 * through the real `projects:fillFromWebsite` handler and the `assist:progress` push.
 * Onboarding v2's step 3 has its own read view, so this runs on New project (the same
 * read and the same live panel), after an onboarding done through the real handlers
 * for another site (tests/e2e/onboarded.ts). CITEFOX_E2E_TOPICS=1 serves fixed
 * TextBolt pages (each read slowed a little) and stubs the competitor DNS
 * check; the `claude` stand-in answers the three focused calls (batch 2 row 5) from
 * src/main/assist/fixtures/project.fillSiteRead.json, project.fillSwitching.json and
 * project.productCompetitors.json after a short delay. Nothing leaves the machine and no
 * search runs (the stand-in ignores the web-search flags).
 */

const ROOT = process.cwd()
const SHIM = path.join(ROOT, 'tests/e2e/claude-shim.mjs')
const FIXTURE_DIR = path.join(ROOT, 'src/main/providers/fixtures/textbolt')
const ACCOUNT_FIXTURE = path.join(ROOT, 'src/main/providers/fixtures/serpapi/account-ok.json')
const SCREENSHOTS = path.join(e2eArtifactsDir(), 'screenshots', 'assist-progress')

async function expectAccessible(page: Page, selector: string): Promise<void> {
  // A row still sliding in is part transparent; check colours once finite animations ended.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined))
    )
  )
  const results = await new AxeBuilder({ page })
    .include(selector)
    .setLegacyMode()
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations).toEqual([])
}

/** The SerpApi key test during the seeded onboarding reads the recorded account. */
async function stubSerpApiAccount(app: ElectronApplication): Promise<void> {
  const account = readFileSync(ACCOUNT_FIXTURE, 'utf8')
  await app.evaluate((_electron, text) => {
    const { body } = JSON.parse(text) as { body: unknown }
    const original = globalThis.fetch.bind(globalThis)
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith('https://serpapi.com/account')) {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      return original(input, init)
    }
  }, account)
}

function step(panel: Locator, label: string | RegExp): Locator {
  return panel.locator('.ui-progress-step').filter({ hasText: label })
}

test('Fill from my website shows each real step live, then folds into the result', async () => {
  test.setTimeout(180_000)
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-assist-progress-'))
  const bin = path.join(dir, 'bin')
  await mkdir(bin, { recursive: true })
  const claude = path.join(bin, 'claude')
  await writeFile(claude, `#!/bin/sh\nexec node ${JSON.stringify(SHIM)} "$@"\n`)
  await chmod(claude, 0o755)
  await mkdir(SCREENSHOTS, { recursive: true })

  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 860 },
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      CITEFOX_FIXTURE_DIR: FIXTURE_DIR,
      CITEFOX_SHIM_LOG: path.join(dir, 'claude-shim.log'),
      CITEFOX_E2E_TOPICS: '1',
      CITEFOX_E2E_READ_DELAY_MS: '900',
      CITEFOX_SHIM_DELAY_MS: '5000'
    }
  })

  try {
    await stubSerpApiAccount(app)
    await onboardThroughBridge(page, {
      profile: { projectName: 'Harbor Text', domain: 'harbortext.example', brandNames: ['Harbor'] }
    })
    await page.evaluate(() => {
      window.location.hash = '#/projects/new'
    })
    const form = page.getByRole('form', { name: 'New project' })
    await form.getByLabel('Project name').fill('TextBolt')
    await form.getByLabel('Website domain').fill('textbolt.com')
    await form.getByTestId('su').getByRole('button', { name: 'Read my website' }).click()

    const panel = page.getByRole('region', { name: 'What CiteFox AI is doing' })
    await test.step('page reads appear one by one, each with how it was read', async () => {
      await expect(panel).toBeVisible()
      await expect(panel.getByText('Reading your website')).toBeVisible()
      await expect(step(panel, 'Reading textbolt.com')).toHaveAttribute('data-state', 'done', {
        timeout: 15_000
      })
      await expect(step(panel, 'Reading textbolt.com')).toContainText(/Read · \d+ words/)
      await expect(step(panel, 'Reading /pricing')).toBeVisible()
    })

    await test.step('the Claude call runs with a timer and the connection line', async () => {
      const asking = step(panel, 'Asking CiteFox AI to read what your site sells and its brand names')
      await expect(asking).toHaveAttribute('data-state', 'running', { timeout: 20_000 })
      await expect(step(panel, 'Reading /compare')).toHaveAttribute('data-state', 'skipped')
      await expect(step(panel, 'Reading /compare')).toContainText('Not found or not readable')
      await expect(asking).toContainText('Using 3 of 4 pages · no searches')
      await expect(panel).toContainText('CiteFox AI · on your plan')
      // Let the timer tick so the screenshot shows real elapsed seconds.
      await expect(asking.locator('.ui-progress-secs')).toHaveText(/^[2-9] s$/, { timeout: 10_000 })
      await expectAccessible(page, '.ui-progress')
      await page.screenshot({ path: path.join(SCREENSHOTS, 'fill-progress-running.png') })
    })

    await test.step('then one web search per product, with its own timer', async () => {
      const search = step(panel, 'Searching the web for competitors · Email-to-SMS gateway')
      await expect(search).toHaveAttribute('data-state', 'running', { timeout: 30_000 })
      await expect(search).toContainText('For buyers in United States (English)')
      await expect(search.locator('.ui-progress-secs')).toHaveText(/^[1-9] s$/, { timeout: 10_000 })
      await page.screenshot({ path: path.join(SCREENSHOTS, 'fill-progress-search.png') })
    })

    await test.step('when done the steps fold above the suggestions', async () => {
      const card = page.getByRole('region', { name: 'Suggestions from the website' })
      await expect(card).toBeVisible({ timeout: 30_000 })
      await expect(card).toContainText('From textbolt.com')
      await expect(panel).toHaveCount(0)
      const folded = page.getByRole('region', { name: 'What CiteFox AI did' })
      const toggle = folded.getByRole('button', { name: /steps · / })
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await expect(toggle).toContainText(/CiteFox AI \d+ s/)
      await page.screenshot({ path: path.join(SCREENSHOTS, 'fill-progress-done.png') })

      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      // One check per Claude call: the site read, switch-from, and one search for each of
      // the three products the fixture read finds.
      const checks = step(folded, 'Checking the answer')
      await expect(checks).toHaveCount(5)
      for (const product of [
        'Email-to-SMS alerting',
        'Carrier email-to-text gateway replacement'
      ]) {
        await expect(
          step(folded, `Searching the web for competitors · ${product}`)
        ).toHaveAttribute('data-state', 'done')
      }
      for (const check of await checks.all()) {
        await expect(check).toHaveAttribute('data-state', 'done')
      }
      await expect(step(folded, 'Checking competitor domains')).toHaveAttribute(
        'data-state',
        'done'
      )
      await expect(step(folded, /\d+ suggestions? ready/)).toHaveAttribute('data-state', 'done')
      await expectAccessible(page, '.ui-progress')
      await page.screenshot({ path: path.join(SCREENSHOTS, 'fill-progress-steps.png') })
    })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
