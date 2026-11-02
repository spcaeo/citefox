import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as ExcelJS from 'exceljs'
import { afterEach, describe, expect, test } from 'vitest'
import { XLSX_PERCENT_FORMAT, type ExportTable } from './cells'
import type { ReportModel } from './model/types'
import {
  FORMULA_PROMPT,
  pageModel,
  withFirstPrompt,
  withRowCount
} from './report-models.test-helper'
import { buildReportTables, type ReportTableOptions } from './report-tables'
import { writeXlsx } from './xlsx'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

async function workbookFor(
  model: ReportModel,
  options: ReportTableOptions & { freezeHeaders?: boolean } = {}
): Promise<{ workbook: ExcelJS.Workbook; tables: ExportTable[] }> {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-xlsx-'))
  directories.push(directory)
  const filePath = join(directory, 'report.xlsx')
  const tables = buildReportTables(model, options)
  await writeXlsx(filePath, tables, {
    freezeHeaders: options.freezeHeaders ?? true,
    secrets: [],
    onRow: () => undefined
  })
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)
  return { workbook, tables }
}

function sheet(workbook: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const found = workbook.getWorksheet(name)
  if (found === undefined) throw new Error(`missing sheet ${name}`)
  return found
}

function headers(worksheet: ExcelJS.Worksheet): string[] {
  const values = worksheet.getRow(1).values
  return Array.isArray(values) ? values.slice(1).map((value) => String(value)) : []
}

function column(worksheet: ExcelJS.Worksheet, header: string): number {
  const index = headers(worksheet).indexOf(header)
  if (index < 0) throw new Error(`missing column ${header}`)
  return index + 1
}

describe('XLSX workbook from the report model', () => {
  test('one sheet per section table, frozen headers, and Excel-safe names', async () => {
    const model = pageModel()
    const { workbook, tables } = await workbookFor(model)
    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual(
      tables.map((table) => table.sheetName)
    )
    const names = workbook.worksheets.map((worksheet) => worksheet.name)
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length)
    for (const name of names) {
      expect(name.length).toBeLessThanOrEqual(31)
      expect(name).not.toMatch(/[:\\/?*[\]]/)
    }
    for (const worksheet of workbook.worksheets) {
      expect(worksheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    }
    expect(names).toEqual(
      expect.arrayContaining([
        'Overview',
        'Your pages',
        'Citation leaderboard',
        'Trends',
        'Prompts',
        'Raw references'
      ])
    )
  })

  test('Prompts and Raw references hold every row, with no totals row', async () => {
    const model = withRowCount(pageModel(), 240)
    const { workbook } = await workbookFor(model)
    const prompts = sheet(workbook, 'Prompts')
    expect(prompts.actualRowCount - 1).toBe(model.rows.length)
    expect(sheet(workbook, 'Raw references').actualRowCount - 1).toBe(model.references.length)
    expect(headers(prompts).slice(0, 14)).toEqual([
      '#',
      'Prompt',
      'Page',
      'Stage',
      'Funnel',
      'Source',
      'Market',
      'AI Overview',
      'Cited',
      'Page cited',
      'Named',
      'Position',
      'Top cited domains',
      'Last checked'
    ])
  })

  test('formula text is neutralised, dates are dates, booleans and percentages are typed', async () => {
    const model = withFirstPrompt(pageModel(), FORMULA_PROMPT)
    const { workbook } = await workbookFor(model)
    const prompts = sheet(workbook, 'Prompts')
    const first = prompts.getRow(2)
    const promptCell = first.getCell(column(prompts, 'Prompt'))
    expect(promptCell.value).toBe(`'${FORMULA_PROMPT}`)
    expect(promptCell.type).not.toBe(ExcelJS.ValueType.Formula)
    const checked = first.getCell(column(prompts, 'Last checked')).value
    expect(checked).toBeInstanceOf(Date)
    expect(first.getCell(column(prompts, 'AI Overview')).value).toBe(true)
    expect(first.getCell(column(prompts, 'Market')).value).toBe('US · EN')
    expect(first.getCell(column(prompts, 'Stage')).value).toBe('Problem')

    const universe = sheet(workbook, 'Universe by intent stage')
    const rate = universe.getRow(2).getCell(column(universe, 'Cited rate'))
    expect(rate.numFmt).toBe(XLSX_PERCENT_FORMAT)
    expect(rate.value).toBe(1)
  })

  test('a totals row only where the columns add up', async () => {
    const model = pageModel()
    const { workbook } = await workbookFor(model)
    const stage = sheet(workbook, 'Universe by intent stage')
    const dimension = model.universe.dimensions.find((item) => item.id === 'stage')
    expect(stage.actualRowCount).toBe((dimension?.rows.length ?? 0) + 2)
    const totalRow = stage.getRow(stage.actualRowCount)
    expect(totalRow.getCell(1).value).toBe('Total')
    expect(totalRow.getCell(column(stage, 'Prompts')).value).toBe(model.rows.length)

    const leaderboard = sheet(workbook, 'Citation leaderboard')
    expect(leaderboard.actualRowCount - 1).toBe(model.competition.leaderboard.length)
  })

  test('an empty section gets one row that explains it', async () => {
    const model = pageModel()
    const { workbook } = await workbookFor(model)
    const reputation = sheet(workbook, 'Reputation')
    expect(headers(reputation)).toEqual(['Section', 'Status', 'Message', 'Next step'])
    expect(reputation.actualRowCount).toBe(2)
    expect(reputation.getRow(2).getCell(2).value).toBe(model.reputation.empty?.title)
  })

  test('one Prompts and Raw references sheet per market when asked', async () => {
    const model = pageModel()
    const { workbook } = await workbookFor(model, { sheetPerMarket: true })
    for (const market of model.markets) {
      const prompts = sheet(workbook, `Prompts ${market.label}`)
      const rows = model.rows.filter((row) => row.marketId === market.id)
      expect(prompts.actualRowCount - 1).toBe(rows.length)
      const ids = new Set(rows.map((row) => row.id))
      expect(sheet(workbook, `Raw references ${market.label}`).actualRowCount - 1).toBe(
        model.references.filter((reference) => ids.has(reference.rowId)).length
      )
    }
    expect(workbook.getWorksheet('Prompts')).toBeUndefined()
  })

  test('leaves the header unfrozen when freezeHeaders is false', async () => {
    const { workbook } = await workbookFor(pageModel(), { freezeHeaders: false })
    // ExcelJS reads an unfrozen sheet's views back as null.
    const views = (sheet(workbook, 'Prompts').views as ExcelJS.WorksheetView[] | null) ?? []
    expect(views.some((view) => view.state === 'frozen')).toBe(false)
  })
})
