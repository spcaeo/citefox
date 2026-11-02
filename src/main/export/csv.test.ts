import { describe, expect, test } from 'vitest'
import { encodeCsv, parseCsv } from './csv'
import { neutralizeFormula } from './formula'
import type { ReportModel } from './model/types'
import { renderCsvEntries } from './render-csv'
import {
  FORMULA_PROMPT,
  pageModel,
  projectModel,
  withFirstPrompt
} from './report-models.test-helper'
import { buildReportTables } from './report-tables'
import { readStoredZip, zipStore, type ZipEntry } from './zip'

describe('CSV encoding', () => {
  test('quotes commas, quotes, and line breaks and round-trips them', () => {
    const rows = [
      ['market', 'prompt'],
      ['us-en', 'say "hello", then\ncontinue'],
      ['us-en', 'line\rbreak']
    ]
    const csv = encodeCsv(rows, ',', false)
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(csv).toContain('"say ""hello"", then\ncontinue"')
    expect(parseCsv(csv, ',')).toEqual(rows)
  })

  test('uses a semicolon delimiter without quoting commas', () => {
    const csv = encodeCsv([['a,b', 'c;d']], ';', false)
    expect(csv.startsWith('a,b;')).toBe(true)
    expect(csv).toContain('"c;d"')
    expect(parseCsv(csv, ';')).toEqual([['a,b', 'c;d']])
  })

  test('writes a UTF-8 BOM only when asked', () => {
    const withBom = encodeCsv([['market']], ',', true)
    expect(withBom.charCodeAt(0)).toBe(0xfeff)
    expect(Buffer.from(withBom, 'utf8').subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
    const plain = encodeCsv([['market']], ',', false)
    expect(plain.startsWith('market')).toBe(true)
    expect(parseCsv(withBom, ',')).toEqual([['market']])
  })

  test('neutralises formula characters', () => {
    for (const value of ['=1+1', '+1', '-1', '@sum', '\t=1', '\r=1']) {
      expect(neutralizeFormula(value)).toBe(`'${value}`)
    }
    expect(neutralizeFormula('Café')).toBe('Café')
    const csv = encodeCsv([[neutralizeFormula('=1+1'), 'safe']], ',', false)
    expect(parseCsv(csv, ',')[0]).toEqual(["'=1+1", 'safe'])
  })
})

describe('CSV zip from the report model', () => {
  async function entries(
    model: ReportModel,
    delimiter: ',' | ';' = ',',
    bom = true
  ): Promise<ZipEntry[]> {
    const zip = zipStore(
      await renderCsvEntries(buildReportTables(model), delimiter, bom, [], () => undefined)
    )
    return readStoredZip(zip)
  }

  function table(files: readonly ZipEntry[], id: string, delimiter: ',' | ';' = ','): string[][] {
    const file = files.find((entry) => entry.name.replace(/^\d+-/, '') === `${id}.csv`)
    if (file === undefined) throw new Error(`missing ${id}.csv`)
    return parseCsv(file.data.toString('utf8'), delimiter).filter((row) => row.join('') !== '')
  }

  function columnOf(rows: readonly string[][], header: string): number {
    const index = rows[0]?.indexOf(header) ?? -1
    if (index < 0) throw new Error(`missing column ${header}`)
    return index
  }

  test('one numbered UTF-8 file with a BOM per table, in report order', async () => {
    const model = pageModel()
    const tables = buildReportTables(model)
    const files = await entries(model)
    expect(files.map((file) => file.name)).toEqual(
      tables.map((item, index) => `${String(index + 1).padStart(2, '0')}-${item.id}.csv`)
    )
    for (const file of files) {
      expect(file.data.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
    }
    expect(files[0]?.name).toBe('01-overview-kpis.csv')
    expect(files.at(-1)?.name).toMatch(/-raw-references\.csv$/)
  })

  test('the delimiter and BOM options are respected', async () => {
    const files = await entries(pageModel(), ';', false)
    for (const file of files) expect(file.data[0]).not.toBe(0xef)
    const prompts = table(files, 'prompts', ';')
    expect(prompts[0]?.slice(0, 3)).toEqual(['#', 'Prompt', 'Page'])
    const raw = files.find((file) => file.name.endsWith('-prompts.csv'))?.data.toString('utf8')
    expect(raw?.split('\r\n')[0]).toContain('#;Prompt;Page')
  })

  test('formula text is neutralised and percentages keep their sign', async () => {
    const files = await entries(withFirstPrompt(pageModel(), FORMULA_PROMPT))
    const prompts = table(files, 'prompts')
    expect(prompts[1]?.[columnOf(prompts, 'Prompt')]).toBe(`'${FORMULA_PROMPT}`)
    const stage = table(files, 'universe-stage')
    expect(stage[1]?.[columnOf(stage, 'Cited rate')]).toBe('100%')
  })

  test('NFR-14: Prompts rows equal the prompt count, and each segment equals its rows', async () => {
    for (const model of [pageModel(), projectModel()]) {
      const files = await entries(model)
      const prompts = table(files, 'prompts')
      const body = prompts.slice(1)
      expect(body.length).toBe(model.prompts.all.n)
      expect(table(files, 'raw-references').length - 1).toBe(model.references.length)

      const columns: Record<
        string,
        { header: string; value: (key: string, label: string) => string }
      > = {
        stage: { header: 'Stage', value: (_key, label) => label },
        funnel: { header: 'Funnel', value: (key) => key },
        market: { header: 'Market', value: (_key, label) => label },
        page: { header: 'Page', value: (_key, label) => label }
      }
      for (const dimension of model.universe.dimensions) {
        const spec = columns[dimension.id]
        if (spec === undefined) continue
        const segments = table(files, `universe-${dimension.id}`).slice(1)
        const promptsAt = 1
        const at = columnOf(prompts, spec.header)
        for (const row of dimension.rows) {
          const label = segments.find(
            (segment) =>
              segment[0] !== 'Total' &&
              segment[0] === segmentLabel(model, dimension.id, row.key, row.label)
          )?.[0]
          expect(label, `${dimension.id} ${row.key}`).toBeDefined()
          const csvRow = segments.find((segment) => segment[0] === label)
          const matching = body.filter(
            (line) => line[at] === spec.value(row.key, label ?? '')
          ).length
          expect(Number(csvRow?.[promptsAt]), `${dimension.id} ${row.key}`).toBe(matching)
          expect(matching).toBe(row.prompts.n)
        }
      }
    }
  })
})

function segmentLabel(model: ReportModel, dimension: string, key: string, label: string): string {
  if (dimension === 'market') return model.markets.find((market) => market.id === key)?.label ?? key
  return label.replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '').trim()
}
