import AxeBuilder from '@axe-core/playwright'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ThemePreference } from '../../src/shared/domain'
import type { CiteFoxApi } from '../../src/shared/ipc'
import { TEXTBOLT_TOPIC_ID } from '../../src/shared/fixtures/textbolt-topic'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'
import { openAllPages } from './nav-helpers'

/**
 * Light / Dark / System (the top bar Theme button, View › Appearance) in the built
 * app: the setting switches <html data-theme> and the page background, main's
 * nativeTheme follows, System follows the emulated OS colour scheme live, the
 * choice survives a relaunch with no light first frame, and the key screens
 * pass axe colour-contrast in both themes. Every main screen is screenshotted
 * in both themes to test-results/e2e/theme-{light|dark}-{screen}.png.
 */

const GROUND = { light: 'rgb(255, 255, 255)', dark: 'rgb(17, 17, 17)' } as const
type Theme = keyof typeof GROUND

async function seed(): Promise<string> {
  installRawMarkdown()
  const { seedTwoMarketProject, SEED } = await import('./screens-seed')
  const { openAppStorage } = await import('../../src/main/storage/app-storage')
  const { closeProjectDatabase, openProjectDatabase } =
    await import('../../src/main/storage/project-files')
  const { projectDatabaseRelativePath } = await import('../../src/main/storage/slug')
  const { seedTextboltTopic } = await import('../../src/main/topics/fixture-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-theme-'))
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
    // Hold the queue so the seeded topic's due checks never search offline.
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

async function launch(dir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1440, height: 900 }
  })
  await page.emulateMedia({ colorScheme: 'light' })
  await openAllPages(page)
  return { app, page }
}

async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((next) => {
    window.location.hash = next
  }, hash)
}

/** Saves a theme through the preload bridge, as Settings does. */
async function saveTheme(page: Page, theme: ThemePreference): Promise<void> {
  await page.evaluate(async (choice) => {
    const api = (window as unknown as { citefox: CiteFoxApi }).citefox
    await api['settings:update']({ theme: choice })
  }, theme)
}

async function htmlTheme(page: Page): Promise<string | undefined> {
  return page.evaluate(() => document.documentElement.dataset.theme)
}

async function bodyBackground(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor)
}

async function expectTheme(page: Page, theme: Theme): Promise<void> {
  await expect.poll(() => htmlTheme(page)).toBe(theme)
  await expect.poll(() => bodyBackground(page)).toBe(GROUND[theme])
}

async function themeSource(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)
}

async function settle(page: Page): Promise<void> {
  await expect(page.locator('#main h1').first()).toBeVisible()
  await expect(page.getByText(/^Loading/)).toHaveCount(0)
  await expect(page.getByText(/Error invoking remote method/)).toHaveCount(0)
  // The work console (a background Claude job) would cover the screen; hide it.
  const hide = page.getByRole('button', { name: 'Hide the console, the work keeps running' })
  if (await hide.isVisible()) await hide.click()
  // Let fonts, charts and the theme transition land before a screenshot.
  await page.waitForTimeout(300)
}

async function shot(page: Page, theme: Theme, name: string): Promise<void> {
  await page.evaluate(() => document.querySelector('#main')?.scrollTo(0, 0))
  await page.screenshot({ path: await e2eArtifact(`theme-${theme}-${name}.png`) })
}

/** axe colour-contrast over the whole window (sidebar, strip, drawers included). */
async function contrastProblems(page: Page, screen: string): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .setLegacyMode()
    .withRules(['color-contrast'])
    .analyze()
  return results.violations.flatMap((violation) =>
    violation.nodes.map(
      (node) =>
        `${screen} · ${node.target.join(' ')} :: ${(node.failureSummary ?? '').replace(/\n/g, ' ')}`
    )
  )
}

