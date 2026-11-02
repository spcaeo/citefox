import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'
import { expectMainAccessible, openHash, shot } from './screens-app'
import { expectDrawerRows } from './drill-helpers'
import { openAllPages } from './nav-helpers'

/**
 * Content gaps drill-downs on real IPC: every count opens a drawer whose
 * total equals it (NFR-14), rows open their one-by-one item, prompt labels
 * open Prompt detail in the page's market, and `?filter=row:<id>` focuses a row.
 * The seed has no coverage matrix (building one needs Claude), so this spec
 * stores one through the project database before launch.
 */

const BODY = 'TextBolt sends text alerts from email. No developer required.'

async function storeCoverage(userDataDir: string): Promise<void> {
  const { openAppStorage } = await import('../../src/main/storage/app-storage')
  const { closeProjectDatabase, openProjectDatabase } =
    await import('../../src/main/storage/project-files')
  const { insertCoverage } = await import('../../src/main/storage/coverage-records')
  const { contentHash } = await import('../../src/main/pipeline/hash')
  const storage = openAppStorage(userDataDir)
  const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  try {
    insertCoverage(db, {
      runId: 'cov-1',
      pageId: 'page-1',
      recordedAt: '2026-10-19T13:00:00.000Z',
      templateId: 'tpl-coverage',
      templateName: 'CiteFox default',
      templateHash: contentHash('coverage template'),
      templateUpdatedAt: null,
      contentHash: contentHash(BODY),
      reused: false,
      stale: false,
      rows: [
        {
          id: 'gap-row-1',
          runId: 'cov-1',
          pageId: 'page-1',
          promptId: 'prompt-1',
          coverage: 'weak',
          whereCovered: ['Intro'],
          currentContent: 'One line about alerts.',
          whatToUpdate: 'Add a section on alerting a crew without a developer.',
          mainGap: 'No crew alert steps.',
          priority: 'high',
          actions: ['new_faq'],
          suggestedFaq: null,
          done: false
        },
        {
          id: 'gap-row-2',
          runId: 'cov-1',
          pageId: 'page-1',
          promptId: 'prompt-2',
          coverage: 'strong',
          whereCovered: ['Pricing'],
          currentContent: 'The plan table lists scheduled texts.',
          whatToUpdate: 'Nothing to change.',
          mainGap: 'None.',
          priority: 'low',
          actions: ['none'],
          suggestedFaq: null,
          done: false
        }
      ],
      findings: [
        {
          id: 'finding-1',
          runId: 'cov-1',
          pageId: 'page-1',
          kind: 'title_length',
          summary: 'The title is too long for search results.',
          detail: 'It runs past 60 characters.'
        }
      ]
    })
  } finally {
    closeProjectDatabase(db)
    storage.close()
  }
}

async function openApp(): Promise<{ app: ElectronApplication; page: Page; dir: string }> {
  installRawMarkdown()
  const { seedTwoMarketProject } = await import('./screens-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-drill-gaps-'))
  await seedTwoMarketProject(dir)
  await storeCoverage(dir)
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 900 }
  })
  await openAllPages(page)
  return { app, page, dir }
}

