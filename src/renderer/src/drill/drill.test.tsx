// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { useState, type JSX } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { GridCsvRequest, GridCsvResult } from '@shared/ipc'
import { TEXTBOLT_MARKETS, TEXTBOLT_PAGE_ID, textboltResults } from '../m3/fixtures'
import { hasAio } from '../m3/model'
import { resetDrawersForTests } from '../shell/drawers'
import { promptHash } from '../shell/routes'
import { useDrill } from './context'
import { DrillHost } from './DrillHost'
import { DrillLink, DrillNumber } from './DrillNumber'
import { ownLinksDrill, resultsDrill, resultsScope } from './fromResults'
import type { DrillRequest } from './types'

const RULES = {
  rules: {
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    'landmark-one-main': { enabled: false },
    region: { enabled: false }
  }
}

const results = textboltResults()
const market = TEXTBOLT_MARKETS[0]
const scope = resultsScope(results, { pageId: TEXTBOLT_PAGE_ID, market, runId: 'run-9' })

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing fixture value')
  return value
}

const aio = required(resultsDrill(results, 'kpi:aio', scope))
const checked = required(resultsDrill(results, 'funnel:checked', scope))

function exporter(): {
  calls: GridCsvRequest[]
  write: (r: GridCsvRequest) => Promise<GridCsvResult>
} {
  const calls: GridCsvRequest[] = []
  return {
    calls,
    write: async (request) => {
      calls.push(request)
      return {
        ok: true,
        rowCount: request.rows.length,
        columnCount: request.header.length,
        fileName: request.fileName
      }
    }
  }
}

function Screen({
  drills,
  write
}: {
  drills: readonly DrillRequest[]
  write?: (r: GridCsvRequest) => Promise<GridCsvResult>
}): JSX.Element {
  return (
    <DrillHost {...(write ? { exportCsv: write } : {})}>
      <p>
        {drills.map((drill) => (
          <DrillNumber key={drill.id} drill={drill} />
        ))}
      </p>
    </DrillHost>
  )
}

/** Lets hashchange and history steps land (they are tasks, not microtasks). */
function settle(): Promise<void> {
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 40)))
}

beforeEach(() => {
  resetDrawersForTests()
  window.history.replaceState(null, '', '#/results')
})

afterEach(() => {
  cleanup()
  resetDrawersForTests()
})

