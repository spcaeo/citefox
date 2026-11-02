// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Market, PageResults, PromptCheckRow } from '@shared/domain'
import type { CheckJob, PageDetail, StartCheckRequest, UpdatePageRequest } from '@shared/ipc'
import { TEXTBOLT_MARKETS, textboltJob, textboltResults } from '../m3/fixtures'
import { emptyResults } from '../visibility/mocks'
import type { AssistRunRequest } from '@shared/ipc'
import type { AssistClient } from '../assist/client'
import { describeMockAssist, runMockAssist } from '../assist/mock'
import { MarketsScreen } from '.'
import type { MarketsSource } from './source'
import {
  addedMarketId,
  buildMatrix,
  cellLabel,
  filterMatrix,
  marketKindLabel,
  scoreChangeLabel,
  searchRange,
  topDomains
} from './utils/model'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

function marketAt(index: number): Market {
  const market = TEXTBOLT_MARKETS[index]
  if (!market) throw new Error('fixture market missing')
  return market
}

const US = marketAt(0)
const UK = marketAt(2)

const PAGE: PageDetail = {
  id: 'textbolt-alerts',
  projectId: 'textbolt',
  url: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
  title: 'Alerts',
  label: 'Text alerts for business',
  folder: null,
  status: 'tracked',
  setupStep: null,
  intervalDays: 14,
  samples: 1,
  promptCount: 10,
  defaultMarketId: US.id,
  pinned: false,
  score: 50,
  promptSetVersion: 1,
  markets: [US, UK],
  snapshotId: 'snap-1'
}

const us = textboltResults()

/** UK: same prompts, the first one not cited, so the markets differ on it. */
function ukResults(): PageResults {
  const prompts = us.prompts.map((row, index): PromptCheckRow =>
    index === 0 ? { ...row, status: 'not_cited', position: null, citedUrl: null } : row
  )
  return { ...us, prompts, run: us.run ? { ...us.run, marketId: UK.id } : null }
}

/** One market's row in the Markets grid, found by its market name link. */
function marketRow(grid: HTMLElement, name: string): HTMLElement {
  const link = within(grid).getByRole('link', { name })
  const row = link.closest<HTMLElement>('[role="row"]')
  if (!row) throw new Error(`no row for ${name}`)
  return row
}

/** The text of a market row's cell under a column header, such as "3 of 7". */
function cellText(grid: HTMLElement, row: HTMLElement, header: string): string {
  const headers = within(grid).getAllByRole('columnheader')
  const at = headers.findIndex((item) => item.textContent === header)
  return within(row).getAllByRole('gridcell')[at]?.textContent ?? ''
}

/** Opens one of the section tabs under the market grid. */
async function openTab(view: ReturnType<typeof render>, name: string): Promise<void> {
  fireEvent.click(await view.findByRole('tab', { name }))
}

/** Opens the add-market panel from the grid toolbar's one Add market action. */
async function openAdd(view: ReturnType<typeof render>): Promise<void> {
  fireEvent.click(await view.findByRole('button', { name: 'Add market' }))
  await view.findByRole('dialog', { name: 'Add a market' })
}

/** The Add a market drawer, whose footer holds the two add buttons. */
function addDrawer(view: ReturnType<typeof render>): HTMLElement {
  return view.getByRole('dialog', { name: 'Add a market' })
}

function source(overrides: Partial<MarketsSource> = {}): MarketsSource & {
  updates: UpdatePageRequest[]
  starts: StartCheckRequest[]
} {
  const updates: UpdatePageRequest[] = []
  const starts: StartCheckRequest[] = []
  return {
    updates,
    starts,
    'results:get': async (request) => (request.marketId === UK.id ? ukResults() : us),
    'pages:update': async (request) => {
      updates.push(request)
      const markets = (request.markets ?? []).map((draft, index) => {
        const known = PAGE.markets.find(
          (market) =>
            market.country === draft.country &&
            market.language === draft.language &&
            market.location === draft.location &&
            market.device === draft.device &&
            market.localWording === draft.localWording
        )
        return known ?? { ...draft, id: `new-${index}`, serpapiLocation: null }
      })
      return { ...PAGE, markets }
    },
    'checks:start': async (request): Promise<CheckJob> => {
      starts.push(request)
      return { ...textboltJob(), status: 'running' }
    },
    'status:getCapsule': async () => ({
      searchesLeft: 3760,
      issueCount: 0,
      serpapi: 'ok',
      claudeCode: 'ok',
      jina: 'off',
      youtube: 'off'
    }),
    ...overrides
  }
}

