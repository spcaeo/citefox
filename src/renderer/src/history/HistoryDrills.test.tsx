// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  HistoryCheck,
  HistoryEvent,
  Market,
  PageHistory,
  PageResults,
  PromptCheckRow
} from '@shared/domain'
import type { GetResultsRequest } from '@shared/ipc'
import { textboltResults } from '../m3/fixtures'
import { pageHash } from '../shell/routes'
import type { HistorySource } from './client'
import { HistoryScreen } from './HistoryScreen'
import type { RunResultsSource } from './runResults'

const RULES = {
  rules: {
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    'landmark-one-main': { enabled: false },
    region: { enabled: false }
  }
}

const US: Market = {
  id: 'us',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}

function check(runId: string, patch: Partial<HistoryCheck> = {}): HistoryCheck {
  return {
    runId,
    marketId: 'us',
    kind: 'scheduled',
    partial: false,
    promptsChecked: 10,
    promptsTotal: 10,
    score: 40,
    scoreChange: 6,
    promptSetVersion: 2,
    contentChanged: false,
    ...patch
  }
}

function event(
  patch: Partial<HistoryEvent> & Pick<HistoryEvent, 'id' | 'primary' | 'at'>
): HistoryEvent {
  return {
    kinds: [patch.primary],
    title: 'Event',
    detail: null,
    check: null,
    content: null,
    note: null,
    fix: null,
    promptSet: null,
    ...patch
  } satisfies HistoryEvent
}

const EVENTS: HistoryEvent[] = [
  event({
    id: 'run-old',
    primary: 'check',
    at: '2026-10-05T10:00:00.000Z',
    title: 'Scheduled check',
    check: check('run-old', { score: 34, scoreChange: 4 })
  }),
  event({
    id: 'run-partial',
    primary: 'check',
    at: '2026-10-10T10:00:00.000Z',
    title: 'Follow-up check for Fix 1',
    check: check('run-partial', {
      kind: 'follow_up',
      partial: true,
      promptsChecked: 3,
      scoreChange: null
    })
  }),
  event({
    id: 'run-new',
    primary: 'check',
    at: '2026-10-19T10:00:00.000Z',
    title: 'Manual check',
    check: check('run-new', { score: 40, scoreChange: 6 })
  }),
  event({
    id: 'fix-1',
    primary: 'fix',
    at: '2026-10-07T10:00:00.000Z',
    title: 'Fix 1 · Added 5 FAQs',
    fix: {
      id: 'fix-1',
      number: 1,
      verdict: 'Partly worked · 1 of 3 questions',
      planned: false,
      promptPositions: [4, 6, 99]
    }
  }),
  event({
    id: 'set-2',
    primary: 'prompt_set',
    at: '2026-09-20T10:00:00.000Z',
    title: 'Question set v2 saved',
    promptSet: { id: 'set-2', version: 2, promptCount: 10, active: true }
  })
]

/** Results for a run: the old run has 2 moved prompts, the new one 3, the partial run ran 3. */
function resultsFor(runId: string | null): PageResults {
  const base = textboltResults()
  const moved = runId === 'run-old' ? 2 : 3
  const prompts: PromptCheckRow[] = base.prompts.map((row, index) => ({
    ...row,
    previousStatus: index < moved ? 'no_aio' : row.status
  }))
  if (runId === 'run-partial') {
    const ran = prompts.slice(0, 3)
    return {
      ...base,
      prompts: ran,
      funnel: base.funnel.map((step) =>
        step.id === 'checked'
          ? { ...step, count: 3, promptIds: ran.map((row) => row.promptId) }
          : step
      )
    }
  }
  return { ...base, prompts }
}

