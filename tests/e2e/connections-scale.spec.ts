import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { CiteFoxApi } from '@shared/ipc'
import { keychainItemExists } from './keychain'
import { stubKeyTests } from './key-test-stub'
import { launchCiteFox } from './launch'
import { chooseRowAction } from './row-menu'
import { installRawMarkdown } from './raw-hook'
import { expectMainAccessible, openHash } from './screens-app'
import { e2eArtifactsDir } from './artifacts'
import { openAllPages } from './nav-helpers'

/** A recognisable fake. It is never sent to SerpApi: this spec makes no key test. */
const BACKUP_SECRET = 'citefox-e2e-serpapi-backup-7k2q'
const SHOTS = path.join(e2eArtifactsDir(), 'screenshots', 'projects')

/** Opens a key's row menu and picks one item. */
async function rowAction(page: Page, scope: Locator, keyName: string, item: string): Promise<void> {
  await chooseRowAction(page, scope, keyName, item)
}

async function shot(page: Page, name: string): Promise<void> {
  await mkdir(SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false })
}

function section(page: Page, heading: string): Locator {
  return page
    .locator('section.conn-section')
    .filter({ has: page.getByRole('heading', { level: 2, name: heading }) })
}

/**
 * The two-market TextBolt project, checked twice through the real IPC handlers,
 * plus searches and a SerpApi rate limit recorded just now so the last 24 hours
 * and the failover sentence are known.
 */
async function seed(dir: string): Promise<void> {
  // Main modules import Markdown with ?raw, so the hook goes in before they load.
  installRawMarkdown()
  const { SEED, seedTwoMarketProject } = await import('./screens-seed')
  const { recordActivity } = await import('../../src/main/storage/activity-events')
  const { openAppStorage } = await import('../../src/main/storage/app-storage')
  const { insertConnectionEvent } = await import('../../src/main/storage/records')
  await seedTwoMarketProject(dir)
  const storage = openAppStorage(dir)
  try {
    const now = Date.now()
    const at = (offsetMs: number): string => new Date(now - offsetMs).toISOString()
    recordActivity(storage.db, {
      id: 'e2e-act-search',
      at: at(60_000),
      kind: 'search',
      keyId: 'key-1',
      projectId: SEED.projectId,
      count: 4,
      detail: null
    })
    recordActivity(storage.db, {
      id: 'e2e-act-claude',
      at: at(50_000),
      kind: 'claude_call',
      keyId: null,
      projectId: SEED.projectId,
      count: 1,
      detail: null
    })
    insertConnectionEvent(storage.db, {
      id: 'e2e-ev-limit',
      keyId: 'key-1',
      at: at(40_000),
      kind: 'rate_limited',
      detail: 'SerpApi is limiting this key.'
    })
    for (const id of ['e2e-ev-move-1', 'e2e-ev-move-2']) {
      insertConnectionEvent(storage.db, {
        id,
        keyId: 'key-1',
        at: at(30_000),
        kind: 'failover',
        detail: 'CiteFox moved this search to the next SerpApi key.'
      })
    }
  } finally {
    storage.close()
  }
}

async function keychainRefs(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const api = (window as unknown as { citefox: CiteFoxApi }).citefox
    const keys = await api['keys:list']()
    return keys.filter((key) => key.id !== 'key-1').map((key) => key.keychainRef)
  })
}

