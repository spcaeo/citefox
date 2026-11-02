import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TEXTBOLT_TOPIC_NAME } from '../../../src/shared/fixtures/textbolt-topic'
import { drawerShots } from '../drawer-helpers'
import { launchCiteFox } from '../launch'
import { openAllPages } from '../nav-helpers'
import { installRawMarkdown } from '../raw-hook'
import { chooseRowAction } from '../row-menu'
import { openHash, type SeededApp } from '../screens-app'

/**
 * The two-market TextBolt project (as `openTwoMarketApp` seeds it) plus the
 * TextBolt topic, so questions can move into a topic. The queue is paused, so
 * nothing is searched; nothing here calls Claude.
 */
async function openQuestionsApp(): Promise<SeededApp> {
  installRawMarkdown()
  const { seedTwoMarketProject, SEED } = await import('../screens-seed')
  const { openAppStorage } = await import('../../../src/main/storage/app-storage')
  const { closeProjectDatabase, openProjectDatabase } =
    await import('../../../src/main/storage/project-files')
  const { projectDatabaseRelativePath } = await import('../../../src/main/storage/slug')
  const { seedTextboltTopic } = await import('../../../src/main/topics/fixture-seed')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-crud-questions-'))
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

const PAGE_Q = 'Which plan covers scheduled texts?'
const FREEZER_ACTIONS = /^Actions for Our alarm system only emails when the freezer/
const CREW_Q = 'How do I alert the crew without a developer?'
const REWORDED = 'Which TextBolt-free plan covers scheduled texts for a small crew team?'
const PLAIN_REWORD = 'Which plan covers scheduled texts for a small crew of field technicians?'
const INLINE_REWORD = 'Which plan covers scheduled texts for a crew of forty field technicians?'

function grid(page: Page): Locator {
  return page.getByRole('grid', { name: 'Questions' })
}

function bulk(page: Page): Locator {
  return page.getByRole('region', { name: 'Bulk actions' })
}

function toast(page: Page): Locator {
  return page.getByRole('status').filter({ has: page.getByRole('button', { name: 'Undo' }) })
}

async function openQuestions(page: Page, search: string): Promise<void> {
  await openHash(page, '#/questions')
  await expect(page.getByRole('heading', { level: 1, name: 'Questions' })).toBeVisible()
  await expect(grid(page)).toBeVisible()
  const box = page.getByRole('searchbox', { name: /^Search \d+ questions( and keywords)?$/ })
  await box.fill(search)
  // The search reaches the URL after a short pause; drawers open over that URL.
  if (search !== '') {
    await expect
      .poll(() =>
        page.evaluate(() => {
          const hash = window.location.hash
          return new URLSearchParams(hash.slice(hash.indexOf('?') + 1)).get('q')
        })
      )
      .toBe(search)
  }
}

/** Opens the drill behind a KPI number; the drawer counts what the number showed. */
async function expectKpiDrill(page: Page, title: string): Promise<void> {
  const button = page.getByRole('button', { name: new RegExp(`: ${title}$`) })
  const shown = Number((await button.innerText()).replace(/[^\d]/g, ''))
  await button.click()
  const drawer = page.getByRole('dialog', { name: title })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('heading', { level: 2 })).toContainText(
    `${title} · ${shown} ${shown === 1 ? 'question' : 'questions'}`
  )
  await drawer.getByRole('button', { name: 'Close' }).first().click()
  await expect(drawer).toHaveCount(0)
}

