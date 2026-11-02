import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { stubKeyTests } from './key-test-stub'
import { launchCiteFox } from './launch'
import { openAllPages } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { expectMainAccessible, openHash } from './screens-app'

/**
 * Multi-engine UI (Engines board panels 1 and 4, helpfill-board panel 6) on the real
 * IPC handlers: What to track in Project settings (the price before Save, engines that
 * need cloro off without a cloro key), each check's credits and cost in Check history
 * with the This month box, and the 3-step key card in Connections. No call leaves the
 * app: the seeds use recorded SerpApi bodies, the cloro key is metadata only, and
 * `shell.openExternal` only records what it was given.
 */

const WIDE = { width: 1440, height: 900 }
const NARROW = { width: 1134, height: 800 }

interface Opened {
  app: ElectronApplication
  page: Page
  close: () => Promise<void>
}

async function launchSeeded(dir: string): Promise<Opened> {
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: WIDE
  })
  // Key tests answer from recorded bodies: nothing reaches cloro, SerpApi or Jina.
  await stubKeyTests(app)
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { __opened?: string[] }).__opened = opened
    shell.openExternal = (async (url: string) => {
      opened.push(url)
    }) as typeof shell.openExternal
  })
  await openAllPages(page)
  return {
    app,
    page,
    close: async () => {
      await app.close()
      await rm(dir, { recursive: true, force: true })
    }
  }
}

/**
 * The two-market TextBolt seed, with a cloro key (metadata only) when asked. `nearPlan`
 * gives the SerpApi key a 250,000 CiteFox cap on an account that has used 218,102 of its
 * 250,000-search plan (other tools included), so the key reads "Near cap".
 */
async function openTwoMarket(withCloro: boolean, nearPlan = false): Promise<Opened> {
  installRawMarkdown()
  const { seedTwoMarketProject } = await import('./screens-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-engines-'))
  await seedTwoMarketProject(dir)
  const { openAppStorage } = await import('../../src/main/storage/app-storage')
  const { getApiKey, insertApiKey, updateApiKey } = await import('../../src/main/storage/records')
  const storage = openAppStorage(dir)
  try {
    if (nearPlan) {
      const serp = getApiKey(storage.db, 'key-1')
      if (serp === null) throw new Error('The seed has no SerpApi key')
      updateApiKey(storage.db, {
        ...serp,
        cap: 250_000,
        serpapiUsage: { used: 218_102, planLimit: 250_000, plan: 'Big Data' }
      })
    }
    if (withCloro) {
      insertApiKey(storage.db, {
        id: 'key-cloro',
        provider: 'cloro',
        name: 'cloro',
        keychainRef: 'citefox.cloro.engines-key',
        hint: 'cl01',
        rotationOrder: 1,
        cap: null,
        on: true,
        projectIds: [],
        state: 'ok',
        lastReason: null,
        serpapiUsage: null,
        plan: null,
        cloroCredits: { remaining: 1_230, perCycle: 37_500, resetsAt: null }
      })
    }
  } finally {
    storage.close()
  }
  return launchSeeded(dir)
}

/** Running animations end; one cancelled by a re-render (theme or size change) counts as ended. */
async function animationsSettled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => undefined))
    )
  })
}

/** Both themes at 1440 and 1134, with no sideways scroll in the window or the main column. */
async function shots(
  page: Page,
  name: string,
  focus: Locator,
  sizes: readonly { width: number; height: number }[] = [WIDE, NARROW]
): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    for (const size of sizes) {
      await page.setViewportSize(size)
      await animationsSettled(page)
      await focus.evaluate((node) => node.scrollIntoView({ block: 'start' }))
      await page.waitForTimeout(150)
      const overflow = await page.evaluate(() => {
        const root = document.scrollingElement ?? document.documentElement
        const main = document.querySelector('main') ?? document.body
        return {
          page: root.scrollWidth - root.clientWidth,
          main: main.scrollWidth - main.clientWidth
        }
      })
      expect(overflow.page, `${name} ${size.width} ${scheme}: window`).toBeLessThanOrEqual(0)
      expect(overflow.main, `${name} ${size.width} ${scheme}: main`).toBeLessThanOrEqual(0)
      await page.screenshot({
        path: await e2eArtifact(`engines-settings-${name}-${size.width}-${scheme}.png`)
      })
    }
  }
  await page.emulateMedia({ colorScheme: 'light' })
  await page.setViewportSize(WIDE)
}

