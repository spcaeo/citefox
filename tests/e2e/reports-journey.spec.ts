import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import * as ExcelJS from 'exceljs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { REPORT_SECTIONS } from '../../src/shared/domain/exports'
import { REPORT_SECTION_COPY } from '../../src/shared/report-copy'
import { readStoredZip } from '../../src/main/export/zip'
import { e2eArtifact } from './artifacts'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'
import { openAllPages, sidebar } from './nav-helpers'

const SCHEDULE_NAME = 'Fixture change report'

/**
 * Exports the fixture page (one market, one check) as CSV, Excel, PDF and a single-file
 * HTML report through the real `exports:*` handlers and the stubbed save dialog.
 * The CSV and XLSX layouts are one table per report section and may change, so the
 * checks stay structural: files exist and are non-empty, the CSV zip has entries and a
 * UTF-8 BOM, the workbook's Prompts sheet has one data row per prompt shown on the
 * Results screen, and the PDF starts with %PDF-.
 */
test('exports CSV, Excel, PDF and HTML for a fixture check', async () => {
  test.setTimeout(180_000)
  const opened = await openSeeded()
  const { app, page } = opened
  try {
    await page.locator('#main').getByRole('link', { name: 'Alerts', exact: true }).click()
    const promptRows = await promptCountOnResults(page)
    expect(promptRows).toBeGreaterThan(0)
    // Export report is under the page header's ⋯.
    await page.locator('.ui-head-page').getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: 'Export report' }).click()
    const screen = page.locator('.xpt')
    await expect(screen.getByRole('heading', { level: 1, name: 'Export a report' })).toBeVisible()
    // The back row goes to the page Export was opened from.
    await expect(screen.getByRole('link', { name: 'Alerts' })).toBeVisible()
    await expect(screen.getByRole('radio', { name: /^This page/ })).toBeChecked()
    await expect(screen.getByRole('radio', { name: 'Latest check' })).toBeChecked()

    // Every v2 section starts picked, with the shared section copy. Topic coverage
    // needs a topic subject, so a page leaves it off.
    for (const id of REPORT_SECTIONS) {
      const box = screen.getByRole('checkbox', {
        name: new RegExp(`^${REPORT_SECTION_COPY[id].title}`)
      })
      if (id === 'topic_coverage') await expect(box).toBeDisabled()
      else await expect(box).toBeChecked()
    }
    await expect(screen.getByText('Cover (always included)')).toBeVisible()

    await installSaveDialog(app)
    const formats = screen.getByRole('radiogroup', { name: 'Format' })

    await formats.getByRole('radio', { name: /CSV/ }).click()
    await expect(screen.getByText('1 check', { exact: true })).toBeVisible()
    await expect(
      screen.getByTestId('export-preview-grid').or(screen.getByTestId('export-preview-text'))
    ).toBeVisible()
    const csvPath = path.join(opened.dir, 'report.csv.zip')
    await saveExport(app, page, screen, csvPath)
    const csvBytes = await readFile(csvPath)
    expect(csvBytes.length).toBeGreaterThan(0)
    const entries = readStoredZip(csvBytes)
    expect(entries.length).toBeGreaterThanOrEqual(1)
    expect(entries.some((entry) => hasUtf8Bom(entry.data))).toBe(true)
    for (const entry of entries) expect(entry.data.length).toBeGreaterThan(0)

    await formats.getByRole('radio', { name: /Excel/ }).click()
    const xlsxPath = path.join(opened.dir, 'report.xlsx')
    await saveExport(app, page, screen, xlsxPath)
    expect((await stat(xlsxPath)).size).toBeGreaterThan(0)
    expect(await countPromptSheetRows(xlsxPath)).toBe(promptRows)

    await formats.getByRole('radio', { name: /PDF/ }).click()
    await expect(screen.getByTestId('export-preview-text')).toBeVisible()
    const pdfPath = path.join(opened.dir, 'report.pdf')
    await saveExport(app, page, screen, pdfPath)
    const pdfBytes = await readFile(pdfPath)
    expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-')

    await formats.getByRole('radio', { name: /HTML/ }).click()
    await screen.getByRole('radio', { name: 'Single index.html' }).click()
    const htmlPath = path.join(opened.dir, 'index.html')
    await saveExport(app, page, screen, htmlPath)
    const html = await readFile(htmlPath, 'utf8')
    expect(html.length).toBeGreaterThan(0)
    expect(html.toLowerCase()).toContain('<html')
    await shot(page, 'reports-export')
  } finally {
    await opened.close()
  }
})

