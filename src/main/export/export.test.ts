import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as ExcelJS from 'exceljs'
import { afterEach, describe, expect, test } from 'vitest'
import { columns, numberCell, textCell, type ExportTable } from './cells'
import { parseCsv } from './csv'
import { richSampleDataset } from './model/sample-dataset.test-helper'
import { fixtureExportSource, sampleExportDataset, sampleExportRequest } from './fixture'
import { nodeExportIo } from './atomic'
import { renderCsvEntries } from './render-csv'
import { previewExport, startExport } from './service'
import { writeXlsx } from './xlsx'
import type { ExportDataset } from './types'
import type { ExportProgress, ExportRequest } from '@shared/ipc'
import { readStoredZip } from './zip'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('export generation', () => {
  test('totals match the sum of the data rows, and the Prompts file matches the KPI', async () => {
    const written = await exportCsv(
      sampleExportRequest({
        projectId: 'proj-textbolt',
        pageIds: ['page-alerts'],
        sections: ['overview', 'universe', 'prompts'],
        checks: 'all',
        marketIds: ['mkt-us', 'mkt-ca']
      }),
      richSampleDataset()
    )
    const stage = parseCsv(fileText(written, 'universe-stage'), ',')
    expect(columnSum(stage, 'Prompts')).toBe(20)
    expect(totalCell(stage, 'Prompts')).toBe('20')
    expect(totalCell(stage, 'AI Overview shown')).toBe(
      String(columnSum(stage, 'AI Overview shown'))
    )
    const prompts = parseCsv(fileText(written, 'prompts'), ',').filter((row) => row.some(Boolean))
    expect(prompts.length - 1).toBe(20)
    const kpis = parseCsv(fileText(written, 'overview-kpis'), ',')
    expect(kpis.find((row) => row[0] === 'Questions tracked')?.[1]).toBe('20')
  })

  test('writes numbers without a formula prefix and escapes formula text', async () => {
    const table: ExportTable = {
      id: 'numbers',
      sheetName: 'Numbers',
      fileName: 'numbers.csv',
      columns: columns(['label', 'amount'], new Set(['amount'])),
      rows: [
        [textCell('negative'), numberCell(-5)],
        [textCell('fraction'), numberCell(-0.25)],
        [textCell('positive'), numberCell(3)],
        [textCell('words'), textCell('-5 apples')],
        [textCell('formula'), textCell('=SUM(A1)')]
      ]
    }

    const entries = await renderCsvEntries([table], ',', false, [], () => {})
    const csv = parseCsv(entries[0]?.data.toString('utf8') ?? '', ',')
    expect(csv.map((row) => row[1])).toEqual([
      'amount',
      '-5',
      '-0.25',
      '3',
      "'-5 apples",
      "'=SUM(A1)",
      '-2.25'
    ])

    const filePath = join(tempDirectory(), 'numbers.xlsx')
    await writeXlsx(filePath, [table], { freezeHeaders: false, secrets: [], onRow: () => {} })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(filePath)
    const sheet = workbook.getWorksheet('Numbers')
    expect(sheet).toBeDefined()
    if (sheet === undefined) return

    const numericRows = [2, 3, 4, 7]
    const numericValues = [-5, -0.25, 3, -2.25]
    numericRows.forEach((rowNumber, index) => {
      const cell = sheet.getRow(rowNumber).getCell(2)
      expect(cell.type).toBe(ExcelJS.ValueType.Number)
      expect(cell.value).toBe(numericValues[index])
    })
    expect(sheet.getRow(5).getCell(2).value).toBe("'-5 apples")
    expect(sheet.getRow(6).getCell(2).value).toBe("'=SUM(A1)")
  })

  test('refuses raw data outside JSON, an empty market list, and an empty selection', async () => {
    const directory = tempDirectory()
    const raw = await startExport({
      request: sampleExportRequest({ sections: ['overview', 'raw'] }),
      source: fixtureExportSource(sampleExportDataset()),
      directory
    })
    expect(raw).toMatchObject({
      ok: false,
      reason: 'Raw search data is only included in JSON exports.',
      nextStep: expect.stringContaining('Remove the raw section')
    })
    expect(readdirSync(directory)).toEqual([])

    const html = await startExport({
      request: sampleExportRequest({ format: 'html', csv: null, sections: ['overview', 'raw'] }),
      source: fixtureExportSource(sampleExportDataset()),
      directory
    })
    expect(html).toMatchObject({ ok: false, nextStep: 'Remove the raw section, or choose JSON.' })
    expect(readdirSync(directory)).toEqual([])

    const markets = await startExport({
      request: sampleExportRequest({ marketIds: [] }),
      source: fixtureExportSource(sampleExportDataset()),
      directory
    })
    expect(markets).toMatchObject({
      ok: false,
      reason: 'Pick at least one market.',
      nextStep: 'Choose a market.'
    })

    const sections = await startExport({
      request: sampleExportRequest({ sections: [] }),
      source: fixtureExportSource(sampleExportDataset()),
      directory
    })
    expect(sections).toMatchObject({ ok: false, reason: 'Pick at least one section.' })
  })

  test('emits collect, render, and write progress', async () => {
    const events: ExportProgress[] = []
    const result = await exportCsv(
      sampleExportRequest({ sections: ['prompts'], checks: 'latest' }),
      sampleExportDataset(),
      (event) => events.push(event)
    )
    expect(result.result.ok).toBe(true)
    expect(events.map((event) => event.phase)).toEqual([
      'collect',
      'collect',
      'render',
      'render',
      'render',
      'write',
      'write'
    ])
    expect(events[0]).toMatchObject({ phase: 'collect', state: 'running', done: 0, total: 1 })
    expect(events[1]).toMatchObject({ phase: 'collect', state: 'ok', done: 1 })
    expect(events.at(-2)).toMatchObject({ phase: 'write', state: 'running' })
    expect(events.at(-1)).toMatchObject({ phase: 'write', state: 'ok', done: 1, total: 1 })
    expect(events.every((event) => event.nextStep === null)).toBe(true)
    expect(JSON.stringify(events)).not.toContain('sk-ant-')
  })

  test('leaves the previous file in place when the rename fails', async () => {
    const directory = tempDirectory()
    const filename = 'TextBolt-text-alerts-2026-10-19.zip'
    writeFileSync(join(directory, filename), 'previous')
    const io = nodeExportIo()
    const csv = await startExport({
      request: sampleExportRequest({ sections: ['prompts'], checks: 'latest' }),
      source: fixtureExportSource(sampleExportDataset()),
      directory,
      io: {
        writeFile: io.writeFile.bind(io),
        unlink: io.unlink.bind(io),
        rename: () => Promise.reject(new Error('disk full'))
      }
    })
    expect(csv).toMatchObject({
      ok: false,
      reason: 'Could not write the export file.',
      nextStep: 'Check that the folder is writable and try again.'
    })
    expect(readFileSync(join(directory, filename), 'utf8')).toBe('previous')
    expect(readdirSync(directory).filter((name) => name.includes('.tmp'))).toEqual([])

    const xlsxName = 'TextBolt-text-alerts-2026-10-19.xlsx'
    writeFileSync(join(directory, xlsxName), 'previous-xlsx')
    const xlsx = await startExport({
      request: sampleExportRequest({
        format: 'xlsx',
        csv: null,
        xlsx: { freezeHeaders: true, sheetPerMarket: false },
        sections: ['prompts'],
        checks: 'latest'
      }),
      source: fixtureExportSource(sampleExportDataset()),
      directory,
      io: {
        writeFile: io.writeFile.bind(io),
        unlink: io.unlink.bind(io),
        rename: () => Promise.reject(new Error('disk full'))
      }
    })
    expect(xlsx.ok).toBe(false)
    expect(readFileSync(join(directory, xlsxName), 'utf8')).toBe('previous-xlsx')
    expect(readdirSync(directory).filter((name) => name.includes('.tmp'))).toEqual([])
  })

  test('does not write a partial file when the CSV write fails', async () => {
    const directory = tempDirectory()
    const io = nodeExportIo()
    const result = await startExport({
      request: sampleExportRequest({ sections: ['prompts'], checks: 'latest' }),
      source: fixtureExportSource(sampleExportDataset()),
      directory,
      io: {
        writeFile: () => Promise.reject(new Error('disk full')),
        rename: io.rename.bind(io),
        unlink: io.unlink.bind(io)
      }
    })
    expect(result.ok).toBe(false)
    expect(readdirSync(directory)).toEqual([])
  })

  test('redacts secrets and never writes the logo or a key', async () => {
    const secret = 'super-secret-value'
    const apiKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'
    const logo = 'LOGO-SECRET-BYTES'
    const dataset = sampleExportDataset()
    const page = dataset.pages[0]
    expect(page).toBeDefined()
    if (page === undefined) return
    const current = page.markets[0]?.checks[2]
    expect(current).toBeDefined()
    if (current === undefined) return
    const detail = current.details[0]
    expect(detail).toBeDefined()
    if (detail === undefined) return
    detail.aioText = `Hello ${apiKey} there`
    const sentiment = page.sentiment[0]
    expect(sentiment).toBeDefined()
    if (sentiment === undefined) return
    sentiment.claim = `Says ${secret}`
    const written = await exportCsv(
      sampleExportRequest({
        sections: ['prompts', 'reputation'],
        checks: 'latest',
        logoBase64: logo
      }),
      dataset,
      undefined,
      [secret]
    )
    const body = written.entries.map((entry) => entry.data.toString('utf8')).join('\n')
    expect(body).not.toContain(secret)
    expect(body).not.toContain(apiKey)
    expect(body).not.toContain(logo)
    expect(body).toContain('[REDACTED]')
  })

  test('names the file from the pattern and previews the first rows', async () => {
    const directory = tempDirectory()
    const request = sampleExportRequest({ sections: ['prompts'], checks: 'latest' })
    const preview = await previewExport({
      request,
      source: fixtureExportSource(sampleExportDataset())
    })
    expect(preview.blocked).toBe(false)
    expect(preview.pageCount).toBe(1)
    expect(preview.marketCount).toBe(1)
    expect(preview.checkCount).toBe(1)
    expect(preview.sections).toEqual(['prompts'])
    expect(preview.estimatedBytes).toBeGreaterThan(0)
    expect(preview.preview.startsWith('#,Prompt,Page,Stage')).toBe(true)
    expect(preview.reason).toBeNull()

    const result = await startExport({
      request,
      source: fixtureExportSource(sampleExportDataset()),
      directory
    })
    expect(result).toMatchObject({
      ok: true,
      filename: 'TextBolt-text-alerts-2026-10-19.zip',
      format: 'csv'
    })
  })

  test('blocks a date range that contains no checks', async () => {
    const result = await startExport({
      request: sampleExportRequest({
        checks: 'range',
        from: '2026-01-01',
        to: '2026-01-02'
      }),
      source: fixtureExportSource(sampleExportDataset()),
      directory: tempDirectory()
    })
    expect(result).toMatchObject({
      ok: false,
      reason: 'No checks fall in this date range.',
      nextStep: 'Widen the date range or choose Latest.'
    })
  })
})

