import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { textboltSitemapFixture } from '../../src/main/structure/fixtures/textbolt-sitemaps'
import { e2eArtifact } from './artifacts'
import { drawerShots } from './drawer-helpers'
import { waitForChecksIdle } from './journey-app'
import { launchCiteFox } from './launch'
import { openStartChoice } from './first-run-helpers'
import { expectTopicLanding, FIRST_TOPIC, walkSetup } from './setup-walk'

/**
 * The guided first run (owner feedback 4, journey A) in stub mode: Finish opens the
 * first topic and runs its check, then "How do you want to start?" (owner feedback 6,
 * `#/start/choose`, opened by its URL as the topic's project has no page yet); "I'll choose" opens the
 * chooser and "Change how to start" comes back; "Let CiteFox set up my site"
 * opens "Setting up textbolt.com"; the autopilot reads the recorded sitemap
 * and the fixture site, Claude is the e2e stand-in. While it runs the user
 * removes a competitor and adds a page; the buyer profile is written without
 * the competitor and the page joins the plan. Apart from onboarding's own first
 * check, no SerpApi search happens until "Start first check". Screens are saved at 1440×900 and 1280×800 as
 * Start-*.png (copied to Mockups/v2/preview).
 */

const ROOT = process.cwd()
const FIXTURE_DIR = path.join(ROOT, 'src/main/providers/fixtures/textbolt')
const ACCOUNT_FIXTURE = path.join(ROOT, 'src/main/providers/fixtures/serpapi/account-ok.json')
const SHIM = path.join(ROOT, 'tests/e2e/claude-shim.mjs')
const SERP_KEY = 'serp-fixture-key-first-run'
const SIZES = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 }
] as const

