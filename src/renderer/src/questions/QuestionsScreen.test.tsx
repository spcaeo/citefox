// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setQuestionEditSourceForTests, type QuestionEditSource } from '../questionEdit'
import { axeViolations } from '../ui/axe.test-helper'
import { resetUndoToastForTests } from '../ui/undoStore'
import { QuestionsScreen } from './QuestionsScreen'
import { questionRow, questionsList } from './questions.fixtures.test-helper'
import {
  fakeSource,
  filterValue,
  goTo,
  pickFilter,
  pickGroup,
  query,
  shown
} from './questions.screen.test-helper'

beforeEach(() => {
  window.history.replaceState(null, '', '#/questions')
})

afterEach(() => {
  cleanup()
  resetUndoToastForTests()
})

describe('QuestionsScreen', () => {
  it('shows the header, KPIs and grouped questions, with the brand marked', async () => {
    const { view, source } = await shown()
    expect(view.getByRole('heading', { level: 1, name: 'Questions' })).toBeTruthy()
    expect(view.getByText('Every question and keyword you track.')).toBeTruthy()
    expect(view.getByText('4 questions · 2 groups')).toBeTruthy()
    const kpis = view.getByRole('region', { name: 'Questions summary' })
    expect(within(kpis).getByRole('region', { name: 'Tracked' }).textContent).toContain('3')
    expect(within(kpis).getByRole('region', { name: 'Cited' }).textContent).toBe('Cited1')
    expect(view.getByRole('button', { name: 'Business texting' })).toBeTruthy()
    expect(view.getByRole('button', { name: 'Not in a topic' })).toBeTruthy()
    const mark = view.container.querySelector('mark.qs-mark')
    expect(mark?.textContent).toBe('TextBolt')
    // Every question here has the same stage, so the Stage column says nothing and hides.
    expect(view.queryByRole('columnheader', { name: /Stage/ })).toBeNull()
    expect(view.getByRole('columnheader', { name: /Target page/ })).toBeTruthy()
    expect(view.queryByRole('columnheader', { name: /Sentiment/ })).toBeNull()
    // The four shared result words; Google's place apart (audit2 #3).
    expect(view.getAllByText('Target page').length).toBeGreaterThan(0)
    expect(view.getByText('#2')).toBeTruthy()
    expect(view.queryByText('Cited #2')).toBeNull()
    expect(view.getByText('Gained')).toBeTruthy()
    const add = view.getByRole('link', { name: 'Add questions' })
    expect(add.getAttribute('href')).toBe('#/questions?drawer=add-questions')
    expect(source.calls.list).toEqual([{ projectId: 'proj-1', marketId: null }])
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('keeps filters in the URL, and Back brings the earlier view', async () => {
    const { view } = await shown()
    pickFilter(view, 'Result: Cited')
    expect(query().get('result')).toBe('cited')
    expect(
      view.queryByRole('checkbox', { name: 'Select cheapest SMS API for startups' })
    ).toBeNull()
    expect(view.getByRole('checkbox', { name: 'Select how much does TextBolt cost' })).toBeTruthy()

    pickFilter(view, 'From: /pricing/')
    expect(query().get('source')).toBe('page-1')
    expect(view.getByRole('link', { name: 'Add questions' }).getAttribute('href')).toBe(
      '#/questions?source=page-1&result=cited&drawer=add-questions&target=page-1'
    )

    goTo('#/questions')
    await waitFor(() =>
      expect(
        view.getByRole('checkbox', { name: 'Select cheapest SMS API for startups' })
      ).toBeTruthy()
    )
    expect(filterValue(view, 'Result')).toBe('All')
  })

  it('opens a deep link with its filters, market and marked row', async () => {
    window.history.replaceState(null, '', '#/questions?change=gone&market=m-uk&row=p-2')
    const { view, source } = await shown()
    expect(source.calls.list).toEqual([{ projectId: 'proj-1', marketId: 'm-uk' }])
    const rows = view.getAllByRole('row').filter((row) => row.getAttribute('aria-current'))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.textContent).toContain('cheapest SMS API for startups')
    expect(view.queryByRole('checkbox', { name: 'Select how much does TextBolt cost' })).toBeNull()
  })

  it('puts sort, grouping and search in the URL', async () => {
    const { view } = await shown()
    const header = view.getByRole('columnheader', { name: /You/ })
    fireEvent.click(within(header).getByRole('button', { name: /You/ }))
    expect(query().get('sort')).toBe('result:asc')

    pickGroup(view, 'None')
    expect(query().get('group')).toBe('none')
    expect(view.getByRole('columnheader', { name: /From/ })).toBeTruthy()
    expect(view.getByRole('columnheader', { name: /Sentiment/ })).toBeTruthy()

    fireEvent.change(view.getByRole('searchbox'), { target: { value: 'per message' } })
    await waitFor(() => expect(query().get('q')).toBe('per message'))
    expect(view.getByRole('checkbox', { name: 'Select sms pricing per message' })).toBeTruthy()
    expect(view.queryByRole('checkbox', { name: 'Select how much does TextBolt cost' })).toBeNull()
  })

  it('opens the question detail on a row click and marks the row for Back', async () => {
    const { view } = await shown()
    fireEvent.click(view.getByText('cheapest SMS API for startups'))
    expect(window.location.hash).toBe('#/pages/page-1/prompt/p-2?market=m-us&run=run-b')
  })

  it('edits a question from the row menu, in the Edit question drawer', async () => {
    const { view } = await shown()
    fireEvent.click(view.getByRole('button', { name: 'Actions for cheapest SMS API for startups' }))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Edit question…' }))
    expect(query().get('drawer')).toBe('question')
    expect(query().get('question')).toBe('p-2')
    expect(query().get('question.src')).toBe('page-1')
  })

  it('pauses the selected questions and reloads', async () => {
    const { view, source } = await shown()
    fireEvent.click(view.getByRole('checkbox', { name: 'Select cheapest SMS API for startups' }))
    const bar = view.getByRole('region', { name: 'Bulk actions' })
    fireEvent.click(within(bar).getByRole('button', { name: 'Pause' }))
    await view.findByText('Paused 1 question.')
    expect(source.calls.update).toEqual([
      { projectId: 'proj-1', action: 'disable', items: [{ sourceId: 'page-1', promptId: 'p-2' }] }
    ])
    await waitFor(() => expect(source.calls.list).toHaveLength(2))
  })

  it('removes at once and Undo restores the earlier version', async () => {
    const restore = vi.fn(async () => ({ restored: 1, skipped: [], message: 'Restored.' }))
    setQuestionEditSourceForTests({
      'questions:restore': restore
    } as unknown as QuestionEditSource)
    const { view, source } = await shown()
    fireEvent.click(view.getByRole('checkbox', { name: 'Select sms pricing per message' }))
    const bar = view.getByRole('region', { name: 'Bulk actions' })
    fireEvent.click(within(bar).getByRole('button', { name: 'More actions' }))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Remove' }))
    expect(view.queryByRole('dialog')).toBeNull()
    await view.findByText('Removed 1 question.')
    expect(source.calls.update).toEqual([
      { projectId: 'proj-1', action: 'remove', items: [{ sourceId: 'page-1', promptId: 'p-3' }] }
    ])
    fireEvent.click(view.getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(restore).toHaveBeenCalledWith({
        projectId: 'proj-1',
        points: [{ sourceId: 'page-1', promptSetId: 'pset-old', replacedBy: 'pset-new' }]
      })
    )
    setQuestionEditSourceForTests(null)
  })

  it('shows the search cost before re-checking the selection', async () => {
    const { view, source } = await shown()
    fireEvent.click(view.getByRole('checkbox', { name: 'Select every row on this page' }))
    fireEvent.click(
      within(view.getByRole('region', { name: 'Bulk actions' })).getByRole('button', {
        name: 'Check now'
      })
    )
    const dialog = await view.findByRole('alertdialog', { name: 'Check 3 questions now?' })
    expect(query().get('confirm')).toBe('recheck')
    expect(query().get('pick')).toBe('p-t1,p-1,p-2,p-3')
    await waitFor(() =>
      expect(dialog.textContent).toContain(
        'Uses 4 searches in US · EN, up to 8 if Google loads the overview separately · 500 left. 1 question skipped'
      )
    )
    const confirm = within(dialog).getByRole('button', { name: 'Check now' }) as HTMLButtonElement
    await waitFor(() => expect(confirm.disabled).toBe(false))
    fireEvent.click(confirm)
    await waitFor(() => expect(query().get('confirm')).toBeNull())
    await view.findByText('Checked 3 questions in US · EN. Used 3 searches.')
    expect(source.calls.start).toEqual([
      {
        projectId: 'proj-1',
        pageIds: ['topic-1', 'page-1'],
        marketIds: ['m-us'],
        promptIds: ['p-t1', 'p-1', 'p-2']
      }
    ])
  })

  it('opens the re-check confirm from a link; Escape closes it and the address loses it', async () => {
    window.history.replaceState(null, '', '#/questions?confirm=recheck&pick=p-1')
    const { view, source } = await shown()
    const dialog = await view.findByRole('alertdialog', { name: 'Check 1 question now?' })
    await waitFor(() => expect(dialog.textContent).toContain('500 left'))
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(view.queryByRole('alertdialog')).toBeNull())
    expect(query().get('confirm')).toBeNull()
    expect(query().get('pick')).toBeNull()
    expect(source.calls.start ?? []).toEqual([])
  })

  it('keeps Check now off when the linked questions are gone', async () => {
    window.history.replaceState(null, '', '#/questions?confirm=recheck&pick=gone-1')
    const { view } = await shown()
    const dialog = await view.findByRole('alertdialog')
    expect(dialog.textContent).toContain('These questions are not in the list any more.')
    const confirm = within(dialog).getByRole('button', { name: 'Check now' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
  })

  it('Back closes the re-check confirm', async () => {
    const { view } = await shown()
    fireEvent.click(view.getByRole('checkbox', { name: 'Select every row on this page' }))
    fireEvent.click(
      within(view.getByRole('region', { name: 'Bulk actions' })).getByRole('button', {
        name: 'Check now'
      })
    )
    await view.findByRole('alertdialog')
    window.history.back()
    await waitFor(() => expect(view.queryByRole('alertdialog')).toBeNull())
    expect(query().get('confirm')).toBeNull()
  })

  it('shows keywords apart from questions: tile, count line, Type column and filter', async () => {
    const base = questionsList()
    const keyword = questionRow({
      promptId: 'k-1',
      sourceId: 'topic-1',
      text: 'business texting app',
      promptKind: 'keyword'
    })
    const { view } = await shown(fakeSource(questionsList({ rows: [...base.rows, keyword] })))
    const kpis = view.getByRole('region', { name: 'Questions summary' })
    const tracked = within(kpis).getByRole('region', { name: 'Tracked' })
    expect(tracked.textContent).toContain('4')
    // The split is in the count line under the grid, not repeated in the tile.
    expect(tracked.textContent).not.toContain('3 questions · 1 keyword')
    expect(view.getByText('4 questions · 1 keyword · 2 groups')).toBeTruthy()
    expect(view.getByRole('columnheader', { name: /Type/ })).toBeTruthy()
    pickFilter(view, 'Type: Keywords')
    expect(query().get('type')).toBe('keyword')
    expect(view.getByRole('checkbox', { name: 'Select business texting app' })).toBeTruthy()
    expect(view.queryByRole('checkbox', { name: 'Select how much does TextBolt cost' })).toBeNull()
  })

  it('has no Kind column or filter when nothing is a keyword', async () => {
    const { view } = await shown()
    expect(view.queryByRole('columnheader', { name: /Type/ })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Filter' }))
    expect(view.queryByRole('menuitemradio', { name: /^Type: / })).toBeNull()
  })

  it('points to Add questions when there are none', async () => {
    const source = fakeSource(
      questionsList({
        rows: [],
        sources: [],
        facets: {
          kind: { page: 0, topic: 0 },
          source: {},
          result: { cited: 0, named: 0, not_cited: 0, no_overview: 0, error: 0, not_checked: 0 },
          change: { gained: 0, lost: 0, new_overview: 0, gone: 0, none: 0 }
        }
      })
    )
    const view = render(<QuestionsScreen projectId="proj-1" source={source} />)
    expect(await view.findByRole('heading', { name: 'No questions yet' })).toBeTruthy()
    expect(view.getAllByRole('link', { name: 'Add questions' })).toHaveLength(2)
    // ✦ Help me write them: Add questions open on its helper tab.
    expect(view.getByRole('link', { name: 'Help me write them' }).getAttribute('href')).toMatch(
      /drawer=add-questions&tab=suggest$/u
    )
  })

  it('offers Show all when the filters match nothing', async () => {
    window.history.replaceState(null, '', '#/questions?result=error&group=none')
    const source = fakeSource()
    const view = render(<QuestionsScreen projectId="proj-1" source={source} />)
    expect(
      await view.findByRole('heading', { name: 'No questions match this filter' })
    ).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Show all' }))
    expect(window.location.hash).toBe('#/questions?group=none')
    await view.findByRole('grid', { name: 'Questions' })
  })
})