/** Elements inside `scope` that scroll sideways (their content is wider than they are). */
async function sidewaysScrollers(scope: Locator): Promise<string[]> {
  return scope.evaluate((root) =>
    [root, ...root.querySelectorAll('*')]
      .filter((node) => {
        const style = getComputedStyle(node)
        return (
          (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
          node.scrollWidth > node.clientWidth + 1
        )
      })
      .map((node) => {
        const wide = [...node.querySelectorAll('*')]
          .filter(
            (child) => child.getBoundingClientRect().right > node.getBoundingClientRect().right + 1
          )
          .slice(0, 3)
          .map((child) => `${child.tagName}.${child.className}`)
        return `${node.className} (${node.scrollWidth} > ${node.clientWidth}): ${wide.join(' | ')}`
      })
  )
}

export function questionsCrud(): void {
  test('KPI drills, the Edit question drawer, inline edit, Back and Forward', async () => {
    test.setTimeout(300_000)
    const { page, close } = await openQuestionsApp()
    try {
      await openQuestions(page, '')
      for (const title of [
        'Searches tracked',
        'Searches where an AI Overview shows',
        'Searches where you are cited',
        'Searches where you are named'
      ]) {
        await expectKpiDrill(page, title)
      }

      // Edit in the drawer: the rules stop a brand, then a plain wording saves.
      await openQuestions(page, 'scheduled texts')
      await chooseRowAction(page, grid(page), PAGE_Q, 'Edit question…')
      const drawer = page.getByRole('dialog', { name: 'Edit question' })
      await expect(drawer).toBeVisible()
      await expect
        .poll(() => page.evaluate(() => window.location.hash))
        .toContain('drawer=question')
      await drawerShots(page, 'crud-question-edit')
      // Nothing in the drawer scrolls sideways at either size.
      expect(await sidewaysScrollers(drawer)).toEqual([])
      const wording = drawer.getByLabel(/^Wording in /)
      await wording.fill(REWORDED)
      await expect(drawer.getByRole('button', { name: 'Save' })).toBeDisabled()
      await wording.fill(PLAIN_REWORD)
      await drawer.getByRole('button', { name: 'Save' }).click()
      await expect(drawer).toHaveCount(0)
      await expect(toast(page)).toContainText('Saved the question as a new version.')
      await openQuestions(page, 'field technicians')
      await expect(grid(page).getByText(PLAIN_REWORD)).toBeVisible()

      // Back closes the drawer, Forward opens it again.
      await chooseRowAction(page, grid(page), PLAIN_REWORD, 'Edit question…')
      await expect(page.getByRole('dialog', { name: 'Edit question' })).toBeVisible()
      await page.goBack()
      await expect(page.getByRole('dialog', { name: 'Edit question' })).toHaveCount(0)
      await page.goForward()
      await expect(page.getByRole('dialog', { name: 'Edit question' })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog', { name: 'Edit question' })).toHaveCount(0)

      // Inline edit: Escape cancels, Enter saves a new version.
      await chooseRowAction(page, grid(page), PLAIN_REWORD, 'Edit wording here')
      const inline = page.getByRole('textbox', { name: `Wording of ${PLAIN_REWORD}` })
      await expect(inline).toBeFocused()
      await inline.press('Escape')
      await expect(inline).toHaveCount(0)
      await chooseRowAction(page, grid(page), PLAIN_REWORD, 'Edit wording here')
      await inline.fill(INLINE_REWORD)
      await expect(page.getByText(/words · Enter saves a new version/)).toBeVisible()
      await inline.press('Enter')
      await expect(toast(page)).toContainText('Saved the new wording as a new version.')
      await openQuestions(page, 'forty field')
      await expect(grid(page).getByText(INLINE_REWORD)).toBeVisible()
    } finally {
      await close()
    }
  })

  test('Pause, Remove with Undo, move to a topic, duplicate, and bulk actions', async () => {
    test.setTimeout(300_000)
    const { page, close } = await openQuestionsApp()
    try {
      // Pause one question, then Undo.
      await openQuestions(page, 'alert the crew')
      await chooseRowAction(page, grid(page), CREW_Q, 'Pause (leave out of checks)')
      await expect(toast(page)).toContainText('Disabled 1')
      await toast(page).getByRole('button', { name: 'Undo' }).click()
      await expect(page.getByText('Undone.')).toBeVisible()

      // Remove acts at once; Undo brings it back.
      await chooseRowAction(page, grid(page), CREW_Q, 'Remove')
      await expect(toast(page)).toContainText('Removed 1')
      await expect(grid(page).getByText(CREW_Q)).toHaveCount(0)
      await toast(page).getByRole('button', { name: 'Undo' }).click()
      await expect(grid(page).getByText(CREW_Q)).toBeVisible()

      // Move the page's question into the topic through the picker drawer.
      await openQuestions(page, 'scheduled texts')
      await chooseRowAction(page, grid(page), PAGE_Q, 'Move to a topic…')
      const move = page.getByRole('dialog', { name: 'Move questions' })
      await expect(move).toBeVisible()
      await expect(move.getByRole('button', { name: /New topic/ })).toBeVisible()
      await move
        .getByRole('radiogroup', { name: 'Move to' })
        .getByLabel(new RegExp(TEXTBOLT_TOPIC_NAME))
        .check()
      await drawerShots(page, 'crud-question-move')
      await move.getByRole('button', { name: 'Move 1 question' }).click()
      await expect(move).toHaveCount(0)
      await expect(toast(page)).toContainText('Moved 1 question')
      await expect(
        page.getByRole('button', { name: TEXTBOLT_TOPIC_NAME, exact: true })
      ).toBeVisible()

      // Duplicate a topic question into the page: a copy, the topic keeps its own.
      // By pointer this time (the keyboard path is covered above).
      await openQuestions(page, 'freezer')
      await grid(page).getByRole('button', { name: FREEZER_ACTIONS }).click()
      await page.getByRole('menuitem', { name: 'Duplicate to…', exact: true }).click()
      const copy = page.getByRole('dialog', { name: 'Duplicate questions' })
      await expect(copy).toBeVisible()
      await copy
        .getByRole('radiogroup', { name: 'Duplicate into' })
        .getByLabel(/^Alerts/)
        .check()
      await drawerShots(page, 'crud-question-copy')
      await copy.getByRole('button', { name: 'Copy 1 question' }).click()
      await expect(copy).toHaveCount(0)
      await expect(toast(page)).toContainText('Copied 1 question')
      await expect(grid(page).getByRole('button', { name: FREEZER_ACTIONS })).toHaveCount(2)

      // Bulk: pause both, then Undo.
      await page.getByRole('checkbox', { name: 'Select every row on this page' }).check()
      await bulk(page).getByRole('button', { name: 'Pause' }).click()
      await expect(toast(page)).toContainText('Disabled 2')
      await toast(page).getByRole('button', { name: 'Undo' }).click()
      await expect(page.getByText('Undone.')).toBeVisible()
    } finally {
      await close()
    }
  })
}
