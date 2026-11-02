import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { e2eArtifact } from './artifacts'
import { animationsDone } from './drawer-helpers'
import { launchCiteFox } from './launch'
import { openAllPages } from './nav-helpers'
import { installRawMarkdown } from './raw-hook'
import { openHash } from './screens-app'

/**
 * Add questions and the shared importer on the real handlers and sqlite: the
 * two-market TextBolt project plus the TextBolt topic. Rows are pasted, a
 * 112-row CSV and an Excel file come in through a stubbed open dialog, the
 * columns are matched, every row is checked (the chips add up), duplicates are
 * skipped, the batch is undone, New topic stacks over the drawer, and Import
 * pages reads an Excel file. The queue is paused and nothing is searched.
 * Screenshots at 1440 × 900 and 1134 × 770 in both themes go to
 * test-results/e2e/import-*.png.
 */

const WIDE = { width: 1440, height: 900 }
const NARROW = { width: 1134, height: 770 }

interface Launched {
  app: ElectronApplication
  page: Page
  dir: string
  topicId: string
  tracked: string
}

async function launch(): Promise<Launched> {
  installRawMarkdown()
  const { seedTwoMarketProject, SEED } = await import('./screens-seed')
  const { openAppStorage } = await import('../../src/main/storage/app-storage')
  const { closeProjectDatabase, openProjectDatabase } =
    await import('../../src/main/storage/project-files')
  const { projectDatabaseRelativePath } = await import('../../src/main/storage/slug')
  const { seedTextboltTopic } = await import('../../src/main/topics/fixture-seed')
  const { textboltTopicPrompts } = await import('../../src/shared/fixtures/textbolt-topic')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-import-'))
  await seedTwoMarketProject(dir)
  const storage = openAppStorage(dir)
  const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  let topicId: string
  try {
    topicId = seedTextboltTopic(db, {
      id: SEED.projectId,
      name: 'TextBolt',
      slug: 'textbolt',
      domain: 'textbolt.com',
      dbPath: projectDatabaseRelativePath('textbolt'),
      clientName: null,
      status: 'active'
    }).topicId
    storage.db
      .prepare(
        `INSERT OR REPLACE INTO queue_pause (id, state, paused_on) VALUES (1, 'paused_all', NULL)`
      )
      .run()
  } finally {
    closeProjectDatabase(db)
    storage.close()
  }
  const { app, page } = await launchCiteFox({ userDataDir: dir, viewport: WIDE })
  await openAllPages(page)
  const tracked = textboltTopicPrompts().find((prompt) => prompt.kind === 'question')?.text ?? ''
  return { app, page, dir, topicId, tracked }
}

/** Every later open dialog returns `file`. */
async function stubOpenDialog(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [picked] })) as never
  }, file)
}

/** Both sizes and both themes: `import-<name>-<width>-<theme>.png`. */
async function shots(page: Page, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    for (const size of [WIDE, NARROW]) {
      await page.setViewportSize(size)
      await animationsDone(page)
      await page.waitForTimeout(200)
      await page.screenshot({
        path: await e2eArtifact(`import-${name}-${size.width}-${scheme}.png`)
      })
    }
  }
  await page.emulateMedia({ colorScheme: 'light' })
  await page.setViewportSize(WIDE)
}

/** A real paste event with tab-separated text, as a block copied from a sheet. */
async function pasteInto(box: Locator, text: string): Promise<void> {
  await box.evaluate((element, value) => {
    const data = new DataTransfer()
    data.setData('text/plain', value)
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }))
  }, text)
}

async function crumbs(dialog: Locator): Promise<string[]> {
  const items = dialog.getByRole('navigation', { name: 'Drawer breadcrumb' }).getByRole('listitem')
  return (await items.allTextContents()).map((text) => text.replace('›', '').trim())
}

/** The numbers on the result chips: All first, then each result. */
async function chipCounts(drawer: Locator): Promise<number[]> {
  const chips = drawer.getByRole('group', { name: 'Show rows by result' }).getByRole('button')
  return (await chips.locator('b').allTextContents()).map((text) => Number(text.replace(/,/gu, '')))
}

