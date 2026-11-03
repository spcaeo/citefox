import { expect, test, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launchCiteFox } from './launch'
import { openAllPages } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { expectMainAccessible, openHash, pickDropdown, shot } from './screens-app'
import { writeClaudeStandIn } from './claude-stand-in'

/**
 * Report perspectives in the app, on real IPC with recorded SerpApi bodies and the
 * Claude fixture shim (no network, no live Claude):
 * - Overview: the quiet Impact review line, Compare with, the change chips,
 *   the market picker and How we measure, all in the URL.
 * - Competitors: "Who else the AI answers cite" by kind of site, with Twilio sorted
 *   by Claude once (src/main/assist/fixtures/competitors.siteKinds.json).
 */

const ROOT = process.cwd()
const SHIM = path.join(ROOT, 'tests/e2e/claude-shim.mjs')
const ANTHROPIC_FIXTURES = path.join(ROOT, 'src/main/providers/fixtures/anthropic')
const SIZES = [
  { width: 1440, height: 900 },
  { width: 1134, height: 770 }
] as const

async function openSeeded(): Promise<{ page: Page; dir: string; close: () => Promise<void> }> {
  installRawMarkdown()
  const { seedPerspectivesProject } = await import('./perspectives-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-perspectives-'))
  await seedPerspectivesProject(dir)
  const bin = path.join(dir, 'bin')
  await mkdir(bin, { recursive: true })
  await writeClaudeStandIn(path.join(bin, 'claude'), SHIM)
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1440, height: 900 },
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      CITEFOX_FIXTURE_DIR: ANTHROPIC_FIXTURES,
      CITEFOX_SHIM_LOG: path.join(dir, 'claude-shim.log')
    }
  })
  await openAllPages(page)
  return {
    page,
    dir,
    close: async () => {
      await app.close()
      await rm(dir, { recursive: true, force: true })
    }
  }
}

async function shots(page: Page, name: string): Promise<void> {
  for (const size of SIZES) {
    await page.setViewportSize(size)
    await page.evaluate(() => document.querySelector('#main')?.scrollTo(0, 0))
    await shot(page, `${name}-${size.width}x${size.height}`)
  }
  await page.setViewportSize(SIZES[0])
}

test('Overview: the Impact review line, Compare with, change chips, market and method', async () => {
  test.setTimeout(180_000)
  const { page, close } = await openSeeded()
  try {
    await openHash(page, '#/overview')
    const main = page.locator('#main')
    // The verdict lives in Reports › Impact review; Summary keeps one quiet line.
    const verdict = main.getByRole('region', { name: 'Is it working?' })
    await expect(verdict).toBeVisible()
    await expect(verdict.getByRole('link', { name: 'See the Impact review →' })).toBeVisible()
    await expect(main.getByText('Citations moved around.')).toHaveCount(0)
    await expect(main.getByRole('region', { name: 'You’re named' })).toBeVisible()

    // Changed is the default chip: the gained and the lost question.
    const grid = main.getByRole('grid', { name: 'Questions that changed' })
    await expect(grid.getByText('Can staff reply to an alert by email?')).toBeVisible()
    await expect(grid.getByText('How do I alert the crew without a developer?')).toBeVisible()
    await expect(grid.getByText('Which plan covers scheduled texts?')).toHaveCount(0)
    await expectMainAccessible(page)
    await shots(page, 'perspectives-overview')

    await main.getByRole('group', { name: 'Change' }).getByRole('button', { name: /Kept/ }).click()
    await expect(page).toHaveURL(/change=kept/)
    await expect(grid.getByText('Which plan covers scheduled texts?')).toBeVisible()

    // Compare with the Oct 5 check: the same comparison, named by its date.
    const compare = main.getByRole('combobox', { name: 'Compare with' })
    await expect(compare.locator('option')).toHaveText(['Previous check', 'Oct 5, 2026 check'])
    await compare.selectOption({ label: 'Oct 5, 2026 check' })
    await expect(page).toHaveURL(/vs=/)

    // The market picker (two markets) reads the UK checks.
    await pickDropdown(main.getByRole('combobox', { name: 'Market' }), '🇬🇧 UK · EN')
    await expect(page).toHaveURL(/market=mkt-uk/)
    // Checks are per market, so the compared check goes back to Previous check.
    await expect(page).not.toHaveURL(/vs=/)
    await expect(verdict.getByText(/That check is not in this project/)).toHaveCount(0)

    await verdict.getByRole('button', { name: 'How we measure' }).click()
    const method = page.getByRole('dialog', { name: 'How we measure' })
    await expect(method).toBeVisible()
    await expect(page).toHaveURL(/panel=method/)
    await expect(method.getByText(/searched on Google in 🇬🇧 UK · EN/)).toBeVisible()
    await shots(page, 'perspectives-overview-method')
    await method.getByRole('button', { name: 'Close How we measure' }).click()
    await expect(method).toHaveCount(0)
  } finally {
    await close()
  }
})

test('Competitors: who else the AI answers cite, by kind of site', async () => {
  test.setTimeout(180_000)
  const { page, dir, close } = await openSeeded()
  try {
    await openHash(page, '#/competitors?period=7')
    const main = page.locator('#main')
    const kinds = main.getByRole('grid', { name: 'Site types' })
    await expect(main.getByRole('heading', { name: 'Who else the AI answers cite' })).toBeVisible()
    await expect(kinds.getByRole('row', { name: /Competitors/ })).toBeVisible()
    await expect(kinds.getByRole('row', { name: /Video, social & forums/ })).toBeVisible()
    // Twilio is sorted by Claude once (the fixture shim), then the list reloads.
    await expect(kinds.getByRole('row', { name: /Big tech & cloud/ })).toBeVisible({
      timeout: 30_000
    })
    const log = await readFile(path.join(dir, 'claude-shim.log'), 'utf8').catch(() => '')
    expect(log).toContain('competitors.siteKinds')

    await kinds.getByText('Video, social & forums').click()
    await expect(page).toHaveURL(/kind=video_social/)
    const sites = main.getByRole('grid', { name: 'Cited sites' })
    await expect(sites.getByText('reddit.com', { exact: true }).first()).toBeVisible()
    await expect(sites.getByText('twilio.com', { exact: true })).toHaveCount(0)
    // The site type lives in the one Filter ▾ menu, ticked, and clears from there.
    await main.getByRole('button', { name: 'Filter, 1 set' }).click()
    await expect(
      page.getByRole('menuitemradio', { name: 'Site type: Video, social & forums' })
    ).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('menuitem', { name: 'Clear filters' }).click()
    await page.keyboard.press('Escape')
    await expect(page).not.toHaveURL(/kind=/)
    await expectMainAccessible(page)
    await shots(page, 'perspectives-competitors')
  } finally {
    await close()
  }
})