describe('markets model', () => {
  it('builds the question × market grid and finds where markets differ', () => {
    const rows = buildMatrix([
      { market: US, results: us, error: null },
      { market: UK, results: ukResults(), error: null }
    ])
    expect(rows).toHaveLength(us.prompts.length)
    expect(rows.filter((row) => row.differs)).toHaveLength(1)
    expect(filterMatrix(rows, '', true)).toHaveLength(1)
    expect(filterMatrix(rows, 'zzzz-no-match', false)).toHaveLength(0)
    expect(cellLabel({ marketId: 'x', runId: null, status: 'page_cited', position: 2 })).toBe(
      'Right page · 2'
    )
    expect(cellLabel({ marketId: 'x', runId: null, status: null, position: null })).toBe(
      'Not checked'
    )
    const unchecked = buildMatrix([
      { market: US, results: us, error: null },
      { market: UK, results: emptyResults(), error: null }
    ])
    expect(unchecked.some((row) => row.differs)).toBe(false)
  })

  it('labels markets, costs, changes, and top domains from results', () => {
    expect(marketKindLabel(US, US.id)).toBe('Country · default')
    expect(
      marketKindLabel(
        { ...US, location: 'Austin', serpapiLocation: null, localWording: true },
        null
      )
    ).toBe('City: Austin (not matched to a Google location) · local wording')
    expect(searchRange(10, 1)).toEqual([10, 20])
    expect(searchRange(10, 3, 2)).toEqual([60, 120])
    expect(scoreChangeLabel(emptyResults())).toBe('First check in this market')
    const top = topDomains(us)
    expect(top.length).toBeLessThanOrEqual(3)
    expect(top.every((item) => item.domain !== 'textbolt.com')).toBe(true)
    const sorted = [...top].sort((a, b) => b.count - a.count)
    expect(top).toEqual(sorted)
  })

  it('finds the market pages:update added', () => {
    const draft = {
      country: 'CA',
      language: 'en',
      location: null,
      device: 'mobile',
      localWording: false
    } as const
    expect(
      addedMarketId(
        PAGE.markets,
        [...PAGE.markets, { ...draft, id: 'ca', serpapiLocation: null }],
        draft
      )
    ).toBe('ca')
  })
})