test('first run: choose, setup with edits mid-run, what we found, plan, first check, results', async () => {
  test.setTimeout(300_000)
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-first-run-'))
  const bin = path.join(dir, 'bin')
  await mkdir(bin, { recursive: true })
  const claude = path.join(bin, 'claude')
  await writeFile(claude, `#!/bin/sh\nexec node ${JSON.stringify(SHIM)} "$@"\n`)
  await chmod(claude, 0o755)
  const shimLog = path.join(dir, 'claude-shim.log')
  const sites = path.join(dir, 'sitemaps')
  mkdirSync(sites, { recursive: true })
  for (const [url, body] of textboltSitemapFixture('base').files) {
    writeFileSync(path.join(sites, encodeURIComponent(url)), body)
  }

  const { app, page } = await launchCiteFox({
    userDataDir: path.join(dir, 'data'),
    viewport: SIZES[0],
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      CITEFOX_FIXTURE_DIR: FIXTURE_DIR,
      CITEFOX_SHIM_LOG: shimLog,
      CITEFOX_E2E_SITEMAP_DIR: sites,
      CITEFOX_E2E_TOPICS: '1',
      CITEFOX_START_AUTOPILOT: 'on',
      CITEFOX_E2E_SITE_WIDE: '1',
      // Slow two Claude steps so the spec can edit while the autopilot runs.
      CITEFOX_SHIM_SLOW: 'Assist: start.firstPages=7000;Template: topic_buyer_profile.md=7000'
    }
  })
  const searchCount = (): Promise<number> =>
    app.evaluate(
      () =>
        (globalThis as typeof globalThis & { __citefoxSearches?: string[] }).__citefoxSearches
          ?.length ?? 0
    )

  // Onboarding's own first check (one question) runs on the new topic's page first.
  let onboardingSearches = 0
  try {
    await installFetch(app)
    await test.step('onboarding opens the topic; how to start has examples from the profile', async () => {
      await onboard(page)
      onboardingSearches = await searchCount()
      expect(onboardingSearches).toBeGreaterThan(0)
      await openStartChoice(page)
      await expect(page.getByRole('radio', { name: 'Let CiteFox set up my site' })).toBeChecked()
      await expect(page.getByText('Reads textbolt.com and its sitemap')).toBeVisible()
      await expect(page.getByText(/such as simpletexting\.com and twilio\.com/)).toBeVisible()
      const ways = page.getByRole('group', { name: 'Way to start (optional)' })
      await expect(ways.getByText('https://textbolt.com/pricing')).toBeVisible()
      await expect(ways.getByText('https://simpletexting.com/pricing')).toBeVisible()
      await shots(page, 'Start-choose')
      expect(await searchCount()).toBe(onboardingSearches)
    })

    await test.step('"I\'ll choose" opens the chooser; Change comes back', async () => {
      await page.getByRole('radio', { name: 'I’ll choose what to track myself' }).check()
      await page.getByRole('button', { name: 'Continue' }).click()
      await expect(
        page.getByRole('heading', { level: 1, name: 'What do you want to track?' })
      ).toBeVisible()
      await expect(page.getByText('https://textbolt.com/pricing')).toBeVisible()
      await page.getByRole('link', { name: 'Change how to start' }).click()
      await expect(
        page.getByRole('heading', { level: 1, name: 'How do you want to start?' })
      ).toBeVisible()
      await expect(
        page.getByRole('radio', { name: 'I’ll choose what to track myself' })
      ).toBeChecked()
    })

    await test.step('"Let CiteFox set up my site" opens "Setting up textbolt.com"', async () => {
      await page.getByRole('radio', { name: 'Let CiteFox set up my site' }).check()
      await page.getByRole('button', { name: 'Continue' }).click()
      await expect(
        page.getByRole('heading', { level: 1, name: 'Setting up textbolt.com' })
      ).toBeVisible()
      await expect(page.getByRole('list', { name: 'Journey steps' })).toBeVisible()
      await expect(page.getByRole('list', { name: 'Setup steps' })).toBeVisible()
      await page.getByRole('button', { name: 'Setup actions' }).click()
      await expect(
        page.getByRole('menuitem', { name: 'Skip, I’ll set it up myself' })
      ).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('button', { name: /^(Pause|Resume)$/ })).toBeVisible()
    })

    await test.step('edit a competitor while Claude picks pages', async () => {
      const steps = page.getByRole('list', { name: 'Setup steps' })
      await expect(steps.getByText('Pick pages most likely to matter')).toBeVisible()
      await expect(steps.locator('[aria-current="step"]')).toContainText(
        'Pick pages most likely to matter',
        { timeout: 30_000 }
      )
      await shots(page, 'Start-Setup-Early')
      await page.getByRole('button', { name: /^Edit competitor twilio\.com/ }).click()
      await page.getByRole('menuitem', { name: 'Remove' }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Removed twilio.com' })).toBeVisible()
      await shots(page, 'Start-Setup-Edit')
    })

    await test.step('add a page while the buyer profile is written', async () => {
      const steps = page.getByRole('list', { name: 'Setup steps' })
      await expect(steps.locator('[aria-current="step"]')).toContainText('Write buyer profile', {
        timeout: 30_000
      })
      // The work console covers the card's foot while it runs; minimise it, as a person would.
      const workConsole = page.getByRole('dialog', { name: 'CiteFox work console' })
      if (await workConsole.isVisible()) {
        await workConsole.getByRole('button', { name: 'Minimise the console' }).click()
      }
      const picked = page.getByRole('region', { name: 'Pages picked' })
      await picked.getByRole('button', { name: /Add/ }).first().click()
      const box = page.getByRole('combobox', { name: /page/i })
      await box.fill('/features/scheduled-texts/')
      await box.press('Enter')
      await expect(picked.getByText('/features/scheduled-texts/')).toBeVisible()
      await shots(page, 'Start-Setup-Late')
    })

    await test.step('what we found opens on its own, with the edits', async () => {
      await expect(page.getByRole('heading', { level: 1, name: 'Your site is ready' })).toBeVisible(
        { timeout: 90_000 }
      )
      await expect(page.getByText('twilio.com')).toHaveCount(0)
      await expect(page.getByRole('heading', { name: 'What we found' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Who you’re up against' })).toBeVisible()
      await shots(page, 'Start-Found')
      // The profile was written after the removal: the shim saw the edited rivals.
      const about = readFileSync(shimLog, 'utf8')
        .split('\n')
        .filter((line) => line.startsWith('Template: topic_buyer_profile.md About the business:'))
      expect(about.length).toBeGreaterThan(0)
      expect(about.at(-1)).not.toContain('twilio')
      expect(await searchCount()).toBe(onboardingSearches)
    })

    await test.step('Edit the buyer profile opens in a drawer on the URL, with the unsaved guard', async () => {
      const hash = (): Promise<string> => page.evaluate(() => window.location.hash)
      const edit = page
        .getByRole('region', { name: 'Who buys' })
        .getByRole('button', { name: 'Edit who buys', exact: true })
      await edit.click()
      const drawer = page.getByRole('dialog', { name: 'Edit the buyer profile' })
      await expect(drawer).toBeVisible()
      await expect(drawer).toHaveAttribute('data-drawer', 'start-buyers')
      expect(await hash()).toBe('#/start?drawer=start-buyers')
      await drawerShots(page, 'start-buyers', SIZES[0])
      // ✕ closes it, and the URL loses it.
      await drawer.getByRole('button', { name: 'Close Edit the buyer profile' }).click()
      await expect(drawer).toHaveCount(0)
      expect(await hash()).toBe('#/start')
      // Back closes it.
      await edit.click()
      await expect(drawer).toBeVisible()
      await page.evaluate(() => window.history.back())
      await expect(drawer).toHaveCount(0)
      expect(await hash()).toBe('#/start')
      // A pasted link opens it; typed Who buys asks before Escape or Back throws it away.
      await page.evaluate(() => {
        window.location.hash = '#/start?drawer=start-buyers'
      })
      await expect(drawer).toBeVisible()
      await drawer.getByLabel('Who buys').fill('Ops leads at clinics who text patients')
      await page.keyboard.press('Escape')
      const ask = page.getByRole('alertdialog', { name: 'Discard changes?' })
      await expect(ask).toBeVisible()
      await ask.getByRole('button', { name: 'Keep editing' }).click()
      await expect(drawer.getByLabel('Who buys')).toHaveValue(
        'Ops leads at clinics who text patients'
      )
      await page.evaluate(() => window.history.back())
      await expect(ask).toBeVisible()
      await expect(drawer).toBeVisible()
      await ask.getByRole('button', { name: 'Discard' }).click()
      await expect(drawer).toHaveCount(0)
      await expect(
        page.getByRole('heading', { level: 1, name: 'Your site is ready' })
      ).toBeVisible()
      expect(await hash()).not.toContain('drawer=')
    })

    await test.step('the plan lists the added page; the first check starts from here', async () => {
      await page.getByRole('button', { name: 'See my starting plan' }).click()
      await expect(
        page.getByRole('heading', { level: 1, name: 'Your starting plan' })
      ).toBeVisible()
      await expect(page.getByText('/features/scheduled-texts/').first()).toBeVisible()
      await expect(page.getByRole('heading', { name: 'This check' })).toBeVisible()
      await shots(page, 'Start-Plan')
      expect(await searchCount()).toBe(onboardingSearches)
      await page.getByRole('button', { name: 'Start first check' }).click()
      await expect(page.getByRole('heading', { level: 1, name: /^Asking Google/ })).toBeVisible()
      await shots(page, 'Start-Check')
    })

    await test.step('first results open when the last answer is in', async () => {
      await expect(
        page.getByRole('heading', { level: 1, name: /Google shows an AI Overview/ })
      ).toBeVisible({ timeout: 120_000 })
      expect(await searchCount()).toBeGreaterThan(onboardingSearches)
      // The four headline numbers are one KPI strip on one row (88px tiles), not a stack.
      const tiles = page.getByRole('region', { name: 'First check numbers' }).locator('.ui-kpi')
      await expect(tiles).toHaveCount(4)
      for (const size of SIZES) {
        await page.setViewportSize(size)
        const boxes = await tiles.evaluateAll((nodes) =>
          nodes.map((node) => {
            const box = node.getBoundingClientRect()
            return { top: Math.round(box.top), height: Math.round(box.height) }
          })
        )
        expect(new Set(boxes.map((box) => box.top)).size).toBe(1)
        expect(boxes.every((box) => box.height === 88)).toBe(true)
      }
      await page.setViewportSize(SIZES[0])
      await shots(page, 'Start-Results')
    })

    await test.step('back in the app: Activity lists what happened, in a drawer on the URL', async () => {
      await page.evaluate(() => {
        window.location.hash = '#/pages?drawer=activity'
      })
      const panel = page.getByRole('dialog', { name: 'Activity' })
      await expect(panel).toBeVisible()
      await expect(panel).toHaveAttribute('data-drawer', 'activity')
      await expect(panel.getByText(/Removed twilio\.com/)).toBeVisible()
      await expect(panel.getByRole('button', { name: 'Close Activity' })).toBeFocused()
      await shots(page, 'Start-Activity')
      await drawerShots(page, 'activity', SIZES[0])
      await page.keyboard.press('Escape')
      await expect(panel).toHaveCount(0)
      expect(await page.evaluate(() => window.location.hash)).toBe('#/pages')
      // The work console's "All activity" link opens it; Back closes it.
      await page.evaluate(() => {
        window.location.hash = '#/pages?drawer=activity'
      })
      await expect(panel).toBeVisible()
      await page.evaluate(() => window.history.back())
      await expect(panel).toHaveCount(0)
    })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }

  async function installFetch(
    app: Awaited<ReturnType<typeof launchCiteFox>>['app']
  ): Promise<void> {
    const serp: string[] = []
    for (const name of readdirSync(FIXTURE_DIR).sort()) {
      if (!name.startsWith('serp-') || name.includes('token')) continue
      const file = JSON.parse(readFileSync(path.join(FIXTURE_DIR, name), 'utf8')) as {
        body: unknown
      }
      serp.push(JSON.stringify(file.body))
    }
    const account = JSON.parse(readFileSync(ACCOUNT_FIXTURE, 'utf8')) as { body: unknown }
    await app.evaluate(
      (_electron, config: { serp: string[]; account: string }) => {
        const original = globalThis.fetch.bind(globalThis)
        const respond = (body: string): Response =>
          new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
        let next = 0
        const seen = globalThis as typeof globalThis & { __citefoxSearches?: string[] }
        seen.__citefoxSearches = []
        globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
          const url =
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
          if (url.startsWith('https://serpapi.com/account')) return respond(config.account)
          if (url.startsWith('https://serpapi.com/')) {
            seen.__citefoxSearches?.push(url)
            await new Promise((resolve) => setTimeout(resolve, 150))
            const body = config.serp[next % config.serp.length] ?? '{}'
            next += 1
            return respond(body)
          }
          return original(input, init)
        }
      },
      { serp, account: JSON.stringify(account.body) }
    )
  }
})

/**
 * Onboarding v2's eight steps on the shim (tests/e2e/setup-walk.ts). Step 6 keeps only
 * simpletexting.com and twilio.com; step 8 keeps one question, so Finish's own first check
 * makes one search. Ends on the new topic's page once that check is done.
 */
async function onboard(page: Page): Promise<void> {
  await walkSetup(page, {
    serpKey: SERP_KEY,
    competitors: ['simpletexting.com', 'twilio.com'],
    onlyThoseCompetitors: true,
    keepQuestions: 1
  })
  await expectTopicLanding(page, FIRST_TOPIC)
  await waitForChecksIdle(page)
}

/** The screen at 1440×900 and 1280×800, then back to 1440×900. */
async function shots(page: Page, name: string): Promise<void> {
  for (const size of SIZES) {
    await page.setViewportSize(size)
    await page.waitForTimeout(150)
    await page.screenshot({
      path: await e2eArtifact(`${name}-${size.width}x${size.height}.png`),
      fullPage: false
    })
  }
  await page.setViewportSize(SIZES[0])
}