test('connections at scale: several SerpApi keys, rotation, project Claude, last 24 hours', async () => {
  test.setTimeout(180_000)
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-connections-scale-'))
  await seed(dir)
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 900 }
  })
  try {
    // "Test and save" tests the new key: recorded account body, no call to SerpApi.
    await stubKeyTests(app)
    await openAllPages(page)
    await openHash(page, '#/connections?tab=serpapi')
    await expect(page.getByRole('heading', { level: 1, name: 'Connections' })).toBeVisible()

    const strip = page.getByRole('region', { name: 'Last 24 hours' })
    for (const name of ['SerpApi searches · 24 h', 'Claude calls · 24 h', 'Jina reads · 24 h']) {
      await expect(strip.getByRole('region', { name })).toContainText(/\d+/)
    }
    const searches = Number(
      (await strip.locator('[data-nfr-figure="activity:searches"]').textContent()) ?? '0'
    )
    expect(searches).toBeGreaterThanOrEqual(4)
    await expect(strip).toContainText(
      /SerpApi rate-limited "My plan"\. 2 searches moved to the next key\./
    )

    // Drill-downs (NFR-14): each count opens exactly the calls behind it, through
    // connections:activityLog on the real IPC.
    const searchButton = strip.locator('[data-nfr-drill="activity:searches"]')
    await expect(searchButton.locator('[data-nfr-figure]')).toHaveText(String(searches))
    await searchButton.focus()
    await page.keyboard.press('Enter')
    const drawer = page.getByRole('dialog')
    await expect(drawer.getByRole('heading', { level: 2 })).toHaveText(
      `SerpApi searches · ${searches} searches`
    )
    await expect(drawer.locator('[data-drill-row]')).toHaveCount(Math.min(searches, 100))
    await expect(drawer.getByText('Search 1 of 4 in this call')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await strip.getByRole('button', { name: /SerpApi rate-limited "My plan"/ }).click()
    await expect(drawer.getByRole('gridcell', { name: 'Rate-limited' })).toBeVisible()
    await expect(drawer.getByRole('gridcell', { name: 'Moved to next key' })).toHaveCount(2)
    await page.keyboard.press('Escape')
    await strip.getByRole('button', { name: 'Show My plan' }).click()
    const myPlan = page.getByRole('button', { name: 'My plan: show its status and settings' })
    await expect(myPlan).toBeFocused()
    await expect(myPlan).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('group', { name: 'My plan status' })).toContainText('3 events')
    await page
      .getByRole('group', { name: 'My plan status' })
      .locator('[data-nfr-drill^="key-events:"]')
      .click()
    await expect(drawer.locator('[data-drill-row]')).toHaveCount(3)
    await page.keyboard.press('Escape')
    await myPlan.click()
    await expect(myPlan).toHaveAttribute('aria-expanded', 'false')
    await page.getByRole('button', { name: /searches used on My plan this month/ }).click()
    await expect(drawer.getByRole('heading', { level: 2 })).toContainText('My plan:')
    await expect(drawer.getByText(/Searches column adds up to/)).toBeVisible()
    await page.keyboard.press('Escape')

    const serp = section(page, 'SerpApi keys')
    // The totals line under the heading (the grid's foot line also starts "1 key.").
    await expect(serp.getByText(/^1 key\. .* this month/)).toBeVisible()
    await serp.getByRole('button', { name: 'Add SerpApi key' }).click()
    await serp.getByLabel('Name', { exact: true }).fill('Backup')
    await serp.getByLabel('API key', { exact: true }).fill(BACKUP_SECRET)
    await serp.getByLabel(/Monthly cap/).fill('250')
    await serp.getByRole('button', { name: 'Test and save' }).click()
    await expect(serp.getByText(/^Backup tested and saved\./)).toBeVisible()
    const refs = await keychainRefs(page)
    expect(refs).toHaveLength(1)
    expect(keychainItemExists(dir, refs[0] ?? '')).toBe(true)
    await expect(page.locator('#main')).not.toContainText(BACKUP_SECRET)
    await expect(serp.getByText(/^2 keys\. .* this month/)).toBeVisible()

    const names = serp.locator('[role="row"] .key-name')
    await expect(names).toHaveText(['My plan', 'Backup'])
    await rowAction(page, serp, 'Backup', 'Move up in rotation order')
    await expect(names).toHaveText(['Backup', 'My plan'])
    await expect(serp.getByText('Backup moved up in rotation order.')).toBeVisible()

    // A header sort changes the view only; the Order column keeps the rotation number.
    const grid = serp.getByRole('grid', { name: 'SerpApi keys in rotation order' })
    await grid.getByRole('button', { name: /^Name/ }).click()
    await expect(names).toHaveText(['Backup', 'My plan'])
    await grid.getByRole('button', { name: /^Name/ }).click()
    await expect(names).toHaveText(['My plan', 'Backup'])
    await grid.getByRole('button', { name: /^Order/ }).click()
    await expect(names).toHaveText(['Backup', 'My plan'])

    await page.getByLabel('How CiteFox uses these keys').selectOption('spread_evenly')
    await expect(page.getByText(/Saved\. Spread evenly from the next search\./)).toBeVisible()

    await rowAction(page, serp, 'Backup', 'Edit key')
    await serp.getByLabel('Plan', { exact: true }).fill('Client plan')
    await serp.getByLabel('Monthly cap', { exact: true }).fill('300')
    await serp.getByRole('group', { name: 'Edit Backup' }).getByLabel('TextBolt').check()
    await serp.getByRole('button', { name: 'Save changes' }).click()
    await expect(serp.getByText('Backup saved.')).toBeVisible()
    const backupRow = serp.getByRole('row').filter({ hasText: 'Client plan' })
    await expect(backupRow).toContainText('of 300')
    await expect(backupRow).toContainText('TextBolt')

    await serp.getByRole('switch', { name: 'Use Backup' }).click()
    await expect(serp.getByRole('switch', { name: 'Use Backup' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    await expect(backupRow).toContainText('Off')

    await shot(page, 'connections-keys')
    await page.getByRole('tab', { name: /^Claude/ }).click()
    const claude = section(page, 'Claude')
    await claude.getByLabel('TextBolt connection').selectOption('claude_code')
    await expect(claude.getByText('Saved for TextBolt.')).toBeVisible()
    await claude.getByLabel('TextBolt fallback').selectOption('retry_later')
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const api = (window as unknown as { citefox: CiteFoxApi }).citefox
          const rows = await api['connections:projectClaude']()
          return rows.map((row) => `${row.claude.connection}/${row.claude.fallback}`)
        })
      )
      .toEqual(['claude_code/retry_later'])
    await expect(claude).toContainText("doesn't rotate between several Claude subscription")
    await expectMainAccessible(page)

    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Connections' })).toBeVisible()
    await expect(page.getByLabel('How CiteFox uses these keys')).toHaveValue('spread_evenly')
    // The open tab is in the URL, so the reload comes back on Claude.
    await expect(page.getByRole('tab', { name: /^Claude/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(section(page, 'Claude').getByLabel('TextBolt connection')).toHaveValue(
      'claude_code'
    )
    await expect(section(page, 'Claude').getByLabel('TextBolt fallback')).toHaveValue('retry_later')
    await page.getByRole('tab', { name: /^SerpApi/ }).click()
    await expect(section(page, 'SerpApi keys').locator('[role="row"] .key-name')).toHaveText([
      'Backup',
      'My plan'
    ])
    await page.getByRole('tab', { name: /^Claude/ }).click()
    await section(page, 'Claude').scrollIntoViewIfNeeded()
    await shot(page, 'connections-claude')

    const overflow = await page.evaluate(() => {
      const root = document.documentElement
      return Math.max(root.scrollWidth, document.body.scrollWidth) - root.clientWidth
    })
    expect(overflow).toBeLessThanOrEqual(1)
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
