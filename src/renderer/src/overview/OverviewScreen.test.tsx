// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EngineAnswerStatus, EngineId } from '@shared/domain'
import type { EngineSummaryRequest, EngineSummaryView, ResultsChanged } from '@shared/ipc'
import { PAGE_FIX_KIND_COPY, rollupPageFixes } from '@shared/page-fixes'
import { DrillHost } from '../drill'
import { projectSearches } from '../fixes/searchFixtures'
import { axeViolations } from '../ui/axe.test-helper'
import { resetBoardMemory } from './board/store'
import type { OverviewClient } from './client'
import { OverviewScreen } from './index'
import { resetCachedReads } from './widgets/useCachedRead'
import {
  BEFORE_AT,
  drawerRows,
  fakeClient,
  FIRST_CALL,
  firstOnly,
  GAINED,
  KEPT,
  LOST,
  NEVER,
  overview,
  PRICING,
  UK,
  US
} from './overviewScreen.test-helper'

beforeEach(() => {
  window.location.hash = '#/overview'
})

afterEach(() => {
  cleanup()
  window.location.hash = ''
  resetBoardMemory()
  resetCachedReads()
})

describe('OverviewScreen', () => {
  it('shows the Impact review line, the headline strip, the chart, the changed questions and the right rail', async () => {
    const { client, calls } = fakeClient(() => overview())
    const view = render(<OverviewScreen projectId="proj-1" client={client} />)
    expect(view.getByRole('status').textContent).toContain('Loading the overview')
    await view.findByRole('region', { name: 'Headline numbers' })
    expect(calls).toEqual([FIRST_CALL])

    expect(view.getByRole('heading', { level: 1, name: 'Summary' })).toBeTruthy()
    const checkNow = view.getByRole('link', { name: /Check now/ })
    expect(checkNow.getAttribute('href')).toBe('#/check')
    const period = view.getByRole('group', { name: 'Period' })
    expect(
      within(period).getByRole('button', { name: '30 days' }).getAttribute('aria-pressed')
    ).toBe('true')
    // One market: no market picker.
    expect(view.queryByRole('combobox', { name: 'Market' })).toBeNull()

    // The verdict moved to Reports → Impact review: one quiet line on top links there.
    const impact = view.getByRole('region', { name: 'Is it working?' })
    expect(impact.textContent).not.toContain('Citations moved around.')
    expect(
      within(impact).getByRole('link', { name: 'See the Impact review →' }).getAttribute('href')
    ).toBe('#/reports?report=impact')
    // Today's cards are the default widgets, in today's order.
    expect(
      [...view.container.querySelectorAll('[data-widget-id]')].map((node) =>
        node.getAttribute('data-kind')
      )
    ).toEqual(['headline', 'results', 'trend', 'cited-sites', 'next-fixes', 'changes'])

    const kpis = view.getByRole('region', { name: 'Headline numbers' })
    const cited = within(kpis).getByRole('region', { name: 'You’re cited' })
    // The number is the drill's own count: the two cited questions it opens.
    expect(within(cited).getByRole('button', { name: /^2 questions/ }).textContent).toBe('2')
    expect(cited.textContent).toContain('+2')
    // No sub-line: the arrow carries the change.
    expect(cited.textContent).not.toContain('was 4')
    expect(within(kpis).getByRole('region', { name: 'AI Overview shows' }).textContent).toContain(
      'of 46'
    )
    const share = within(kpis).getByRole('region', { name: 'Citation share' })
    expect(share.textContent).toContain('8%')
    expect(share.textContent).toContain('−1 pts')
    expect(share.textContent).not.toContain('links across')
    // Four tiles: the tracked count is the AI Overview tile's "of 46".
    expect(within(kpis).queryByRole('region', { name: 'Questions tracked' })).toBeNull()

    const chart = view.getByRole('img', { name: /^Cited questions per week/ })
    expect(chart.getAttribute('aria-label')).toContain(
      'cited in 6 of 31 questions with an AI Overview'
    )
    expect(chart.querySelectorAll('[data-point]').length).toBeGreaterThan(0)

    // "Changed" is the default chip: gained and lost only.
    const grid = view.getByRole('grid', { name: 'Questions that changed' })
    const gained = within(grid).getByRole('link', {
      name: 'best replacement for a carrier email to text gateway'
    })
    expect(gained.getAttribute('href')).toBe('#/pages/topic-1/prompt/tq-3?market=mkt-us&run=run-9')
    expect(grid.textContent).toContain('Topic: Gateway shutdown')
    // The four result words; Google's place sits in its own Place column; Named is a
    // badge beside Not cited, never a fifth result.
    expect(grid.textContent).toContain('Right page#3')
    expect(grid.textContent).toContain('Not citedNamed')
    expect(grid.textContent).not.toContain('Right page #')
    expect(grid.textContent).toContain('Gained')
    expect(grid.textContent).toContain('Lost')
    expect(grid.textContent).not.toContain(KEPT.text)
    expect(within(grid).getByRole('button', { name: 'Copy /pricing/' })).toBeTruthy()
    expect(
      within(grid).getByRole('link', { name: 'Open /pricing/ in a new tab' }).getAttribute('href')
    ).toBe(PRICING)
    expect(within(grid).getByText('Named').className).toContain('ui-result-named')

    // Add questions is a small + with a tooltip; it opens the drawer over this screen.
    const add = view.getByRole('button', { name: 'Add questions' })
    expect(add.getAttribute('data-tip')).toBe('Add questions')
    fireEvent.click(add)
    expect(window.location.hash).toBe('#/overview?drawer=add-questions')
    window.location.hash = '#/overview'
    // No count: Questions also lists the questions left out of checks.
    expect(view.getByRole('link', { name: 'All questions →' }).getAttribute('href')).toBe(
      '#/questions'
    )
    expect(view.getByRole('link', { name: 'Competitors →' }).getAttribute('href')).toBe(
      '#/competitors'
    )
    // Next fixes is What to fix's list: with no fixes source, it waits for it.
    expect(view.getByRole('link', { name: 'All fixes →' }).getAttribute('href')).toBe('#/fixes')

    const sites = view.getByRole('list', { name: 'Questions citing each site' })
    expect(within(sites).getByText('TextBolt').closest('.ov-own')).toBeTruthy()
    expect(within(sites).getByRole('button', { name: 'Copy reddit.com' })).toBeTruthy()
    expect(
      within(sites).getByRole('button', { name: 'TextBolt: 2 questions, 4 at the previous check' })
        .textContent
    ).toBe('2')
    expect(view.getByText(/Faint bar: the previous check/)).toBeTruthy()

    expect(view.getByText(/From setup on Oct 1: 1 topic, 10 questions checked/)).toBeTruthy()
    expect(view.getByRole('link', { name: 'Track the 3 pages' }).getAttribute('href')).toBe(
      '#/start/plan'
    )
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('has no verdict card: the verdict lives in Reports → Impact review', async () => {
    const { client } = fakeClient(() => overview())
    const view = render(<OverviewScreen projectId="proj-1" client={client} />)
    await view.findByRole('region', { name: 'Results at a glance' })
    const impact = view.getByRole('region', { name: 'Is it working?' })
    expect(view.queryByRole('heading', { name: 'Verdict' })).toBeNull()
    expect(within(impact).queryByRole('button', { name: /Cite TextUs/ })).toBeNull()
    expect(impact.textContent).toContain('Impact review')
  })

  it('compares with an earlier check, filters by change and keeps both in the address', async () => {
    window.location.hash = '#/overview?period=7d'
    const { client, calls } = fakeClient((request) =>
      overview(
        request.vs === 'run-5'
          ? {
              compare: {
                vs: 'run-5',
                mode: 'run',
                at: BEFORE_AT,
                unknown: false,
                available: true,
                options: [{ value: 'run-5', at: BEFORE_AT }]
              }
            }
          : {}
      )
    )
    const view = render(<OverviewScreen projectId="proj-1" client={client} />)
    await view.findByRole('grid', { name: 'Questions that changed' })
    expect(calls[0]).toEqual({ ...FIRST_CALL, period: '7d' })

    const compare = view.getByRole('combobox', { name: 'Compare with' })
    expect([...(compare as HTMLSelectElement).options].map((option) => option.text)).toEqual([
      'Previous check',
      'Oct 8, 2026 check'
    ])
    fireEvent.change(compare, { target: { value: 'run-5' } })
    await waitFor(() => expect(calls.at(-1)).toEqual({ ...FIRST_CALL, period: '7d', vs: 'run-5' }))
    expect(window.location.hash).toBe('#/overview?period=7d&vs=run-5')
    await waitFor(() =>
      expect(
        (view.getByRole('combobox', { name: 'Compare with' }) as HTMLSelectElement).value
      ).toBe('run-5')
    )

    const chips = view.getByRole('group', { name: 'Change' })
    fireEvent.click(within(chips).getByRole('button', { name: /Kept/ }))
    expect(window.location.hash).toBe('#/overview?period=7d&vs=run-5&change=kept')
    const grid = view.getByRole('grid', { name: 'Questions that changed' })
    await waitFor(() => expect(grid.textContent).toContain(KEPT.text))
    expect(grid.textContent).not.toContain(GAINED.text)

    fireEvent.click(view.getByRole('button', { name: '90 days' }))
    await waitFor(() => expect(calls.at(-1)).toEqual({ ...FIRST_CALL, period: '90d', vs: 'run-5' }))
    fireEvent.click(within(grid).getByText(KEPT.text))
    expect(window.location.hash).toBe('#/pages/page-pricing/prompt/p-3?market=mkt-us&run=run-9')
  })

  it('picks a market when the project has two, and says so when a compared check is gone', async () => {
    window.location.hash = '#/overview?vs=run-gone'
    const { client, calls } = fakeClient((request) =>
      overview({
        markets: [US, UK],
        marketId: request.marketId ?? null,
        compare: {
          vs: request.vs ?? null,
          mode: 'previous',
          at: null,
          unknown: request.vs === 'run-gone',
          available: true,
          options: []
        }
      })
    )
    const view = render(<OverviewScreen projectId="proj-1" client={client} />)
    await view.findByRole('region', { name: 'Results at a glance' })
    expect(calls[0]).toEqual({ ...FIRST_CALL, vs: 'run-gone' })
    expect(view.getByText(/That check is not in this project/)).toBeTruthy()
    expect((view.getByRole('combobox', { name: 'Compare with' }) as HTMLSelectElement).value).toBe(
      ''
    )
    fireEvent.click(view.getByRole('combobox', { name: 'Market' }))
    fireEvent.click(
      within(view.getByRole('listbox', { name: 'Market' })).getByRole('option', { name: /UK/ })
    )
    await waitFor(() => expect(calls.at(-1)).toEqual({ ...FIRST_CALL, marketId: 'mkt-uk' }))
    expect(window.location.hash).toBe('#/overview?market=mkt-uk')
  })

  it('opens How we measure in the address, with the agreement line', async () => {
    const { client } = fakeClient(() => overview())
    const view = render(<OverviewScreen projectId="proj-1" client={client} />)
    await view.findByRole('region', { name: 'Results at a glance' })
    fireEvent.click(view.getByRole('button', { name: 'How we measure' }))
    const panel = await view.findByRole('dialog', { name: 'How we measure' })
    expect(window.location.hash).toBe('#/overview?panel=method')
    expect(panel.textContent).toContain('46 tracked questions searched on Google in 🇺🇸 US · EN')
    expect(panel.textContent).toContain('Changes compare with the previous check.')
    expect(panel.textContent).toContain('Both checks agree on 1 of 2 questions (50%)')
    fireEvent.click(within(panel).getByRole('button', { name: 'Close How we measure' }))
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    expect(window.location.hash).toBe('#/overview')
  })

  it('opens How we measure from a link as a read-only drawer; Escape closes it', async () => {
    window.location.hash = '#/overview?panel=method'
    const { client } = fakeClient(() => overview())
    const view = render(<OverviewScreen projectId="proj-1" client={client} />)
    const drawer = await view.findByRole('dialog', { name: 'How we measure' })
    expect(drawer.getAttribute('data-drawer')).toBe('method')
    // Read-only: one Close in the footer, no primary.
    expect(within(drawer).getByRole('button', { name: 'Close' })).toBeTruthy()
    expect(within(drawer).getByRole('complementary', { name: 'At a glance' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    expect(window.location.hash).toBe('#/overview')
  })

  it('Back closes How we measure, and Forward opens it again', async () => {
    const { client } = fakeClient(() => overview())
    const view = render(<OverviewScreen projectId="proj-1" client={client} />)
    await view.findByRole('region', { name: 'Results at a glance' })
    fireEvent.click(view.getByRole('button', { name: 'How we measure' }))
    await view.findByRole('dialog', { name: 'How we measure' })
    window.history.back()
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    expect(window.location.hash).toBe('#/overview')
    window.history.forward()
    await view.findByRole('dialog', { name: 'How we measure' })
    expect(window.location.hash).toBe('#/overview?panel=method')
  })

  it('links Gained to the same filter on the Questions screen', async () => {
    window.location.hash = '#/overview?change=gained'
    const { client } = fakeClient(() => overview())
    const view = render(<OverviewScreen projectId="proj-1" client={client} />)
    const link = await view.findByRole('link', { name: 'Gained in Questions →' })
    expect(link.getAttribute('href')).toBe('#/questions?change=gained')
    const grid = view.getByRole('grid', { name: 'Questions that changed' })
    expect(grid.textContent).toContain(GAINED.text)
    expect(grid.textContent).not.toContain(LOST.text)
  })

  it('reads as a first measurement when nothing compares', async () => {
    const { client } = fakeClient(() => overview(firstOnly()))
    const view = render(<OverviewScreen projectId="proj-1" client={client} />)
    await view.findByRole('region', { name: 'Results at a glance' })
    const grid = view.getByRole('grid', { name: 'Your questions' })
    expect(grid.textContent).toContain(KEPT.text)
    expect(view.queryByRole('group', { name: 'Change' })).toBeNull()
    expect(view.queryByText(/Faint bar/)).toBeNull()
    expect(view.getByRole('region', { name: 'You’re cited' }).textContent).not.toContain('was')
  })

  it('opens exactly the questions behind each headline number', async () => {
    const { client } = fakeClient(() => overview())
    const view = render(
      <DrillHost>
        <OverviewScreen projectId="proj-1" client={client} />
      </DrillHost>
    )
    const kpis = await view.findByRole('region', { name: 'Headline numbers' })
    const cases: [string, number][] = [
      ['AI Overview shows', 4],
      ['You’re cited', 2],
      ['You’re named', 1]
    ]
    for (const [tile, count] of cases) {
      // The first button that is not the change chip (which opens what moved).
      const number = within(within(kpis).getByRole('region', { name: tile }))
        .getAllByRole('button')
        .find((button) => !button.classList.contains('ov-trend-btn')) as HTMLElement
      expect(number.textContent).toBe(String(count))
      fireEvent.click(number)
      const dialog = await view.findByRole('dialog')
      expect(dialog.textContent).toContain(`${count} question`)
      fireEvent.keyDown(dialog, { key: 'Escape' })
      await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    }
    // "of 46" opens every tracked question.
    const aio = within(kpis).getByRole('region', { name: 'AI Overview shows' })
    const tracked = within(aio).getByRole('button', { name: 'of 46 questions tracked' })
    expect(tracked.textContent).toBe('46')
    fireEvent.click(tracked)
    expect((await view.findByRole('dialog')).textContent).toContain('46 question')
  })

  it('shows the four results in one bar; each count and Needs work open their searches', async () => {
    const { client } = fakeClient(() => overview())
    const view = render(<OverviewScreen projectId="proj-1" client={client} />)
    const panel = await view.findByRole('group', { name: /^Results/ })
    // GAINED target page, KEPT your other page, LOST named and NEVER not cited: 2 not cited.
    expect(within(panel).getByRole('img').getAttribute('aria-label')).toBe(
      '4 searches: 2 not cited, 1 your other page, 1 right page cited, 0 no AI Overview'
    )
    const legend = within(panel).getByRole('list', { name: '4 searches by result' })
    const notCited = within(legend).getByRole('link', { name: /2\s*not cited/ })
    // Not cited is orange (grid rule R7, 2026-10-29).
    expect(
      legend.querySelector<HTMLElement>('[data-result="not_cited"] .ui-rdot')?.style.background
    ).toBe('var(--result-not-cited)')
    // No AI Overview at zero has nothing to open.
    expect(within(legend).queryByRole('link', { name: /no AI Overview/ })).toBeNull()

    window.location.hash = notCited.getAttribute('href') ?? ''
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    let dialog = await view.findByRole('dialog', { name: /Not cited: latest checks/ })
    expect(window.location.hash).toContain('drawer=drill&drill=result%3Anot_cited')
    expect(await drawerRows(dialog)).toBe(2)
    expect(dialog.textContent).toContain('Improve the target page, highest win odds first.')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())

    // Needs work = not cited + your other page, and the way to Fixes.
    const work = within(panel).getByRole('button', { name: '3 searches need work' })
    expect(work.textContent).toBe('3')
    expect(
      within(panel).getByRole('link', { name: 'See them in Fixes →' }).getAttribute('href')
    ).toBe('#/fixes')
    fireEvent.click(work)
    dialog = await view.findByRole('dialog', { name: /Searches that need work/ })
    expect(await drawerRows(dialog)).toBe(3)
    expect(dialog.textContent).toContain('Your other page')
  }, 30_000)

  it('opens every link behind the citation share, yours first, on the URL', async () => {
    const { client } = fakeClient(() => overview())
    const view = render(<OverviewScreen projectId="proj-1" client={client} />)
    const kpis = await view.findByRole('region', { name: 'Headline numbers' })
    const share = within(kpis).getByRole('region', { name: 'Citation share' })

    // The share opens every link, your 12 first.
    fireEvent.click(within(share).getByRole('button', { name: /^8% citation share/ }))
    const dialog = await view.findByRole('dialog', { name: /Links in AI Overviews/ })
    await waitFor(() => expect(window.location.hash).toContain('drawer=drill&drill=kpi%3Ashare'))
    expect(await drawerRows(dialog)).toBe(150)
    expect(dialog.querySelector('[data-drill-row="0"]')?.textContent).toContain('textbolt.com')
    const tiles = within(dialog).getByRole('group', { name: 'Filter this list' })
    expect(within(tiles).getByRole('button', { name: /12\s*Your site/ })).toBeTruthy()
    expect(within(tiles).getByRole('button', { name: /138\s*Other sites/ })).toBeTruthy()
  }, 30_000)

  it('opens the questions behind each Who gets cited count and the chart scale', async () => {
    const { client } = fakeClient(() => overview())
    const view = render(<OverviewScreen projectId="proj-1" client={client} />)
    const sites = await view.findByRole('list', { name: 'Questions citing each site' })
    for (const [name, count] of [
      ['TextUs', 3],
      ['TextBolt', 2],
      ['reddit.com', 1]
    ] as const) {
      const number = within(sites).getByRole('button', { name: new RegExp(`^${name}: `) })
      expect(number.textContent).toBe(String(count))
      fireEvent.click(number)
      const dialog = await view.findByRole('dialog')
      expect(await drawerRows(dialog)).toBe(count)
      // An opaque id on the URL, never the site's name.
      expect(window.location.hash).toMatch(/drill=site%3A(own|s[0-9a-z]+)/)
      fireEvent.keyDown(dialog, { key: 'Escape' })
      await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    }
    const chart = view.getByRole('region', { name: 'Questions where you’re cited, by week' })
    const scale = within(chart).getByRole('button', { name: /^of 4 questions/ })
    fireEvent.click(scale)
    expect(await drawerRows(await view.findByRole('dialog'))).toBe(4)
  })

  it('shows a zero count as plain text, not a button to an empty list', async () => {
    const { client } = fakeClient(() =>
      overview({ verdictSets: { ...overview().verdictSets, named: [] } })
    )
    const view = render(<OverviewScreen projectId="proj-1" client={client} />)
    const kpis = await view.findByRole('region', { name: 'Headline numbers' })
    const named = within(kpis).getByRole('region', { name: 'You’re named' })
    expect(within(named).queryByRole('button')).toBeNull()
    expect(named.textContent).toContain('0')
  })

  it('points to Add questions before any question is tracked', async () => {
    const { client } = fakeClient(() =>
      overview({
        hasChecks: false,
        kpis: {
          tracked: { value: 0, before: null, delta: null },
          keywords: 0,
          withAio: { value: 0, before: null, delta: null },
          cited: { value: 0, before: null, delta: null },
          named: { value: 0, before: null, delta: null },
          share: {
            value: null,
            before: null,
            delta: null,
            ownCitations: 0,
            allCitations: 0,
            questions: 0
          }
        }
      })
    )
    const view = render(<OverviewScreen projectId="proj-1" client={client} />)
    await view.findByRole('heading', { name: 'No questions tracked yet' })
    expect(view.getByRole('link', { name: /Add questions/ }).getAttribute('href')).toBe(
      '#/overview?drawer=add-questions'
    )
    expect(view.queryByRole('link', { name: /Check now/ })).toBeNull()
    expect(view.queryByRole('region', { name: 'Headline numbers' })).toBeNull()
    expect(view.queryByRole('region', { name: 'Results at a glance' })).toBeNull()
  })

  it('counts keywords apart from questions in the tracked tile and the first-check line', async () => {
    const { client } = fakeClient(() =>
      overview({
        hasChecks: false,
        checkSearches: { min: 148, max: 296 },
        kpis: {
          tracked: { value: 148, before: null, delta: null },
          keywords: 118,
          withAio: { value: 0, before: null, delta: null },
          cited: { value: 0, before: null, delta: null },
          named: { value: 0, before: null, delta: null },
          share: {
            value: null,
            before: null,
            delta: null,
            ownCitations: 0,
            allCitations: 0,
            questions: 0
          }
        }
      })
    )
    const view = render(<OverviewScreen projectId="proj-1" client={client} />)
    await view.findByRole('heading', { name: 'No checks yet' })
    const tile = view.getByRole('region', { name: 'AI Overview shows' })
    expect(within(tile).getByRole('button', { name: 'of 148 searches tracked' }).textContent).toBe(
      '148'
    )
    expect(
      view.getByText('Check now searches your 30 questions · 118 keywords: about 148–296 searches.')
    ).toBeTruthy()
  })

  it('points to Check now with its search count before the first check', async () => {
    const { client } = fakeClient(() =>
      overview({
        hasChecks: false,
        checkSearches: { min: 3, max: 6 },
        kpis: {
          tracked: { value: 3, before: null, delta: null },
          keywords: 0,
          withAio: { value: 0, before: null, delta: null },
          cited: { value: 0, before: null, delta: null },
          named: { value: 0, before: null, delta: null },
          share: {
            value: null,
            before: null,
            delta: null,
            ownCitations: 0,
            allCitations: 0,
            questions: 0
          }
        }
      })
    )
    const view = render(<OverviewScreen projectId="proj-1" client={client} />)
    await view.findByRole('heading', { name: 'No checks yet' })
    expect(view.getByText('Check now searches your 3 questions: about 3–6 searches.')).toBeTruthy()
    expect(view.getByRole('link', { name: /Check now/ }).getAttribute('href')).toBe('#/check')
    expect(view.queryByRole('grid')).toBeNull()
  })

  it('says when no question changed, and shows no first check report when there is none', async () => {
    const { client } = fakeClient(() =>
      overview({
        questions: [KEPT, NEVER],
        diff: { gained: 0, kept: 1, lost: 0, never: 1, unmatched: 0 },
        fixes: [],
        openFixes: 0,
        firstReport: null
      })
    )
    const withSearches: OverviewClient = {
      ...client,
      'fixes:searches': () => Promise.resolve(projectSearches([]))
    }
    const view = render(<OverviewScreen projectId="proj-1" client={withSearches} />)
    await view.findByText('No question gained or lost a citation')
    expect(view.getByRole('button', { name: 'Add questions' })).toBeTruthy()
    expect(await view.findByText(/No page fixes now/)).toBeTruthy()
    expect(view.getByRole('link', { name: 'All fixes →' }).getAttribute('href')).toBe('#/fixes')
    expect(view.queryByRole('heading', { name: 'First check report' })).toBeNull()
  })

  it('lists the top 3 page fixes of What to fix in Next fixes, each opening its fix', async () => {
    const { client } = fakeClient(() => overview())
    const searches = projectSearches()
    const top = rollupPageFixes(searches.searches).fixes
    expect(top.length).toBeGreaterThan(3)
    const view = render(
      <OverviewScreen
        projectId="proj-1"
        client={{ ...client, 'fixes:searches': () => Promise.resolve(searches) }}
      />
    )
    const panel = await view.findByRole('region', { name: 'Next fixes' })
    await waitFor(() => expect(within(panel).getAllByRole('listitem')).toHaveLength(3))
    const first = top[0]
    if (first === undefined) throw new Error('no fix')
    const links = within(panel).getAllByRole('link', { name: PAGE_FIX_KIND_COPY[first.kind].title })
    // The fix opens in its drawer over the Overview, not in Fixes.
    expect(links[0]?.getAttribute('href')).toMatch(
      new RegExp(`[?&]drawer=page-fix&pfx\\.id=${first.id}$`)
    )
    expect(view.queryByText(/No page fixes now/)).toBeNull()
  })

  it('shows a load error with Try again', async () => {
    let fail = true
    const { client, calls } = fakeClient(() =>
      fail ? new Error('visibility:overview: That project was not found') : overview()
    )
    const view = render(<OverviewScreen projectId="proj-1" client={client} />)
    const alert = await view.findByRole('alert')
    expect(alert.textContent).toContain('Could not load the overview.')
    expect(alert.textContent).toContain('That project was not found')
    fail = false
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    await view.findByRole('region', { name: 'Headline numbers' })
    expect(calls).toHaveLength(2)
  })
})

describe('OverviewScreen engine filter', () => {
  /** Per question: Google cites 3 of 4, ChatGPT cites GAINED only, Perplexity is down. */
  const STATUS: Readonly<Record<string, Partial<Record<EngineId, EngineAnswerStatus>>>> = {
    [GAINED.key]: { google_aio: 'cited', chatgpt: 'cited', perplexity: 'unavailable' },
    [LOST.key]: { google_aio: 'cited', chatgpt: 'not_cited', perplexity: 'unavailable' },
    [KEPT.key]: { google_aio: 'cited', chatgpt: 'named', perplexity: 'unavailable' },
    [NEVER.key]: { google_aio: 'not_cited', chatgpt: 'no_answer', perplexity: 'unavailable' }
  }

  function withEngines(engines: readonly EngineId[]): OverviewClient {
    return {
      ...fakeClient(() => overview()).client,
      'engines:summary': async (request: EngineSummaryRequest): Promise<EngineSummaryView> => ({
        projectId: request.projectId,
        engines,
        counts: engines.map((engine) => ({
          engine,
          label: engine,
          // Every market: more than the Summary counts, so the screen must scope them.
          checked: 99,
          cited: 99,
          named: 0,
          notCited: 0,
          noAnswer: 0,
          unavailable: 0,
          error: 0,
          gained: engine === 'chatgpt' ? 1 : 0,
          lost: 0,
          lastCheckedAt: '2026-10-24T10:00:00.000Z'
        })),
        questions: [GAINED, LOST, KEPT, NEVER]
          .filter((item) => request.pageIds?.includes(item.pageId))
          .map((item) => ({
            pageId: item.pageId,
            promptId: item.promptId,
            marketId: item.marketId,
            statuses: Object.fromEntries(
              engines.flatMap((engine) => {
                const status = STATUS[item.key]?.[engine]
                return status === undefined ? [] : [[engine, status]]
              })
            ),
            // ChatGPT cites GAINED now and did not at the check before.
            ...(item.key === GAINED.key && engines.includes('chatgpt')
              ? { moved: { chatgpt: 'gained' as const } }
              : {})
          }))
      })
    }
  }

  it('keeps today’s Summary with one engine', async () => {
    const view = render(<OverviewScreen projectId="proj-1" client={withEngines(['google_aio'])} />)
    await view.findByRole('region', { name: 'Headline numbers' })
    expect(view.queryByRole('group', { name: /^Engine for/ })).toBeNull()
    expect(view.queryByRole('region', { name: 'Cited on each engine' })).toBeNull()
  })

  it('gives each widget its own engine filter, All to start', async () => {
    const view = render(
      <OverviewScreen
        projectId="proj-1"
        client={withEngines(['google_aio', 'chatgpt', 'perplexity'])}
      />
    )
    const filter = await view.findByRole('group', { name: 'Engine for Headline numbers' })
    expect(within(filter).getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
    // Next fixes are page fixes: no engine to pick.
    expect(view.getAllByRole('group', { name: /^Engine for / }).length).toBe(5)
    expect(view.queryByRole('group', { name: 'Engine for Next fixes' })).toBeNull()
    expect(view.getByRole('region', { name: 'Headline numbers' })).toBeTruthy()
    expect(view.getByRole('region', { name: 'Results at a glance' })).toBeTruthy()
    expect(view.queryByRole('region', { name: 'Cited on each engine' })).toBeNull()
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('shows a running check’s answers, re-reads on results:changed, then says Checked just now', async () => {
    const listeners = new Set<(event: ResultsChanged) => void>()
    const bridge = window as unknown as { citefox?: unknown }
    bridge.citefox = {
      'results:changed': (listener: (event: ResultsChanged) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    }
    const live = {
      state: 'running' as const,
      jobId: 'job-1',
      done: 3,
      total: 12,
      questions: { done: 3, total: 8 },
      keywords: { done: 0, total: 4 },
      startedAt: BEFORE_AT,
      endedAt: null
    }
    let running = true
    const { client, calls } = fakeClient(() =>
      running
        ? overview({ ...firstOnly(), live })
        : overview({ ...firstOnly(), live: null, lastCheckedAt: new Date().toISOString() })
    )
    try {
      const view = render(<OverviewScreen projectId="proj-1" client={client} />)
      expect(
        await view.findByText('Checking… 3 of 12 done · numbers update as answers come in')
      ).toBeTruthy()
      running = false
      const end = { projectId: 'proj-1', jobId: 'job-1', pageId: 'topic-1', marketId: null }
      act(() => {
        for (const listener of listeners) {
          listener({ ...end, promptId: null, state: 'finished', done: 12, total: 12 })
        }
      })
      expect(await view.findByText('Checked just now')).toBeTruthy()
      expect(calls).toHaveLength(2)
    } finally {
      delete bridge.citefox
    }
  })

  it('shows one engine’s numbers from the URL, each drills, and Back returns to All', async () => {
    window.location.hash = '#/overview?engine=chatgpt'
    const view = render(
      <OverviewScreen projectId="proj-1" client={withEngines(['google_aio', 'chatgpt'])} />
    )
    const kpis = await view.findByRole('region', { name: 'Headline numbers on ChatGPT' })
    const cited = within(kpis).getByRole('region', { name: 'You’re cited' })
    expect(cited.textContent).toContain('1of 3')
    // The counts are drill buttons: their suffix keeps a no-break space.
    expect(cited.textContent?.replace(/\u00a0/g, ' ')).toContain('1 gained · 0 lost')
    expect(within(kpis).getByRole('region', { name: 'ChatGPT answered' }).textContent).toContain(
      '3of 4'
    )
    // The link's engine shows on every widget, said once above them.
    expect(view.getByText(/Every widget shows ChatGPT/)).toBeTruthy()
    // Every engine number opens exactly the questions it counts.
    for (const [name, count] of [
      ['4 questions checked on ChatGPT', 4],
      ['3 questions answered on ChatGPT', 3],
      ['1 question where you’re cited on ChatGPT', 1],
      ['1 question where you’re named on ChatGPT', 1],
      // The small print drills too: "of N", without an answer, gained and lost.
      ['1 without an answer on ChatGPT: 1 question', 1],
      ['1 gained on ChatGPT: 1 question', 1],
      ['of 4 questions checked on ChatGPT', 4],
      ['of 3 questions answered on ChatGPT', 3]
    ] as const) {
      fireEvent.click(within(kpis).getByRole('button', { name }))
      const dialog = await view.findByRole('dialog', { name: /on ChatGPT/ })
      expect(await drawerRows(dialog)).toBe(count)
      fireEvent.keyDown(dialog, { key: 'Escape' })
      await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    }
    expect(
      view.getByRole('link', { name: 'See each question on ChatGPT' }).getAttribute('href')
    ).toBe('#/questions?engine=chatgpt')
    fireEvent.click(view.getByRole('button', { name: 'Show each widget’s own engine' }))
    await view.findByRole('region', { name: 'Headline numbers' })
    expect(window.location.hash).toBe('#/overview')
    // Picking an engine on one widget changes that widget only, and it is kept.
    const filter = view.getByRole('group', { name: 'Engine for Headline numbers' })
    fireEvent.click(within(filter).getByRole('button', { name: 'ChatGPT' }))
    await view.findByRole('region', { name: 'Headline numbers on ChatGPT' })
    expect(view.getByRole('region', { name: 'Results at a glance' })).toBeTruthy()
    expect(view.getByRole('grid', { name: 'Questions that changed' })).toBeTruthy()
  }, 30_000)
})