describe('DrillNumber and the drill drawer', () => {
  test('shows its own row count and opens a drawer with exactly those rows', async () => {
    const view = render(<Screen drills={[aio]} />)
    const button = view.getByRole('button', { name: new RegExp(`^${aio.rows.length} questions`) })
    expect(button.getAttribute('data-nfr-drill')).toBe('kpi:aio')
    expect(button.querySelector('[data-nfr-figure="kpi:aio"]')?.textContent).toBe(
      String(aio.rows.length)
    )
    fireEvent.click(button)
    const dialog = view.getByRole('dialog')
    expect(
      within(dialog).getByRole('heading', {
        name: `AI Overview appears · ${aio.rows.length} questions`
      })
    ).toBeTruthy()
    expect(dialog.textContent).toContain('🇺🇸 US · EN')
    // The buyer's full question, not only the internal label.
    const firstRow = required(aio.rows[0])
    expect(dialog.textContent).toContain(firstRow.text.split('**').join(''))
    // The header row counts too.
    expect(within(dialog).getByRole('grid').getAttribute('aria-rowcount')).toBe(
      String(aio.rows.length + 1)
    )
    expect(dialog.querySelectorAll('[data-drill-row]')).toHaveLength(aio.rows.length)
    expect((await axe.run(view.container, RULES)).violations).toEqual([])
  })

  test('opening a number puts the drawer on the URL; Back closes it, Forward reopens it', async () => {
    const view = render(<Screen drills={[aio]} />)
    fireEvent.click(view.getByRole('button', { name: /questions: AI Overview appears/ }))
    expect(window.location.hash).toBe('#/results?drawer=drill&drill=kpi%3Aaio')
    expect(view.getByRole('dialog').getAttribute('data-drill')).toBe('kpi:aio')
    window.history.back()
    await settle()
    expect(window.location.hash).toBe('#/results')
    expect(view.queryByRole('dialog')).toBeNull()
    window.history.forward()
    await settle()
    expect(view.getByRole('dialog').getAttribute('data-drill')).toBe('kpi:aio')
  })

  test('a copied drill link opens the list once the screen draws its number', async () => {
    window.history.replaceState(
      null,
      '',
      '#/results?drawer=drill&drill=funnel%3Achecked&drill.f=aio'
    )
    const view = render(<Screen drills={[aio, checked]} />)
    await settle()
    const dialog = view.getByRole('dialog')
    expect(dialog.getAttribute('data-drill')).toBe('funnel:checked')
    const withAio = checked.rows.filter(hasAio)
    expect(
      within(dialog)
        .getByRole('button', { name: `${withAio.length} AI Overview shown` })
        .getAttribute('aria-pressed')
    ).toBe('true')
    expect(dialog.querySelectorAll('[data-drill-row]')).toHaveLength(withAio.length)
  })

  test('a drill link whose number is not on screen says so instead of an empty list', async () => {
    vi.useFakeTimers()
    try {
      window.history.replaceState(null, '', '#/results?drawer=drill&drill=gone')
      const view = render(<Screen drills={[aio]} />)
      expect(view.getByRole('dialog').getAttribute('aria-busy')).toBe('true')
      act(() => {
        vi.advanceTimersByTime(6000)
      })
      expect(view.getByRole('dialog').textContent).toContain('This list is not on this screen')
    } finally {
      vi.useRealTimers()
    }
  })

  test('the filter is a step on the URL and the search rewrites it in place', async () => {
    const view = render(<Screen drills={[checked]} />)
    fireEvent.click(view.getByRole('button', { name: /questions: Questions checked/ }))
    const dialog = view.getByRole('dialog')
    const withAio = checked.rows.filter(hasAio)
    fireEvent.click(
      within(dialog).getByRole('button', { name: `${withAio.length} AI Overview shown` })
    )
    expect(window.location.hash).toContain('drill.f=aio')
    fireEvent.change(within(dialog).getByRole('searchbox', { name: /^Search / }), {
      target: { value: 'sms' }
    })
    expect(window.location.hash).toContain('drill.q=sms')
    const length = window.history.length
    window.history.back()
    await settle()
    // Back undoes the filter (the search rewrote that step, so it goes too).
    expect(window.location.hash).toBe('#/results?drawer=drill&drill=funnel%3Achecked')
    expect(view.getByRole('dialog')).toBeTruthy()
    expect(window.history.length).toBe(length)
  })

  test('keeps the space before a text suffix inside the inline-flex button', () => {
    const view = render(
      <DrillHost>
        <DrillNumber drill={aio} suffix=" cases" label="cases" />
      </DrillHost>
    )
    // A leading normal space is dropped by inline-flex layout ("2cases"); a no-break space is not.
    expect(view.getByRole('button', { name: 'cases' }).textContent).toBe(
      `${aio.rows.length}\u00a0cases`
    )
  })

  test('a question row opens Question detail in the drawer market and check', async () => {
    const view = render(<Screen drills={[checked]} />)
    fireEvent.click(view.getByRole('button', { name: /questions: Questions checked/ }))
    const dialog = view.getByRole('dialog')
    const first = required(checked.rows[0])
    const link = within(dialog).getByRole('link', {
      name: new RegExp(`^Open question ${first.promptPosition}:`)
    })
    const href = promptHash(TEXTBOLT_PAGE_ID, first.promptId, {
      marketId: scope.marketId,
      runId: 'run-9'
    })
    expect(link.getAttribute('href')).toBe(href)
    const second = required(checked.rows[1])
    const row = required(dialog.querySelector<HTMLElement>('[data-drill-row="1"]'))
    fireEvent.click(row)
    expect(window.location.hash).toBe(
      promptHash(TEXTBOLT_PAGE_ID, second.promptId, { marketId: scope.marketId, runId: 'run-9' })
    )
    await settle()
    expect(view.queryByRole('dialog')).toBeNull()
  })

  test('leaving through a row keeps the drill one Back away', async () => {
    // The drawer does not close itself (a close through history would undo the
    // route change): the new route has no drawer, and Back returns to it.
    const view = render(<Screen drills={[checked]} />)
    fireEvent.click(view.getByRole('button', { name: /questions: Questions checked/ }))
    fireEvent.click(required(view.getByRole('dialog').querySelector('[data-drill-row="0"]')))
    await settle()
    expect(view.queryByRole('dialog')).toBeNull()
    window.history.back()
    await settle()
    expect(window.location.hash).toBe('#/results?drawer=drill&drill=funnel%3Achecked')
    expect(view.getByRole('dialog').getAttribute('data-drill')).toBe('funnel:checked')
  })

  test('arrow keys move between rows and Enter opens the focused row', () => {
    const view = render(<Screen drills={[checked]} />)
    fireEvent.click(view.getByRole('button', { name: /questions: Questions checked/ }))
    const grid = within(view.getByRole('dialog')).getByRole('grid')
    grid.focus()
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    expect(document.activeElement?.getAttribute('data-drill-row')).toBe('0')
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' })
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' })
    expect(document.activeElement?.getAttribute('data-drill-row')).toBe('2')
    const link = within(grid).getAllByRole('link')[0] as HTMLElement
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    link.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    fireEvent.keyDown(required(grid.querySelector('[data-drill-row="2"]')), { key: 'Enter' })
    expect(window.location.hash).toContain(required(checked.rows[2]).promptId)
  })

  test('the summary strip filters the list and the CSV holds exactly the rows shown', async () => {
    const csv = exporter()
    const view = render(<Screen drills={[checked]} write={csv.write} />)
    fireEvent.click(view.getByRole('button', { name: /questions: Questions checked/ }))
    const dialog = view.getByRole('dialog')
    const withAio = checked.rows.filter(hasAio)
    const filter = within(dialog).getByRole('button', {
      name: `${withAio.length} AI Overview shown`
    })
    fireEvent.click(filter)
    expect(filter.getAttribute('aria-pressed')).toBe('true')
    expect(within(dialog).getByRole('grid').getAttribute('aria-rowcount')).toBe(
      String(withAio.length + 1)
    )
    expect(dialog.textContent).toContain(`Showing ${withAio.length} of ${checked.rows.length}`)
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: `Export CSV of these ${withAio.length} questions`
      })
    )
    await waitFor(() => expect(csv.calls).toHaveLength(1))
    const request = required(csv.calls[0])
    expect(request.rows).toHaveLength(withAio.length)
    expect(request.header[0]).toBe('Question #')
    expect(request.rows.map((cells) => cells[0])).toEqual(withAio.map((row) => row.promptPosition))
    expect(request.fileName).toMatch(/^citefox-funnel-checked-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(
      await within(dialog).findByText(`Saved ${withAio.length} rows to ${request.fileName}.`)
    ).toBeTruthy()
  })

  test('a row expands to the AI Overview text and its sources', () => {
    const view = render(<Screen drills={[aio]} />)
    fireEvent.click(view.getByRole('button', { name: /questions: AI Overview appears/ }))
    const dialog = view.getByRole('dialog')
    const first = required(aio.rows[0])
    const toggle = within(dialog).getByRole('button', {
      name: `Show the AI Overview for question ${first.promptPosition}`
    })
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const detail = required(document.getElementById(required(toggle.getAttribute('aria-controls'))))
    expect(detail.textContent).toContain('What the AI Overview said')
    if (first.aioSummary) expect(detail.textContent).toContain(first.aioSummary.slice(0, 20))
    expect(within(detail).getAllByRole('listitem')).toHaveLength(first.references.length)
  })

  test('a links drill lists one row per link, opening its question', () => {
    const links = ownLinksDrill(results, scope)
    const view = render(<Screen drills={[links]} />)
    fireEvent.click(view.getByRole('button', { name: new RegExp(`^${links.items.length} links`) }))
    const dialog = view.getByRole('dialog')
    expect(
      within(dialog).getByRole('heading', {
        name: `Citations to textbolt.com · ${links.items.length} links`
      })
    ).toBeTruthy()
    expect(dialog.querySelectorAll('[data-drill-row]')).toHaveLength(links.items.length)
    const thisPage = links.items.filter((item) => item.group === 'this_page').length
    fireEvent.click(within(dialog).getByRole('button', { name: `${thisPage} To this page` }))
    expect(dialog.querySelectorAll('[data-drill-row]')).toHaveLength(thisPage)
    const external = within(dialog).getAllByRole('link', { name: / in a new tab$/ })[0]
    expect(external?.getAttribute('target')).toBe('_blank')
  })

  test('Escape closes the drawer without a dead Back step, and focus goes back to the number', async () => {
    const view = render(<Screen drills={[aio]} />)
    const button = view.getByRole('button', { name: /questions: AI Overview appears/ })
    button.focus()
    fireEvent.click(button)
    expect(view.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await settle()
    expect(view.queryByRole('dialog')).toBeNull()
    expect(window.location.hash).toBe('#/results')
    expect(document.activeElement).toBe(button)
  })

  test('a host inside a host shares the outer drawer; a new screen closes it', async () => {
    function Shell(): JSX.Element {
      const [key, setKey] = useState('a')
      return (
        <DrillHost resetKey={key}>
          <button type="button" onClick={() => setKey('b')}>
            Navigate
          </button>
          <DrillHost>
            <DrillNumber drill={aio} />
          </DrillHost>
          <DrillHost>
            <DrillNumber drill={checked} />
          </DrillHost>
        </DrillHost>
      )
    }
    const view = render(<Shell />)
    fireEvent.click(view.getByRole('button', { name: /questions: AI Overview appears/ }))
    fireEvent.click(
      view.getByRole('button', { name: /questions: Questions checked/, hidden: true })
    )
    expect(view.getAllByRole('dialog')).toHaveLength(1)
    expect(view.getByRole('dialog').getAttribute('data-drill')).toBe('funnel:checked')
    // The shell's route change: a new hash (no drawer) and a new resetKey.
    window.location.hash = '#/elsewhere'
    fireEvent.click(view.getByRole('button', { name: 'Navigate', hidden: true }))
    await settle()
    expect(view.queryByRole('dialog')).toBeNull()
  })

  test('useDrill outside a host says what is missing', () => {
    function Bare(): JSX.Element {
      useDrill()
      return <p />
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(<Bare />)).toThrow(/DrillHost/)
    error.mockRestore()
  })

  test('DrillLink sends a single item straight to its detail', () => {
    const view = render(
      <DrillLink
        target={{ kind: 'prompt', pageId: 'pg', promptId: 'p1', marketId: 'm1' }}
        label="Open question 1"
      >
        Question 1
      </DrillLink>
    )
    expect(view.getByRole('link', { name: 'Open question 1' }).getAttribute('href')).toBe(
      '#/pages/pg/prompt/p1?market=m1'
    )
    cleanup()
    const external = render(
      <DrillLink target={{ kind: 'url', url: 'javascript:alert(1)' }}>bad</DrillLink>
    )
    expect(external.queryByRole('link')).toBeNull()
  })
})
