import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TEXTBOLT_TOPIC_ID } from '../../src/shared/fixtures/textbolt-topic'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { openAllPages } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { openHash } from './screens-app'
import { writeClaudeStandIn } from './claude-stand-in'

/**
 * The shared chart style (ui/chart) on every converted chart, on real IPC with
 * seeded data and no network: each chart saved light and dark under
 * test-results/e2e/charts/, plus the fix marker's hover card and its click,
 * which opens the fix drawer over the chart.
 */

const ROOT = process.cwd()

async function chartShot(page: Page, chart: Locator, name: string): Promise<void> {
  await chart.scrollIntoViewIfNeeded()
  await page.mouse.move(0, 0)
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme)
    await page.waitForTimeout(250)
    await chart.screenshot({ path: await e2eArtifact(`charts/${name}-${scheme}.png`) })
  }
  await page.emulateMedia({ colorScheme: 'light' })
}

test('page Progress, Summary and Changes charts in the shared style, light and dark', async () => {
  test.setTimeout(240_000)
  installRawMarkdown()
  const { seedProgressProject } = await import('./progress-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-charts-'))
  await seedProgressProject(dir)
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 900 }
  })
  try {
    await openAllPages(page)

    // Page Progress: the rate line, the hollow follow-up and Fix 1's marker.
    await openHash(page, '#/pages/page-1/progress')
    const panel = page.locator('#page-tabpanel')
    const rate = panel.locator('[data-nfr-chart="citation-rate"]')
    await expect(rate.getByRole('img', { name: /Share of AI Overviews/ })).toBeVisible()
    const marker = rate.getByRole('button', { name: /Your fix: Fix 1 · / })
    await expect(marker).toHaveText('1')
    await chartShot(page, rate, 'page-progress')

    // Hover card: who, what, before → now and the verdict.
    await marker.hover()
    const card = rate.locator('.ui-chart-card')
    await expect(card).toContainText('Your fix')
    await expect(card).toContainText('Fix 1 · Added a pricing FAQ')
    await rate.screenshot({ path: await e2eArtifact('charts/page-progress-marker-card.png') })

    // A check's hover card.
    const plot = rate.locator('.ui-chart-plot')
    const box = await plot.boundingBox()
    if (box) await page.mouse.move(box.x + box.width - 30, box.y + 80)
    await expect(card).toContainText('Page cited')
    await rate.screenshot({ path: await e2eArtifact('charts/page-progress-check-card.png') })

    // A Google update: its rollout days, when it finished, and its light band.
    const googleMark = rate.getByRole('button', { name: /, Google: / }).first()
    if ((await googleMark.count()) > 0) {
      await googleMark.hover()
      await expect(card).toContainText('Google')
      await expect(rate.locator('.ui-chart-rollout').first()).toBeAttached()
      await rate.screenshot({ path: await e2eArtifact('charts/page-progress-google-card.png') })
    }

    // Hiding Google updates is on the URL.
    const google = rate.getByRole('button', { name: 'Google updates', exact: true })
    if ((await google.count()) > 0) {
      await google.click()
      await expect(page).toHaveURL(/marks\.hide=google/)
      await google.click()
    }

    // The fix marker opens Fix 1 in its drawer, over Progress.
    await marker.click()
    await expect(page).toHaveURL(/progress.*drawer=fix&fix=/)
    await expect(page.getByRole('dialog', { name: 'Fix 1' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page).not.toHaveURL(/drawer=fix/)

    // Summary: this week's count, its line and the gap said once.
    await openHash(page, '#/overview')
    const weekly = page.locator('.ov-chart')
    await expect(weekly.getByRole('img', { name: /per week/ })).toBeVisible()
    await chartShot(page, weekly, 'summary-weekly')

    // Changes: how fast changes get cited, as soft columns.
    await openHash(page, '#/fixes?view=changes')
    const speed = page.locator('.chg-speed')
    await expect(speed).toBeVisible()
    await chartShot(page, speed, 'changes-speed')
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('topic Progress chart in the shared style, light and dark', async () => {
  test.setTimeout(180_000)
  installRawMarkdown()
  const { seedTwoMarketProject, SEED } = await import('./screens-seed')
  const { openAppStorage } = await import('../../src/main/storage/app-storage')
  const { closeProjectDatabase, openProjectDatabase } =
    await import('../../src/main/storage/project-files')
  const { projectDatabaseRelativePath } = await import('../../src/main/storage/slug')
  const { seedTextboltTopic } = await import('../../src/main/topics/fixture-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-charts-topic-'))
  await seedTwoMarketProject(dir)
  const storage = openAppStorage(dir)
  const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  try {
    seedTextboltTopic(db, {
      id: SEED.projectId,
      name: 'TextBolt',
      slug: 'textbolt',
      domain: 'textbolt.com',
      dbPath: projectDatabaseRelativePath('textbolt'),
      clientName: null,
      status: 'active'
    })
    storage.db
      .prepare(
        `INSERT OR REPLACE INTO queue_pause (id, state, paused_on) VALUES (1, 'paused_all', NULL)`
      )
      .run()
  } finally {
    closeProjectDatabase(db)
    storage.close()
  }
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1440, height: 900 }
  })
  try {
    await openAllPages(page)
    await openHash(page, `#/topics/${TEXTBOLT_TOPIC_ID}`)
    const views = page.getByRole('tablist', { name: 'Topic views' })
    await views.getByRole('tab', { name: /^Progress/ }).click()
    // The once-only guide cards ("Your first results are in", "What is a topic page?")
    // would cover the chart.
    const kickoff = page.getByTestId('guide-kickoff')
    if (await kickoff.isVisible()) await kickoff.getByRole('button', { name: 'Later' }).click()
    const explainer = page.getByTestId('guide-explainer')
    if (await explainer.isVisible()) {
      await explainer.getByRole('button', { name: 'Close', exact: true }).first().click()
    }
    const chart = page.locator('.tr-progress')
    await expect(chart.getByRole('img', { name: /Cited rate per full check/ })).toBeVisible()
    await chartShot(page, chart, 'topic-progress')
    const box = await chart.locator('.ui-chart-plot').boundingBox()
    if (box) await page.mouse.move(box.x + box.width - 30, box.y + 90)
    await expect(chart.locator('.ui-chart-card')).toContainText('Oct 19')
    await expect(chart.locator('.ui-chart-card')).toContainText('Right page cited')
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('Sentiment trend and bars in the shared style, light and dark', async () => {
  test.setTimeout(180_000)
  installRawMarkdown()
  const { seedSentimentProject } = await import('./sentiment-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-charts-sentiment-'))
  await seedSentimentProject(dir)
  const bin = path.join(dir, 'bin')
  await mkdir(bin, { recursive: true })
  const shim = path.join(ROOT, 'tests/e2e/claude-shim.mjs')
  await writeClaudeStandIn(path.join(bin, 'claude'), shim)
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 900 },
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      CITEFOX_FIXTURE_DIR: path.join(ROOT, 'src/main/providers/fixtures/textbolt'),
      CITEFOX_SHIM_LOG: path.join(dir, 'claude-shim.log')
    }
  })
  try {
    await openAllPages(page)
    await page.locator('#main').getByRole('link', { name: 'Alerts', exact: true }).first().click()
    await page.getByRole('tab', { name: 'Sentiment', exact: true }).click()
    const tab = page.getByTestId('sentiment-tab')
    await expect(tab).toBeVisible()
    const trend = tab.locator('section[aria-labelledby="st-trend-h"]')
    await expect(trend.getByRole('img', { name: /Net sentiment about/ })).toBeVisible()
    await chartShot(page, trend, 'sentiment-trend')
    const shares = tab.locator('section[aria-labelledby="st-share-h"]')
    await chartShot(page, shares, 'sentiment-shares')
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
