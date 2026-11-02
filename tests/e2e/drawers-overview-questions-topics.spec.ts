import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TEXTBOLT_TOPIC_ID } from '../../src/shared/fixtures/textbolt-topic'
import { drawerShots } from './drawer-helpers'
import { launchCiteFox } from './launch'
import { openAllPages } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { openHash } from './screens-app'

/**
 * Wave 3 (B) overlays on the Drawer and Confirm, in the built app with real
 * handlers: the two-market TextBolt project plus the TextBolt topic seeded as
 * stored checks. Each drawer opens from its URL, closes on Esc or ✕ with the
 * URL losing it, and Back closes it; Target bands asks before throwing away a
 * change. Screenshots: test-results/e2e/drawer-<name>-<width>.png.
 */
async function launch(): Promise<{ app: ElectronApplication; page: Page; dir: string }> {
  installRawMarkdown()
  const { seedTwoMarketProject, SEED } = await import('./screens-seed')
  const { openAppStorage } = await import('../../src/main/storage/app-storage')
  const { closeProjectDatabase, openProjectDatabase } =
    await import('../../src/main/storage/project-files')
  const { projectDatabaseRelativePath } = await import('../../src/main/storage/slug')
  const { seedTextboltTopic } = await import('../../src/main/topics/fixture-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-w3b-'))
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
    // Hold the queue so the seeded topic is not searched (offline) when it comes due.
    storage.db
      .prepare(
        `INSERT OR REPLACE INTO queue_pause (id, state, paused_on) VALUES (1, 'paused_all', NULL)`
      )
      .run()
  } finally {
    closeProjectDatabase(db)
    storage.close()
  }
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1440, height: 900 }
  })
  await openAllPages(page)
  return { app, page, dir }
}

function hash(page: Page): Promise<string> {
  return page.evaluate(() => window.location.hash)
}

