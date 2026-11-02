// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ImportPreview, ImportRow } from '@shared/ipc'
import { PreviewCard } from './PreviewCard'

afterEach(cleanup)

function row(n: number, values: Record<string, string>, fix: ImportRow['fix'] = null): ImportRow {
  return {
    row: n,
    values,
    result: fix === null ? 'new' : 'fix',
    reason: fix === null ? null : 'No topic named that yet.',
    fix,
    match: null,
    kind: 'question'
  }
}

function preview(rows: ImportRow[]): ImportPreview {
  return {
    sourceId: 'src-1',
    entity: 'questions',
    rows,
    counts: {
      new: rows.filter((item) => item.result === 'new').length,
      keyword: 0,
      similar: 0,
      duplicate: 0,
      fix: rows.filter((item) => item.result === 'fix').length,
      total: rows.length
    },
    stageWords: [],
    unknownMarkets: [],
    newPages: []
  }
}

function renderCard(data: ImportPreview): void {
  render(
    <PreviewCard
      entity="questions"
      preview={data}
      checking={false}
      filter="all"
      limit={10}
      title="every row is checked"
      marketLabel={(id) => (id === 'mkt-uk' ? 'GB' : id)}
      site="textbolt.com"
      defaultMarket={null}
      busy={false}
      onFilter={() => undefined}
      onAddMarkets={() => undefined}
      onDropMarketColumn={() => undefined}
      onStageWord={() => undefined}
    />
  )
}

function headers(): string[] {
  return within(screen.getByTestId('import-rows'))
    .getAllByRole('columnheader')
    .map((cell) => cell.textContent ?? '')
}

describe('the import preview (W3I-C1, C3)', () => {
  it('shows a Topic column when rows name a topic, marking one that is new', () => {
    renderCard(
      preview([
        row(2, { question: 'how do I page my on-call team', topic: 'On-call paging' }, 'topic'),
        row(3, { question: 'what is the best sms tool for clinics', market: 'mkt-uk' })
      ])
    )
    expect(headers()).toEqual(['Row', 'Question', 'Stage', 'Page', 'Market', 'Topic', 'Result'])
    const table = screen.getByTestId('import-rows')
    expect(table.textContent).toContain('On-call paging (new)')
    expect(table.textContent).toContain('GB')
    expect(table.textContent).toContain('The picked one')
  })

  it('leaves the Topic column out when no row names one', () => {
    renderCard(preview([row(2, { question: 'what is the best sms tool for clinics' })]))
    expect(headers()).not.toContain('Topic')
  })
})
