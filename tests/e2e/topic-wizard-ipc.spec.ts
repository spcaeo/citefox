import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'
import { openAdd } from './nav-helpers'

/**
 * The Add wizard through the real `topics:*` handlers: the `claude` stand-in
 * answers the topic templates from src/main/topics/fixtures, and
 * CITEFOX_E2E_TOPICS=1 serves fixed site pages, so nothing leaves the
 * machine. The seed path runs to the estimate, then a restart shows the draft
 * under "Pick up where you left off" and reopens it at the same step. Start
 * is not pressed: it would queue real searches.
 */

const ROOT = process.cwd()
const SHIM = path.join(ROOT, 'tests/e2e/claude-shim.mjs')
const FIXTURE_DIR = path.join(ROOT, 'src/main/providers/fixtures/textbolt')
const VIEWPORT = { width: 1440, height: 900 }

async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include('#main')
    .setLegacyMode()
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations).toEqual([])
}

function heading(page: Page, name: string): ReturnType<Page['getByRole']> {
  return page.getByRole('heading', { level: 1, name })
}

function primary(page: Page): ReturnType<Page['locator']> {
  return page.locator('.ui-wizard-foot .ui-btn-primary')
}

test('seed path on the real topics handlers, resumed after a restart', async () => {
  test.setTimeout(300_000)
  installRawMarkdown()
  const { seedTwoMarketProject } = await import('./screens-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-topic-ipc-'))
  await seedTwoMarketProject(dir)
  const bin = path.join(dir, 'bin')
  await mkdir(bin, { recursive: true })
  const claude = path.join(bin, 'claude')
  await writeFile(claude, `#!/bin/sh\nexec node ${JSON.stringify(SHIM)} "$@"\n`)
  await chmod(claude, 0o755)
  const env = {
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    CITEFOX_FIXTURE_DIR: FIXTURE_DIR,
    CITEFOX_SHIM_LOG: path.join(dir, 'claude-shim.log'),
    CITEFOX_E2E_TOPICS: '1'
  }

  let { app, page } = await launchCiteFox({ userDataDir: dir, viewport: VIEWPORT, env })
  try {
    await expect(heading(page, 'Summary')).toBeVisible()
    await openAdd(page, 'Topic')
    await expect(heading(page, 'What do you want to track?')).toBeVisible()
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(heading(page, 'Start from a problem')).toBeVisible()
    await page.getByLabel('Problem or seed').fill('Text alerts for teams without a developer')
    await page
      .getByRole('group', { name: 'Generate' })
      .getByRole('button', { name: 'Both' })
      .click()
    await page.getByRole('button', { name: 'AI actions for your business' }).click()
    await page.getByRole('menuitem', { name: /Discover from website/ }).click()
    await expect(page.getByRole('button', { name: 'Use as seed' })).toBeVisible({ timeout: 60_000 })
    await expectAccessible(page)
    await page.screenshot({ path: await e2eArtifact('topic-wizard-ipc-seed.png') })

    await primary(page).click()
    await expect(heading(page, 'Buyer profile')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByRole('grid', { name: 'Buyer profile points' })).toBeVisible()

    await primary(page).click()
    await expect(heading(page, 'Buyer journey questions')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByRole('grid', { name: 'Buyer questions' })).toBeVisible()
    await page.screenshot({ path: await e2eArtifact('topic-wizard-ipc-questions.png') })

    await primary(page).click()
    await expect(heading(page, 'Keywords and groups')).toBeVisible({ timeout: 60_000 })

    await primary(page).click()
    await expect(heading(page, 'Which page answers each question')).toBeVisible({ timeout: 60_000 })

    await primary(page).click()
    await expect(heading(page, 'Estimate and start')).toBeVisible()
    await expect(page.getByRole('radio').first()).toBeVisible({ timeout: 30_000 })
    await expectAccessible(page)
    await page.screenshot({ path: await e2eArtifact('topic-wizard-ipc-estimate.png') })

    await app.close()
    ;({ app, page } = await launchCiteFox({ userDataDir: dir, viewport: VIEWPORT, env }))
    await expect(heading(page, 'Summary')).toBeVisible()
    await openAdd(page, 'Topic')
    await page.getByRole('button', { name: 'Text alerts for teams without a developer' }).click()
    await expect(heading(page, 'Estimate and start')).toBeVisible()
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
