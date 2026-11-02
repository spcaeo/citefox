import AxeBuilder from '@axe-core/playwright'
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'
import { openAllPages } from './nav-helpers'

export interface SeededApp {
  app: ElectronApplication
  page: Page
  close: () => Promise<void>
}

/** Seeds the two-market TextBolt project, then opens the production shell on it. */
export async function openTwoMarketApp(
  prefix: string,
  seed: { checksAt?: readonly string[] } = {}
): Promise<SeededApp> {
  installRawMarkdown()
  const { seedTwoMarketProject } = await import('./screens-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), `citefox-${prefix}-`))
  await seedTwoMarketProject(dir, seed)
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 900 }
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

export async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((next) => {
    window.location.hash = next
  }, hash)
}

/**
 * Picks a choice in the custom Dropdown (ui/Dropdown): a combobox button that opens a
 * listbox of options, not a native <select>, so `selectOption` does not work on it.
 */
export async function pickDropdown(combobox: Locator, option: string | RegExp): Promise<void> {
  await combobox.click()
  await expect(combobox).toHaveAttribute('aria-expanded', 'true')
  const listId = await combobox.getAttribute('aria-controls')
  const list = combobox.page().locator(`[id="${listId}"]`)
  await list.getByRole('option', { name: option, exact: typeof option === 'string' }).click()
  await expect(list).toHaveCount(0)
}

/**
 * Picks a list filter (a grid's `filterControls`, audit2 #7): its own toolbar
 * dropdown while the row has room, else the same choice inside Filter ▾.
 */
export async function pickFilter(page: Page, name: string, option: RegExp): Promise<void> {
  const own = page.getByRole('combobox', { name, exact: true })
  if (await own.isVisible()) {
    await pickDropdown(own, option)
    return
  }
  await page.getByRole('button', { name: /^Filter/ }).click()
  await page
    .getByRole('menuitemradio', { name: new RegExp(`^${name}: .*${option.source}`) })
    .click()
  await page.keyboard.press('Escape')
}

export async function expectMainAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include('#main')
    .setLegacyMode()
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations).toEqual([])
}

export async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  await page.screenshot({ path: await e2eArtifact(`${name}.png`), fullPage })
}
