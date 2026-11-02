// @vitest-environment happy-dom
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetUndoToastForTests } from '../ui/undoStore'
import { questionRow, questionsList } from './questions.fixtures.test-helper'
import { fakeSource, shown } from './questions.screen.test-helper'

/**
 * Every count on Questions opens its list, and the list is as long as the
 * number clicked (NFR-14): the KPI strip and each group header's "cited N of M".
 */

beforeEach(() => {
  window.history.replaceState(null, '', '#/questions')
})

afterEach(() => {
  cleanup()
  resetUndoToastForTests()
})

async function drawerRows(dialog: HTMLElement): Promise<number> {
  const grid = within(dialog).queryByRole('grid')
  if (grid === null) return 0
  await waitFor(() => expect(grid.querySelectorAll('[data-drill-row]').length).toBeGreaterThan(0))
  return Number(grid.getAttribute('aria-rowcount')) - 1
}

async function expectOpens(
  view: Awaited<ReturnType<typeof shown>>['view'],
  button: HTMLElement
): Promise<void> {
  const count = Number(button.querySelector('[data-nfr-figure]')?.textContent)
  expect(Number.isInteger(count)).toBe(true)
  fireEvent.click(button)
  const dialog = await view.findByRole('dialog')
  expect(await drawerRows(dialog)).toBe(count)
  await waitFor(() => expect(window.location.hash).toContain('drawer=drill&drill='))
  fireEvent.keyDown(dialog, { key: 'Escape' })
  await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
}

describe('Questions drills', () => {
  it('every KPI number and group count opens a list as long as the number', async () => {
    const { view } = await shown()
    const kpis = view.getByRole('region', { name: 'Questions summary' })
    const kpiButtons = within(kpis).getAllByRole('button')
    // Tracked 3, 1 off, Overview shows 2, Cited 1, Named 1.
    expect(kpiButtons.map((button) => button.textContent?.replace(/\u00a0/g, ' '))).toEqual([
      '3',
      '1 off',
      '2',
      '1',
      '1'
    ])
    for (const button of kpiButtons) await expectOpens(view, button)

    const grid = view.getByRole('grid', { name: 'Questions' })
    const groupButtons = within(grid).getAllByRole('button', { name: /^(cited|of) \d+: / })
    expect(groupButtons.length).toBeGreaterThan(0)
    for (const button of groupButtons) await expectOpens(view, button)
  })

  it('a zero off count is plain text, not a button to an empty list', async () => {
    const rows = questionsList().rows.filter((row) => row.enabled)
    const { view } = await shown(fakeSource(questionsList({ rows })))
    const tracked = view.getByRole('region', { name: 'Tracked' })
    // No questions off: no "0 off" line at all.
    expect(tracked.textContent?.replace(/\u00a0/g, ' ')).not.toContain('off')
    expect(within(tracked).queryByRole('button', { name: /off/ })).toBeNull()
  })

  it('a group with keywords counts only its buyer questions', async () => {
    const rows = [
      questionRow({ promptId: 'q1', sourceId: 'topic-1', text: 'one', cited: true }),
      questionRow({ promptId: 'k1', sourceId: 'topic-1', text: 'kw', promptKind: 'keyword' })
    ]
    const { view } = await shown(fakeSource(questionsList({ rows })))
    const of = view.getByRole('button', { name: /^of 1: / })
    await expectOpens(view, of)
  })
})