const STAGES = ['Problem', 'Options', 'Doubts', 'Compare', 'Decide', 'TOFU', 'mofu', 'Fit']
const PAGES = [
  'https://textbolt.com/email-to-sms/',
  'https://textbolt.com/pricing/',
  '/blog/how-to-set-up-text-alerts-for-business/'
]

const WHO = [
  'dental clinic',
  'plumbing company',
  'law firm',
  'veterinary practice',
  'roofing contractor',
  'daycare center',
  'auto repair shop',
  'property manager',
  'hvac technician',
  'yoga studio',
  'catering business',
  'moving company'
]
const WANTS = [
  'get missed call alerts as texts',
  'send appointment reminders from gmail',
  'forward outlook emails to staff phones',
  'replace the verizon vtext gateway',
  'text customers when invoices are overdue',
  'notify crews about schedule changes instantly',
  'receive website form leads by sms',
  'broadcast emergency closures to every employee',
  'confirm bookings automatically without an app'
]

/** 112 rows: 108 different questions, two repeats inside the file and two tracked ones. */
function csvRows(tracked: string): string[][] {
  const rows: string[][] = []
  for (let index = 0; index < 108; index += 1) {
    const who = WHO[index % WHO.length] ?? ''
    const wants = WANTS[Math.floor(index / WHO.length)] ?? ''
    rows.push([
      `how can a ${who} ${wants}`,
      STAGES[index % STAGES.length] ?? '',
      PAGES[index % PAGES.length] ?? ''
    ])
  }
  rows.push([rows[0]?.[0] ?? '', 'Problem', ''])
  rows.push([rows[1]?.[0] ?? '', 'Options', ''])
  rows.push([tracked, 'Problem', ''])
  rows.push([tracked.toUpperCase(), 'Problem', ''])
  return rows
}

function csvText(rows: readonly string[][]): string {
  const cell = (value: string): string =>
    /[",\n]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value
  return [['Question', 'Funnel stage', 'Landing page'], ...rows]
    .map((row) => row.map(cell).join(','))
    .join('\n')
}

async function writeXlsx(file: string, sheets: Record<string, string[][]>): Promise<void> {
  const ExcelJS = (await import('exceljs')).default
  const book = new ExcelJS.Workbook()
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = book.addWorksheet(name)
    for (const row of rows) sheet.addRow(row)
  }
  await book.xlsx.writeFile(file)
}

