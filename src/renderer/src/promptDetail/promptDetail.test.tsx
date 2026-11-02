// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PromptCheckRow } from '@shared/domain'
import { PromptDetailScreen } from '.'
import type { PromptDetailSource } from './source'
import {
  detailFor,
  HISTORY,
  PAGE,
  results,
  rowAt,
  rows,
  sample,
  source
} from './promptDetail.fixtures.test-helper'
import {
  citationCounts,
  fixBrief,
  neighbours,
  overTimeRows,
  sourceKindLabel,
  winningSampleIndex
} from './utils/model'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

/** Picks a Prompt detail tab by its label (or the tab element itself). */
function openTab(view: ReturnType<typeof render>, tab: string | HTMLElement): void {
  const element =
    typeof tab === 'string' ? view.getByRole('tab', { name: new RegExp(`^${tab}`) }) : tab
  fireEvent.click(element)
}

describe('question detail model', () => {
  it('steps through questions in question order', () => {
    const second = rowAt(1)
    const nav = neighbours(results.prompts, second.promptId)
    expect(nav).toEqual({
      index: 1,
      total: rows.length,
      previousId: rowAt(0).promptId,
      nextId: rowAt(2).promptId
    })
    expect(neighbours(results.prompts, 'missing').index).toBe(-1)
  })

  it('marks sources and counts links like the Results screen', () => {
    expect(sourceKindLabel({ classification: 'target', untracked: false })).toBe('This page')
    expect(sourceKindLabel({ classification: 'own', untracked: true })).toBe(
      'Own page, not tracked'
    )
    expect(sourceKindLabel({ classification: 'competitor', untracked: false })).toBe('Competitor')
    expect(sourceKindLabel({ classification: 'other', untracked: false })).toBe('Neutral')
    expect(
      sourceKindLabel({
        classification: 'other',
        untracked: false,
        url: 'https://www.reddit.com/r/msp/comments/1nhtfd5/x/'
      })
    ).toBe('Community · Reddit r/msp')
    for (const row of results.prompts) {
      const counts = citationCounts(row.references, row.named)
      const ownRefs = row.references.filter((ref) => ref.classification !== 'competitor')
      expect(counts.thisPage + counts.otherOwn).toBeLessThanOrEqual(ownRefs.length)
    }
    const total = results.prompts.reduce(
      (sum, row) => sum + citationCounts(row.references, row.named).thisPage,
      0
    )
    expect(total).toBe(results.run?.citationsThisPage)
  })

  it('picks the sample whose sources match the rolled-up row', () => {
    const row = rowAt(0)
    const detail = detailFor(row)
    const other = sample(row, { id: 'other', sampleNo: 2, references: [] })
    expect(winningSampleIndex({ ...detail, samples: [other, ...detail.samples] })).toBe(1)
    expect(winningSampleIndex({ ...detail, samples: [] })).toBe(-1)
  })

  it('builds over-time rows and a plain-text fix brief from stored data only', () => {
    const row = rowAt(0)
    const details = new Map([
      ['run-1', detailFor({ ...row, status: 'not_cited', position: null }, 'run-1')],
      ['run-current', detailFor(row)]
    ])
    const timeline = overTimeRows(HISTORY.points, details)
    expect(timeline.map((item) => [item.runId, item.status, item.first])).toEqual([
      ['run-1', 'not_cited', true],
      ['run-2', null, false],
      ['run-current', row.status, false]
    ])
    const brief = fixBrief({
      pageUrl: PAGE.url ?? '',
      marketName: '🇺🇸 US · EN',
      detail: detailFor(row),
      sample: sample(row)
    })
    expect(brief).toContain(`Question: ${row.text.split('**').join('')}`)
    expect(brief).toContain('Staff need no new app. (from simpletexting.com)')
    expect(brief).toContain('Intro: "No custom development required"')
    expect(brief).not.toContain('**no')
  })
})