test('Overview, Questions and Topics overlays are drawers and confirms on the URL', async () => {
  test.setTimeout(300_000)
  const { app, page, dir } = await launch()
  const restore = { width: 1440, height: 900 }
  try {
    await test.step('How we measure: link, Esc, Back', async () => {
      await openHash(page, '#/overview')
      await expect(page.getByRole('heading', { level: 1, name: 'Summary' })).toBeVisible()
      await openHash(page, '#/overview?panel=method')
      const method = page.getByRole('dialog', { name: 'How we measure' })
      await expect(method).toBeVisible()
      await expect(method).toHaveAttribute('data-drawer', 'method')
      // Read-only: a single Close, no primary.
      await expect(method.getByRole('button', { name: 'Close', exact: true })).toBeVisible()
      await drawerShots(page, 'w3b-method', restore)
      await page.keyboard.press('Escape')
      await expect(method).toHaveCount(0)
      await expect.poll(() => hash(page)).not.toContain('panel=')

      await page.getByRole('button', { name: 'How we measure' }).click()
      await expect(method).toBeVisible()
      await expect.poll(() => hash(page)).toContain('panel=method')
      await page.goBack()
      await expect(method).toHaveCount(0)
      await expect.poll(() => hash(page)).not.toContain('panel=')
      await page.goForward()
      await expect(method).toBeVisible()
      await method.getByRole('button', { name: 'Close How we measure' }).click()
      await expect(method).toHaveCount(0)
    })

    await test.step('Questions: Set target page drawer and the re-check confirm', async () => {
      await openHash(page, '#/questions')
      const grid = page.getByRole('grid', { name: 'Questions' })
      await expect(grid).toBeVisible()
      await grid
        .getByRole('checkbox', { name: /^Select (?!every)/ })
        .first()
        .check()
      const bar = page.getByRole('region', { name: 'Bulk actions' })
      await bar.getByRole('button', { name: 'Set target page' }).click()
      const target = page.getByRole('dialog', { name: 'Set target page' })
      await expect(target).toBeVisible()
      await expect.poll(() => hash(page)).toMatch(/panel=target&pick=/)
      const link = await hash(page)
      await drawerShots(page, 'w3b-question-target', restore)
      await page.goBack()
      await expect(target).toHaveCount(0)
      await expect.poll(() => hash(page)).not.toContain('panel=')

      // A copied link reopens it; ✕ closes it and the URL loses it.
      await openHash(page, link)
      await expect(target).toBeVisible()
      await target.getByRole('button', { name: 'Close Set target page' }).click()
      await expect(target).toHaveCount(0)
      await expect.poll(() => hash(page)).not.toContain('pick=')

      await grid
        .getByRole('checkbox', { name: /^Select (?!every)/ })
        .first()
        .check()
      await bar.getByRole('button', { name: 'Check now' }).click()
      const recheck = page.getByRole('alertdialog', { name: /^Check \d+ questions? now\?$/ })
      await expect(recheck).toBeVisible()
      await expect(recheck).toContainText(/Uses \d+ search/)
      await expect.poll(() => hash(page)).toMatch(/confirm=recheck&pick=/)
      await page.goBack()
      await expect(recheck).toHaveCount(0)
      await expect.poll(() => hash(page)).not.toContain('confirm=')
    })

    await test.step('Topics: merge with one topic explains itself; delete asks first', async () => {
      await openHash(page, `#/topics?action=merge&topic=${TEXTBOLT_TOPIC_ID}`)
      const merge = page.getByRole('dialog', { name: 'Merge into another topic' })
      await expect(merge).toBeVisible()
      await expect(merge).toContainText('Merging needs two topics')
      await expect(merge.getByRole('button', { name: 'Merge topics' })).toHaveCount(0)
      await drawerShots(page, 'w3b-topic-merge-alone', restore)
      await page.keyboard.press('Escape')
      await expect(merge).toHaveCount(0)
      await expect.poll(() => hash(page)).not.toContain('action=')

      await openHash(page, `#/topics?action=delete&topic=${TEXTBOLT_TOPIC_ID}`)
      const remove = page.getByRole('alertdialog', { name: 'Delete this topic?' })
      await expect(remove).toBeVisible()
      await remove.getByRole('button', { name: 'Cancel' }).click()
      await expect(remove).toHaveCount(0)
      await expect.poll(() => hash(page)).not.toContain('action=')
    })

    await test.step('Target bands: link, Esc, Back, and the unsaved-changes guard', async () => {
      const topic = `#/topics/${TEXTBOLT_TOPIC_ID}`
      await openHash(page, topic)
      // A topic opens on its List view.
      await expect(page.getByRole('grid', { name: /: every search$/ })).toBeVisible()
      await openHash(page, `${topic}?drawer=topic-bands`)
      const bands = page.getByRole('dialog', { name: 'Target bands' })
      await expect(bands).toBeVisible()
      await drawerShots(page, 'w3b-topic-bands', restore)
      await page.keyboard.press('Escape')
      await expect(bands).toHaveCount(0)
      await expect.poll(() => hash(page)).toBe(topic)

      await page.locator('.tr-head').getByRole('button', { name: 'More actions' }).click()
      await page.getByRole('menuitem', { name: 'Target bands' }).click()
      await expect(bands).toBeVisible()
      await expect.poll(() => hash(page)).toBe(`${topic}?drawer=topic-bands`)
      await page.goBack()
      await expect(bands).toHaveCount(0)
      await expect.poll(() => hash(page)).toBe(topic)

      await page.goForward()
      await expect(bands).toBeVisible()
      const low = bands.getByRole('region', { name: 'Buyer questions' }).getByLabel('Low edge')
      await low.fill('35')
      await page.keyboard.press('Escape')
      const discard = page.getByRole('alertdialog', { name: 'Discard changes?' })
      await expect(discard).toBeVisible()
      await discard.getByRole('button', { name: 'Keep editing' }).click()
      await expect(low).toHaveValue('35')
      await page.goBack()
      await expect(discard).toBeVisible()
      await expect(bands).toBeVisible()
      await discard.getByRole('button', { name: 'Discard' }).click()
      await expect(bands).toHaveCount(0)
      await expect.poll(() => hash(page)).toBe(topic)
    })

    await test.step('Change target page: from a ticked row, on the URL, ✕ closes', async () => {
      // The List view's bulk bar: tick one search, Change target.
      await page
        .getByRole('tablist', { name: 'Topic views' })
        .getByRole('tab', { name: 'List' })
        .click()
      await expect.poll(() => hash(page)).toContain('view=list')
      const list = page.getByRole('grid', { name: /: every search$/ })
      await list
        .getByRole('checkbox', { name: /^Select Q\d+ / })
        .first()
        .check()
      await page
        .getByRole('region', { name: 'Bulk actions' })
        .getByRole('button', { name: 'Change target' })
        .click()
      const retarget = page.getByRole('dialog', { name: 'Target pages for this question' })
      await expect(retarget).toBeVisible()
      await expect.poll(() => hash(page)).toMatch(/drawer=topic-target&tt\.ids=/)
      await expect(retarget.getByRole('radio', { name: 'No page yet' })).toBeVisible()
      await drawerShots(page, 'w3b-topic-target', restore)
      await retarget.getByRole('button', { name: 'Close Target pages for this question' }).click()
      await expect(retarget).toHaveCount(0)
      await expect.poll(() => hash(page)).not.toContain('drawer=')
    })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