function sources(): {
  history: HistorySource
  results: RunResultsSource
  asked: GetResultsRequest[]
} {
  const asked: GetResultsRequest[] = []
  const history: HistorySource = {
    'history:list': vi.fn(async (): Promise<PageHistory> => ({
      pageId: 'alerts',
      marketId: 'us',
      builtAt: '2026-10-20T10:00:00.000Z',
      events: EVENTS
    })),
    'history:compare': vi.fn(async () => {
      throw new Error('not used')
    }),
    'history:addNote': vi.fn(async () => {
      throw new Error('not used')
    }),
    'history:updateNote': vi.fn(async () => {
      throw new Error('not used')
    }),
    'history:deleteNote': vi.fn(async () => {
      throw new Error('not used')
    })
  }
  const results: RunResultsSource = {
    'results:get': vi.fn(async (request: GetResultsRequest) => {
      asked.push(request)
      return resultsFor(request.runId)
    })
  }
  return { history, results, asked }
}

function renderScreen(): ReturnType<typeof render> & { asked: GetResultsRequest[] } {
  const { history, results, asked } = sources()
  const view = render(
    <HistoryScreen
      source={history}
      resultsSource={results}
      projectId="textbolt"
      pageId="alerts"
      marketId="us"
      markets={[US]}
    />
  )
  return Object.assign(view, { asked })
}

async function showTimeline(view: ReturnType<typeof render>): Promise<void> {
  fireEvent.click(await view.findByRole('tab', { name: /^Timeline/ }))
}

function rowsIn(dialog: HTMLElement): number {
  return dialog.querySelectorAll('[data-drill-row]').length
}

beforeEach(() => {
  window.location.hash = ''
})

afterEach(() => cleanup())