test('content gaps: every number drills, rows open, prompts link in the market', async () => {
  test.setTimeout(180_000)
  const { app, page, dir } = await openApp()
  try {
    await openHash(page, '#/pages/page-1/gaps')
    const panel = page.locator('#page-tabpanel')
    const matrix = panel.getByRole('grid', { name: 'Coverage matrix' })
    const row = (text: string): Locator => matrix.locator('.ui-lg-row', { hasText: text })
    const matrixTab = panel.getByRole('tab', { name: /^Matrix/ })
    await expect(matrix).toBeVisible()

    await test.step('every drill opens a drawer whose total equals its number', async () => {
      const openers = panel.locator('[data-nfr-drill]')
      const count = await openers.count()
      // A count of zero is plain text (nothing to open), so the openers plus the zeros cover all 13.
      const zeros = await panel.locator('.drill-num-zero').count()
      expect(count + zeros).toBeGreaterThanOrEqual(13)
      expect(count).toBeGreaterThan(0)
      for (let index = 0; index < count; index += 1) {
        const opener = openers.nth(index)
        const id = (await opener.getAttribute('data-nfr-drill')) ?? ''
        const figure = await panel.locator(`[data-nfr-figure="${id}"]`).first().textContent()
        await opener.click()
        const drawer = page.getByRole('dialog')
        await expectDrawerRows(drawer, figure ?? '')
        await page.keyboard.press('Escape')
        await expect(drawer).toHaveCount(0)
      }
    })

    await test.step('keyboard: Enter on a count opens it, Escape returns focus', async () => {
      const weak = panel
        .getByRole('region', { name: 'Coverage summary' })
        .getByRole('button', { name: '1 question with Weak coverage' })
      await weak.focus()
      await page.keyboard.press('Enter')
      const drawer = page.getByRole('dialog')
      await expect(drawer.getByRole('heading', { name: 'Weak coverage · 1 question' })).toBeVisible()
      await expect(drawer.getByRole('link', { name: /Crew alerts/ })).toHaveAttribute(
        'href',
        /\/prompt\/prompt-1\?market=mkt-us$/
      )
      await shot(page, 'drill-gaps-drawer')
      await page.keyboard.press('Escape')
      await expect(weak).toBeFocused()
    })

    await test.step('a row click opens and focuses its one-by-one item', async () => {
      await row('Scheduled plan').locator('.gp-gap').click()
      const item = panel.locator('#gap-gap-row-2 .ps-acc-btn')
      await expect(item).toBeFocused()
      await expect(item).toHaveAttribute('aria-expanded', 'true')
      await expect
        .poll(() => page.evaluate(() => window.location.hash))
        .toContain('filter=row%3Aprompt-2')
    })

    await test.step('Enter on a row does the same', async () => {
      await matrixTab.click()
      await row('Crew alerts').focus()
      await page.keyboard.press('Enter')
      await expect(panel.locator('#gap-gap-row-1 .ps-acc-btn')).toBeFocused()
      await expect(
        panel.getByRole('link', { name: "See this question's AI Overview" })
      ).toHaveAttribute('href', /\/prompt\/prompt-1\?market=mkt-us$/)
    })

    await test.step('cells and the row menu filter the matrix', async () => {
      await matrixTab.click()
      await matrix.getByRole('button', { name: 'Filter by action New FAQ' }).click()
      await expect(panel.getByText('Showing 1 of 2 questions')).toBeVisible()
      await panel.getByRole('button', { name: 'Remove filter Action: New FAQ' }).click()
      await expect(panel.getByText('Showing 2 questions')).toBeVisible()
    })

    await expectMainAccessible(page)
    await shot(page, 'drill-gaps', true)

    await test.step('the row menu opens where the page covers it', async () => {
      await row('Crew alerts')
        .getByRole('button', { name: /^Actions for question / })
        .click()
      await page.getByRole('menuitem', { name: /^Where on the page: Intro/ }).click()
      await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/pages/page-1/read')
    })

    await test.step('prompt labels open Prompt detail in the picked market', async () => {
      await openHash(page, '#/pages/page-1/gaps?market=mkt-uk')
      const link = matrix.getByRole('link', { name: 'Crew alerts: open Question detail' })
      await expect(link).toHaveAttribute('href', /\/prompt\/prompt-1\?market=mkt-uk$/)
      await link.click()
      await expect
        .poll(() => page.evaluate(() => window.location.hash))
        .toContain('/prompt/prompt-1?market=mkt-uk')
    })

    await test.step('a route focus opens and focuses that row', async () => {
      await openHash(page, '#/pages/page-1/gaps?filter=row%3Aprompt-2')
      await expect(panel.locator('#gap-gap-row-2 .ps-acc-btn')).toBeFocused()
      await expect(panel.locator('#gap-gap-row-2 .ps-acc-btn')).toHaveAttribute(
        'aria-expanded',
        'true'
      )
    })

    await test.step('page-wide fixes have their own tab and address', async () => {
      await openHash(page, '#/pages/page-1/gaps?filter=view%3Afixes')
      const fixes = panel.getByRole('region', { name: 'Page-wide fixes' })
      await expect(fixes.getByRole('link', { name: 'See shorter title options' })).toHaveAttribute(
        'href',
        '#/pages/page-1/read'
      )
    })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
