// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it } from 'vitest'
import { formatMoment } from '../../utils/dates'
import { ProjectHistoryScreen } from './index'
import {
  NEWEST,
  OLDEST,
  PARTIAL,
  TOPIC,
  UK_CHECK,
  fakeSource,
  history
} from './ProjectHistory.fixtures'
import {
  columnsParam,
  compareBlock,
  contentBlock,
  defaultColumns,
  dropOrder,
  durationText,
  NARROW_DROPS,
  parseColumns,
  parseCompare,
  parseSelection,
  parseSort,
  previousCheck,
  rerunRequest,
  retryRequest,
  searchCost
} from './model'
import { historyCsv } from './utils/csv'

const AXE_RULES = {
  rules: {
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    'landmark-one-main': { enabled: false },
    region: { enabled: false }
  }
}

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

/**
 * The check row for a day ("Oct 19, 2026": its When cell starts "Oct 19,") or a
 * page or topic name. Day group rows are left out.
 */
function rowOf(grid: HTMLElement, text: string): HTMLElement {
  const day = /^[A-Z][a-z]{2} \d+, \d{4}$/.test(text) ? text.replace(/, \d{4}$/, ',') : null
  const row = checkRows(grid).find((line) =>
    day === null
      ? line.textContent?.includes(text)
      : Array.from(line.querySelectorAll('.num')).some((cell) => cell.textContent?.startsWith(day))
  )
  return row as HTMLElement
}

/** The check rows of the tree, without its Day group rows and total row. */
function checkRows(grid: HTMLElement): HTMLElement[] {
  return Array.from(grid.querySelectorAll<HTMLElement>('[role="row"][data-row]'))
}

function headers(grid: HTMLElement): string[] {
  return within(grid)
    .getAllByRole('columnheader')
    .map((cell) => cell.textContent?.trim() ?? '')
    .filter((text) => text.length > 0)
}