describe('History drill-downs', () => {
  it('opens Results pinned to that check from View results and the score chip', async () => {
    const view = renderScreen()
    await showTimeline(view)
    const old = await view.findByRole('link', {
      name: /^View results of the Oct 5, 2026, .+ check$/
    })
    const href = pageHash('alerts', 'results', { marketId: 'us', runId: 'run-old' })
    expect(old.getAttribute('href')).toBe(href)
    expect(href).toContain('run=run-old')
    expect(
      view.getByRole('link', { name: /^Score 34: open the results of the Oct 5, 2026, .+ check$/ })
    ).toHaveProperty('href', expect.stringContaining('run=run-old'))
    await waitFor(() => expect(view.asked.length).toBe(4))
    expect(view.asked.map((request) => request.runId ?? 'latest').sort()).toEqual([
      'latest',
      'run-new',
      'run-old',
      'run-partial'
    ])
  })

  it('a partial check opens exactly the questions it ran', async () => {
    const view = renderScreen()
    await showTimeline(view)
    const button = await view.findByRole('button', { name: /^3 of 10 questions checked/ })
    const figure = button.querySelector('[data-nfr-figure]')?.textContent
    expect(figure).toBe('3')
    button.focus()
    fireEvent.click(button)
    const dialog = view.getByRole('dialog')
    expect(
      within(dialog).getByRole('heading', {
        name: 'Questions this partial check ran · 3 questions'
      })
    ).toBeTruthy()
    expect(rowsIn(dialog)).toBe(Number(figure))
    const first = resultsFor('run-partial').prompts[0]
    if (!first) throw new Error('fixture')
    const hrefs = within(dialog)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href') ?? '')
    expect(
      hrefs.some(
        (href) =>
          href.startsWith(`#/pages/alerts/prompt/${first.promptId}?`) &&
          href.includes('run=run-partial')
      )
    ).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(button)
  })

  it('"N changed" lists the questions that moved in that check, not the latest', async () => {
    const view = renderScreen()
    await showTimeline(view)
    const old = await view.findByRole('button', {
      name: '2 questions changed since the previous check: show them'
    })
    fireEvent.click(old)
    let dialog = view.getByRole('dialog')
    expect(rowsIn(dialog)).toBe(2)
    expect(dialog.textContent).toContain('Questions whose result changed · 2 questions')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    const latest = view.getByRole('button', {
      name: '3 questions changed since the previous check: show them'
    })
    fireEvent.click(latest)
    dialog = view.getByRole('dialog')
    expect(rowsIn(dialog)).toBe(Number(latest.textContent?.match(/\d+/)?.[0]))
  })

  it('fix events link to the fix card and list every targeted question', async () => {
    const view = renderScreen()
    await showTimeline(view)
    const fix = await view.findByRole('link', { name: 'Open fix 1 on the Progress tab' })
    expect(fix.getAttribute('href')).toBe(
      pageHash('alerts', 'progress', { marketId: 'us', filter: 'fix:1' })
    )
    const targeted = await view.findByRole('button', {
      name: '3 questions fix 1 targeted: show them'
    })
    fireEvent.click(targeted)
    const dialog = view.getByRole('dialog')
    expect(rowsIn(dialog)).toBe(3)
    expect(dialog.textContent).toContain('Not in the latest check')
    expect(
      view.getByRole('link', { name: /Open questions: question set v2, 10 questions/ })
    ).toHaveProperty('href', expect.stringContaining('#/pages/alerts/prompts'))
    expect((await axe.run(view.container, RULES)).violations).toEqual([])
  })

  it('the events grid keeps the score and change drills, and a row opens the rest', async () => {
    const view = renderScreen()
    const grid = await view.findByRole('grid', { name: 'Page history' })
    expect(
      within(grid).getByRole('link', {
        name: /^Score 34: open the results of the Oct 5, 2026, .+ check$/
      }).textContent
    ).toBe('34')
    const changed = await within(grid).findByRole('button', {
      name: '2 questions changed since the previous check: show them'
    })
    fireEvent.click(changed)
    expect(rowsIn(view.getByRole('dialog'))).toBe(2)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())

    const partialRow = Array.from(grid.querySelectorAll<HTMLElement>('[data-row]')).find((row) =>
      (row.textContent ?? '').includes('Partial')
    )
    if (!partialRow) throw new Error('no partial row')
    fireEvent.click(partialRow)
    const panel = view.getByRole('dialog')
    expect(
      within(panel)
        .getByRole('link', { name: /^View results of the .* check$/ })
        .getAttribute('href')
    ).toContain('run=run-partial')
    const partial = await within(panel).findByRole('button', { name: /^3 of 10 questions checked/ })
    fireEvent.click(partial)
    const dialogs = view.getAllByRole('dialog')
    expect(rowsIn(dialogs[dialogs.length - 1] as HTMLElement)).toBe(3)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(view.getAllByRole('dialog')).toHaveLength(1))
    fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: /^Close .+/ }))
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())

    const fixRow = Array.from(grid.querySelectorAll<HTMLElement>('[data-row]')).find((row) =>
      (row.textContent ?? '').includes('Added 5 FAQs')
    )
    if (!fixRow) throw new Error('no fix row')
    fireEvent.click(within(fixRow).getByRole('button', { name: /^Actions for Fix/ }))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Show only Fixes' }))
    expect(view.getByRole('button', { name: /^Fixes/ }).getAttribute('aria-pressed')).toBe('true')
    expect(
      view.getByRole('grid', { name: 'Page history' }).querySelectorAll('[data-row]')
    ).toHaveLength(1)
    expect((await axe.run(view.container, RULES)).violations).toEqual([])
  })

  it('without a results source, numbers stay plain text and links still work', async () => {
    const { history } = sources()
    const view = render(
      <HistoryScreen
        source={history}
        resultsSource={null}
        projectId="textbolt"
        pageId="alerts"
        marketId="us"
        markets={[US]}
      />
    )
    await showTimeline(view)
    expect(
      await view.findByRole('link', { name: /^View results of the Oct 19, 2026, .+ check$/ })
    ).toBeTruthy()
    expect(view.queryByRole('button', { name: /changed since the previous check/ })).toBeNull()
    expect(view.getByText(/Partial check · 3 of 10 questions/)).toBeTruthy()
  })
})
