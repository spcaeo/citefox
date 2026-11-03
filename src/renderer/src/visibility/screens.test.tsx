// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import type { DrillSpec } from '../m3/model'
import axe from 'axe-core'
import { afterEach, describe, expect, it } from 'vitest'
import { textboltResults } from '../m3/fixtures'
import { DerivedPromptHistory } from './ProgressSections'
import { CitationGrid } from './CitationGrid'
import { manyCitationRows } from './citations'
import { CitationsScreen } from './CitationsScreen'
import { markersFor } from './chart.sample'
import { emptyResults, mockVisibilitySource } from './mocks'
import { progressDetail } from './progress.sample'
import { ProgressAfterChart, SampleMarkets, WhatChangedSection } from './ProgressSample'
import { ScoresScreen } from './ScoresScreen'
import type { VisibilitySource } from './source'
import type { TrendPoint } from '@shared/domain'
import { runningHash } from '../shell/routes'

const PAGE_RULES = {
  rules: {
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    'landmark-one-main': { enabled: false },
    region: { enabled: false }
  }
}

afterEach(() => {
  cleanup()
  // Progress keeps its tab and chart/table view in the route (`?view=`, `?show=`).
  window.history.replaceState(null, '', '#/')
})

const source = mockVisibilitySource()
const detail = progressDetail('alerts')
if (!detail) throw new Error('sample progress missing')
const sample = {
  markers: markersFor('alerts'),
  rateFootnote: detail.rateFootnote,
  renderBefore: (onDrill: (drill: DrillSpec) => void) => (
    <WhatChangedSection detail={detail} onDrill={onDrill} />
  ),
  renderAfter: (onDrill: (drill: DrillSpec) => void) => (
    <ProgressAfterChart detail={detail} onDrill={onDrill} />
  ),
  renderMarkets: () => <SampleMarkets detail={detail} />
}