function columnSum(rows: string[][], header: string): number {
  const headers = rows[0] ?? []
  const index = headers.indexOf(header)
  const data = rows.slice(1, -1)
  return data.reduce((sum, row) => sum + csvNumber(row[index] ?? ''), 0)
}

function totalCell(rows: string[][], header: string): string {
  const headers = rows[0] ?? []
  const index = headers.indexOf(header)
  return rows.at(-1)?.[index] ?? ''
}

function csvNumber(value: string): number {
  const raw = value.startsWith("'") ? value.slice(1) : value
  if (raw.length === 0) return 0
  return Number(raw)
}

async function exportCsv(
  request: ExportRequest,
  dataset: ExportDataset = sampleExportDataset(),
  onProgress?: (event: ExportProgress) => void,
  secrets?: readonly string[]
): Promise<{
  result: Awaited<ReturnType<typeof startExport>>
  entries: ReturnType<typeof readStoredZip>
  text: (name: string) => string
}> {
  const directory = tempDirectory()
  const result = await startExport({
    request,
    source: fixtureExportSource(dataset),
    directory,
    onProgress,
    ...(secrets !== undefined ? { secrets } : {})
  })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('export failed')
  const entries = readStoredZip(readFileSync(result.filePath))
  return {
    result,
    entries,
    text: (name) => entries.find((entry) => entry.name === name)?.data.toString('utf8') ?? ''
  }
}

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-export-'))
  directories.push(directory)
  return directory
}

function fileText(written: { entries: { name: string; data: Buffer }[] }, id: string): string {
  const entry = written.entries.find((item) => item.name.replace(/^\d+-/, '') === `${id}.csv`)
  return entry?.data.toString('utf8') ?? ''
}
