import { describe, expect, test } from 'vitest'
import { pageModel, projectModel } from './report-models.test-helper'
import { buildReportTables } from './report-tables'
import { draft, finishTables } from './report-tables/build'

describe('report tables', () => {
  test('page scope: one table per section table, in report order', () => {
    const tables = buildReportTables(pageModel())
    expect(tables.map((table) => table.id)).toEqual([
      'overview-kpis',
      'overview-funnel',
      'overview-opportunity-stage',
      'overview-actions',
      'pages-tracked',
      'pages-other-own',
      'pages-wrong-page',
      'competition-share-of-voice',
      'competition-leaderboard',
      'reputation-empty',
      'trends-series',
      'trends-changes',
      'trends-fix-verdicts',
      'universe-stage',
      'universe-funnel',
      'universe-source',
      'universe-market',
      'sources-split',
      'sources-platforms',
      'sources-youtube',
      'sources-reddit',
      'sources-subreddits',
      'sources-linkedin',
      'sources-influential',
      'answer-shape-blocks',
      'answer-shape-journeys',
      'answer-shape-changes',
      'content-gaps-page-read',
      'content-gaps-matrix',
      'content-gaps-one-by-one',
      'content-gaps-page-wide',
      'prompts',
      'raw-references'
    ])
    expect(tables.map((table) => table.sheetName)).toContain('Changes since previous check')
  })

  test('project scope adds the page tables and explains the page-only section', () => {
    const model = projectModel()
    const tables = buildReportTables(model)
    const ids = tables.map((table) => table.id)
    expect(ids).toContain('overview-opportunity-page')
    expect(ids).toContain('universe-page')
    expect(ids).toContain('content-gaps-empty')
    const empty = tables.find((table) => table.id === 'content-gaps-empty')
    expect(empty?.sheetName).toBe('Content gaps')
    expect(empty?.rows).toEqual([
      [
        { kind: 'text', value: 'Content gaps' },
        { kind: 'text', value: model.contentGaps.empty?.title },
        { kind: 'text', value: model.contentGaps.empty?.message },
        { kind: 'text', value: model.contentGaps.empty?.nextStep }
      ]
    ])
  })

  test('only the chosen sections, and Raw references only with Prompts', () => {
    const model = { ...pageModel(), sections: ['overview', 'universe'] as const }
    const ids = buildReportTables(model).map((table) => table.id)
    expect(ids.every((id) => id.startsWith('overview-') || id.startsWith('universe-'))).toBe(true)
    expect(ids).not.toContain('raw-references')
  })

  test('changes since the previous check say when a category is empty', () => {
    const model = pageModel()
    const emptied = {
      ...model,
      trends: { ...model.trends, lost: { count: { n: 0, drill: null }, items: [] } }
    }
    const changes = buildReportTables(emptied).find((table) => table.id === 'trends-changes')
    const lost = changes?.rows.filter(
      (row) => row[0]?.kind === 'text' && row[0].value === 'Lost citations'
    )
    expect(lost).toEqual([
      [
        { kind: 'text', value: 'Lost citations' },
        { kind: 'text', value: 'No changes in this category.' },
        { kind: 'blank' },
        { kind: 'blank' },
        { kind: 'blank' },
        { kind: 'blank' }
      ]
    ])
  })

  test('market columns use the market label, never the flag', () => {
    const tables = buildReportTables(pageModel())
    const market = tables.find((table) => table.id === 'universe-market')
    expect(market?.rows.map((row) => row[0])).toEqual([
      { kind: 'text', value: 'US · EN' },
      { kind: 'text', value: 'CA · EN' }
    ])
  })

  test('sheet names are trimmed to 31 characters, cleaned, and made unique', () => {
    const tables = finishTables([
      draft('a', 'Prompts: US/EN [main]?', ['x'], []),
      draft('b', 'A sheet name that is much longer than Excel allows', ['x'], []),
      draft('c', 'A sheet name that is much longer than Excel allows', ['x'], []),
      draft('d', 'prompts  US EN  main', ['x'], [])
    ])
    expect(tables.map((table) => table.sheetName)).toEqual([
      'Prompts US EN main',
      'A sheet name that is much longe',
      'A sheet name that is much l (2)',
      'prompts US EN main (2)'
    ])
    expect(tables.map((table) => table.fileName)).toEqual([
      '01-a.csv',
      '02-b.csv',
      '03-c.csv',
      '04-d.csv'
    ])
  })
})