test('the top bar Theme button and View › Appearance switch the theme; System follows the OS', async () => {
  test.setTimeout(240_000)
  const dir = await seed()
  let { app, page } = await launch(dir)
  try {
    // Default: System, light OS.
    expect(await themeSource(app)).toBe('system')
    await expectTheme(page, 'light')

    await openHash(page, '#/settings')
    // Light, Dark and System sit behind the Theme button, a tick on the current one.
    const themeButton = page.getByRole('banner').getByRole('button', { name: 'Theme', exact: true })
    const pick = async (label: 'Light' | 'Dark' | 'System'): Promise<void> => {
      await themeButton.click()
      await page.getByRole('menuitemradio', { name: `Theme: ${label}` }).click()
    }
    const ticked = async (label: 'Light' | 'Dark' | 'System'): Promise<void> => {
      await themeButton.click()
      await expect(page.getByRole('menuitemradio', { name: `Theme: ${label}` })).toHaveAttribute(
        'aria-checked',
        'true'
      )
      await page.keyboard.press('Escape')
    }
    await ticked('System')

    await pick('Dark')
    await expectTheme(page, 'dark')
    await expect.poll(() => themeSource(app)).toBe('dark')
    // The OS saying light no longer matters.
    await page.emulateMedia({ colorScheme: 'light' })
    await expectTheme(page, 'dark')

    await pick('Light')
    await expectTheme(page, 'light')
    await expect.poll(() => themeSource(app)).toBe('light')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expectTheme(page, 'light')

    // System follows the (emulated) OS colour scheme, live.
    await pick('System')
    await expect.poll(() => themeSource(app)).toBe('system')
    await expectTheme(page, 'dark')
    await page.emulateMedia({ colorScheme: 'light' })
    await expectTheme(page, 'light')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expectTheme(page, 'dark')
    await page.emulateMedia({ colorScheme: 'light' })

    // View › Appearance › Dark: saved, applied, and the Theme button follows.
    await app.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()?.getMenuItemById('appearance-dark')?.click()
    })
    await expectTheme(page, 'dark')
    await ticked('Dark')
    expect(
      await app.evaluate(
        ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('appearance-dark')?.checked
      )
    ).toBe(true)
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.getBackgroundColor().toLowerCase()
      )
    ).toBe('#111111')

    // A relaunch keeps Dark, and the first frame is already dark (theme-boot.js).
    await app.close()
    ;({ app, page } = await launchCiteFox({
      userDataDir: dir,
      viewport: { width: 1440, height: 900 }
    }))
    expect(await themeSource(app)).toBe('dark')
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.getBackgroundColor().toLowerCase()
      )
    ).toBe('#111111')
    await expectTheme(page, 'dark')
    // Playwright emulates a light colour scheme by default; drop that so the
    // page sees what nativeTheme says, as in the real app.
    await page.emulateMedia({ colorScheme: null })
    expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true)
    // theme-boot.js is a classic script in <head>, before the app bundle, so it
    // runs before first paint; run it again from scratch and it says dark.
    expect(
      await page.evaluate(() => {
        const scripts = [...document.head.querySelectorAll('script')].map((node) =>
          node.getAttribute('src')
        )
        return scripts.indexOf('./theme-boot.js') === 0 && scripts.length > 1
      })
    ).toBe(true)
    const booted = await page.evaluate(
      () =>
        new Promise<string | undefined>((resolve) => {
          delete document.documentElement.dataset.theme
          const script = document.createElement('script')
          script.src = './theme-boot.js'
          script.onload = () => {
            resolve(document.documentElement.dataset.theme)
          }
          document.head.append(script)
        })
    )
    expect(booted).toBe('dark')

    // Back to System for the next run of this profile.
    await saveTheme(page, 'system')
    await expect.poll(() => themeSource(app)).toBe('system')
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

/** Key screens: axe colour-contrast in both themes. */
const KEY_SCREENS: readonly (readonly [string, string])[] = [
  ['overview', '#/overview'],
  ['topics', '#/topics'],
  ['topic', `#/topics/${TEXTBOLT_TOPIC_ID}`],
  ['questions', '#/questions'],
  ['page-results', '#/pages/page-1/results'],
  ['competitors', '#/competitors'],
  ['all-pages', '#/pages'],
  ['settings', '#/settings?tab=general'],
  ['settings-connections', '#/settings']
]

/** Every other main screen: screenshots in both themes (looked at by hand). */
const OTHER_SCREENS: readonly (readonly [string, string])[] = [
  ['citations', '#/citations'],
  ['fixes', '#/fixes'],
  ['history', '#/history'],
  ['ask', '#/ask'],
  ['structure', '#/structure'],
  ['youtube', '#/youtube'],
  ['communities', '#/communities'],
  ['reports', '#/reports'],
  ['project-settings', '#/project-settings'],
  ['connections', '#/connections'],
  ['permissions', '#/permissions'],
  ['alerts', '#/alerts'],
  ['templates', '#/templates'],
  ['playground', '#/playground'],
  ['gallery', '#/playground/gallery'],
  ['projects', '#/projects'],
  ['status', '#/status'],
  ['export', '#/export'],
  ['page-progress', '#/pages/page-1/progress'],
  ['page-markets', '#/pages/page-1/markets'],
  ['page-gaps', '#/pages/page-1/gaps'],
  ['page-prompts', '#/pages/page-1/prompts'],
  ['page-audience', '#/pages/page-1/audience'],
  ['prompt-detail', '#/pages/page-1/prompt/prompt-1'],
  ['topic-stage', `#/topics/${TEXTBOLT_TOPIC_ID}?tab=stage`],
  ['topic-progress', `#/topics/${TEXTBOLT_TOPIC_ID}?tab=progress`],
  ['settings-about', '#/settings?tab=data']
]

for (const theme of ['light', 'dark'] as const) {
  test(`key screens pass colour contrast in ${theme}, and every main screen is screenshotted`, async () => {
    test.setTimeout(420_000)
    const dir = await seed()
    const { app, page } = await launch(dir)
    const problems: string[] = []
    try {
      await saveTheme(page, theme)
      await expectTheme(page, theme)

      for (const [name, hash] of KEY_SCREENS) {
        await openHash(page, hash)
        await settle(page)
        await shot(page, theme, name)
        problems.push(...(await contrastProblems(page, name)))
      }

      // A drawer: All pages › a "Page cited" number opens the drill drawer.
      await openHash(page, '#/pages')
      await settle(page)
      const cited = page
        .getByRole('grid', { name: 'Pages' })
        .locator('button[data-nfr-drill^="allpages:cited:"]')
        .first()
      await cited.click()
      const drawer = page.getByRole('dialog').filter({ has: page.getByRole('grid') })
      await expect(drawer).toBeVisible()
      await page.waitForTimeout(400)
      await shot(page, theme, 'drawer-cited')
      problems.push(...(await contrastProblems(page, 'drawer-cited')))
      await page.keyboard.press('Escape')
      await expect(drawer).toHaveCount(0)

      for (const [name, hash] of OTHER_SCREENS) {
        await openHash(page, hash)
        await settle(page)
        await shot(page, theme, name)
      }

      await writeFile(await e2eArtifact(`theme-${theme}-contrast.txt`), problems.join('\n'))
      expect(problems).toEqual([])
    } finally {
      await app.close()
      await rm(dir, { recursive: true, force: true })
    }
  })
}