describe('Check history (project level)', () => {
  it('lists every check newest first with kind, score and change, and a page path to copy or open', async () => {
    // Type is hidden by default (audit #10); this link shows it.
    window.location.hash = '#/history?cols=market,kind,score,change,cited'
    const { source } = fakeSource()
    const view = render(<ProjectHistoryScreen projectId="proj-1" source={source} />)
    const grid = await view.findByRole('treegrid', { name: 'Check history' })
    expect(view.getByText(/5 checks across 1 page and 1 topic, 23 searches used\./)).toBeTruthy()
    expect(headers(grid)).toEqual([
      'Day › Check',
      'Page or topic',
      'Market',
      'Type',
      'Score',
      'Change',
      'Cited',
      'Status',
      'Ask CiteFox',
      'Actions'
    ])
    const rows = checkRows(grid)
    expect(rows).toHaveLength(5)
    expect(rows[0]?.textContent).toMatch(/^Oct 19/)
    expect(rows[0]?.textContent).toContain('Scheduled')
    expect(rows[0]?.textContent).toContain('67')
    expect(rows[0]?.textContent).toContain('+27')
    // Market, questions, searches and duration ride in the date's tooltip.
    expect(
      within(rows[0] as HTMLElement).getByTitle(
        /US · EN · 3 of 3 questions · 6 searches · took 42s$/
      )
    ).toBeTruthy()
    expect(rows[1]?.textContent).toContain('Crew alerts')
    expect(rows[1]?.textContent).toContain('Topic')
    expect(rows[1]?.textContent).toContain('Stopped')
    expect(rows[2]?.textContent).toContain('Partial')
    expect(rows[2]?.textContent).toContain('Follow-up')
    expect(rows[4]?.textContent).toContain('Baseline')
    expect(within(grid).getAllByText('/blog/text-alerts/').length).toBe(4)
    expect(within(grid).getAllByRole('button', { name: 'Copy /blog/text-alerts/' }).length).toBe(4)
    const open = within(grid).getAllByRole('link', { name: 'Open /blog/text-alerts/ in a new tab' })
    expect(open[0]?.getAttribute('href')).toBe('https://textbolt.com/blog/text-alerts/')
    const results = await axe.run(view.container, AXE_RULES)
    expect(results.violations.map((item) => item.id)).toEqual([])
  })

  it('starts with the columns that fit, leaving Type, Credits and Cost in the Columns menu', async () => {
    window.location.hash = '#/history'
    const { source } = fakeSource()
    const view = render(<ProjectHistoryScreen projectId="proj-1" source={source} />)
    const grid = await view.findByRole('treegrid', { name: 'Check history' })
    // A narrow window (the test window) starts with the seven columns that fit 1134px.
    expect(headers(grid)).toEqual([
      'Day › Check',
      'Page or topic',
      'Market',
      'Score',
      'Change',
      'Cited',
      'Status',
      'Ask CiteFox',
      'Actions'
    ])
  })

  it('filters by engine from the toolbar, in the URL, and shows engines as logos (audit #4)', async () => {
    window.location.hash = '#/history?cols=engines'
    const both = { ...NEWEST, engines: ['google_aio', 'chatgpt'] as const }
    const { source } = fakeSource(history([both, OLDEST]))
    const view = render(<ProjectHistoryScreen projectId="proj-1" source={source} />)
    const grid = await view.findByRole('treegrid', { name: 'Check history' })
    expect(checkRows(grid)).toHaveLength(2)
    expect(within(grid).getByRole('img', { name: 'Google AI Overview, ChatGPT' })).toBeTruthy()
    const filter = view.getByRole('group', { name: 'Engine' })
    fireEvent.click(within(filter).getByRole('button', { name: 'ChatGPT' }))
    await waitFor(() => expect(window.location.hash).toContain('engine=chatgpt'))
    await waitFor(() => expect(checkRows(grid)).toHaveLength(1))
    fireEvent.click(within(filter).getByRole('button', { name: 'All' }))
    await waitFor(() => expect(checkRows(grid)).toHaveLength(2))
  })

  it('shows one fixed engine logo when every check asked Google only', async () => {
    window.location.hash = '#/history'
    const { source } = fakeSource()
    const view = render(<ProjectHistoryScreen projectId="proj-1" source={source} />)
    await view.findByRole('treegrid', { name: 'Check history' })
    expect(view.queryByRole('group', { name: 'Engine' })).toBeNull()
    expect(view.getByRole('img', { name: 'Google AI Overview only' })).toBeTruthy()
  })

  it('folds the checks by day: a Day row adds up its checks, each check shows its time', async () => {
    window.location.hash = '#/history'
    const { source } = fakeSource()
    const view = render(<ProjectHistoryScreen projectId="proj-1" source={source} />)
    const grid = await view.findByRole('treegrid', { name: 'Check history' })
    // Four days, newest first; five checks fit, so every day starts open.
    const days = Array.from(grid.querySelectorAll<HTMLElement>('[role="row"][data-group]'))
    expect(
      days.map(
        (row) => row.textContent?.replace(/\u00a0/g, ' ').match(/Oct \d+, \d{4} · \d+ checks?/)?.[0]
      )
    ).toEqual([
      'Oct 19, 2026 · 1 check',
      'Oct 15, 2026 · 1 check',
      'Oct 12, 2026 · 1 check',
      'Oct 5, 2026 · 2 checks'
    ])
    expect(checkRows(grid)).toHaveLength(5)
    // Oct 5 holds two checks, cited once each: its Cited total is 2.
    const cited = within(grid)
      .getAllByRole('columnheader')
      .findIndex((cell) => cell.textContent?.trim() === 'Cited')
    const cell = (row: HTMLElement): string =>
      (row.querySelectorAll('[role="gridcell"]')[cited]?.textContent ?? '').trim()
    expect(cell(days[3] as HTMLElement)).toBe('2')
    // The footer adds up every check.
    const total = grid.querySelector<HTMLElement>('.ui-lg-tree-total')
    expect(total?.textContent).toContain('All checks')
    expect(cell(total as HTMLElement)).toBe('6')
    // Each check shows when it started, with the time, in the computer's own clock.
    expect(rowOf(grid, 'Oct 19, 2026').textContent).toContain(formatMoment(NEWEST.startedAt))
    // A day folds and opens from its arrow, and the open days are in the URL.
    fireEvent.click(
      within(days[0] as HTMLElement).getByRole('button', { name: 'Close Oct 19, 2026' })
    )
    await waitFor(() => expect(checkRows(grid)).toHaveLength(4))
    expect(window.location.hash).toContain('hp.open=')
  })

  it('keeps scope, market and status in the URL, and follows Back and Forward', async () => {
    window.location.hash = '#/p/proj-1/history?status=partial'
    const { source } = fakeSource()
    const view = render(<ProjectHistoryScreen projectId="proj-1" source={source} />)
    const grid = await view.findByRole('treegrid', { name: 'Check history' })
    expect(checkRows(grid)).toHaveLength(1)

    const filters = view.getByRole('group', { name: 'Show checks by status' })
    fireEvent.click(within(filters).getByRole('button', { name: /^All/ }))
    await waitFor(() => expect(window.location.hash).toBe('#/p/proj-1/history'))

    // The pickers are the toolbar's own dropdowns (audit2 #7).
    const pick = (name: string, option: string | RegExp): void => {
      fireEvent.click(view.getByRole('combobox', { name }))
      const list = view.getByRole('listbox', { name })
      fireEvent.click(within(list).getByRole('option', { name: option }))
    }
    pick('Page or topic', 'All topics')
    await waitFor(() => expect(window.location.hash).toBe('#/p/proj-1/history?scope=topics'))
    expect(checkRows(grid)).toHaveLength(1)
    expect(grid.textContent).toContain('Crew alerts')

    pick('Page or topic', 'Alerts')
    pick('Market', /GB|UK/)
    await waitFor(() =>
      expect(window.location.hash).toBe('#/p/proj-1/history?page=page-1&market=mkt-uk')
    )
    expect(checkRows(grid)).toHaveLength(1)

    window.location.hash = '#/p/proj-1/history?scope=topics'
    await waitFor(() => expect(grid.textContent).toContain('Crew alerts'))
    expect(checkRows(grid)).toHaveLength(1)
  })

  it('a row opens that check’s results: the page Results tab or the topic, pinned to the run', async () => {
    window.location.hash = '#/history'
    const { source } = fakeSource()
    const view = render(<ProjectHistoryScreen projectId="proj-1" source={source} />)
    const grid = await view.findByRole('treegrid', { name: 'Check history' })
    fireEvent.click(rowOf(grid, 'Oct 12, 2026'))
    await waitFor(() =>
      expect(window.location.hash).toBe('#/pages/page-1/results?market=mkt-us&run=run-2')
    )
    window.location.hash = '#/history'
    fireEvent.click(rowOf(grid, 'Crew alerts'))
    await waitFor(() =>
      expect(window.location.hash).toBe('#/topics/topic-1?market=mkt-us&run=run-topic')
    )
  })

  it('shows and hides columns from the Columns menu, in the URL', async () => {
    window.location.hash = '#/history'
    const { source } = fakeSource()
    const view = render(<ProjectHistoryScreen projectId="proj-1" source={source} />)
    const grid = await view.findByRole('treegrid', { name: 'Check history' })
    fireEvent.click(view.getByRole('button', { name: /Columns/ }))
    fireEvent.click(
      within(view.getByRole('menu', { name: 'Columns' })).getByRole('menuitem', {
        name: /^Searches/
      })
    )
    await waitFor(() => expect(window.location.hash).toContain('cols='))
    expect(headers(grid)).toContain('Searches')
    expect(rowOf(grid, 'Oct 19, 2026').textContent).toContain('6')

    // A copied link shows the same columns.
    cleanup()
    const again = render(<ProjectHistoryScreen projectId="proj-1" source={source} />)
    const reopened = await again.findByRole('treegrid', { name: 'Check history' })
    expect(headers(reopened)).toContain('Searches')
  })

  it('keeps the ticked checks in the URL and ticks them again from a link', async () => {
    window.location.hash = '#/history'
    const { source } = fakeSource()
    const view = render(<ProjectHistoryScreen projectId="proj-1" source={source} />)
    await view.findByRole('treegrid', { name: 'Check history' })
    fireEvent.click(view.getByRole('checkbox', { name: /^Select Alerts · .*Oct 19,/ }))
    await waitFor(() => expect(window.location.hash).toBe('#/history?sel=run-3'))
    fireEvent.click(view.getByRole('checkbox', { name: /^Select Alerts · .*Oct 12,/ }))
    await waitFor(() => expect(window.location.hash).toBe('#/history?sel=run-3%2Crun-2'))

    cleanup()
    const again = render(<ProjectHistoryScreen projectId="proj-1" source={source} />)
    await again.findByRole('treegrid', { name: 'Check history' })
    const box = again.getByRole('checkbox', {
      name: /^Select Alerts · .*Oct 12,/
    }) as HTMLInputElement
    expect(box.checked).toBe(true)
    expect(again.getByText(/2 selected/)).toBeTruthy()
  })

  it('exports the filtered checks as CSV from the toolbar', async () => {
    window.location.hash = '#/history?market=mkt-uk'
    const { source, csv } = fakeSource()
    const view = render(<ProjectHistoryScreen projectId="proj-1" source={source} />)
    await view.findByRole('treegrid', { name: 'Check history' })
    fireEvent.click(view.getByRole('button', { name: 'Export CSV' }))
    await waitFor(() => expect(csv).toHaveLength(1))
    expect(csv[0]?.header.slice(0, 6)).toEqual([
      'Date',
      'Time',
      'Page or topic',
      'URL',
      'Type',
      'Market'
    ])
    expect(csv[0]?.rows).toHaveLength(1)
    expect(csv[0]?.rows[0]?.[2]).toBe('Alerts')
  })

  it('tells a project with nothing tracked to add a page first', async () => {
    window.location.hash = '#/history'
    const { source } = fakeSource(history([], 0))
    const view = render(<ProjectHistoryScreen projectId="proj-1" source={source} />)
    expect(
      await view.findByRole('heading', { name: 'No checks yet. Add a page to track first' })
    ).toBeTruthy()
    expect(view.getByRole('link', { name: 'Import pages' }).getAttribute('href')).toBe(
      '#/import-pages'
    )
    fireEvent.click(view.getByRole('button', { name: 'Add a page' }))
    await waitFor(() => expect(window.location.hash).toBe('#/history?drawer=add-page'))
  })

  it('sends a project that tracks pages but has no checks yet to Check now', async () => {
    window.location.hash = '#/history'
    const { source } = fakeSource(history([], 3))
    const view = render(<ProjectHistoryScreen projectId="proj-1" source={source} />)
    expect(await view.findByRole('heading', { name: 'No checks yet.' })).toBeTruthy()
    expect(view.getByRole('link', { name: 'Check now' }).getAttribute('href')).toBe('#/check')
  })

  it('shows a load error with a retry that loads again', async () => {
    window.location.hash = '#/history'
    const { source, lists } = fakeSource(new Error('The project file is busy.'))
    const view = render(<ProjectHistoryScreen projectId="proj-1" source={source} />)
    const alert = await view.findByRole('alert')
    expect(alert.textContent).toContain('Could not load the check history.')
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    await view.findByRole('treegrid', { name: 'Check history' })
    expect(lists()).toBe(2)
  })
})

