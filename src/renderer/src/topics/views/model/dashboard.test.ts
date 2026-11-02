import { describe, expect, test } from 'vitest'
import type { PromptCheckStatus } from '@shared/domain'
import type { QuestionRow } from '@shared/ipc'
import { questionRow, topicSummary } from '../../../questions/questions.fixtures.test-helper'
import { dashboard, folderGrid, NO_FOLDER } from './dashboard'
import { drillChips, drillTitle, drillWhatToDo, parseDrill, withoutKey, writeDrill } from './drill'

function rows(topicId: string, statuses: readonly (PromptCheckStatus | null)[]): QuestionRow[] {
  return statuses.map((status, index) =>
    questionRow({
      promptId: `${topicId}-${index}`,
      sourceId: topicId,
      text: `Question ${index + 1}`,
      status,
      overview: status === null || status === 'error' ? null : status !== 'no_aio',
      cited: status === 'page_cited' || status === 'other_own_page'
    })
  )
}

const TOPICS = [
  topicSummary({ id: 't-att', name: 'AT&T gateway', checkedAt: '2026-10-29T14:27:00.000Z' }),
  topicSummary({ id: 't-vz', name: 'Verizon vtext', checkedAt: '2026-10-28T20:02:00.000Z' }),
  topicSummary({ id: 't-nagios', name: 'Nagios alerts', checkedAt: null }),
  topicSummary({ id: 't-gone', name: 'Old', status: 'removed' })
]

const ROWS = [
  ...rows('t-att', [
    'not_cited',
    'not_cited',
    'brand_mentioned',
    'other_own_page',
    'other_own_page',
    'no_aio'
  ]),
  ...rows('t-vz', ['page_cited', 'not_cited', 'no_aio', 'error']),
  ...rows('t-nagios', [null, null]),
  ...rows('t-gone', ['page_cited'])
]

describe('the Topics dashboard model', () => {
  test('folders › topics with totals; No folder holds the rest; removed topics are left out', () => {
    const board = dashboard(
      TOPICS,
      [{ id: 'f1', name: 'Carrier shutdowns', createdAt: '', topicIds: ['t-att', 't-vz'] }],
      ROWS
    )
    expect(board.folders.map((folder) => [folder.name, folder.topics.map((t) => t.id)])).toEqual([
      ['Carrier shutdowns', ['t-att', 't-vz']],
      [NO_FOLDER, ['t-nagios']]
    ])
    const carriers = board.folders[0]
    expect(carriers?.totals.searches).toBe(10)
    expect(carriers?.totals.counts).toEqual({
      not_cited: 4,
      other_page: 2,
      target: 1,
      no_overview: 2,
      not_checked: 1
    })
    expect(carriers?.totals.needsWork).toBe(6)
    expect(carriers?.totals.targetPct).toBe(14)
    expect(carriers?.checkedAt).toBe('2026-10-29T14:27:00.000Z')
    // The footer adds up the folders.
    expect(board.totals.searches).toBe(12)
    expect(board.folders.reduce((sum, folder) => sum + folder.totals.searches, 0)).toBe(12)
    expect(board.kpis).toMatchObject({ targetCited: 1, withAio: 7, needsWork: 6, targetPct: 14 })
    expect(board.kpis.furthestBehind?.id).toBe('t-att')
  })

  test('with no folders every topic is in No folder; an empty folder still shows', () => {
    expect(dashboard(TOPICS, [], ROWS).folders.map((folder) => folder.name)).toEqual([NO_FOLDER])
    const board = dashboard(
      TOPICS,
      [
        { id: 'f1', name: 'Empty', createdAt: '', topicIds: [] },
        { id: 'f2', name: 'All', createdAt: '', topicIds: ['t-att', 't-vz', 't-nagios'] }
      ],
      ROWS
    )
    expect(board.folders.map((folder) => [folder.name, folder.topics.length])).toEqual([
      ['Empty', 0],
      ['All', 3]
    ])
  })

  test('the folder grid adds up to All', () => {
    const grid = folderGrid(
      dashboard(TOPICS, [{ id: 'f1', name: 'C', createdAt: '', topicIds: ['t-att'] }], ROWS)
    )
    expect(grid.results).toEqual([
      'not_cited',
      'other_page',
      'target',
      'no_overview',
      'not_checked'
    ])
    grid.results.forEach((result, index) => {
      expect(grid.rows.reduce((sum, row) => sum + (row.cells[index]?.count ?? 0), 0)).toBe(
        grid.all.totals.counts[result]
      )
    })
  })
})

describe('drill filters in the URL', () => {
  test('round-trip, keeping other keys, ignoring junk', () => {
    const params = writeDrill(new URLSearchParams('view=tree&stage=fit'), {
      stage: 'problem',
      result: 'not_cited',
      kind: 'question'
    })
    expect(params.toString()).toBe('view=tree&stage=problem&result=not_cited&type=question')
    expect(parseDrill(params)).toEqual({ stage: 'problem', result: 'not_cited', kind: 'question' })
    expect(parseDrill(new URLSearchParams('stage=nope&result=bad&type=x&site=reddit.com'))).toEqual(
      { site: 'reddit.com' }
    )
  })

  test('chips, title and what to do read in plain words', () => {
    const filter = { stage: 'problem', result: 'not_cited' } as const
    expect(drillChips(filter).map((chip) => chip.label)).toEqual(['Stage: Problem', 'Not cited'])
    expect(drillTitle(filter)).toBe('Problem searches where you are not cited')
    expect(drillTitle({ kind: 'keyword', words: 'nagios sms' })).toBe('"nagios sms" keywords')
    expect(drillTitle({ result: 'no_overview' })).toBe('Searches with no AI Overview')
    expect(drillWhatToDo(filter)).toBe('Improve the target page, highest win odds first.')
    expect(withoutKey(filter, 'stage')).toEqual({ result: 'not_cited' })
  })
})
