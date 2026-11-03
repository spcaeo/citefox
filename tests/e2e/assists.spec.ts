import { expect, test, type Locator, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'
import { expectMainAccessible, openHash } from './screens-app'
import { e2eArtifactsDir } from './artifacts'
import { openAllPages } from './nav-helpers'
import { writeClaudeStandIn } from './claude-stand-in'

/**
 * AI assists (FR-25.1 to FR-25.6) through real IPC. The two-market TextBolt
 * seed holds two finished checks; one logged fix is added so "Check if Fix 1
 * worked in other markets" has saved data to compare. The `claude` stand-in
 * answers every prompt whose first line is `Assist: <id>` from
 * src/main/assist/fixtures/<id>.json. No SerpApi search runs.
 */

const ROOT = process.cwd()
const SHIM = path.join(ROOT, 'tests/e2e/claude-shim.mjs')
const FIXTURE_DIR = path.join(ROOT, 'src/main/providers/fixtures/textbolt')
const SCREENSHOTS = path.join(e2eArtifactsDir(), 'screenshots', 'templates')
const PAGE = 'page-1'

test('assists answer in place from saved data and Status counts their Claude calls', async () => {
  test.setTimeout(240_000)
  installRawMarkdown()
  const { seedTwoMarketProject, SEED } = await import('./screens-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-assists-'))
  await seedTwoMarketProject(dir)
  await logFix(dir, SEED.pageId, [SEED.us, SEED.uk])
  // "Suggest a shorter title" is offered only under the title-too-long flag.
  await lengthenTitle(dir)
  const bin = path.join(dir, 'bin')
  await mkdir(bin, { recursive: true })
  await writeClaudeStandIn(path.join(bin, 'claude'), SHIM)
  const shimLog = path.join(dir, 'claude-shim.log')
  await mkdir(SCREENSHOTS, { recursive: true })

  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 900 },
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      CITEFOX_FIXTURE_DIR: FIXTURE_DIR,
      CITEFOX_SHIM_LOG: shimLog
    }
  })

  try {
    await openAllPages(page)

    await test.step('Results: Explain this change, then Tell CiteFox AI what to change', async () => {
      await openHash(page, `#/pages/${PAGE}/results`)
      const summary = page.getByRole('region', { name: 'Summary' })
      const region = await runMenuAssist(page, 'Explain this change', summary)
      await expect(region.getByText(/stayed cited for prompt 1/)).toBeVisible()

      const input = region.getByRole('textbox', { name: 'Tell CiteFox AI what to change' })
      await expect(input).toHaveAttribute('placeholder', 'Tell CiteFox AI what to change…')
      await input.fill('Keep it to the two prompts')
      await region.getByRole('button', { name: 'Try again' }).click()
      await expect(region.getByRole('listitem').first()).toBeVisible({ timeout: 60_000 })

      await expect(page.getByText(/Error invoking remote method/)).toHaveCount(0)
      await expectMainAccessible(page)
      await region.scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(SCREENSHOTS, 'assist-results.png') })

      await region.getByRole('button', { name: 'Dismiss suggestion' }).click()
      await expect(region).toHaveCount(0)
    })

    await test.step('Progress: other markets reads saved checks only', async () => {
      await openHash(page, `#/pages/${PAGE}/progress`)
      const name = 'Check if Fix 1 worked in other markets'
      const sections = page.locator('#page-tabpanel .vis-tabbar')
      await expect(sections.getByRole('button', { name: 'AI actions' })).toBeVisible()
      const region = await runMenuAssist(page, name, sections)
      await expect(region.getByRole('listitem')).not.toHaveCount(0)
      await expect(page.getByText(/Error invoking remote method/)).toHaveCount(0)
      await region.scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(SCREENSHOTS, 'assist-progress.png') })
      await region.getByRole('button', { name: 'Dismiss suggestion' }).click()
    })

    await test.step("Prompt detail: Why isn't my page first?", async () => {
      await openHash(page, `#/pages/${PAGE}/prompt/prompt-1`)
      const screen = page.getByTestId('prompt-detail')
      await expect(screen.getByRole('heading', { level: 1, name: SEED.prompts[0] })).toBeVisible()
      const region = await runNamedMenuAssist(
        page,
        'AI actions for this question',
        "Why isn't my page first?"
      )
      await expect(region.getByRole('listitem')).not.toHaveCount(0)
      await expect(page.getByText(/Error invoking remote method/)).toHaveCount(0)
      await region.scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(SCREENSHOTS, 'assist-prompt-detail.png') })
      await region.getByRole('button', { name: 'Dismiss suggestion' }).click()
      await expect(region).toHaveCount(0)
    })

    await test.step('Page read: Suggest a shorter title', async () => {
      await openHash(page, `#/pages/${PAGE}/read`)
      const region = await runNamedMenuAssist(
        page,
        'AI actions for this page',
        'Suggest a shorter title'
      )
      await expect(region.getByRole('button', { name: 'Apply' })).toHaveCount(0)
      await region.getByRole('button', { name: 'Dismiss suggestion' }).click()
    })

    await test.step('Prompts: the AI menu writes more, added only on Apply', async () => {
      await openHash(page, `#/pages/${PAGE}/prompts`)
      const grid = page.getByRole('grid', { name: 'Buyer questions' })
      await expect(grid.locator('.ui-lg-row')).toHaveCount(2)
      await page.getByRole('button', { name: 'AI actions for these questions' }).click()
      await page.getByRole('menuitem', { name: /Write more like these/ }).click()
      const apply = page.getByRole('button', { name: 'Add selected' })
      await expect(apply).toBeVisible({ timeout: 30_000 })
      await expect(grid.locator('.ui-lg-row')).toHaveCount(2)
      await apply.click()
      await expect
        .poll(async () => grid.locator('.ui-lg-row').count(), { timeout: 30_000 })
        .toBeGreaterThan(2)
    })

    const assistCalls = shimMatches(shimLog, 'assist-')
    expect(assistCalls).toBeGreaterThanOrEqual(6)

    await test.step('Status: the Claude usage card counts the calls just made', async () => {
      await openHash(page, '#/status')
      await expect(page.getByRole('heading', { level: 1, name: 'Status' })).toBeVisible()
      const card = page.getByRole('region', { name: 'Calls and tokens', exact: true })
      const summary = card.getByText(
        /^CiteFox AI calls today \d+ · tokens this month \S+ in \/ \S+ out$/
      )
      await expect(summary).toBeVisible()
      const today = Number(/today (\d+)/.exec((await summary.textContent()) ?? '')?.[1] ?? '0')
      expect(today).toBeGreaterThanOrEqual(assistCalls)
      // "By step" names assist ids in words; it may sit in a closed <details>.
      await expect(card.getByText('Explain this change').first()).toBeAttached()

      const region = await runMenuAssist(page, 'Explain my usage')
      await expect(region.getByRole('listitem')).not.toHaveCount(0)
      await expect(page.getByText(/Error invoking remote method/)).toHaveCount(0)
      await expectMainAccessible(page)
      await card.scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(SCREENSHOTS, 'status-usage.png') })
    })

    expect(shimMatches(shimLog, 'unmatched')).toBe(0)
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

