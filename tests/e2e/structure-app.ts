import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { textboltSitemapFixture } from '../../src/main/structure/fixtures/textbolt-sitemaps'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'
import { openAllPages } from './nav-helpers'

/** 1280×900 screenshots. Set CITEFOX_E2E_SHOTS_DIR to keep them somewhere else. */
export const SHOTS =
  process.env.CITEFOX_E2E_SHOTS_DIR ?? path.join(process.cwd(), 'test-results', 'structure')

export interface StructureApp {
  app: ElectronApplication
  page: Page
  /** Serve the base site or the site after a change (6 new, 1 removed, 14 changed). */
  serveSite: (variant: 'base' | 'next') => void
  close: () => Promise<void>
}

/**
 * The seeded two-market TextBolt project (one tracked page, two real checks
 * through the IPC handlers), with the unpackaged build reading recorded
 * sitemaps from a folder (`CITEFOX_E2E_SITEMAP_DIR`). No network.
 */
export async function openStructureApp(prefix: string): Promise<StructureApp> {
  installRawMarkdown()
  const { seedTwoMarketProject } = await import('./screens-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), `citefox-${prefix}-`))
  const sites = path.join(dir, 'sitemaps')
  mkdirSync(sites, { recursive: true })
  const serveSite = (variant: 'base' | 'next'): void => {
    for (const [url, body] of textboltSitemapFixture(variant).files) {
      writeFileSync(path.join(sites, encodeURIComponent(url)), body)
    }
  }
  serveSite('base')
  const data = path.join(dir, 'data')
  await seedTwoMarketProject(data)
  const { app, page } = await launchCiteFox({
    userDataDir: data,
    viewport: { width: 1280, height: 900 },
    env: { CITEFOX_E2E_SITEMAP_DIR: sites }
  })
  await openAllPages(page)
  return {
    app,
    page,
    serveSite,
    close: async () => {
      await app.close()
      await rm(dir, { recursive: true, force: true })
    }
  }
}

export async function saveShot(page: Page, name: string, fullPage = false): Promise<void> {
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage })
}

/**
 * Opens a part of Site structure (All pages › Tree) the way a person does: Folders,
 * Clusters and Groups from the toolbar's "Group ▾", Sitemaps and Last sync from the
 * status line (one row of tabs, monday audit #7).
 */
export async function openStructurePart(
  page: Page,
  part: 'Folders' | 'Clusters' | 'Groups' | 'Sitemaps' | 'Last sync'
): Promise<void> {
  const toolbar = page.locator('.str-tabs-row')
  if (part === 'Sitemaps' || part === 'Last sync') {
    const name = part === 'Sitemaps' ? /\d+ sitemaps?$/ : /^(Last sync|Not synced yet)/
    await toolbar.getByLabel('Site structure status').getByRole('link', { name }).click()
    return
  }
  await toolbar.getByRole('combobox', { name: 'Group' }).click()
  await page
    .getByRole('listbox')
    .getByRole('option', { name: new RegExp(`^${part}`) })
    .click()
}
