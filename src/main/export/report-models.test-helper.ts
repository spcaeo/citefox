import type { ExportRequest } from '@shared/ipc'
import { sampleReportModel } from './model/sample.test-helper'
import type { ReportModel, ReportRow } from './model/types'

/** Report models derived from the rich sample, for renderer tests. */

export const FORMULA_PROMPT = '=HYPERLINK("http://evil.test","click")'

export function pageModel(overrides: Partial<ExportRequest> = {}): ReportModel {
  return sampleReportModel(overrides)
}

export function projectModel(): ReportModel {
  return sampleReportModel({ scope: 'project', pageIds: [] })
}

/** The sample with its first prompt's text replaced. */
export function withFirstPrompt(model: ReportModel, text: string): ReportModel {
  return {
    ...model,
    rows: model.rows.map((row, index) => (index === 0 ? { ...row, text } : row))
  }
}

/** The sample's rows repeated until there are `count`, with fresh ids and numbers. */
export function withRowCount(model: ReportModel, count: number): ReportModel {
  const rows: ReportRow[] = []
  for (let index = 0; index < count; index += 1) {
    const source = model.rows[index % model.rows.length]
    if (source === undefined) break
    rows.push({ ...source, id: `x${index + 1}`, number: index + 1 })
  }
  return { ...model, rows, prompts: { ...model.prompts, all: { n: rows.length, drill: 'all' } } }
}

/** Remove whitespace, so text that wrapped across lines still matches. */
export function squash(value: string): string {
  return value.replace(/\s+/g, '')
}
