import { expect, test, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'
import { expectMainAccessible, openHash, openTwoMarketApp } from './screens-app'
import { openAllPages } from './nav-helpers'

/**
 * v2 look of Status, the Checking (running) screen and the Progress tab at
 * 1280×900: screenshots of the main pane from the top down, plus an axe pass.
 */
const VIEWPORT = { width: 1280, height: 900 }

async function settle(page: Page): Promise<void> {
  await expect(page.getByText(/^Loading/)).toHaveCount(0)
  await page.waitForTimeout(300)
}

/** Screenshots of the main pane, one per screenful, top to bottom (at most `max`). */
async function shots(page: Page, name: string, max = 3): Promise<void> {
  await page.evaluate(() => document.querySelector('#main')?.scrollTo(0, 0))
  for (let index = 0; index < max; index += 1) {
    await page.waitForTimeout(150)
    await page.screenshot({ path: await e2eArtifact(`v2-${name}-${index + 1}.png`) })
    const more = await page.evaluate(() => {
      const main = document.querySelector('#main')
      if (!main) return false
      const before = main.scrollTop
      main.scrollTo(0, before + main.clientHeight - 80)
      return main.scrollTop > before
    })
    if (!more) break
  }
  await page.evaluate(() => document.querySelector('#main')?.scrollTo(0, 0))
}

test('Status in the v2 look', async () => {
  test.setTimeout(180_000)
  const { page, close } = await openTwoMarketApp('v2-status')
  try {
    await page.setViewportSize(VIEWPORT)
    await openHash(page, '#/status')
    await expect(page.getByRole('heading', { level: 1, name: 'Status' })).toBeVisible()
    await settle(page)
    await shots(page, 'status')
    await expectMainAccessible(page)
  } finally {
    await close()
  }
})

test('Checking screen in the v2 look', async () => {
  test.setTimeout(180_000)
  installRawMarkdown()
  const { RUNNING_SEED, runningJob, seedRunningProject, stubRunningJob } =
    await import('./running-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-v2-running-'))
  seedRunningProject(dir)
  const { app, page } = await launchCiteFox({ userDataDir: dir, viewport: VIEWPORT })
  try {
    await stubRunningJob(app, runningJob())
    await openHash(page, `#/pages/${encodeURIComponent(RUNNING_SEED.pageId)}/running`)
    const table = page.getByRole('grid', { name: 'Questions in the market being checked' })
    await expect(table.locator('[data-row="9"]')).toBeAttached()
    await settle(page)
    await shots(page, 'running')
    await expectMainAccessible(page)
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('Progress tab in the v2 look', async () => {
  test.setTimeout(180_000)
  installRawMarkdown()
  const { seedProgressProject } = await import('./progress-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-v2-progress-'))
  await seedProgressProject(dir)
  const { app, page } = await launchCiteFox({ userDataDir: dir, viewport: VIEWPORT })
  try {
    await openAllPages(page)
    await openHash(page, '#/pages/page-1/progress')
    await expect(page.locator('#page-tabpanel [data-nfr-chart]').first()).toBeAttached()
    await settle(page)
    await shots(page, 'progress', 4)
    const tabs = page.getByRole('tablist', { name: 'Progress sections' })
    if ((await tabs.count()) > 0) {
      for (const tab of await tabs.getByRole('tab').all()) {
        const name = ((await tab.textContent()) ?? '').trim().split(/\s/)[0]?.toLowerCase() ?? 'tab'
        await tab.click()
        await page.waitForTimeout(200)
        await shots(page, `progress-tab-${name}`, 2)
      }
    }
    await expectMainAccessible(page)
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