test('Add questions: paste, import a CSV and Excel file, undo, New topic, Import pages', async () => {
  test.setTimeout(420_000)
  const { app, page, dir, topicId, tracked } = await launch()
  const add = page.getByRole('dialog', { name: 'Add questions' })
  const importer = page.getByTestId('import-drawer')
  try {
    await test.step('paste three columns from a sheet; each row is checked', async () => {
      await openHash(page, `#/topics?drawer=add-questions&topic=${topicId}`)
      await expect(add).toBeVisible()
      await expect(add.getByTestId('aq-target')).toHaveValue(topicId)
      const block = [
        'Question\tStage\tPage',
        'my carrier shut down its email to text gateway, what do I use now\tProblem\thttps://textbolt.com/email-to-sms/',
        'cheapest way for a 10-person office to send texts from email\tDecide\thttps://textbolt.com/pricing/',
        'sms alerts for plumbers\tOptions\t',
        `${tracked}\tProblem\t`
      ].join('\n')
      await pasteInto(add.getByLabel('Question 1', { exact: true }), block)
      await expect(add.getByLabel('Question 4', { exact: true })).toHaveValue(tracked)
      await expect(add.getByLabel('Stage of question 2')).toHaveValue('decide')
      await expect(add.getByLabel('Page to be cited for question 1')).toHaveValue(
        'https://textbolt.com/email-to-sms/'
      )
      await expect(add.getByText('Keyword', { exact: true })).toBeVisible()
      await expect(add.getByText('Duplicate', { exact: true })).toBeVisible()
      await expect(add).toContainText(/\d to add · 1 duplicate skipped/u)
      await expect(add).toContainText('Topic grows to')
      await shots(page, 'add-questions')
    })

    await test.step('Add to the next check adds one batch; Undo removes it', async () => {
      await add.getByTestId('aq-add-later').click()
      await expect(add).toHaveCount(0)
      const toast = page.locator('.bm-toast')
      await expect(toast).toContainText(/\d questions? added/u)
      await toast.getByRole('button', { name: 'Undo' }).click()
      await expect(page.locator('.bm-toast')).toContainText(/Undone: removed \d questions?\./u)
    })

    const csv = path.join(dir, 'questions.csv')
    await writeFile(csv, csvText(csvRows(tracked)))

    await test.step('a 112-row CSV: match columns, every row checked, the chips add up', async () => {
      await openHash(page, `#/topics?drawer=add-questions&topic=${topicId}&tab=import`)
      await expect(add).toBeVisible()
      await stubOpenDialog(app, csv)
      await add.getByRole('button', { name: 'choose a file' }).click()
      await expect(importer).toBeVisible()
      await expect(importer).toHaveAttribute('data-drawer-depth', '1')
      expect(await crumbs(importer)).toEqual(['TextBolt', 'Topics', 'Add questions'])
      await importer.getByRole('button', { name: 'Choose a file' }).click()
      await expect(importer.getByRole('button', { name: 'Check 112 rows' })).toBeVisible()
      await expect(importer.getByLabel('CiteFox column for Funnel stage')).toHaveValue('stage')
      await expect(importer.getByLabel('CiteFox column for Landing page')).toHaveValue('page')
      // The preview finishes before the shot, so it shows the first rows and their chips.
      await expect(importer.getByRole('button', { name: 'Check 112 rows' })).toBeEnabled()
      await expect.poll(async () => (await chipCounts(importer))[0]).toBe(112)
      await shots(page, 'import-match')
      await importer.getByRole('button', { name: 'Check 112 rows' }).click()
      await expect(importer).toContainText('112 rows checked')
      await expect.poll(async () => (await chipCounts(importer))[0]).toBe(112)
      const counts = await chipCounts(importer)
      expect(counts.slice(1).reduce((sum, value) => sum + value, 0)).toBe(112)
      // New, keyword, similar, duplicate, needs a fix.
      expect(counts[4]).toBe(4)
      await expect(importer).toContainText('4 duplicates skipped')
      const adding = (counts[1] ?? 0) + (counts[2] ?? 0)
      await shots(page, 'import-check')
      await importer.getByTestId('import-finish').click()
      await expect(importer).toHaveCount(0)
      await expect(add.getByLabel('Question 108', { exact: true })).toHaveValue(/moving company/u)
      await expect(add).toContainText(`${adding} to add`, { timeout: 30_000 })
      await shots(page, 'add-questions-imported')
    })

    await test.step('New topic stacks over Add questions with the trail grown', async () => {
      await add.getByRole('button', { name: 'New topic' }).click()
      const newTopic = page.getByRole('dialog', { name: 'New topic' })
      await expect(newTopic).toBeVisible()
      await expect(newTopic).toHaveAttribute('data-drawer-depth', '1')
      expect(await crumbs(newTopic)).toEqual(['TextBolt', 'Topics', 'Add questions'])
      await newTopic
        .getByRole('navigation', { name: 'Drawer breadcrumb' })
        .getByRole('link', { name: 'Add questions' })
        .click()
      await expect(newTopic).toHaveCount(0)
      await expect(add).toBeVisible()
    })

    await test.step('Add a page stacks over Add questions', async () => {
      await add.getByRole('button', { name: '+ Add a page' }).click()
      const addPage = page.getByRole('dialog', { name: 'Add a page' })
      await expect(addPage).toBeVisible()
      await addPage.getByLabel('Page address').fill('/integrations/zapier/')
      await expect(addPage).toContainText('https://textbolt.com/integrations/zapier/')
      await shots(page, 'add-page')
      await addPage.getByTestId('add-page-submit').click()
      await expect(addPage).toHaveCount(0)
      await expect(add.getByTestId('aq-default-page')).toHaveValue(
        'https://textbolt.com/integrations/zapier/'
      )
    })

    await test.step('closing with rows asks first', async () => {
      await page.keyboard.press('Escape')
      const discard = page.getByRole('alertdialog', { name: 'Discard your questions?' })
      await expect(discard).toBeVisible()
      await discard.getByRole('button', { name: 'Discard' }).click()
      await expect(add).toHaveCount(0)
    })

    const xlsx = path.join(dir, 'questions.xlsx')
    await writeXlsx(xlsx, {
      Notes: [['Read me'], ['The questions are on the next sheet.']],
      Questions: [
        ['Question', 'Stage'],
        ['does email to text still work for Verizon business lines in 2026', 'Doubts'],
        ['is there a replacement for vtext.com email to SMS', 'Options']
      ]
    })

    await test.step('an Excel file: pick the sheet, match, check', async () => {
      await openHash(page, `#/topics?drawer=add-questions&topic=${topicId}`)
      await expect(add).toBeVisible()
      await stubOpenDialog(app, xlsx)
      await add.getByRole('button', { name: 'choose a file' }).click()
      await importer.getByRole('button', { name: 'Choose a file' }).click()
      const sheet = importer.getByLabel('Sheet', { exact: true })
      await expect(sheet).toBeVisible()
      await sheet.selectOption('Questions')
      await expect(importer.getByRole('button', { name: 'Check 2 rows' })).toBeVisible()
      await importer.getByRole('button', { name: 'Check 2 rows' }).click()
      await importer.getByTestId('import-finish').click()
      await expect(add.getByLabel('Question 2', { exact: true })).toHaveValue(/vtext/u)
      await expect(add).toContainText('2 to add')
      await page.keyboard.press('Escape')
      await page.getByRole('alertdialog').getByRole('button', { name: 'Discard' }).click()
      await expect(add).toHaveCount(0)
    })

    const topicCsv = path.join(dir, 'topic-market.csv')
    await writeFile(
      topicCsv,
      [
        'Question,Topic,Market',
        'how do night shift supervisors text the whole crew at once,Night shift alerts,UK',
        'what app sends a text to every driver when a route changes,,UK'
      ].join('\n')
    )

    await test.step('a file’s Topic and Market columns are kept per row (W3I-C1, C3)', async () => {
      await openHash(page, `#/topics?drawer=add-questions&topic=${topicId}`)
      await expect(add).toBeVisible()
      await stubOpenDialog(app, topicCsv)
      await add.getByRole('button', { name: 'choose a file' }).click()
      await importer.getByRole('button', { name: 'Choose a file' }).click()
      await expect(importer.getByLabel('CiteFox column for Topic')).toHaveValue('topic')
      await expect(importer.getByLabel('CiteFox column for Market')).toHaveValue('market')
      await importer.getByRole('button', { name: 'Check 2 rows' }).click()
      const rows = importer.getByTestId('import-rows')
      await expect(rows.getByRole('columnheader', { name: 'Topic' })).toBeVisible()
      await expect(rows).toContainText('Night shift alerts (new)')
      await shots(page, 'import-topic-market')
      await importer.getByTestId('import-finish').click()
      await expect(importer).toHaveCount(0)
      await expect(add.getByLabel('Topic of question 1')).toHaveValue('Night shift alerts')
      await expect(add.getByLabel('Market of question 2')).toHaveValue('mkt-uk')
      await add.getByRole('button', { name: 'create it' }).click()
      await add.getByRole('button', { name: /^add UK to this topic$/u }).click()
      await expect(add).toContainText('2 to add', { timeout: 30_000 })
      await shots(page, 'add-questions-topic-market')
      await add.getByTestId('aq-add-later').click()
      await expect(add).toHaveCount(0)
      await expect(page.locator('.bm-toast')).toContainText('2 questions added')
      const Database = (await import('better-sqlite3')).default
      const db = new Database(path.join(dir, 'projects', 'textbolt.sqlite'), { readonly: true })
      try {
        const marketsOf = (pageId: string): string[] =>
          db
            .prepare<unknown[], { market_id: string }>(
              'SELECT market_id FROM page_markets WHERE page_id = ? ORDER BY market_id'
            )
            .all(pageId)
            .map((row) => row.market_id)
        const created = db
          .prepare<unknown[], { id: string }>(
            "SELECT id FROM pages WHERE kind = 'topic' AND title = 'Night shift alerts'"
          )
          .get()
        // The new topic is checked in the market its row named; the picked topic gains UK.
        expect(marketsOf(created?.id ?? '')).toEqual(['mkt-uk'])
        expect(marketsOf(topicId)).toContain('mkt-uk')
      } finally {
        db.close()
      }
    })

    await test.step('rows not added yet survive a reload and are offered again (W3I-C4)', async () => {
      const typed = 'which text alert app works when the office wifi is down'
      await openHash(page, `#/topics?drawer=add-questions&topic=${topicId}`)
      await expect(add).toBeVisible()
      await add.getByLabel('Question 1', { exact: true }).fill(typed)
      await expect(add).toContainText('1 to add', { timeout: 30_000 })
      // Saved to main a moment after the last change.
      await expect
        .poll(async () => (await readdir(path.join(dir, 'question-drafts')).catch(() => [])).length)
        .toBe(1)
      await page.reload()
      await openHash(page, `#/topics?drawer=add-questions&topic=${topicId}`)
      await expect(add).toBeVisible()
      const offer = add.getByTestId('aq-draft')
      await expect(offer).toContainText('1 question you did not add yet')
      await shots(page, 'add-questions-draft')
      await offer.getByRole('button', { name: 'Continue' }).click()
      await expect(add.getByLabel('Question 1', { exact: true })).toHaveValue(typed)
      await page.keyboard.press('Escape')
      await page.getByRole('alertdialog').getByRole('button', { name: 'Discard' }).click()
      await expect(add).toHaveCount(0)
      // Discarded rows are not offered again.
      await expect
        .poll(async () => (await readdir(path.join(dir, 'question-drafts')).catch(() => [])).length)
        .toBe(0)
    })

    const pagesFile = path.join(dir, 'pages.xlsx')
    await writeXlsx(pagesFile, {
      Pages: [
        ['Address', 'Name'],
        ['https://textbolt.com/use-cases/restaurants/', 'Restaurants & cafes'],
        ['https://textbolt.com/use-cases/schools/', 'School alerts'],
        ['https://other.com/not-ours/', 'Not ours']
      ]
    })

    await test.step('Import pages reads an Excel file through Import a file', async () => {
      await openHash(page, '#/import-pages')
      await expect(page.getByRole('heading', { level: 1, name: 'Import pages' })).toBeVisible()
      await page.getByRole('radio', { name: 'CSV or Excel file' }).check()
      await stubOpenDialog(app, pagesFile)
      await page.getByRole('button', { name: 'Choose a file…' }).click()
      await expect(importer).toBeVisible()
      await importer.getByRole('button', { name: 'Choose a file' }).click()
      await expect(importer.getByLabel('CiteFox column for Address')).toHaveValue('url')
      await importer.getByRole('button', { name: 'Check 3 rows' }).click()
      await shots(page, 'import-pages-check')
      await importer.getByTestId('import-finish').click()
      await expect(importer).toHaveCount(0)
      await expect(page.getByText(/Added 2 pages to your selection/u)).toBeVisible()
      // The file's Name column is kept as each page's label (W3I-C2).
      await page.getByRole('button', { name: /^Preview \d+ pages?$/u }).click()
      const grid = page.getByRole('grid', { name: 'Pages that match your choices' })
      await expect(grid.getByRole('link', { name: /^Restaurants & cafes/u })).toBeVisible()
      await expect(grid.getByRole('link', { name: /^School alerts/u })).toBeVisible()
      await page.getByRole('button', { name: 'Choose how to track' }).click()
      await page.getByRole('button', { name: /^Track 2 pages$/u }).click()
      await expect(page.getByText(/Tracking 2 pages\./u)).toBeVisible()
      const Database = (await import('better-sqlite3')).default
      const db = new Database(path.join(dir, 'projects', 'textbolt.sqlite'), { readonly: true })
      try {
        const labels = db
          .prepare<unknown[], { label: string | null }>(
            "SELECT label FROM pages WHERE url LIKE '%/use-cases/%' ORDER BY url"
          )
          .all()
          .map((row) => row.label)
        expect(labels).toEqual(['Restaurants & cafes', 'School alerts'])
      } finally {
        db.close()
      }
    })
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
