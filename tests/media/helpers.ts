import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launchCiteFox } from '../e2e/launch'
import { sidebar } from '../e2e/nav-helpers'
import { installRawMarkdown } from '../e2e/raw-hook'
import { openHash } from '../e2e/screens-app'

/**
 * Shared by the media specs (demo.spec.ts screenshots, video.spec.ts footage): the
 * TextBolt demo project, the app in Sepia at 1440×900, and a few moves.
 */

export const OUT = path.resolve(process.env.CITEFOX_MEDIA_OUT ?? 'test-results/media-out')
export const VIEW = { width: 1440, height: 900 }
export const TOPIC_ID = 'topic-textbolt-alerts'
export const QUESTION = '#/pages/page-outlook/prompt/page-outlook-q0'

/** The rich Reports project (3 checks, 3 engines, fixes) plus the TextBolt topic. */
export async function seed(): Promise<string> {
  installRawMarkdown()
  const { seedReportsProject, REPORTS_SEED } = await import('../e2e/reports-seed')
  const { openAppStorage } = await import('../../src/main/storage/app-storage')
  const { closeProjectDatabase, openProjectDatabase } =
    await import('../../src/main/storage/project-files')
  const { projectDatabaseRelativePath } = await import('../../src/main/storage/slug')
  const { seedTextboltTopic } = await import('../../src/main/topics/fixture-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-media-'))
  await seedReportsProject(dir)
  const storage = openAppStorage(dir)
  const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  try {
    seedTextboltTopic(db, {
      id: REPORTS_SEED.projectId,
      name: 'TextBolt',
      slug: 'textbolt',
      domain: 'textbolt.com',
      dbPath: projectDatabaseRelativePath('textbolt'),
      clientName: null,
      status: 'active'
    })
    // Nothing is searched while recording: the queue stays paused.
    storage.db
      .prepare(
        `INSERT OR REPLACE INTO queue_pause (id, state, paused_on) VALUES (1, 'paused_all', NULL)`
      )
      .run()
  } finally {
    closeProjectDatabase(db)
    storage.close()
  }
  return dir
}

/** Opens the seeded app in the default Sepia theme with the guide and its tips off. */
export async function open(
  dir: string,
  env: Record<string, string | undefined> = {}
): Promise<{ app: ElectronApplication; page: Page }> {
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: VIEW,
    // Visible inside the container's own Xvfb, so the screencast gets frames.
    env: { CITEFOX_DEFAULT_THEME: 'sepia', CITEFOX_E2E_BACKGROUND: undefined, ...env }
  })
  await expect(sidebar(page)).toBeVisible()
  await page.evaluate(() =>
    (window as unknown as { citefox: Record<string, (request: unknown) => Promise<unknown>> })
      .citefox['guide:update']!({ projectId: 'proj-1', tipsOff: true, hidden: true })
  )
  await page.reload()
  await expect(sidebar(page)).toBeVisible()
  await go(page, '#/overview', 'Summary')
  return { app, page }
}

export async function go(page: Page, hash: string, heading?: string | RegExp): Promise<void> {
  await openHash(page, hash)
  if (heading !== undefined) {
    await expect(page.getByRole('heading', { level: 1, name: heading }).first()).toBeVisible()
  }
  await settle(page)
}

/** Waits for loading text and spinners to go, then for charts to finish growing. */
export async function settle(page: Page, ms = 800): Promise<void> {
  await expect(page.locator('#main').getByText(/^Loading/)).toHaveCount(0, { timeout: 30_000 })
  await expect(page.locator('#main [aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 })
  await page.waitForTimeout(ms)
}

/** Scrolls the nearest scrolling box so `target` sits `offset` px below its top. */
export async function scrollIntoTop(page: Page, target: Locator, offset = 96): Promise<void> {
  await target.evaluate((node, gap) => {
    const scrolls = (box: HTMLElement): boolean =>
      box.scrollHeight > box.clientHeight + 4 &&
      ['auto', 'scroll'].includes(getComputedStyle(box).overflowY)
    let scroller: HTMLElement | null = node.parentElement
    while (scroller && !scrolls(scroller)) scroller = scroller.parentElement
    const host = scroller ?? document.scrollingElement
    if (!host) return
    const hostTop = scroller ? scroller.getBoundingClientRect().top : 0
    host.scrollBy({
      top: node.getBoundingClientRect().top - hostTop - gap,
      behavior: 'instant' as ScrollBehavior
    })
  }, offset)
  await page.waitForTimeout(400)
}
