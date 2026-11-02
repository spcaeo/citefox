import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'
import { expectMainAccessible, openHash, shot } from './screens-app'
import { expectDrawerRows } from './drill-helpers'
import { openAllPages } from './nav-helpers'

/**
 * Prompts tab drill-downs on real IPC: each row opens Prompt detail (link and
 * Enter on the row), the coverage chip opens the row in Content gaps, tags
 * apply their facet, the version and template link out, and each coverage
 * count opens a drawer whose total equals it (NFR-14). The seed has no
 * coverage matrix (building one needs Claude), so this spec stores one first.
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
  const row = {
    runId: 'cov-p',
    pageId: 'page-1',
    currentContent: 'One line about alerts.',
    mainGap: 'No crew alert steps.',
    suggestedFaq: null,
    done: false
  }
  try {
    insertCoverage(db, {
      runId: 'cov-p',
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
          ...row,
          id: 'gap-p-1',
          promptId: 'prompt-1',
          coverage: 'weak',
          whereCovered: ['Intro'],
          whatToUpdate: 'Add crew alert steps.',
          priority: 'high',
          actions: ['new_faq']
        },
        {
          ...row,
          id: 'gap-p-2',
          promptId: 'prompt-2',
          coverage: 'strong',
          whereCovered: ['Pricing'],
          whatToUpdate: 'Nothing to change.',
          priority: 'low',
          actions: ['none']
        }
      ],
      findings: []
    })
  } finally {
    closeProjectDatabase(db)
    storage.close()
  }
}

async function openApp(): Promise<{ app: ElectronApplication; page: Page; dir: string }> {
  installRawMarkdown()
  const { seedTwoMarketProject } = await import('./screens-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-drill-prompts-'))
  await seedTwoMarketProject(dir)
  await storeCoverage(dir)
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 900 }
  })
  await openAllPages(page)
  return { app, page, dir }
}

test('prompts tab: rows, chips, tags and counts drill', async () => {
  test.setTimeout(180_000)
  const { app, page, dir } = await openApp()
  try {
    await openHash(page, '#/pages/page-1/prompts')
    const panel = page.getByRole('tabpanel')
    const grid = panel.getByRole('grid', { name: 'Buyer questions' })
    await expect(grid).toBeVisible()

    await test.step('each coverage count opens a drawer whose total equals it', async () => {
      const line = panel.getByRole('group', { name: 'Coverage against the page' })
      const openers = line.locator('[data-nfr-drill]')
      await expect(openers).toHaveCount(2)
      for (let index = 0; index < 2; index += 1) {
        const opener = openers.nth(index)
        const id = (await opener.getAttribute('data-nfr-drill')) ?? ''
        const figure = (await line.locator(`[data-nfr-figure="${id}"]`).textContent()) ?? ''
        await opener.focus()
        await page.keyboard.press('Enter')
        const drawer = page.getByRole('dialog')
        await expectDrawerRows(drawer, figure)
        await expect(drawer.locator('[data-drill-row]')).toHaveCount(Number(figure))
        await page.keyboard.press('Escape')
        await expect(drawer).toHaveCount(0)
        await expect(opener).toBeFocused()
      }
      await line.getByRole('button', { name: /^1 question: Weak coverage/ }).click()
      const drawer = page.getByRole('dialog')
      await expect(drawer.getByRole('link', { name: /Crew alerts/ })).toHaveAttribute(
        'href',
        /\/prompt\/prompt-1\?market=mkt-us$/
      )
      await shot(page, 'drill-prompts-coverage')
      await page.keyboard.press('Escape')
    })

    await test.step('row links: Content gaps row; Version history and Template', async () => {
      await expect(
        grid.getByRole('link', { name: 'Weak coverage: open question 1 in Content gaps' })
      ).toHaveAttribute('href', '#/pages/page-1/gaps?filter=row%3Aprompt-1')
      await expect(panel.getByRole('link', { name: 'Version history' })).toHaveAttribute(
        'href',
        '#/pages/page-1/history'
      )
      await expect(panel.getByRole('link', { name: /^Template: CiteFox default/ })).toHaveAttribute(
        'href',
        '#/templates/tpl-buyer-prompts'
      )
    })

    await test.step('the row menu opens the editor at its own URL', async () => {
      await grid.getByRole('button', { name: 'Actions for question 1' }).click()
      await page.getByRole('menuitem', { name: 'Edit wording' }).click()
      await expect
        .poll(() => page.evaluate(() => window.location.hash))
        .toMatch(/^#\/pages\/page-1\/prompts\?(.*&)?drawer=pt-edit&pt\.edit=prompt-1$/)
      await expect(page.getByRole('dialog', { name: 'Edit question' })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog', { name: 'Edit question' })).toHaveCount(0)
      await expect.poll(() => page.evaluate(() => window.location.hash)).not.toContain('drawer=')
    })

    await expectMainAccessible(page)

    await test.step('Enter on a row opens Prompt detail in the picked market', async () => {
      await openHash(page, '#/pages/page-1/prompts')
      const row = grid.locator('.ui-lg-row').first()
      await row.locator('.pr-text').click()
      await expect
        .poll(() => page.evaluate(() => window.location.hash))
        .toMatch(/^#\/pages\/page-1\/prompt\/prompt-\d+\?market=mkt-us$/)
    })

    await test.step('the coverage chip opens that row in Content gaps', async () => {
      await openHash(page, '#/pages/page-1/prompts')
      await page
        .getByRole('link', { name: 'Strong coverage: open question 2 in Content gaps' })
        .click()
      await expect
        .poll(() => page.evaluate(() => window.location.hash))
        .toBe('#/pages/page-1/gaps?filter=row%3Aprompt-2')
    })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
