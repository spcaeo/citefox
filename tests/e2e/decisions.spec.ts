import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { appDataPaths } from '../../src/main/storage/paths'
import { closeProjectDatabase, openProjectDatabase } from '../../src/main/storage/project-files'
import { recordTrackingChange } from '../../src/main/storage/tracking-changes'
import { e2eArtifact } from './artifacts'
import { launchJourneyApp, onboardTextBolt } from './journey-app'
import { launchCiteFox } from './launch'
import { hubTabs, openAllPages, sidebar } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { openHash } from './screens-app'

/**
 * The owner's November decisions on real IPC with no paid calls:
 * 1. charts mark CiteFox's own tracking changes in grey (one marker per day, a card, a toggle);
 * 2. the shorter left menu: one Pages and one Settings item, their screens as tabs, every
 *    old address still opening;
 * 4. "Alerts & schedules" in the menu, the title, the breadcrumb and Ctrl+K;
 * 5. project rules: saved from a setup card's Redo box, listed in Project settings ›
 *    Project rules, and carried by the next AI prompt (the Claude stand-in logs it).
 * Screenshots go to test-results/e2e/decisions/.
 */

async function shot(page: Page, name: string): Promise<void> {
  await page.mouse.move(0, 0)
  await page.screenshot({ path: await e2eArtifact(`decisions/${name}.png`) })
}

async function hash(page: Page): Promise<string> {
  return page.evaluate(() => window.location.hash)
}

async function seededApp(): Promise<{ page: Page; close: () => Promise<void> }> {
  installRawMarkdown()
  const { seedProgressProject } = await import('./progress-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-decisions-'))
  await seedProgressProject(dir)
  // Two tracking changes on Oct 14 for this page, one for another page (not on its chart).
  const db = openProjectDatabase(appDataPaths(dir).projectsDirectory, 'textbolt')
  try {
    const at = '2026-10-14T10:00:00.000Z'
    recordTrackingChange(db, { at, kind: 'questions_added', pageId: 'page-1', count: 4 })
    recordTrackingChange(db, { at, kind: 'engine_on', detail: 'ChatGPT' })
    recordTrackingChange(db, { at, kind: 'questions_added', pageId: 'page-other', count: 9 })
  } finally {
    closeProjectDatabase(db)
  }
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 900 }
  })
  return {
    page,
    close: async () => {
      await app.close()
      await rm(dir, { recursive: true, force: true })
    }
  }
}

test('charts mark a day of tracking changes in grey, with a card and a toggle', async () => {
  test.setTimeout(240_000)
  const { page, close } = await seededApp()
  try {
    await openAllPages(page)
    await openHash(page, '#/pages/page-1/progress')
    const rate = page.locator('#page-tabpanel [data-nfr-chart="citation-rate"]')
    await expect(rate.getByRole('img', { name: /Share of AI Overviews/ })).toBeVisible()
    const marker = rate.getByRole('button', { name: /Oct 14, Tracking changed: 2 changes/ })
    await expect(marker).toBeVisible()
    await expect(marker).toHaveAttribute('data-marker-kind', 'tracking')
    await expect(marker.locator('.ui-mk-tracking')).toHaveText('±')
    await marker.hover()
    const card = rate.locator('.ui-chart-card')
    await expect(card).toContainText('Tracking changed')
    await expect(card).toContainText('You added 4 questions. ChatGPT turned on.')
    await expect(card).not.toContainText('9 questions')
    await rate.screenshot({ path: await e2eArtifact('decisions/chart-tracking-card.png') })

    // Its own chip, like the other kinds; hiding it is kept in the URL.
    const chip = rate.getByRole('button', { name: 'Tracking changes', exact: true })
    await expect(chip).toHaveAttribute('aria-pressed', 'true')
    await page.mouse.move(0, 0)
    await chip.click()
    await expect.poll(() => hash(page)).toContain('marks.hide=tracking')
    await expect(rate.getByRole('button', { name: /Tracking changed/ })).toHaveCount(0)
    await rate.screenshot({ path: await e2eArtifact('decisions/chart-tracking-hidden.png') })
    await chip.click()
    await expect(marker).toBeVisible()

    // The Summary's trend chart shows the project's changes too (every page's questions).
    await openHash(page, '#/overview')
    await expect(page.getByRole('heading', { level: 1, name: 'Summary' })).toBeVisible()
    const anyTracking = page.locator('#main [data-marker-kind="tracking"]').first()
    if ((await anyTracking.count()) > 0) {
      await anyTracking.scrollIntoViewIfNeeded()
      await shot(page, 'summary-tracking')
    }
  } finally {
    await close()
  }
})