/** The assist block whose button has this name. */
/**
 * Opens a section's AI menu, picks `item`, and waits for its suggestion card:
 * the items, "CiteFox AI · about N s · no searches", and no error.
 */
async function runNamedMenuAssist(page: Page, menu: string, item: string): Promise<Locator> {
  const button = page.getByRole('button', { name: menu, exact: true })
  await expect(button).toBeEnabled()
  await button.click()
  await expect(page.getByText('Runs on your AI plan. Uses no searches.')).toBeVisible()
  await page.getByRole('menuitem', { name: new RegExp(`^${item.replace(/[?]/g, '\\?')}`) }).click()
  const region = page.getByRole('region', { name: item, exact: true })
  await expect(region.getByRole('listitem').first()).toBeVisible({ timeout: 60_000 })
  await expect(region.getByRole('alert')).toHaveCount(0)
  await expect(region.getByText(/^CiteFox AI · about \d+ s · no searches$/)).toBeVisible()
  return region
}

/**
 * Runs an assist from the section's one AI menu (v2) and waits for its
 * suggestion card: "CiteFox AI · about N s · no searches", no error.
 */
async function runMenuAssist(page: Page, name: string, scope?: Locator): Promise<Locator> {
  await (scope ?? page).getByRole('button', { name: 'AI actions' }).first().click()
  const pattern = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
  await page.getByRole('menuitem', { name: pattern }).click()
  const region = page.getByRole('region', { name, exact: true })
  await expect(region.getByRole('listitem').first()).toBeVisible({ timeout: 60_000 })
  await expect(region.getByRole('alert')).toHaveCount(0)
  await expect(region.getByText(/no searches/).first()).toBeVisible()
  return region
}

function shimMatches(file: string, needle: string): number {
  if (!existsSync(file)) return 0
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.includes(needle)).length
}

/** One logged fix on the page, live between the two seeded checks. */
async function lengthenTitle(userDataDir: string): Promise<void> {
  const { openAppStorage } = await import('../../src/main/storage/app-storage')
  const { closeProjectDatabase, openProjectDatabase } =
    await import('../../src/main/storage/project-files')
  const storage = openAppStorage(userDataDir)
  const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  try {
    db.prepare(`UPDATE snapshots SET title = ? WHERE id = 'snap-1'`).run(
      'Text alerts for business: how to set up SMS alerts from email without a developer'
    )
  } finally {
    closeProjectDatabase(db)
    storage.close()
  }
}

async function logFix(
  userDataDir: string,
  pageId: string,
  marketIds: readonly string[]
): Promise<void> {
  const { openAppStorage } = await import('../../src/main/storage/app-storage')
  const { closeProjectDatabase, openProjectDatabase } =
    await import('../../src/main/storage/project-files')
  const { createFixFollowUp } = await import('../../src/main/storage/fix-follow-ups')
  const storage = openAppStorage(userDataDir)
  const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  try {
    createFixFollowUp(db, {
      id: 'fix-1',
      pageId,
      description: 'Added a FAQ on alerting crews without a developer.',
      goLiveAt: '2026-10-10T12:00:00.000Z',
      rule: 'after_7_days',
      promptIds: ['prompt-1'],
      marketIds
    })
  } finally {
    closeProjectDatabase(db)
    storage.close()
  }
}