test('creates and edits a scheduled report through reports:*', async () => {
  test.setTimeout(180_000)
  const opened = await openSeeded()
  const { page } = opened
  try {
    await sidebar(page).getByRole('link', { name: 'Reports', exact: true }).click()
    const screen = page.locator('.rpt')
    await expect(screen.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible()
    // Reports opens on Ready reports; schedules live in the Scheduled emails tab.
    await screen.getByRole('tab', { name: /^Scheduled emails/ }).click()
    await expect(screen.getByText('No schedules yet.')).toBeVisible()

    await screen.getByRole('button', { name: 'New schedule' }).first().click()
    const form = screen.locator('[data-drawer="schedule"]')
    await form.getByLabel('Name').fill(SCHEDULE_NAME)
    await form.getByLabel('Project', { exact: true }).selectOption({ label: 'TextBolt' })
    await form.getByRole('radio', { name: 'When something changes' }).click()
    await form.getByRole('checkbox', { name: 'The score dropped by more than' }).click()
    await form.getByRole('checkbox', { name: 'A check failed' }).click()
    await expect(
      form.getByRole('checkbox', { name: 'A tracked page lost a citation' })
    ).toBeChecked()
    await expect(
      form.getByRole('checkbox', { name: 'A tracked page gained a citation' })
    ).not.toBeChecked()
    await form.getByLabel('Recipients').fill('reports@example.com')
    await form.getByRole('button', { name: 'Add', exact: true }).click()
    await form.getByRole('button', { name: 'Save schedule' }).click()

    await expect(
      screen.getByRole('button', { name: `${SCHEDULE_NAME}: open details` })
    ).toBeVisible()
    // whenLabel collapses a lone lost_citation event to this sentence.
    // The checkbox copy ("A tracked page lost a citation") is the form, which
    // resets to weekly after save and hides those checkboxes.
    await expect(
      screen.getByRole('gridcell', { name: 'When a tracked page loses a citation' })
    ).toBeVisible()
    let listed = await listSchedules(page)
    expect(listed).toEqual([
      expect.objectContaining({
        name: SCHEDULE_NAME,
        projectId: 'proj-1',
        recipients: ['reports@example.com'],
        timing: { kind: 'on_change', events: ['lost_citation'], scoreDropPoints: 10 }
      })
    ])

    // The row menu by keyboard: a scroll closes an open menu, and a click can scroll.
    await screen.getByRole('button', { name: `Actions for ${SCHEDULE_NAME}` }).focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Edit schedule' })).toBeVisible()
    await form.getByRole('button', { name: 'Remove reports@example.com' }).click()
    await form.getByLabel('Recipients').fill('weekly@example.com')
    await form.getByRole('button', { name: 'Add', exact: true }).click()
    await form.getByRole('radio', { name: 'Weekly', exact: true }).click()
    await form.getByRole('button', { name: 'Save schedule' }).click()
    await expect(page.getByRole('dialog', { name: 'Edit schedule' })).toHaveCount(0)
    await expect(screen.getByText('weekly@example.com')).toBeVisible()
    await expect(screen.getByText('Mondays 08:00')).toBeVisible()

    await page.reload()
    const reloaded = page.locator('.rpt')
    await expect(reloaded.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible()
    await expect(reloaded.getByText('weekly@example.com')).toBeVisible()
    await expect(page.locator('.rpt').getByText('Mondays 08:00')).toBeVisible()
    await expect(page.locator('.rpt').getByText('reports@example.com')).toHaveCount(0)
    listed = await listSchedules(page)
    expect(listed).toEqual([
      expect.objectContaining({
        name: SCHEDULE_NAME,
        recipients: ['weekly@example.com'],
        timing: expect.objectContaining({ kind: 'weekly', day: 1, time: '08:00' })
      })
    ])
    await shot(page, 'reports-schedule')
  } finally {
    await opened.close()
  }
})

test('deletes a scheduled report and drops it from the list', async () => {
  test.setTimeout(180_000)
  const opened = await openSeeded()
  const { page } = opened
  try {
    await sidebar(page).getByRole('link', { name: 'Reports', exact: true }).click()
    const screen = page.locator('.rpt')
    await expect(screen.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible()
    await screen.getByRole('tab', { name: /^Scheduled emails/ }).click()
    await screen.getByRole('button', { name: 'New schedule' }).first().click()
    const form = screen.locator('[data-drawer="schedule"]')
    await form.getByLabel('Name').fill(SCHEDULE_NAME)
    await form.getByLabel('Project', { exact: true }).selectOption({ label: 'TextBolt' })
    await form.getByLabel('Recipients').fill('reports@example.com')
    await form.getByRole('button', { name: 'Add', exact: true }).click()
    await form.getByRole('button', { name: 'Save schedule' }).click()
    await expect(
      screen.getByRole('button', { name: `${SCHEDULE_NAME}: open details` })
    ).toBeVisible()

    await screen.getByRole('button', { name: `Actions for ${SCHEDULE_NAME}` }).focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('End')
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeFocused()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('alertdialog', { name: 'Delete this schedule?' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(
      screen.getByRole('button', { name: `${SCHEDULE_NAME}: open details` })
    ).toHaveCount(0)
    await expect(screen.getByText('No schedules yet.')).toBeVisible()
    expect(await listSchedules(page)).toEqual([])
  } finally {
    await opened.close()
  }
})

async function openSeeded(): Promise<{
  app: ElectronApplication
  page: Page
  dir: string
  close: () => Promise<void>
}> {
  installRawMarkdown()
  const { seedFixtureProject } = await import('./fixture-project')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'citefox-reports-journey-'))
  await seedFixtureProject(dir)
  const viewport = { width: 1280, height: 900 }
  const { app, page } = await launchCiteFox({ userDataDir: dir, viewport })
  await openAllPages(page)
  return {
    app,
    page,
    dir,
    close: async () => {
      await app.close()
      await rm(dir, { recursive: true, force: true })
    }
  }
}

async function installSaveDialog(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog }) => {
    const target = global as typeof globalThis & { __citefoxExportPath?: string }
    dialog.showSaveDialog = (async () => {
      const filePath = target.__citefoxExportPath
      if (filePath === undefined || filePath.length === 0) return { canceled: true }
      return { canceled: false, filePath }
    }) as typeof dialog.showSaveDialog
  })
}