test('one Pages and one Settings item; their screens are tabs and old addresses still open', async () => {
  test.setTimeout(240_000)
  const { page, close } = await seededApp()
  try {
    await openAllPages(page)
    const nav = sidebar(page)
    const names = await nav.locator('.side-scroll a .nav-text').allTextContents()
    expect(names.slice(-2)).toEqual(['Pages', 'Settings'])
    expect(names).toContain('Alerts & schedules')
    for (const gone of [
      'YouTube',
      'Communities',
      'Project settings',
      'Connections',
      'App settings'
    ]) {
      expect(names).not.toContain(gone)
    }
    await expect(nav.getByRole('button', { name: /^Your site/ })).toHaveCount(0)
    await expect(nav.getByRole('button', { name: /^Setup/ })).toHaveCount(0)
    await nav.screenshot({ path: await e2eArtifact('decisions/sidebar.png') })

    // Settings opens Project settings, with Connections and App settings as tabs.
    await nav.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Project settings' })).toBeVisible()
    const settings = hubTabs(page, 'Settings')
    await expect(settings.getByRole('tab', { name: 'Project settings' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await shot(page, 'settings-project')
    await settings.getByRole('tab', { name: 'Connections' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Connections' })).toBeVisible()
    await expect.poll(() => hash(page)).toMatch(/#\/(p\/[^/]+\/)?connections$/)
    await expect(nav.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Settings')
    await shot(page, 'settings-connections')

    // Pages has YouTube and Communities as tabs.
    await nav.getByRole('link', { name: /^Pages/ }).click()
    const pagesTabs = hubTabs(page, 'Pages')
    await expect(pagesTabs.getByRole('tab', { name: 'Pages' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await pagesTabs.getByRole('tab', { name: 'YouTube' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'YouTube' })).toBeVisible()
    await expect(page.getByText('Loading YouTube…')).toHaveCount(0)
    await shot(page, 'pages-youtube')

    // Every old address opens its screen under the right tab, with its sidebar item current.
    for (const [old, heading, hub, tab] of [
      ['#/communities', 'Communities', 'Pages', 'Communities'],
      ['#/youtube', 'YouTube', 'Pages', 'YouTube'],
      ['#/project-settings?tab=markets', 'Project settings', 'Settings', 'Project settings'],
      ['#/connections', 'Connections', 'Settings', 'Connections'],
      ['#/settings', 'App settings', 'Settings', 'App settings'],
      ['#/settings?tab=appearance', 'App settings', 'Settings', 'App settings'],
      ['#/permissions', 'What CiteFox needs', 'Settings', 'App settings'],
      ['#/playground', 'Playground', 'Settings', 'Playground']
    ] as const) {
      await openHash(page, old)
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
      await expect(hubTabs(page, hub).getByRole('tab', { name: tab })).toHaveAttribute(
        'aria-selected',
        'true'
      )
      const item = hub === 'Pages' ? /^Pages/ : /^Settings$/
      await expect(nav.getByRole('link', { name: item })).toHaveAttribute('aria-current', 'page')
    }
    await shot(page, 'settings-playground')

    // Ctrl+K finds the moved screens under their new names.
    await page.keyboard.press('ControlOrMeta+k')
    const box = page.getByRole('combobox', {
      name: 'Find anything: screens, settings, reports, help, actions, pages, topics and questions'
    })
    await box.fill('youtube')
    const results = page.getByRole('listbox', { name: 'Search results' })
    await expect(results.getByRole('option', { name: /Pages · YouTube/ }).first()).toBeVisible()
    await shot(page, 'search-youtube')
    await box.fill('alert rules')
    await expect(
      results.getByRole('option', { name: /Alerts & schedules · Alert rules/ }).first()
    ).toBeVisible()
    await box.press('Escape')
  } finally {
    await close()
  }
})

test('Alerts & schedules: the menu item, the title and the breadcrumb, at the same address', async () => {
  test.setTimeout(180_000)
  const { page, close } = await seededApp()
  try {
    await openAllPages(page)
    await sidebar(page).getByRole('link', { name: 'Alerts & schedules', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Alerts & schedules' })).toBeVisible()
    await expect.poll(() => hash(page)).toMatch(/#\/(p\/[^/]+\/)?alerts$/)
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(
      'Alerts & schedules'
    )
    await shot(page, 'alerts-and-schedules')
  } finally {
    await close()
  }
})

test('project rules: saved from Redo, listed in Project settings, and in the next AI prompt', async () => {
  test.setTimeout(360_000)
  const RULE = 'Never call TextBolt a cloud service'
  const journey = await launchJourneyApp('rules')
  const { app, page } = journey
  try {
    await onboardTextBolt(page, {
      onStep: async (step) => {
        if (step !== 'buyers') return
        const buyers = page.getByTestId('section-buyers')
        await buyers.getByRole('button', { name: 'AI actions for Buyers' }).click()
        await buyers.getByTestId('menu-redo').click()
        const redo = buyers.getByTestId('redo-box')
        const keep = redo.getByRole('checkbox', { name: /Save as a project rule/ })
        await expect(keep).toBeChecked()
        await redo.getByRole('textbox').fill(RULE)
        await shot(page, 'rules-redo-box')
        await redo.getByRole('button', { name: /Redo buyers/ }).click()
        await expect(redo).toBeHidden({ timeout: 30_000 })
      }
    })

    // The first check's celebration may be up: close it before looking.
    const nice = page.getByRole('button', { name: 'Nice!' })
    const closeCelebration = async (): Promise<void> => {
      await nice.click({ timeout: 5_000 }).catch(() => undefined)
      await expect(page.locator('.celebrate-dim')).toHaveCount(0, { timeout: 15_000 })
    }
    await closeCelebration()
    // Finish saved the rule to the project: Project settings › Project rules lists it.
    await openHash(page, '#/project-settings?tab=rules')
    const rules = page.getByRole('region', { name: 'Project rules' })
    await expect(rules.getByRole('list', { name: 'Project rules' })).toContainText(RULE)
    await expect(rules.getByRole('checkbox', { name: `Use the rule: ${RULE}` })).toBeChecked()
    await closeCelebration()
    await shot(page, 'rules-project-settings')

    // The Claude stand-in logs the rules each prompt carried: the topic and questions
    // written after the Redo carry this one.
    const logPath = await app.evaluate(() => process.env.CITEFOX_SHIM_LOG ?? '')
    const log = await readFile(logPath, 'utf8')
    const ruled = log.split('\n').filter((line) => line.includes(`RULES: ${RULE}`))
    expect(ruled.length).toBeGreaterThan(0)
    expect(ruled.some((line) => /^Assist: setup\.(topic|questions)/.test(line))).toBe(true)
  } finally {
    await journey.close()
  }
})