describe('MarketsScreen', () => {
  it('shows a row per market with the Results numbers, the question grid, and top domains', async () => {
    const view = render(
      <MarketsScreen
        source={source()}
        projectId="textbolt"
        page={PAGE}
        onChanged={() => undefined}
      />
    )
    const grid = await view.findByRole('grid', { name: 'Markets' })
    const usRow = marketRow(grid, '🇺🇸 US · EN')
    const run = us.run
    if (!run) throw new Error('fixture run missing')
    expect(cellText(grid, usRow, 'Page cited')).toBe(`${run.pageCited} of ${run.promptsWithAio}`)
    expect(cellText(grid, usRow, 'Citations (links)')).toBe(
      String(run.citationsThisPage + run.citationsOtherOwn)
    )
    expect(cellText(grid, usRow, 'AI Overview shown')).toBe(
      `${run.promptsWithAio} of ${run.promptsChecked}`
    )
    expect(usRow.querySelector('.mk-score')?.textContent).toBe(
      `Visibility score ${run.visibilityScore}`
    )
    expect(within(usRow).getByText('10–20')).toBeTruthy()
    const matrix = view.getByRole('grid', { name: 'Question results by market' })
    expect(within(matrix).getAllByRole('row')).toHaveLength(us.prompts.length + 1)
    // Rows read as the buyer's question, not only the internal label.
    expect(matrix.textContent).toContain((us.prompts[0]?.text ?? '-').split('**').join(''))
    fireEvent.click(view.getByRole('button', { name: /^Only where markets differ/ }))
    expect(within(matrix).getAllByRole('row')).toHaveLength(2)
    expect(view.getByText(/Showing 1 of 10 questions/)).toBeTruthy()
    expect(window.location.hash).toContain('show=differ')
    await openTab(view, 'Cited instead')
    expect(window.location.hash).toContain('view=cited')
    expect(view.getByRole('grid', { name: 'Cited instead of you, by market' })).toBeTruthy()
    expect(view.queryByRole('tab', { name: 'Add a market' })).toBeNull()
    expect(view.queryByRole('button', { name: 'Check all markets' })).toBeNull()
    await openAdd(view)
    expect(window.location.hash).toContain('panel=add-market')
    expect(within(addDrawer(view)).getByTestId('mk-add-summary').textContent).toContain(
      '3,760 searches left'
    )
    const result = await axe.run(view.container, { rules: { region: { enabled: false } } })
    expect(result.violations).toEqual([])
  })

  it('suggests markets from the AI menu, and runs per-market assists from a row', async () => {
    const requests: AssistRunRequest[] = []
    const assistClient: AssistClient = {
      describe: describeMockAssist,
      run: async (request) => {
        requests.push(request)
        return runMockAssist(request)
      }
    }
    const view = render(
      <MarketsScreen
        source={source()}
        assistClient={assistClient}
        projectId="textbolt"
        page={PAGE}
        onChanged={() => undefined}
      />
    )
    const grid = await view.findByRole('grid', { name: 'Markets' })
    fireEvent.click(within(grid).getByRole('button', { name: 'Actions for 🇺🇸 US · EN' }))
    expect(view.queryByRole('menuitem', { name: 'Write local questions' })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(grid).getByRole('button', { name: 'Actions for 🇬🇧 UK · EN' }))
    fireEvent.click(view.getByRole('menuitem', { name: 'Write local questions' }))
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({ assistId: 'markets.localPrompts', marketId: UK.id })
    fireEvent.click(view.getByRole('button', { name: 'AI actions for markets' }))
    fireEvent.click(view.getByRole('menuitem', { name: /Suggest markets to add/ }))
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]).toMatchObject({ assistId: 'markets.suggest', marketId: null })
  })

  it('adds a market without checking and keeps the default market', async () => {
    const fake = source()
    const onChanged = vi.fn()
    const view = render(
      <MarketsScreen source={fake} projectId="textbolt" page={PAGE} onChanged={onChanged} />
    )
    await openAdd(view)
    const form = await view.findByRole('form', { name: 'Add a market' })
    fireEvent.change(within(form).getByLabelText('Country'), { target: { value: 'CA' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Mobile' }))
    fireEvent.change(within(form).getByLabelText(/City or region/), {
      target: { value: 'Toronto' }
    })
    fireEvent.click(within(addDrawer(view)).getByRole('button', { name: 'Add without checking' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(fake.updates[0]).toEqual({
      projectId: 'textbolt',
      pageId: PAGE.id,
      defaultMarketId: US.id,
      markets: [
        { country: 'US', language: 'en', location: null, device: 'desktop', localWording: false },
        { country: 'UK', language: 'en', location: null, device: 'desktop', localWording: false },
        {
          country: 'CA',
          language: 'en',
          location: 'Toronto',
          device: 'mobile',
          localWording: false
        }
      ]
    })
    expect(fake.starts).toHaveLength(0)
    expect(await view.findByText(/Market added/)).toBeTruthy()
    await waitFor(() => expect(view.queryByRole('dialog', { name: 'Add a market' })).toBeNull())
    expect(window.location.hash).not.toContain('panel=add-market')
  })

  it('opens Add a market from the URL, closes on Escape and asks before dropping changes', async () => {
    window.location.hash = `#/pages/${PAGE.id}/markets?panel=add-market`
    const view = render(
      <MarketsScreen
        source={source()}
        projectId="textbolt"
        page={PAGE}
        onChanged={() => undefined}
      />
    )
    const drawer = await view.findByRole('dialog', { name: 'Add a market' })
    fireEvent.change(within(drawer).getByLabelText(/City or region/), {
      target: { value: 'Leeds' }
    })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close Add a market' }))
    const ask = await view.findByRole('alertdialog', { name: 'Discard changes?' })
    fireEvent.click(within(ask).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(view.queryByRole('dialog', { name: 'Add a market' })).toBeNull())
    await waitFor(() => expect(window.location.hash).not.toContain('panel=add-market'))
    // A pasted link has no entry to go back to: the URL is rewritten in place.
    expect(window.location.hash).toBe(`#/pages/${PAGE.id}/markets`)

    window.location.hash = `#/pages/${PAGE.id}/markets?panel=add-market`
    await view.findByRole('dialog', { name: 'Add a market' })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(view.queryByRole('dialog', { name: 'Add a market' })).toBeNull())
  })

  it('refuses a duplicate and runs the first check for a new market', async () => {
    const fake = source()
    const view = render(
      <MarketsScreen source={fake} projectId="textbolt" page={PAGE} onChanged={() => undefined} />
    )
    await openAdd(view)
    const form = await view.findByRole('form', { name: 'Add a market' })
    // It starts on a country the page does not track yet.
    const country = within(form).getByLabelText<HTMLSelectElement>('Country')
    expect(PAGE.markets.map((market) => market.country)).not.toContain(country.value)
    fireEvent.change(country, { target: { value: PAGE.markets[0]?.country } })
    fireEvent.change(within(form).getByLabelText('Language'), {
      target: { value: PAGE.markets[0]?.language }
    })
    fireEvent.click(
      within(addDrawer(view)).getByRole('button', { name: 'Add market and run first check' })
    )
    expect(await view.findByText('This page already tracks that market.')).toBeTruthy()
    expect(fake.updates).toHaveLength(0)
    fireEvent.change(within(form).getByLabelText('Language'), { target: { value: 'es' } })
    fireEvent.click(
      within(addDrawer(view)).getByRole('button', { name: 'Add market and run first check' })
    )
    await waitFor(() => expect(window.location.hash).toBe(`#/pages/${PAGE.id}/running`))
    expect(fake.starts).toEqual([
      { projectId: 'textbolt', pageIds: [PAGE.id], marketIds: ['new-2'], promptIds: null }
    ])
  })

  it('removes a market after confirming and reports a refused check', async () => {
    const fake = source({
      'checks:start': async () => ({
        ...textboltJob(),
        status: 'error',
        message: 'This project reached its search cap.',
        nextStep: 'Raise the cap in Project settings.'
      })
    })
    const onChanged = vi.fn()
    const view = render(
      <MarketsScreen source={fake} projectId="textbolt" page={PAGE} onChanged={onChanged} />
    )
    fireEvent.click(await view.findByRole('button', { name: 'Actions for 🇬🇧 UK · EN' }))
    fireEvent.click(view.getByRole('menuitem', { name: 'Remove 🇬🇧 UK · EN' }))
    const confirm = view.getByRole('alertdialog', { name: 'Remove 🇬🇧 UK · EN?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove market' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(fake.updates[0]?.markets).toHaveLength(1)
    expect(fake.updates[0]?.defaultMarketId).toBe(US.id)
    fireEvent.click(view.getByRole('button', { name: 'Actions for 🇺🇸 US · EN' }))
    fireEvent.click(view.getByRole('menuitem', { name: 'Check 🇺🇸 US · EN' }))
    const alert = await view.findByRole('alert')
    expect(alert.textContent).toBe(
      'This project reached its search cap. Raise the cap in Project settings.'
    )
  })

  it('shows a failed market with Try again, which loads it again', async () => {
    let ukCalls = 0
    const fake = source({
      'results:get': async (request) => {
        if (request.marketId !== UK.id) return us
        ukCalls += 1
        if (ukCalls === 1) throw new Error('The engine is busy.')
        return ukResults()
      }
    })
    const view = render(
      <MarketsScreen source={fake} projectId="textbolt" page={PAGE} onChanged={() => undefined} />
    )
    const alert = await view.findByRole('alert')
    expect(alert.textContent).toContain('The engine is busy.')
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(view.queryByRole('alert')).toBeNull())
    expect(ukCalls).toBe(2)
  })
})

describe('Markets drill-downs (NFR-14)', () => {
  function required<T>(value: T | null | undefined): T {
    if (value === null || value === undefined) throw new Error('missing test value')
    return value
  }

  async function screen(): Promise<ReturnType<typeof render>> {
    const view = render(
      <MarketsScreen
        source={source()}
        projectId="textbolt"
        page={PAGE}
        onChanged={() => undefined}
      />
    )
    await view.findByRole('grid', { name: 'Markets' })
    return view
  }

  function card(view: ReturnType<typeof render>, name: string): HTMLElement {
    return marketRow(view.getByRole('grid', { name: 'Markets' }), name)
  }

  /** Clicks a count and checks the drawer lists exactly that many rows, then closes it. */
  function expectDrawerTotal(view: ReturnType<typeof render>, button: HTMLElement): number {
    expect(button.tagName).toBe('BUTTON')
    const id = required(button.getAttribute('data-nfr-drill'))
    const shown = Number(required(button.querySelector(`[data-nfr-figure="${id}"]`)).textContent)
    button.focus()
    fireEvent.click(button)
    const dialog = view.getByRole('dialog')
    expect(dialog.querySelectorAll('[data-drill-row]')).toHaveLength(shown)
    expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toMatch(
      new RegExp(` · ${shown} (question|questions|link|links)$`)
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(button)
    return shown
  }

  it('row numbers open drawers whose totals equal them, in that market', async () => {
    const view = await screen()
    const uk = card(view, '🇬🇧 UK · EN')
    const run = required(us.run)
    const cited = within(uk).getByRole('button', {
      name: /questions with this page cited in 🇬🇧 UK/
    })
    expect(expectDrawerTotal(view, cited)).toBe(run.pageCited)
    const aio = within(uk).getAllByRole('button', { name: /with an AI Overview in 🇬🇧 UK/ })
    expect(aio).toHaveLength(2)
    expect(expectDrawerTotal(view, required(aio[0]))).toBe(run.promptsWithAio)
    const checked = within(uk).getByRole('button', { name: /questions checked in 🇬🇧 UK/ })
    expect(expectDrawerTotal(view, checked)).toBe(run.promptsChecked)
    const links = within(uk).getByRole('button', { name: /citations? of your domain in 🇬🇧 UK/ })
    expect(expectDrawerTotal(view, links)).toBe(run.citationsThisPage + run.citationsOtherOwn)

    fireEvent.click(cited)
    const dialog = view.getByRole('dialog')
    expect(dialog.textContent).toContain('🇬🇧 UK · EN')
    const row = required(dialog.querySelector<HTMLElement>('[data-drill-row="0"]'))
    row.focus()
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(window.location.hash).toContain(`market=${UK.id}`)
    expect(window.location.hash).toContain(`run=${run.runId}`)
  })

  it('Cited instead counts drill to the overviews that cite each domain', async () => {
    const view = await screen()
    await openTab(view, 'Cited instead')
    const table = view.getByRole('grid', { name: 'Cited instead of you, by market' })
    const buttons = within(table).getAllByRole('button', { name: /AI Overviews? in / })
    expect(buttons.length).toBeGreaterThan(0)
    for (const button of buttons) {
      const domain = required(button.getAttribute('aria-label')).split(':')[0]
      const row = required(us.leaderboard.find((item) => item.domain === domain))
      expect(expectDrawerTotal(view, button)).toBe(row.aioCount)
    }
    const ukHeader = within(table).getByRole('link', { name: '🇬🇧 UK · EN' })
    expect(ukHeader.getAttribute('href')).toBe(`#/pages/${PAGE.id}/results?market=${UK.id}`)
  })

  it('matrix cells open Question detail in their own market and check', async () => {
    const view = await screen()
    const table = view.getByRole('grid', { name: 'Question results by market' })
    const first = required(us.prompts[0])
    const run = required(us.run)
    const ukCell = within(table).getByRole('link', {
      name: new RegExp(`question ${first.promptPosition} in 🇬🇧 UK · EN$`)
    })
    expect(ukCell.getAttribute('href')).toBe(
      `#/pages/${PAGE.id}/prompt/${first.promptId}?market=${UK.id}&run=${run.runId}`
    )
    const usCell = within(table).getByRole('link', {
      name: new RegExp(`question ${first.promptPosition} in 🇺🇸 US · EN$`)
    })
    expect(usCell.getAttribute('href')).toContain(`market=${US.id}`)
    const label = required(table.querySelector<HTMLAnchorElement>('a.mk-prompt'))
    expect(label.getAttribute('href')).toContain(`market=${US.id}`)
    fireEvent.click(view.getByRole('button', { name: /^Only where markets differ/ }))
    expect(within(table).getAllByRole('row')).toHaveLength(2)
  })

  it('the row links to Results and History in its market and explains searches', async () => {
    const view = await screen()
    const uk = card(view, '🇬🇧 UK · EN')
    expect(within(uk).getByRole('link', { name: '🇬🇧 UK · EN' }).getAttribute('href')).toBe(
      `#/pages/${PAGE.id}/results?market=${UK.id}`
    )
    expect(
      within(uk)
        .getByRole('link', { name: /Visibility score/ })
        .getAttribute('href')
    ).toBe(`#/pages/${PAGE.id}/results?market=${UK.id}`)
    expect(
      within(uk)
        .getByRole('link', { name: /open History for 🇬🇧 UK/ })
        .getAttribute('href')
    ).toBe(`#/pages/${PAGE.id}/history?market=${UK.id}`)
    const searches = within(uk).getByRole('button', { name: /searches per check in 🇬🇧 UK/ })
    searches.focus()
    fireEvent.click(searches)
    expect(searches.getAttribute('aria-expanded')).toBe('true')
    const pop = view.getByRole('dialog', { name: 'Searches per check in 🇬🇧 UK · EN' })
    expect(pop.textContent).toContain('10 questions × 1 sample × 1 to 2 searches = 10–20')
    expect(within(pop).getByRole('link').getAttribute('href')).toBe('#/connections')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(searches)
    const result = await axe.run(view.container, { rules: { region: { enabled: false } } })
    expect(result.violations).toEqual([])
  })
})