describe('Citations screen', () => {
  it('offers Try again after a failed load and a Check link when there is no check', async () => {
    let calls = 0
    const flaky: VisibilitySource = {
      ...source,
      'results:get': async (request) => {
        calls += 1
        if (calls === 1) throw new Error('The engine is busy.')
        return { ...(await source['results:get'](request)), run: null }
      }
    }
    const view = render(
      <CitationsScreen source={flaky} projectId="textbolt" pageId="alerts" marketId="us" />
    )
    expect(await view.findByText('Could not load citations.')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Try again' }))
    expect(await view.findByText('No check in this market yet.')).toBeTruthy()
    expect(view.getByRole('link', { name: 'Check now' }).getAttribute('href')).toBe(
      runningHash('alerts')
    )
    expect(calls).toBe(2)
  })

  it('offers Try again when scores fail to load', async () => {
    let failed = false
    const flaky: VisibilitySource = {
      ...source,
      'results:history': async (request) => {
        if (!failed) {
          failed = true
          throw new Error('The engine is busy.')
        }
        return source['results:history'](request)
      }
    }
    const view = render(
      <ScoresScreen source={flaky} projectId="textbolt" pageId="alerts" marketId="us" />
    )
    expect(await view.findByText('Could not load scores.')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Try again' }))
    expect(
      await view.findByRole('heading', { name: 'How often overviews cite this page' })
    ).toBeTruthy()
  })

  it('opens a citations drawer whose rows match the link count', async () => {
    const view = render(
      <CitationsScreen source={source} projectId="textbolt" pageId="alerts" marketId="us" />
    )
    expect(await view.findByRole('heading', { name: 'Citations (links)' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '5 links' }))
    const dialog = await view.findByRole('dialog')
    expect(
      within(dialog).getByRole('heading', { name: 'Citations to textbolt.com · 5 links' })
    ).toBeTruthy()
    expect(dialog.querySelectorAll('[data-drill-row]')).toHaveLength(5)
    expect(dialog.textContent).toContain('Counts match the number you clicked')
  })

  it('keeps spaces in section heading text', async () => {
    const view = render(
      <CitationsScreen source={source} projectId="textbolt" pageId="alerts" marketId="us" />
    )
    const leader = await view.findByRole('heading', { name: 'Who gets cited' })
    expect(leader.textContent).toBe('Who gets cited')
    const cited = view.getByRole('heading', { name: 'Cited instead of you' })
    expect(cited.textContent).toBe('Cited instead of you')
    const sources = view.getByRole('heading', { name: 'Sources Google listed' })
    expect(sources.textContent).toBe('Sources Google listed')
    for (const node of view.container.querySelectorAll('h1, h2, h3')) {
      const raw = node.textContent ?? ''
      const text = raw.replace(/\s+/g, ' ').trim()
      expect(text).not.toMatch(/Whogets|Howoften|Citedinstead|Yourother/)
      if (text.split(' ').length > 1) expect(raw).toMatch(/\S\s+\S/)
    }
  })

  it('opens a leaderboard drill that lists the overview count', async () => {
    const view = render(
      <CitationsScreen source={source} projectId="textbolt" pageId="alerts" marketId="us" />
    )
    const [button] = await view.findAllByRole('button', { name: /: simpletexting.com cited$/ })
    if (!button) throw new Error('missing drill')
    const count = button.getAttribute('aria-label')?.match(/(\d+) questions?/)?.[1]
    fireEvent.click(button)
    const dialog = await view.findByRole('dialog')
    expect(dialog.textContent).toContain(`${count} question`)
  })

  it('has no axe violations on the loaded screen', async () => {
    const view = render(
      <CitationsScreen source={source} projectId="textbolt" pageId="alerts" marketId="us" />
    )
    await view.findByRole('heading', { name: 'Who gets cited' })
    const results = await axe.run(view.container, PAGE_RULES)
    expect(results.violations.map((item) => item.id)).toEqual([])
  })
})

describe('Scores and trends screen', () => {
  it('names the chart, shows the table, and drills the cited count', async () => {
    const view = render(
      <ScoresScreen
        source={source}
        projectId="textbolt"
        pageId="alerts"
        marketId="us"
        sample={sample}
      />
    )
    const rate = await view.findByRole('heading', { name: 'How often overviews cite this page' })
    expect(rate.textContent).toBe('How often overviews cite this page')
    expect(view.getByRole('heading', { name: /What changed since the last check/ })).toBeTruthy()
    const ticks = [...view.container.querySelectorAll('.vis-tick')].map((tick) => tick.textContent)
    expect(ticks).toContain('10 of 10')
    fireEvent.click(view.getByRole('button', { name: 'Gained a citation: 2 questions' }))
    const gained = await view.findByRole('dialog')
    expect(gained.textContent).toContain('2 questions')
    const closeGained = within(gained).getAllByRole('button', { name: 'Close' })[0]
    if (!closeGained) throw new Error('missing close')
    fireEvent.click(closeGained)
    // A logged fix is a numbered marker on the baseline; its card says who made it.
    const marker = view.getByRole('button', { name: /Your fix: Fix 1 · Oct 8/ })
    expect(marker.textContent).toBe('1')
    fireEvent.click(view.getByRole('button', { name: /US · EN, 3 checks/ }))
    const market = await view.findByRole('dialog')
    expect(market.textContent).toContain('🇺🇸 US · EN · 3')
    expect(market.querySelectorAll('[data-drill-row]')).toHaveLength(3)
    const closeMarket = within(market).getAllByRole('button', { name: /^Close$/ })[0]
    if (!closeMarket) throw new Error('missing close')
    fireEvent.click(closeMarket)
    const chart = view.getByRole('img', { name: /Share of AI Overviews that cite this page/ })
    expect(chart.getAttribute('aria-label')).toContain('38%')
    fireEvent.click(
      view.getByRole('button', { name: /38%, Page cited in 3 of 8 AI Overviews shown/ })
    )
    const dialog = await view.findByRole('dialog')
    expect(dialog.textContent).toContain('3 questions')
    const close = within(dialog).getAllByRole('button', { name: 'Close' })[0]
    if (!close) throw new Error('missing close')
    fireEvent.click(close)
    fireEvent.click(view.getByRole('button', { name: 'Table' }))
    const table = view.getByRole('grid', { name: /Share of AI Overviews/ })
    expect(within(table).getByRole('columnheader', { name: 'Rate' })).toBeTruthy()
    expect(within(table).getByRole('columnheader', { name: 'In trend line' })).toBeTruthy()
    expect(table.textContent).toContain('38%')
    expect(table.textContent).toContain('Fix 1 · Added 5 FAQs')
    expect(view.container.querySelector('strong')?.textContent).toBe('page cited')
    expect(view.container.textContent).not.toContain('**')
  })

  it('reads the page score by the page id it was given, with no fixture alias', async () => {
    const aliased: VisibilitySource = {
      ...source,
      'scores:listPages': async (request) => {
        const list = await source['scores:listPages'](request)
        return {
          ...list,
          pages: list.pages.map((row) => (row.pageId === 'alerts' ? { ...row, score: 77 } : row))
        }
      }
    }
    const own = render(
      <ScoresScreen source={aliased} projectId="textbolt" pageId="alerts" marketId="us" />
    )
    expect(await own.findByText(/Visibility score 77/)).toBeTruthy()
    cleanup()
    const other = render(
      <ScoresScreen source={aliased} projectId="textbolt" pageId="textbolt-alerts" marketId="us" />
    )
    await other.findByRole('heading', { name: 'How often overviews cite this page' })
    expect(other.queryByText(/Visibility score 77/)).toBeNull()
  })

  it('has no axe violations on the chart', async () => {
    const view = render(
      <ScoresScreen
        source={source}
        projectId="textbolt"
        pageId="alerts"
        marketId="us"
        sample={sample}
      />
    )
    await view.findByRole('heading', { name: 'How often overviews cite this page' })
    const results = await axe.run(view.container, PAGE_RULES)
    expect(results.violations.map((item) => item.id)).toEqual([])
  })
})

describe('production scores without a fixture', () => {
  it('keeps the tab and the chart or table view in the route', async () => {
    window.history.replaceState(null, '', '#/pages/alerts/progress?view=prompts&show=table')
    const view = render(
      <ScoresScreen source={source} projectId="textbolt" pageId="alerts" marketId="us" />
    )
    expect(await view.findByRole('heading', { name: 'Each question across checks' })).toBeTruthy()
    expect(view.getByRole('tab', { name: /^Questions/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(view.getByRole('tab', { name: 'Overview' }))
    expect(window.location.hash).toBe('#/pages/alerts/progress?show=table')
    expect(view.getByRole('grid', { name: /Share of AI Overviews/ })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Chart' }))
    expect(window.location.hash).toBe('#/pages/alerts/progress')
    expect(view.getByRole('img', { name: /Share of AI Overviews/ })).toBeTruthy()
    fireEvent.click(view.getByRole('tab', { name: /^Fixes/ }))
    expect(window.location.hash).toBe('#/pages/alerts/progress?view=fixes')
  })

  it('shows the empty states and derives question columns from history', async () => {
    const view = render(
      <ScoresScreen source={source} projectId="textbolt" pageId="alerts" marketId="us" />
    )
    // FR-14.1: built from the two latest full checks the screen already loads.
    expect(
      await view.findByRole('heading', {
        name: 'What changed since the last check (Oct 5 → Oct 19)'
      })
    ).toBeTruthy()
    expect(view.getByText(/doesn’t claim one caused the other/)).toBeTruthy()
    expect(view.getByRole('list', { name: 'Chart key' }).querySelectorAll('svg')).toHaveLength(4)
    expect(view.queryByRole('button', { name: /Fix 1 · Oct 8/ })).toBeNull()
    const chart = view.getByRole('img', { name: /Share of AI Overviews that cite this page/ })
    expect(chart.getAttribute('aria-label')).toContain('38%')
    expect(chart.getAttribute('aria-label')).not.toContain('Fix 1')
    fireEvent.click(view.getByRole('tab', { name: /^Fixes/ }))
    expect(view.getByText('No fixes logged yet.')).toBeTruthy()
    expect(view.queryByRole('button', { name: 'Show all fixes' })).toBeNull()
    expect(view.container.textContent).not.toContain('Fix 2')
    fireEvent.click(view.getByRole('tab', { name: /^Questions/ }))
    expect(view.getByRole('heading', { name: 'Each question across checks' })).toBeTruthy()
    expect(view.getAllByRole('columnheader', { name: /^Sep 21/ }).length).toBeGreaterThan(0)
    expect(view.getAllByRole('columnheader', { name: /^Oct 5/ }).length).toBeGreaterThan(0)
    expect(view.getAllByRole('columnheader', { name: /^Oct 19/ }).length).toBeGreaterThan(0)
  })

  it('shows the first-check empty copy when history has no runs', async () => {
    const calls: string[] = []
    const empty = mockVisibilitySource()
    const wrapped = {
      'results:get': async (request: Parameters<(typeof empty)['results:get']>[0]) => {
        calls.push('results:get')
        return empty['results:get']({ ...request, pageId: 'missing' })
      },
      'results:history': async (request: Parameters<(typeof empty)['results:history']>[0]) => {
        calls.push('results:history')
        return empty['results:history']({ ...request, pageId: 'missing' })
      },
      'scores:listProjects': async () => {
        calls.push('scores:listProjects')
        return empty['scores:listProjects']()
      },
      'scores:listPages': async (request: Parameters<(typeof empty)['scores:listPages']>[0]) => {
        calls.push('scores:listPages')
        return empty['scores:listPages'](request)
      }
    }
    const view = render(
      <ScoresScreen source={wrapped} projectId="other" pageId="missing" marketId="us" />
    )
    expect((await view.findAllByText('No check in this market yet.')).length).toBeGreaterThan(0)
    const rate = view.getByRole('heading', { name: 'How often overviews cite this page' })
    expect(rate.textContent).toBe('How often overviews cite this page')
    expect(view.queryByRole('img', { name: /Share of AI Overviews/ })).toBeNull()
    expect(view.getByRole('link', { name: 'Check now' }).getAttribute('href')).toBe(
      runningHash('missing')
    )
    expect(calls).toEqual(
      expect.arrayContaining([
        'results:get',
        'results:history',
        'scores:listProjects',
        'scores:listPages'
      ])
    )
    expect(view.queryByText('None')).toBeNull()
    fireEvent.click(view.getByRole('tab', { name: /^Fixes/ }))
    expect(view.getByText('No fixes logged yet.')).toBeTruthy()
    expect(view.queryByRole('button', { name: 'Show all fixes' })).toBeNull()
    expect(view.container.textContent).not.toContain('CiteFox shows both side by side')
    expect(view.container.textContent).not.toContain('Fix 2')
    expect(view.container.textContent).not.toContain('Added 5 FAQs')
    expect(view.container.textContent).not.toContain('Gained a citation')
  })

  it('renders a missing question set as version unknown, not v1 or v0', async () => {
    for (const version of [null, undefined, 0, 1.5, Number.NaN] as const) {
      const view = render(
        <ScoresScreen
          source={unknownVersionSource(version)}
          projectId="other"
          pageId="missing"
          marketId="us"
        />
      )
      expect(
        (await view.findAllByText('First check with question set version unknown.')).length
      ).toBeGreaterThan(0)
      expect(view.container.textContent).not.toContain('question set v0')
      expect(view.container.textContent).not.toContain('question set v1')
      expect(view.container.textContent).not.toContain('vNaN')
      expect(view.container.querySelector('[data-nfr-version-change]')).toBeNull()
      const chart = view.getByRole('img', { name: /Share of AI Overviews/ })
      expect(chart.getAttribute('aria-label')).toContain('version unknown')
      expect(chart.getAttribute('aria-label')).not.toContain('Question set changed')
      const point = view.getByRole('button', { name: /version unknown/ })
      expect(point.getAttribute('aria-label')).toContain('version unknown')
      expect(point.getAttribute('aria-label')).not.toContain('v0')
      fireEvent.click(view.getByRole('button', { name: 'Table' }))
      const table = view.getByRole('grid', { name: /Share of AI Overviews/ })
      expect(within(table).getByRole('columnheader', { name: 'Question set' })).toBeTruthy()
      expect(within(table).getByRole('gridcell', { name: 'version unknown' })).toBeTruthy()
      expect(table.textContent).not.toContain('v0')
      view.unmount()
      window.history.replaceState(null, '', '#/')
    }
  })
})

function unknownVersionSource(version: number | null | undefined): VisibilitySource {
  const base = mockVisibilitySource()
  return {
    ...base,
    'results:get': async () => emptyResults(),
    'results:history': async (request: Parameters<(typeof base)['results:history']>[0]) => {
      const history = await base['results:history']({ ...request, pageId: 'missing' })
      return {
        ...history,
        points: [
          {
            runId: 'run-unknown',
            finishedAt: '2026-10-01T12:00:00.000Z',
            promptSetVersion: version as TrendPoint['promptSetVersion'],
            partial: false,
            pageCitedRate: 0.5,
            promptsChecked: 4,
            promptsTotal: 4,
            visibilityScore: 10,
            contentChanged: false
          }
        ]
      }
    }
  }
}

describe('citation and trend emphasis', () => {
  it('renders a question label on the citations screen without raw asterisks', async () => {
    const base = textboltResults()
    const first = base.prompts[0]
    if (!first) throw new Error('missing question')
    const marked = {
      ...base,
      prompts: [
        { ...first, label: '**Send** alerts', text: 'How do I **send** alerts?' },
        ...base.prompts.slice(1)
      ]
    }
    const live = mockVisibilitySource()
    const markedSource: VisibilitySource = {
      ...live,
      'results:get': () => Promise.resolve(marked)
    }
    const view = render(
      <CitationsScreen source={markedSource} projectId="textbolt" pageId="alerts" marketId="us" />
    )
    // Each source row shows the prompt label; a click on the row opens the prompt.
    const buttons = await view.findAllByTitle(/Send alerts/)
    expect(buttons.length).toBeGreaterThan(0)
    for (const button of buttons) {
      expect(button.querySelector('strong')?.textContent).toBe('Send')
      expect(button.textContent).not.toContain('**')
    }
    const button = buttons[0]
    if (!button) throw new Error('missing question')
    fireEvent.click(button)
    expect(window.location.hash).toContain(`/prompt/${first.promptId}`)
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('renders a question on the trends history without raw asterisks', () => {
    const view = render(
      <DerivedPromptHistory
        columns={[{ runId: 'run-1', at: '2026-10-19T00:00:00.000Z', label: 'Oct 19' }]}
        rows={[
          {
            id: 'p1',
            n: 1,
            label: '**Send** alerts',
            full: 'How do I **send** alerts?',
            cells: [{ runId: 'run-1', text: 'Page cited · 1' }]
          }
        ]}
        place="US · EN"
        pageId="alerts"
        marketId="us"
      />
    )
    const button = view.getByRole('link', { name: /Send alerts/ })
    // The full question leads (its bold kept); the short label follows it.
    expect(button.querySelector('strong')?.textContent).toBe('send')
    expect(button.textContent).toBe('How do I send alerts? · Send alerts')
    expect(view.container.textContent).not.toContain('**')
  })
})

describe('citation grid scale', () => {
  it('renders 2,000 rows in under 300 ms', () => {
    const rows = manyCitationRows(2000)
    const started = performance.now()
    const view = render(<CitationGrid rows={rows} onOpen={() => undefined} />)
    const elapsed = performance.now() - started
    const painted = view.container.querySelectorAll('[data-row]').length
    expect(painted).toBeGreaterThan(0)
    expect(painted).toBeLessThan(40)
    // Windows CI runners are about twice as slow; the point is "no full 2,000-row render".
    expect(elapsed).toBeLessThan(process.platform === 'win32' ? 600 : 300)
  })
})