function creditsOf(text: string): number {
  const match = /One check: ([\d,]+) credits/.exec(text)
  return Number((match?.[1] ?? '0').replace(/,/g, ''))
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}

async function opened(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as { __opened?: string[] }).__opened ?? [])
}

function engineBox(region: Locator, name: string): Locator {
  return region.getByRole('checkbox', { name: new RegExp(`^${name}`) })
}

test('What to track: without a cloro key only Google AI Overview can be picked', async () => {
  test.setTimeout(180_000)
  const { page, close } = await openTwoMarket(false)
  try {
    await openHash(page, '#/project-settings?tab=track')
    const region = page.getByRole('region', { name: 'What to track', exact: true })
    await expect(region).toBeVisible()
    for (const name of ['ChatGPT', 'Perplexity', 'Google AI Mode', 'Gemini', 'Copilot']) {
      await expect(engineBox(region, name)).toBeDisabled()
    }
    await expect(engineBox(region, 'Google AI Overview')).toBeChecked()
    await expect(region.getByText('Needs a key', { exact: true })).toHaveCount(5)
    await expect(region.getByText('Google AI Overviews only.')).toBeVisible()
    await expect(region.getByRole('link', { name: 'Add one in Connections' })).toHaveAttribute(
      'href',
      '#/connections?tab=cloro'
    )
    // The price is shown before anything is saved.
    const cost = region.getByTestId('engines-cost')
    await expect(cost).toContainText(/searches a month/)
    await expect(cost).toContainText(/\d+ questions? × 1 engine/)
    await expectMainAccessible(page)
    await shots(page, 'track-no-cloro', region)

    await region.getByRole('link', { name: 'Add one in Connections' }).click()
    await expect(page).toHaveURL(/#\/connections\?tab=cloro$/)
  } finally {
    await close()
  }
})

test('What to track: with a cloro key, ticking engines prices them, Save keeps them', async () => {
  test.setTimeout(180_000)
  const { page, close } = await openTwoMarket(true)
  try {
    await openHash(page, '#/project-settings?tab=track')
    const region = page.getByRole('region', { name: 'What to track', exact: true })
    await expect(region.getByText('Key saved in Keychain · 1,230 credits left')).toBeVisible()
    await expect(region.getByRole('radio', { name: /^cloro/ })).toBeChecked()
    const cost = region.getByTestId('engines-cost')
    // Google AI Overview on cloro: 7 credits a question.
    await expect(cost).toContainText(/One check: \d+ credits/)
    const before = creditsOf(await cost.innerText())
    expect(before % 7).toBe(0)
    const questions = before / 7

    await engineBox(region, 'ChatGPT').check()
    await engineBox(region, 'Perplexity').check()
    // + 7 (ChatGPT) + 6 (Perplexity) credits a question, priced before Save.
    await expect(cost).toContainText(`One check: ${formatCount(questions * 20)} credits`)
    await expect(cost).toContainText(/× 3 engines/)
    await expectMainAccessible(page)
    await shots(page, 'track-cloro', region)

    await region.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(region.getByText('What to track is saved.')).toBeVisible()
    await page.reload()
    const reloaded = page.getByRole('region', { name: 'What to track', exact: true })
    await expect(engineBox(reloaded, 'ChatGPT')).toBeChecked()
    await expect(engineBox(reloaded, 'Perplexity')).toBeChecked()
    await expect(engineBox(reloaded, 'Gemini')).not.toBeChecked()
    await expect(page).toHaveURL(/#\/project-settings\?tab=track$/)

    // Back undoes the tab, as every tab change is a history entry.
    await page.getByRole('tab', { name: 'Markets', exact: true }).click()
    await expect(page).toHaveURL(/tab=markets$/)
    await page.goBack()
    await expect(page).toHaveURL(/tab=track$/)
  } finally {
    await close()
  }
})

test('Check history: each check shows its credits and cost, and the month adds them up', async () => {
  test.setTimeout(180_000)
  installRawMarkdown()
  const { seedProgressProject } = await import('./progress-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-engines-history-'))
  await seedProgressProject(dir)
  // The newest check ran Google AI Overview on cloro and asked ChatGPT too.
  const { openAppStorage } = await import('../../src/main/storage/app-storage')
  const { closeProjectDatabase, openProjectDatabase } =
    await import('../../src/main/storage/project-files')
  const storage = openAppStorage(dir)
  const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  try {
    const newest = db
      .prepare<unknown[], { id: string }>('SELECT id FROM runs ORDER BY started_at DESC LIMIT 1')
      .get()!.id
    db.prepare(
      "UPDATE serp_results SET provider = 'cloro', credits = 7, cost_micros = 5600 WHERE run_id = ?"
    ).run(newest)
    db.prepare(`UPDATE runs SET engines_json = '["google_aio","chatgpt"]' WHERE id = ?`).run(newest)
    db.prepare("UPDATE serp_results SET cost_micros = 15000 WHERE provider = 'serpapi'").run()
  } finally {
    closeProjectDatabase(db)
    storage.close()
  }
  const { page, close } = await launchSeeded(dir)
  try {
    // Credits and Cost wait in the Columns menu (audit #10); this link shows them.
    await openHash(page, '#/history?cols=engines,credits,cost')
    const grid = page.getByRole('treegrid', { name: 'Check history' })
    await expect(grid).toBeVisible()
    await expect(grid.getByRole('columnheader', { name: /^Credits/ })).toBeVisible()
    await expect(grid.getByRole('columnheader', { name: /^Cost/ })).toBeVisible()
    const rows = grid.locator('[role="row"][data-row]')
    // Newest first: the cloro check charged 7 credits a sample, priced at the plan.
    await expect(rows.first().getByTitle(/search credits/)).toBeVisible()
    await expect(rows.last()).not.toContainText('SerpApi')

    const box = page.getByRole('region', { name: 'This month' })
    await expect(box.getByText('Search credits used')).toBeVisible()
    await expect(box.getByText('Searches used')).toBeVisible()
    await expect(box.getByText('Spent', { exact: true })).toBeVisible()
    await expect(box.getByText('Next scheduled')).toBeVisible()
    await expectMainAccessible(page)
    await shots(page, 'history', grid)
    await shots(page, 'history-month', box)
  } finally {
    await close()
  }
})

test('Connections: a cloro key in 3 steps, tested, then saved', async () => {
  test.setTimeout(180_000)
  const { page, app, close } = await openTwoMarket(false)
  try {
    await openHash(page, '#/connections?tab=cloro')
    const section = page
      .locator('section.conn-section')
      .filter({ has: page.getByRole('heading', { level: 2, name: 'cloro keys' }) })
    const steps = section.getByRole('list', { name: 'Connect cloro in 3 steps' })
    await expect(steps).toBeVisible()
    await expect(steps.getByText('Make a free cloro account')).toBeVisible()
    await expect(steps.getByText('Dashboard › API keys › Create key')).toBeVisible()
    // The domain shown in step 1 has Copy and Open, as every address on screen.
    await expect(steps.getByRole('button', { name: /^Copy cloro\.dev/ })).toBeAttached()

    await steps.getByRole('link', { name: /^Sign up at cloro/ }).click()
    await expect
      // The sign-up link carries CiteFox's referral code (CLORO_REF in keys/providerLinks.ts).
      .poll(async () =>
        (await opened(app)).some((url) => /^https:\/\/cloro\.dev\/?(\?|$)/.test(url))
      )
      .toBe(true)
    await steps.getByRole('link', { name: /^Open dashboard at cloro/ }).click()
    await expect
      .poll(async () =>
        (await opened(app)).some((url) => url.startsWith('https://dashboard.cloro.dev'))
      )
      .toBe(true)
    await expectMainAccessible(page)
    await shots(page, 'key-card', section)

    // Step 3: paste, then one green Test and save (cloro's free credits call, recorded).
    const secret = 'fake-e2e-cloro-key-0001'
    await section.getByLabel('API key', { exact: true }).fill(secret)
    await section.getByRole('button', { name: 'Test and save' }).click()
    await expect(
      section.getByText('cloro tested and saved. It works. 37,500 credits left.')
    ).toBeVisible()
    await expect(page.locator('#main')).not.toContainText(secret)

    // With a cloro key saved, What to track lets every engine be picked.
    await openHash(page, '#/project-settings?tab=track')
    const region = page.getByRole('region', { name: 'What to track', exact: true })
    await expect(engineBox(region, 'ChatGPT')).toBeEnabled()
    await expect(region.getByText('Needs a key', { exact: true })).toHaveCount(0)
  } finally {
    await close()
  }
})

test('Connections: cloro first and recommended; a SerpApi key near its plan says why', async () => {
  test.setTimeout(180_000)
  const { page, close } = await openTwoMarket(true, true)
  try {
    await openHash(page, '#/connections')
    const tabs = page.getByRole('tablist', { name: 'Connections' }).getByRole('tab')
    await expect(tabs.first()).toHaveAccessibleName(/^cloro Recommended/)
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
    await expect(tabs.nth(1)).toHaveAccessibleName(/^SerpApi/)
    const cloro = page
      .locator('section.conn-section')
      .filter({ has: page.getByRole('heading', { level: 2, name: 'cloro keys' }) })
    await expect(cloro.getByRole('row').filter({ hasText: '••••' })).toContainText(
      'Account 1,230 of 37,500 credits left'
    )

    await tabs.nth(1).click()
    await expect(page).toHaveURL(/#\/connections\?tab=serpapi$/)
    const serp = page
      .locator('section.conn-section')
      .filter({ has: page.getByRole('heading', { level: 2, name: 'SerpApi keys' }) })
    // Two clean sentences, then the scope on a line of its own.
    await expect(
      serp.getByText(/^1 key\. CiteFox used [\d,]+ of 250,000 capped searches this month\.$/)
    ).toBeVisible()
    await expect(serp.getByText(/^SerpApi covers Google AI Overviews only\./)).toBeVisible()
    // CiteFox's own count, the account's figure under it, and the status says which is near.
    const row = serp.getByRole('row').filter({ hasText: 'My plan' })
    await expect(row).toContainText(/[\d,]+ of 250,000/)
    await expect(row).toContainText('Account 218,102 of 250,000')
    await expect(row.getByRole('button', { name: /status: Near cap/ })).toHaveAttribute(
      'title',
      'Account near its plan: 218,102 of 250,000 searches used, other tools included.'
    )
    await expectMainAccessible(page)
    for (const width of [1440, 1320, 1134]) {
      await page.setViewportSize({ width, height: 860 })
      await animationsSettled(page)
      const clipped = await row.evaluate((node) =>
        [...node.querySelectorAll('.conn-used .mini, .conn-used-account, .conn-status-btn')]
          .filter((cell) => cell.scrollWidth > cell.clientWidth + 1)
          .map((cell) => cell.textContent)
      )
      expect(clipped, `clipped at ${width}px`).toEqual([])
    }
    await shots(page, 'connections-serpapi', serp, [WIDE, { width: 1320, height: 860 }, NARROW])
  } finally {
    await close()
  }
})