async function saveExport(
  app: ElectronApplication,
  page: Page,
  screen: ReturnType<Page['locator']>,
  filePath: string
): Promise<void> {
  await app.evaluate((_, nextPath: string) => {
    ;(global as typeof globalThis & { __citefoxExportPath?: string }).__citefoxExportPath = nextPath
  }, filePath)
  await expect(
    screen.getByRole('button', { name: /^Save (HTML report|PDF|Excel workbook|CSV tables|JSON)$/ })
  ).toBeEnabled()
  await screen
    .getByRole('button', { name: /^Save (HTML report|PDF|Excel workbook|CSV tables|JSON)$/ })
    .click()
  await expect(screen.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  await expect(page.getByText(/Export cancelled/)).toHaveCount(0)
  await expect(page.getByText(/Could not open the save dialog/)).toHaveCount(0)
}

/** "N buyer prompts" in What this report covers: one Prompts row each in a one-market export. */
async function promptCountOnResults(page: Page): Promise<number> {
  const scope = page.locator('#m3-results-top .m3-scope')
  await expect(scope.getByText(/\d+ buyer questions?/)).toBeVisible()
  const text = await scope.getByText(/\d+ buyer questions?/).innerText()
  return Number(/([\d,]+) buyer question/.exec(text)?.[1]?.replace(/,/g, '') ?? '0')
}

function hasUtf8Bom(data: Buffer): boolean {
  return data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf
}

/** Data rows on the Prompts sheet: rows after the header with a first cell, minus any totals row. */
async function countPromptSheetRows(filePath: string): Promise<number> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)
  const sheet = workbook.worksheets.find((item) => item.name === 'Prompts')
  expect(sheet, 'the workbook has a Prompts sheet').toBeDefined()
  let dataRows = 0
  sheet?.eachRow((row) => {
    const first = cellText(row.getCell(1).value)
    if (row.number === 1 || first === '' || first === 'Total') return
    dataRows += 1
  })
  return dataRows
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string')
    return value.text
  if (typeof value === 'object' && 'result' in value)
    return cellText(value.result as ExcelJS.CellValue)
  return ''
}

async function listSchedules(page: Page): Promise<unknown[]> {
  return page.evaluate(async () => {
    const api = (
      window as unknown as {
        citefox: { 'reports:list': () => Promise<unknown[]> }
      }
    ).citefox
    return api['reports:list']()
  })
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: await e2eArtifact(`${name}.png`), fullPage: false })
}
