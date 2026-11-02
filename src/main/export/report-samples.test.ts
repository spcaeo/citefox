import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { sampleReportModel } from './model/sample.test-helper'
import { renderReportPdf } from './pdf'
import { renderCsvEntries } from './render-csv'
import { buildReportTables } from './report-tables'
import { writeXlsx } from './xlsx'
import { zipStore } from './zip'

/**
 * Writes the sample report's PDF, XLSX and CSV zip for a person to look at.
 * Runs only with CITEFOX_WRITE_SAMPLES=1. CITEFOX_SAMPLES_DIR overrides the folder.
 */

const enabled = process.env.CITEFOX_WRITE_SAMPLES === '1'
const OUT_DIR = process.env.CITEFOX_SAMPLES_DIR ?? join(tmpdir(), 'citefox-sample-reports')

describe.runIf(enabled)('sample report outputs', () => {
  test('writes sample-report.pdf, sample-report.xlsx and sample-report-csv.zip', async () => {
    mkdirSync(OUT_DIR, { recursive: true })
    const model = sampleReportModel()
    const pdf = await renderReportPdf(model, {
      pdf: { pageSize: 'letter', charts: true, preparedFor: null, hideBranding: false },
      logo: null,
      secrets: []
    })
    writeFileSync(join(OUT_DIR, 'sample-report.pdf'), pdf)

    const project = await renderReportPdf(sampleReportModel({ scope: 'project', pageIds: [] }), {
      pdf: { pageSize: 'a4', charts: true, preparedFor: 'Northwind Ops', hideBranding: true },
      logo: null,
      secrets: []
    })
    writeFileSync(join(OUT_DIR, 'sample-report-project-a4.pdf'), project)

    const tables = buildReportTables(model)
    const scratch = mkdtempSync(join(tmpdir(), 'citefox-samples-'))
    try {
      const xlsxPath = join(scratch, 'sample-report.xlsx')
      await writeXlsx(xlsxPath, tables, {
        freezeHeaders: true,
        secrets: [],
        onRow: () => undefined
      })
      writeFileSync(join(OUT_DIR, 'sample-report.xlsx'), readFileSync(xlsxPath))
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }

    const entries = await renderCsvEntries(tables, ',', true, [], () => undefined)
    writeFileSync(join(OUT_DIR, 'sample-report-csv.zip'), zipStore(entries))
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  })
})