describe('Check history model', () => {
  it('reads the sort, the selection and the comparison from the URL, dropping what it does not know', () => {
    expect(parseSort('date:asc,nope:desc,cited:desc,date:desc')).toEqual([
      { key: 'date', dir: 'asc' },
      { key: 'cited', dir: 'desc' }
    ])
    expect(parseSort('score:desc,kind:asc')).toEqual([
      { key: 'score', dir: 'desc' },
      { key: 'kind', dir: 'asc' }
    ])
    expect(parseCompare('a,b')).toEqual(['a', 'b'])
    expect(parseCompare('a,a')).toBeNull()
    expect(parseCompare('a,../b')).toBeNull()
    expect(parseSelection('run-1,run-1,../x,run-2')).toEqual(['run-1', 'run-2'])
    expect(parseSelection(null)).toEqual([])
  })

  it('keeps the column choice short: the default is no value', () => {
    expect(parseColumns(null, false)).toEqual(defaultColumns(false))
    // Type, Questions, Named, Credits and Cost wait in the Columns menu (audit #10).
    for (const id of ['kind', 'questions', 'named', 'credits', 'cost'] as const) {
      expect(parseColumns(null, true)).not.toContain(id)
      expect(parseColumns(null, false)).not.toContain(id)
    }
    expect(columnsParam(defaultColumns(false), false)).toBeNull()
    const more = [...defaultColumns(false), 'searches' as const]
    const value = columnsParam(more, false)
    expect(value).toBe('market,score,change,cited,searches')
    expect(parseColumns(value, false)).toContain('searches')
    expect(parseColumns('none', true)).toEqual(['date', 'subject', 'status'])
  })

  it('leaves out a column the Columns menu added last, so ticking it shows it', () => {
    expect(dropOrder(defaultColumns(true), true)).toEqual(NARROW_DROPS)
    const wide = dropOrder([...defaultColumns(true), 'questions'], true)
    expect(wide.at(-1)).toBe('questions')
    expect(wide.slice(0, 3)).toEqual(['named', 'aio', 'searches'])
    // At 1134, Overviews is not a default column: ticked, it outlasts Kind and Score.
    const narrow = dropOrder([...defaultColumns(false), 'aio'], false)
    expect(narrow.at(-1)).toBe('aio')
    expect(narrow).toHaveLength(NARROW_DROPS.length)
  })

  it('compares any two checks of the same page or topic, and explains why not', () => {
    const subjects = new Map(history().subjects.map((item) => [item.id, item]))
    expect(compareBlock([NEWEST])).toMatch(/exactly two/)
    expect(compareBlock([NEWEST, TOPIC])).toMatch(/different pages/)
    // Same page read, other market: still compared, results side by side.
    expect(compareBlock([OLDEST, UK_CHECK])).toBeNull()
    expect(compareBlock([OLDEST, PARTIAL])).toBeNull()
    expect(contentBlock([OLDEST, PARTIAL], subjects)).toMatch(/same version/)
    expect(contentBlock([OLDEST, NEWEST], subjects)).toBeNull()
    expect(contentBlock([TOPIC, { ...TOPIC, runId: 'x', snapshotId: 'y' }], subjects)).toMatch(
      /topic has no page/
    )
  })

  it('finds the check before, and builds re-run and retry requests with their cost', () => {
    const all = [NEWEST, TOPIC, PARTIAL, UK_CHECK, OLDEST]
    expect(previousCheck(NEWEST, all)?.runId).toBe('run-2')
    expect(previousCheck(OLDEST, all)).toBeNull()
    expect(rerunRequest('proj-1', NEWEST)).toEqual({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: ['mkt-us'],
      promptIds: null
    })
    expect(rerunRequest('proj-1', PARTIAL).promptIds).toEqual(['prompt-1'])
    expect(retryRequest('proj-1', TOPIC)).toEqual({
      projectId: 'proj-1',
      pageIds: ['topic-1'],
      marketIds: ['mkt-us'],
      promptIds: ['tq-13', 'tq-14']
    })
    expect(searchCost(3, 1)).toBe('About 3–6 searches')
  })

  it('writes every column to the CSV whatever the grid shows', () => {
    const subjects = new Map(history().subjects.map((item) => [item.id, item]))
    const markets = new Map(history().markets.map((item) => [item.id, item]))
    const csv = historyCsv([NEWEST, TOPIC], subjects, markets, new Date('2026-10-20T00:00:00Z'))
    expect(csv.fileName).toBe('check-history-2026-10-20.csv')
    expect(csv.header).toContain('Score')
    expect(csv.rows[0]).toContain(67)
    expect(csv.rows[0]).toContain(27)
    expect(csv.rows[1]?.at(-1)).toBe(2)
  })

  it('writes durations people read at a glance', () => {
    expect(durationText(null)).toBe('—')
    expect(durationText(12_400)).toBe('12s')
    expect(durationText(90_000)).toBe('1m 30s')
    expect(durationText(7_500_000)).toBe('2h 5m')
  })
})