describe('PromptDetailScreen', () => {
  it('renders the question, the overview, the sources, markets, and history', async () => {
    const row = rowAt(0)
    const fake = source()
    const view = render(
      <PromptDetailScreen
        source={fake}
        projectId="textbolt"
        projectName="TextBolt"
        pageId="textbolt-alerts"
        promptId={row.promptId}
        marketId={undefined}
        onMarketChange={() => undefined}
      />
    )
    await view.findByRole('heading', { level: 1 })
    expect(view.getByText(`Buyer question ${row.promptPosition}`, { exact: false })).toBeTruthy()
    expect(view.getByRole('button', { name: 'Previous question' })).toHaveProperty('disabled', true)
    expect(view.getByRole('link', { name: 'Next question' }).getAttribute('href')).toBe(
      `#/pages/textbolt-alerts/prompt/${rowAt(1).promptId}`
    )
    const aio = view.getByRole('region', { name: /AI Overview/ })
    expect(aio.querySelector('strong')?.textContent).toBe('text')
    expect(aio.textContent).not.toContain('**')
    expect(view.getByText('Written by CiteFox AI')).toBeTruthy()
    expect(view.getByRole('region', { name: 'Status' })).toBeTruthy()
    openTab(view, 'Sources')
    const sources = view.getByRole('grid', { name: 'Sources in the order Google listed them' })
    expect(within(sources).getAllByRole('row')).toHaveLength(row.references.length + 1)
    expect(view.getByRole('list', { name: 'In these sources' }).textContent).toContain('Your site:')
    openTab(view, 'Markets')
    const markets = view.getByRole('region', { name: 'This question in other markets' })
    expect(within(markets).getByText('¿Cómo envío alertas?')).toBeTruthy()
    openTab(view, 'Over time')
    await waitFor(() => expect(view.getByText('Baseline')).toBeTruthy())
    expect(view.getByRole('link', { name: 'Content changed' })).toBeTruthy()
    expect(fake.calls.map((call) => call.runId)).toEqual([null, 'run-1', 'run-2'])
    openTab(view, 'Raw data')
    expect(view.getByText('2 searches used', { exact: false })).toBeTruthy()
    const result = await axe.run(view.container, {
      rules: { region: { enabled: false } }
    })
    expect(result.violations).toEqual([])
  })

  it('switches market from the header picker and other-market rows', async () => {
    const row = rowAt(0)
    const onMarketChange = vi.fn()
    const view = render(
      <PromptDetailScreen
        source={source()}
        projectId="textbolt"
        projectName="TextBolt"
        pageId="textbolt-alerts"
        promptId={row.promptId}
        marketId="us-en"
        onMarketChange={onMarketChange}
      />
    )
    const picker = await view.findByLabelText('Market')
    fireEvent.change(picker, { target: { value: 'uk-en' } })
    expect(onMarketChange).toHaveBeenLastCalledWith('uk-en')
    openTab(view, 'Markets')
    fireEvent.click(view.getByRole('button', { name: /^🇲🇽 MX · ES/ }))
    expect(onMarketChange).toHaveBeenLastCalledWith('mx-es')
  })

  it('copies a fix brief and shows it on demand', async () => {
    const row = rowAt(0)
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const view = render(
      <PromptDetailScreen
        source={source()}
        projectId="textbolt"
        projectName="TextBolt"
        pageId="textbolt-alerts"
        promptId={row.promptId}
        marketId={undefined}
        onMarketChange={() => undefined}
      />
    )
    fireEvent.click(await view.findByRole('button', { name: 'Copy fix brief' }))
    await waitFor(() => expect(view.getByRole('button', { name: 'Copied' })).toBeTruthy())
    expect(view.getByText('Fix brief copied.').getAttribute('role')).toBe('status')
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Fix brief: Question'))
    fireEvent.click(view.getByRole('button', { name: 'More fix actions' }))
    fireEvent.click(within(document.body).getByRole('menuitem', { name: /Show the brief/ }))
    expect(view.container.querySelector('#pd-brief')?.textContent).toContain('Sources Google')
  })

  it('says when the market has no check and when loading fails', async () => {
    const row = rowAt(0)
    const empty = source({
      'checks:getPrompt': async () => ({
        ...detailFor(row),
        runId: null,
        row: null,
        samples: [],
        searchesUsed: 0,
        aioGap: null,
        whereCovered: []
      })
    })
    const view = render(
      <PromptDetailScreen
        source={empty}
        projectId="textbolt"
        projectName="TextBolt"
        pageId="textbolt-alerts"
        promptId={row.promptId}
        marketId={undefined}
        onMarketChange={() => undefined}
      />
    )
    expect(await view.findByText('No check has finished in 🇺🇸 US · EN yet.')).toBeTruthy()
    expect(view.queryByRole('button', { name: 'Copy fix brief' })).toBeNull()
    cleanup()
    const failing = source({
      'pages:get': async () => {
        throw new Error("Error invoking remote method 'pages:get': Error: Unknown page")
      }
    })
    const broken = render(
      <PromptDetailScreen
        source={failing}
        projectId="textbolt"
        projectName="TextBolt"
        pageId="textbolt-alerts"
        promptId={row.promptId}
        marketId={undefined}
        onMarketChange={() => undefined}
      />
    )
    const alert = await broken.findByRole('alert')
    expect(within(alert).getByText('Could not load this question.')).toBeTruthy()
    expect(within(alert).getByText('Unknown page')).toBeTruthy()
    expect(within(alert).getByRole('link', { name: 'Back to Results' })).toBeTruthy()
  })

  it('tries the question again after a failed load', async () => {
    const row = rowAt(0)
    let pageCalls = 0
    const flaky = source({
      'pages:get': async () => {
        pageCalls += 1
        if (pageCalls === 1) throw new Error('The engine is busy.')
        return PAGE
      }
    })
    const view = render(
      <PromptDetailScreen
        source={flaky}
        projectId="textbolt"
        projectName="TextBolt"
        pageId="textbolt-alerts"
        promptId={row.promptId}
        marketId={undefined}
        onMarketChange={() => undefined}
      />
    )
    fireEvent.click(await view.findByRole('button', { name: 'Try again' }))
    expect(await view.findByTestId('prompt-detail')).toBeTruthy()
    expect(pageCalls).toBe(2)
  })

  it('says when earlier checks fail to load instead of showing no checks', async () => {
    const row = rowAt(0)
    let historyCalls = 0
    const view = render(
      <PromptDetailScreen
        source={source({
          'results:history': async () => {
            historyCalls += 1
            if (historyCalls === 1) throw new Error('History is unavailable.')
            return HISTORY
          }
        })}
        projectId="textbolt"
        projectName="TextBolt"
        pageId="textbolt-alerts"
        promptId={row.promptId}
        marketId={undefined}
        onMarketChange={() => undefined}
      />
    )
    openTab(view, await view.findByRole('tab', { name: /^Over time/ }))
    expect(await view.findByText('Could not load earlier checks.')).toBeTruthy()
    expect(view.queryByText('No finished check in this market yet.')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Try again' }))
    await waitFor(() => {
      expect(view.queryByText('Could not load earlier checks.')).toBeNull()
    })
    expect(historyCalls).toBe(2)
  })
})

describe('question detail drill-downs', () => {
  function screen(
    row: PromptCheckRow,
    extra: { runId?: string | null; src?: PromptDetailSource } = {}
  ): ReturnType<typeof render> {
    return render(
      <PromptDetailScreen
        source={extra.src ?? source()}
        projectId="textbolt"
        projectName="TextBolt"
        pageId="textbolt-alerts"
        promptId={row.promptId}
        marketId={undefined}
        runId={extra.runId ?? null}
        onMarketChange={() => undefined}
      />
    )
  }

  it('a pinned check loads that run, says so, and links back to the latest', async () => {
    const row = rowAt(0)
    const src = source()
    const view = screen(row, { runId: 'run-2', src })
    expect(await view.findByText(/not the latest one/)).toBeTruthy()
    expect(src.calls.some((call) => call.runId === 'run-2')).toBe(true)
    expect(view.getByRole('link', { name: 'Show the latest check' }).getAttribute('href')).toBe(
      `#/pages/textbolt-alerts/prompt/${row.promptId}?market=us-en`
    )
  })

  it('header chips explain the status and move to the sources and history', async () => {
    const row = results.prompts.find((item) => item.position !== null) ?? rowAt(0)
    const view = screen(row)
    const status = await view.findByRole('button', { name: /^Status .*: what it means$/ })
    fireEvent.click(status)
    const pop = view.getByRole('dialog')
    expect(pop.textContent).toMatch(/points|score/)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(view.getByRole('button', { name: /go to the sources$/ }))
    expect(document.activeElement?.id).toBe('pd-src-h')
    const stage = view.getByRole('button', { name: /stage: the questions in this stage$/ })
    fireEvent.click(stage)
    expect(view.getByRole('dialog').textContent).toContain('questions')
  })

  it('earlier checks open the question in that check, and coverage opens Page read', async () => {
    const row = rowAt(0)
    const view = screen(row)
    expect(
      (await view.findByRole('link', { name: /see it in Page read$/ })).getAttribute('href')
    ).toBe('#/pages/textbolt-alerts/read')
    openTab(view, 'Over time')
    const earlier = await view.findAllByRole('link', { name: /show this question in that check$/ })
    expect(earlier.length).toBeGreaterThan(0)
    expect(earlier[0]?.getAttribute('href')).toMatch(/\?market=us-en&run=run-/)
    openTab(view, 'Raw data')
    expect(view.getByRole('link', { name: /searches? used: see key usage/ })).toBeTruthy()
  })

  it('a competitor source opens every overview that cites it', async () => {
    const row = results.prompts.find((item) =>
      item.references.some((ref) => ref.classification === 'competitor')
    )
    if (!row) return
    const view = screen(row)
    openTab(view, await view.findByRole('tab', { name: /^Sources/ }))
    const [button] = await view.findAllByRole('button', {
      name: /every overview in this check that cites/
    })
    fireEvent.click(button as HTMLElement)
    const dialog = view.getByRole('dialog')
    expect(within(dialog).getByRole('grid')).toBeTruthy()
  })

  it('keeps the open tab in the URL (?view=), and Back returns to it', async () => {
    const row = rowAt(0)
    window.location.hash = `#/pages/textbolt-alerts/prompt/${row.promptId}`
    const view = screen(row)
    openTab(view, await view.findByRole('tab', { name: /^Sources/ }))
    expect(window.location.hash).toBe(`#/pages/textbolt-alerts/prompt/${row.promptId}?view=sources`)
    openTab(view, 'AI Overview')
    expect(window.location.hash).toBe(`#/pages/textbolt-alerts/prompt/${row.promptId}`)
    window.location.hash = `#/pages/textbolt-alerts/prompt/${row.promptId}?view=time`
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await waitFor(() =>
      expect(view.getByRole('tab', { name: /^Over time/ }).getAttribute('aria-selected')).toBe(
        'true'
      )
    )
  })
})
