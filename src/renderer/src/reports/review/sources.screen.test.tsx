// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildReport, EMPTY_EXTRAS, type ReportExtras } from '@shared/report/review'
import { sampleContext, sampleMetrics } from '@shared/report/review/sample.test-helper'
import { answerExtras } from '@shared/report/review/sources.test-helper'
import { resetDrawersForTests } from '../../shell/drawers'
import { axeViolations } from '../../ui/axe.test-helper'
import { ReviewDrawers } from './ReviewDrawers'
import { ShapeSection } from './sections/ShapeSection'
import { SourcesSection } from './sections/SourcesSection'

/** The Visibility report's Sources and Answer shape tabs in the app. */

afterEach(() => {
  cleanup()
  window.location.hash = ''
  resetDrawersForTests()
})

const extras: ReportExtras = { ...EMPTY_EXTRAS, answers: answerExtras() }

describe('Sources tab', () => {
  const metrics = sampleMetrics({ engine: 'google_aio' })
  const report = buildReport(metrics, sampleContext('visibility'), extras)

  it('shows the split, source types, Reddit reply status first and saves CSVs', async () => {
    const onCsv = vi.fn()
    const view = render(<SourcesSection report={report} onCsv={onCsv} />)
    expect(view.getByRole('heading', { name: 'Who the AI answers lean on' })).toBeTruthy()
    const types = view.getByRole('table', { name: 'By source type' })
    expect(
      within(types)
        .getAllByRole('row')
        .map((row) => (row as HTMLTableRowElement).cells[0]?.textContent)
    ).toEqual(['Source type', 'Web pages', 'YouTube', 'Reddit', 'LinkedIn'])
    const threads = view.getByRole('table', { name: 'Threads' })
    expect(within(threads).getAllByRole('columnheader')[0]?.textContent).toBe('Can we reply?')
    expect(within(threads).getAllByRole('row')[1]?.textContent).toContain('Yes, open')
    expect(view.getByRole('table', { name: 'Videos' }).textContent).toContain('SMS Academy')
    // Each table with rows saves as CSV.
    const csv = view.getAllByRole('button', { name: 'Download CSV' })
    csv.forEach((button) => fireEvent.click(button))
    expect(onCsv.mock.calls.map((call) => call[0])).toEqual(['youtube', 'reddit', 'linkedin'])
    // A count opens exactly its questions.
    fireEvent.click(view.getByRole('button', { name: /Gaps to win/ }))
    expect(window.location.hash).toContain('drawer=report-drill&rd=src%3Agaps')
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('says so in one line when nothing is cited', () => {
    const empty = buildReport(metrics, sampleContext('visibility'), EMPTY_EXTRAS)
    const view = render(<SourcesSection report={empty} onCsv={() => undefined} />)
    expect(view.getByTestId('rv-sources-empty').textContent).toContain(
      'No AI answer cites a page in this check yet.'
    )
    expect(view.queryByRole('table')).toBeNull()
  })
})

describe('Answer shape tab', () => {
  const metrics = sampleMetrics({ engine: 'google_aio' })
  const report = buildReport(metrics, sampleContext('visibility'), extras)

  it('shows the tiles, the blocks, the journeys and a collapsible legend', async () => {
    const view = render(<ShapeSection report={report} />)
    expect(view.getByText('Answers analysed')).toBeTruthy()
    expect(view.getByText(/^Most common shape/)).toBeTruthy()
    const journeys = view.getByRole('table', { name: 'Recurring answer journeys' })
    expect(
      within(journeys)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)
    ).toEqual(['Journey', 'Opens with', 'Answers'])
    expect(view.queryByText('Definition', { selector: 'b' })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Show' }))
    expect(view.getByText('Definition', { selector: 'b' })).toBeTruthy()
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('a journey opens a drawer with its questions and the page outline', async () => {
    const view = render(
      <>
        <ShapeSection report={report} />
        <ReviewDrawers report={report} metrics={metrics} projectId="proj-1" />
      </>
    )
    const top = report.answerShape.journeys[0]
    if (top === undefined) throw new Error('no journey')
    fireEvent.click(view.getByRole('button', { name: top.label }))
    const drawer = await view.findByRole('dialog', { name: `Journey: ${top.label}` })
    const outline = within(drawer).getByTestId('rv-outline')
    expect(outline.textContent).toContain('Write a page in this order')
    expect(within(outline).getAllByRole('listitem')).toHaveLength(top.codes.length)
    expect(within(drawer).getByTestId('rv-dstats').textContent).toContain(
      `${top.answers.n} questions`
    )
    await waitFor(() => expect(window.location.hash).toContain('drawer=report-drill'))
  })

  it('says CiteFox AI has not read the answers yet when nothing is classified', () => {
    const waiting = answerExtras()
    const blocks = Object.fromEntries(Object.keys(waiting.blocks).map((id) => [id, []]))
    const unread = buildReport(metrics, sampleContext('visibility'), {
      ...EMPTY_EXTRAS,
      answers: { ...waiting, blocks }
    })
    const view = render(<ShapeSection report={unread} />)
    expect(view.getByTestId('rv-shape-empty').textContent).toContain(
      'CiteFox AI has not read these answers yet.'
    )
  })
})
