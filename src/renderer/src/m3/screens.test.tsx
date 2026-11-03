// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BuyerPrompt, PromptCheckRow } from '@shared/domain'
import { REPORT_DEFINITIONS, REPORT_KPI_LABELS, reportHeadline } from '@shared/report-copy'
import { pageHash, promptHash } from '../shell/routes'
import {
  TEXTBOLT_MARKETS,
  TEXTBOLT_PAGE,
  TEXTBOLT_PAGE_ID,
  excludedResults,
  textboltJob,
  textboltResults
} from './fixtures'
import { formatClock, formatStamp } from './model'
import { PageResultsScreen } from './PageResultsScreen'
import { PromptGrid } from './PromptGrid'
import { RunningScreen } from './RunningScreen'
import { resetDrawersForTests } from '../shell/drawers'

const PAGE_RULES = {
  rules: {
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    'landmark-one-main': { enabled: false },
    region: { enabled: false }
  }
}

beforeEach(() => {
  window.location.hash = ''
})

afterEach(() => {
  cleanup()
})

/** Opens one of the Results tabs (Prompts, Breakdown, Who gets cited, Top actions, Checks). */
function openTab(view: ReturnType<typeof render>, name: string): void {
  const tablist = view.getAllByRole('tablist', { name: 'Results sections' })[0] as HTMLElement
  fireEvent.click(within(tablist).getByRole('tab', { name: new RegExp(`^${name}`) }))
}

/** Opens the "About this check" popover above the KPI row. */
function openAbout(view: ReturnType<typeof render>): HTMLElement {
  fireEvent.click(view.getAllByRole('button', { name: 'About this check' })[0] as HTMLElement)
  return view.getByRole('dialog', { name: 'About this check' })
}

/** Closes it again with its trigger. */
function closeAbout(view: ReturnType<typeof render>): void {
  fireEvent.click(view.getAllByRole('button', { name: 'About this check' })[0] as HTMLElement)
}

/** The "Cited instead" cell whose full list is `names`. */
function citedCell(view: ReturnType<typeof render>, names: string): HTMLElement {
  const cell = view.container.querySelector<HTMLElement>(`.m3-instances[title="${names}"]`)
  if (!cell) throw new Error(`no cited cell for ${names}`)
  return cell
}

describe('Running screen', () => {
  it('shows check progress and keeps the cancel control a button', async () => {
    const view = render(
      <RunningScreen
        pageId={TEXTBOLT_PAGE_ID}
        samples={1}
        markets={TEXTBOLT_MARKETS}
        job={textboltJob()}
        onCancel={() => undefined}
        onStart={() => undefined}
      />
    )
    const bar = view.getByRole('progressbar', { name: 'Questions checked' })
    expect(bar.getAttribute('aria-valuenow')).toBe('16')
    expect(bar.getAttribute('aria-valuemax')).toBe('40')
    expect(view.getByRole('heading', { name: 'Checking 10 questions in 4 markets' })).toBeTruthy()
    expect(view.getByText('Timed out once, retried')).toBeTruthy()
    expect(view.getByRole('button', { name: 'Cancel check' }).tagName).toBe('BUTTON')
    expect(view.queryByRole('button', { name: 'Start first check' })).toBeNull()
    expect(view.queryByRole('button', { name: 'Explain errors' })).toBeNull()
    expect(view.getByText('Timed out once, retried')).toBeTruthy()
    const results = await axe.run(view.container, PAGE_RULES)
    expect(results.violations.map((item) => item.id)).toEqual([])
  })

  it('market pills switch the table, and a finished row opens Question detail', () => {
    window.location.hash = ''
    const job = textboltJob()
    const view = render(
      <RunningScreen
        pageId={TEXTBOLT_PAGE_ID}
        samples={1}
        markets={TEXTBOLT_MARKETS}
        job={job}
        onCancel={() => undefined}
        onStart={() => undefined}
      />
    )
    const pills = within(view.getByRole('list', { name: 'Markets' })).getAllByRole('button')
    expect(pills).toHaveLength(job.markets.length)
    const done = job.markets.find((market) => market.state === 'ok')
    const other = done ?? job.markets[job.markets.length - 1]
    if (!other) throw new Error('missing market')
    const pill = pills[job.markets.indexOf(other)] as HTMLElement
    fireEvent.click(pill)
    expect(pill.getAttribute('aria-pressed')).toBe('true')
    // An empty market has no rows yet: the list shows its empty state in the same region.
    const table = view.getByRole('region', { name: /Questions in the market/ })
    const open = within(table).queryAllByRole('link', { name: /^Analysis done: open question/ })
    if (open[0]) {
      const row = open[0].closest<HTMLElement>('[data-row]') as HTMLElement
      fireEvent.keyDown(row, { key: 'Enter' })
      expect(window.location.hash).toContain(`market=${encodeURIComponent(other.marketId)}`)
    }
  })

  it('renders the search usage line with the mockup spacing', () => {
    const job = textboltJob()
    const view = render(
      <RunningScreen
        pageId={TEXTBOLT_PAGE_ID}
        samples={1}
        markets={TEXTBOLT_MARKETS}
        job={job}
        onCancel={() => undefined}
        onStart={() => undefined}
      />
    )
    expect(view.getByText(/searches used so far/).textContent).toBe(
      '34 searches used so far, up to 80 · 1,274 of 5,000 this month'
    )
    expect(view.getByText(/sample per question/).textContent).toBe(
      `4 markets · 1 sample per question · started ${formatClock(job.startedAt)}`
    )
    const pills = within(view.getByRole('list', { name: 'Markets' })).getAllByRole('listitem')
    expect(pills.map((pill) => pill.querySelector('.m3-pill-label')?.textContent)).toEqual([
      '🇺🇸 US · EN',
      '🇺🇸 US · Austin · EN',
      '🇬🇧 UK · EN',
      '🇲🇽 MX · ES'
    ])
    expect(view.getByRole('heading', { level: 2, name: '🇺🇸 US · Austin · EN' }).textContent).toBe(
      '🇺🇸 US · Austin · EN'
    )
    expect(view.container.querySelector('.m3-now-label')?.textContent).toBe(
      'Market being checked now · local wording on'
    )
  })

  it('uses finished copy for the heading, market, and search line', () => {
    const view = render(
      <RunningScreen
        pageId={TEXTBOLT_PAGE_ID}
        samples={1}
        markets={TEXTBOLT_MARKETS}
        job={textboltJob()}
        finished
        onCancel={() => undefined}
        onStart={() => undefined}
      />
    )
    expect(view.getByRole('heading', { level: 1 }).textContent).toBe('Check finished')
    expect(view.container.querySelector('.m3-now-label')?.textContent).toBe(
      'Checked · local wording on'
    )
    expect(view.container.textContent).not.toContain('Market being checked now')
    expect(view.getByText(/searches used/).textContent).toBe(
      '34 searches used, up to 80 · 1,274 of 5,000 this month'
    )
    expect(view.queryByText(/so far/)).toBeNull()
  })

  it('shows a search that failed after its retries as failed, not Waiting', () => {
    const base = textboltJob()
    const failed = new Set(['search', 'aio'])
    // The engine stores a timed-out search and its AIO as `error` and the analysis as `warning`.
    const steps = base.steps.map((step) =>
      step.marketId === 'us-austin' && step.promptPosition === 1
        ? {
            ...step,
            state: failed.has(step.phase) ? ('error' as const) : ('warning' as const),
            detail: step.phase === 'analysis' ? 'Scored' : 'The search timed out.',
            errorCode: failed.has(step.phase) ? ('timeout' as const) : null,
            error: failed.has(step.phase) ? 'The search timed out.' : null
          }
        : step
    )
    const view = render(
      <RunningScreen
        pageId={TEXTBOLT_PAGE_ID}
        samples={1}
        markets={TEXTBOLT_MARKETS}
        job={{ ...base, status: 'finished', steps }}
        finished
        onCancel={() => undefined}
        onStart={() => undefined}
      />
    )
    const grid = view.getByRole('grid', { name: 'Questions in the market being checked' })
    const row = within(grid).getAllByRole('row')[1]
    if (!row) throw new Error('question 1 row missing')
    const cells = within(row).getAllByRole('gridcell')
    expect(cells[2]?.textContent).toBe('The search timed out. See Status')
    expect(within(cells[2] as HTMLElement).getByRole('link', { name: 'See Status' })).toBeTruthy()
    expect(cells[3]?.textContent).toBe('Not loaded')
    expect(row.textContent).not.toContain('Waiting')
  })

  it('shows the real empty state when no check is running', async () => {
    const view = render(
      <RunningScreen
        pageId={TEXTBOLT_PAGE_ID}
        samples={1}
        markets={TEXTBOLT_MARKETS}
        job={null}
        onCancel={() => undefined}
        onStart={() => undefined}
      />
    )
    const start = view.getByRole('button', { name: 'Start first check' })
    expect(view.getByRole('heading', { name: 'First check' })).toBeTruthy()
    expect(view.getByText('No check is running.')).toBeTruthy()
    expect(view.getByText(/sample per question/).textContent).toBe(
      '4 markets · 1 sample per question'
    )
    expect(start.tagName).toBe('BUTTON')
    expect(start.className).toContain('btn-primary')
    expect(start.hasAttribute('disabled')).toBe(false)
    start.focus()
    expect(document.activeElement).toBe(start)
    expect(view.queryByRole('button', { name: 'Cancel check' })).toBeNull()
    expect(view.queryByRole('heading', { name: /Checking 10 questions/ })).toBeNull()
    // View results so far sits under the header's ⋯.
    fireEvent.click(view.getByRole('button', { name: 'More actions' }))
    fireEvent.click(view.getByRole('menuitem', { name: 'View results so far' }))
    expect(window.location.hash).toBe(pageHash(TEXTBOLT_PAGE_ID, 'results'))
    window.location.hash = ''
    const results = await axe.run(view.container, PAGE_RULES)
    expect(results.violations.map((item) => item.id)).toEqual([])
  })

  it('lists every queued question at 0 of N before the first step', () => {
    const job = {
      ...textboltJob(),
      done: 0,
      total: 2,
      steps: [],
      marketIds: ['us-en'],
      markets: [{ marketId: 'us-en', done: 0, total: 2, state: 'running' as const }]
    }
    const catalog: BuyerPrompt[] = [
      {
        id: 'p1',
        position: 1,
        label: 'Alerts',
        source: 'written_by_user',
        intentStage: 'problem',
        mappedElement: '',
        enabled: true,
        variants: [
          {
            marketId: 'us-en',
            language: 'en',
            text: 'How can I send text alerts?',
            originalText: null
          }
        ]
      },
      {
        id: 'p2',
        position: 2,
        label: 'Schedule',
        source: 'written_by_user',
        intentStage: 'solution',
        mappedElement: '',
        enabled: true,
        variants: [
          {
            marketId: 'us-en',
            language: 'en',
            text: 'Is there a way to schedule a text?',
            originalText: null
          }
        ]
      },
      {
        id: 'p3',
        position: 3,
        label: 'Off',
        source: 'written_by_user',
        intentStage: 'unset',
        mappedElement: '',
        enabled: false,
        variants: [
          {
            marketId: 'us-en',
            language: 'en',
            text: 'Disabled question',
            originalText: null
          }
        ]
      }
    ]
    const view = render(
      <RunningScreen
        pageId={TEXTBOLT_PAGE_ID}
        samples={1}
        markets={TEXTBOLT_MARKETS.slice(0, 1)}
        job={job}
        promptCatalog={catalog}
        onCancel={() => undefined}
        onStart={() => undefined}
      />
    )
    const grid = view.getByRole('grid', { name: 'Questions in the market being checked' })
    // Two prompt rows plus the header row.
    expect(grid.getAttribute('aria-rowcount')).toBe('3')
    expect(view.getByText('How can I send text alerts?')).toBeTruthy()
    expect(view.getByText('Is there a way to schedule a text?')).toBeTruthy()
    expect(view.queryByText('Disabled question')).toBeNull()
    expect(view.getAllByText('Waiting').length).toBeGreaterThan(0)
    expect(view.container.textContent).toContain('0 of 2 done')
    expect(
      view.getByRole('progressbar', { name: 'Questions checked' }).getAttribute('aria-valuenow')
    ).toBe('0')
    expect(view.queryByRole('button', { name: 'Start first check' })).toBeNull()
    expect(view.queryByText('No check is running.')).toBeNull()
  })
})

describe('Page results screen', () => {
  it('uses the report labels, definitions and headline', () => {
    const results = textboltResults()
    const run = results.run
    if (!run) throw new Error('fixture has a run')
    const view = render(
      <PageResultsScreen
        pageId={TEXTBOLT_PAGE_ID}
        projectName="TextBolt"
        page={TEXTBOLT_PAGE}
        marketId="us-en"
        onMarketChange={() => undefined}
        results={results}
      />
    )
    const kpis = within(view.getByRole('region', { name: 'Headline numbers' }))
    for (const key of ['score', 'pageCited', 'aio'] as const) {
      const tile = kpis.getByText(REPORT_KPI_LABELS[key]).closest('section')
      expect(tile?.textContent).toContain(REPORT_DEFINITIONS[key])
    }
    expect(kpis.queryByText('Page cited')).toBeNull()
    expect(kpis.queryByText('AI Overview shown')).toBeNull()
    const headline = reportHeadline({
      measured: run.promptsChecked - run.errors,
      aio: run.promptsWithAio,
      cited: run.pageCited + run.otherOwnPage,
      named: results.prompts.filter((row) => row.named === true).length,
      notVisible: run.notCited
    })
    expect(headline).toMatch(/^Google shows an AI Overview for \d+ of your \d+ buyer questions\./)
    expect(view.container.querySelector('.m3-headline')?.textContent).toBe(headline)
    // Export report is under the page header's ⋯ and opens the export for this page and market.
    const head = view.container.querySelector('header.ui-head-page') as HTMLElement
    fireEvent.click(within(head).getByRole('button', { name: 'More actions' }))
    fireEvent.click(view.getByRole('menuitem', { name: 'Export report' }))
    expect(window.location.hash).toBe(
      `#/export?page=${encodeURIComponent(TEXTBOLT_PAGE_ID)}&market=us-en`
    )
  })

  it('opens a drawer whose row count is the bucket that was clicked', async () => {
    const results = textboltResults()
    const baseline = formatStamp(results.comparison[0].finishedAt)
    const saved = formatStamp(results.scope.promptSetSavedAt)
    const view = render(
      <>
        <PageResultsScreen
          pageId={TEXTBOLT_PAGE_ID}
          projectName="TextBolt"
          page={TEXTBOLT_PAGE}
          marketId="us-en"
          onMarketChange={() => undefined}
          results={results}
        />
        <div id="page-tabpanel" role="tabpanel" aria-labelledby="page-tab-results" />
      </>
    )
    expect(view.queryByRole('button', { name: 'Explain this change' })).toBeNull()
    expect(view.queryByRole('button', { name: 'What should I fix first?' })).toBeNull()
    expect(view.queryByText('Brand sentiment')).toBeNull()
    openAbout(view)
    expect(view.getByText(new RegExp(`saved ${saved}`)).textContent).toBe(`v2 · saved ${saved}`)
    closeAbout(view)
    const cited = citedCell(view, 'reddit.com, simpletexting.com, twilio.com')
    expect([...cited.querySelectorAll('.m3-instance')].map((node) => node.textContent)).toEqual([
      'reddit.com',
      'simpletexting.com'
    ])
    expect(cited.querySelector('.m3-instance-sep')?.textContent).toBe(',')
    expect(cited.querySelector('.m3-instance-line')?.textContent).toBe('reddit.com,')
    expect(cited.querySelector('.m3-instances-more')?.textContent).toBe('+1 more')
    openTab(view, 'Checks')
    expect(
      view.getByRole('button', { name: new RegExp(`Baseline · ${baseline}`) }).textContent
    ).toBe(`Baseline · ${baseline}`)
    openTab(view, 'Breakdown')
    expect(view.getAllByText(/8 of 10/).length).toBeGreaterThan(0)
    expect(view.getByText(/2 \+ 3 \+ 1 \+ 2 = 8 AI Overviews/)).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '2 questions: Cited · named' }))
    const dialog = view.getByRole('dialog')
    expect(dialog.textContent).toContain('2 questions')
    // Two prompt rows plus the header row.
    expect(within(dialog).getByRole('grid').getAttribute('aria-rowcount')).toBe('3')
    expect(within(dialog).getAllByRole('row').length).toBeGreaterThan(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.queryByRole('dialog')).toBeNull()

    fireEvent.click(view.getAllByRole('button', { name: 'Table' })[1] as HTMLButtonElement)
    const table = view.getByRole('grid', { name: /Opportunity buckets/ })
    const counts = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => Number(within(row).getAllByRole('gridcell')[1]?.textContent))
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(8)

    const excluded = render(
      <PageResultsScreen
        pageId={TEXTBOLT_PAGE_ID}
        projectName="TextBolt"
        page={TEXTBOLT_PAGE}
        marketId="us-en"
        onMarketChange={() => undefined}
        results={excludedResults()}
      />
    )
    expect(excluded.getAllByRole('tab', { name: /^Breakdown/ })[1]).toBeTruthy()
    fireEvent.click(excluded.getAllByRole('tab', { name: /^Breakdown/ })[1] as HTMLElement)
    expect(excluded.getByText(/1 \+ 0 \+ 0 \+ 0 = 1 AI Overview\./)).toBeTruthy()
    excluded.unmount()

    const axeResults = await axe.run(view.container, PAGE_RULES)
    expect(axeResults.violations.map((item) => item.id)).toEqual([])
  })

  it('renders a missing question set as version unknown', () => {
    const base = textboltResults()
    for (const version of [null, undefined, 0, 1.5, Number.NaN] as const) {
      const view = render(
        <PageResultsScreen
          pageId={TEXTBOLT_PAGE_ID}
          projectName="TextBolt"
          page={TEXTBOLT_PAGE}
          marketId="us-en"
          onMarketChange={() => undefined}
          results={{
            ...base,
            scope: {
              ...base.scope,
              promptSetVersion: version as number | null,
              promptSetSavedAt: null
            }
          }}
        />
      )
      openAbout(view)
      const term = view.getByText('Question set')
      const value = term.parentElement?.querySelector('dd')
      expect(value?.textContent).toBe('version unknown')
      expect(value?.textContent).not.toContain('v0')
      expect(value?.textContent).not.toContain('v1')
      expect(view.container.textContent).not.toContain('vNaN')
      closeAbout(view)
      openTab(view, 'Breakdown')
      fireEvent.click(view.getByRole('button', { name: /Questions checked/ }))
      expect(view.getByRole('dialog').textContent).toContain(
        'Every question in question set version unknown.'
      )
      view.unmount()
      // The drill drawer is on the URL: close it before the next render.
      window.history.replaceState(null, '', '#/')
      resetDrawersForTests()
    }
  }, 30_000)

  it('shows two cited domains, then +N more, and names the full list', () => {
    const view = render(
      <PromptGrid
        prompts={textboltResults().prompts}
        domain="textbolt.com"
        sinceLabel="Oct 5"
        checkLabel="Oct 19"
        onOpen={() => undefined}
      />
    )
    const folded = citedCell(view, 'reddit.com, simpletexting.com, twilio.com')
    expect([...folded.querySelectorAll('.m3-instance')].map((node) => node.textContent)).toEqual([
      'reddit.com',
      'simpletexting.com'
    ])
    expect(folded.querySelector('.m3-instance-sep')?.textContent).toBe(',')
    expect(folded.querySelector('.m3-instance-line')?.textContent).toBe('reddit.com,')
    expect(folded.querySelector('.m3-instances-more')?.textContent).toBe('+1 more')

    const four = citedCell(view, 'youtube.com, att.com, spiceworks.com, textmagic.com')
    expect([...four.querySelectorAll('.m3-instance')].map((node) => node.textContent)).toEqual([
      'youtube.com',
      'att.com'
    ])
    expect(four.querySelector('.m3-instances-more')?.textContent).toBe('+2 more')

    const pair = citedCell(view, 'simpletexting.com, textmagic.com')
    expect([...pair.querySelectorAll('.m3-instance')].map((node) => node.textContent)).toEqual([
      'simpletexting.com',
      'textmagic.com'
    ])
    expect([...pair.querySelectorAll('.m3-instance-line')].map((node) => node.textContent)).toEqual(
      ['simpletexting.com,', 'textmagic.com']
    )
    expect(pair.querySelector('.m3-instances-more')).toBeNull()
  })

  it('virtualizes 2,000 question rows in under 300 ms', () => {
    const prompts = manyPrompts(2000)
    const started = performance.now()
    const view = render(
      <PromptGrid
        prompts={prompts}
        domain="textbolt.com"
        sinceLabel="Oct 5"
        checkLabel="Oct 19"
        onOpen={() => undefined}
      />
    )
    const elapsed = performance.now() - started
    const painted = view.container.querySelectorAll('[data-row]').length
    expect(painted).toBeGreaterThan(0)
    expect(painted).toBeLessThan(40)
    expect(elapsed).toBeLessThan(300)
  })
})

describe('summary and question emphasis', () => {
  it('renders an engine summary and question text without raw asterisks', () => {
    const results = textboltResults()
    const first = results.prompts[0]
    if (!first) throw new Error('missing question')
    const headline =
      '**5** AI Overviews shown, **2** page cited, **0** other own page, **1** named without a link, **0** invisible.'
    const body =
      '**Citation change:** the rate moved.\n\nCurrent citation rate: 40% (2 of 5 AI Overviews shown).'
    const view = render(
      <PageResultsScreen
        pageId={TEXTBOLT_PAGE_ID}
        projectName="TextBolt"
        page={TEXTBOLT_PAGE}
        marketId="us-en"
        onMarketChange={() => undefined}
        results={{
          ...results,
          runSummary: { headline, body },
          prompts: [{ ...first, text: 'How do I **send** alerts?' }, ...results.prompts.slice(1)]
        }}
      />
    )
    const summary = view.getByRole('region', { name: 'Summary' })
    expect([...summary.querySelectorAll('strong')].map((node) => node.textContent)).toEqual([
      '5',
      '2',
      '0',
      '1',
      '0',
      'Citation change:'
    ])
    expect(summary.textContent).toContain('5 AI Overviews shown, 2 page cited')
    expect(summary.textContent).not.toContain('**')
    expect(summary.querySelector('script')).toBeNull()
    expect(summary.querySelector('img')).toBeNull()
    const prompt = view.getByTitle('How do I send alerts?')
    expect(prompt.querySelector('strong')?.textContent).toBe('send')
    expect(prompt.textContent).not.toContain('**')
    fireEvent.click(prompt)
    const detail = promptHash(TEXTBOLT_PAGE_ID, first.promptId, {
      marketId: results.run?.marketId ?? null
    })
    expect(window.location.hash).toBe(detail)
    expect(view.queryByRole('dialog')).toBeNull()
    openTab(view, 'Breakdown')
    fireEvent.click(view.getByRole('button', { name: /Questions checked/ }))
    const dialog = view.getByRole('dialog')
    const link = within(dialog).getByRole('link', { name: /^Open question 1:/ })
    expect(link.getAttribute('href')).toBe(detail)
    expect(link.textContent).not.toContain('**')
  })

  it('renders running question text without raw asterisks', () => {
    const job = textboltJob()
    const steps = job.steps.map((step) =>
      step.promptId === 'austin-1' ? { ...step, promptText: 'How do I **send** alerts?' } : step
    )
    const view = render(
      <RunningScreen
        pageId={TEXTBOLT_PAGE_ID}
        samples={1}
        markets={TEXTBOLT_MARKETS}
        job={{ ...job, steps }}
        onCancel={() => undefined}
        onStart={() => undefined}
      />
    )
    const strong = view.container.querySelector('strong')
    expect(strong?.textContent).toBe('send')
    expect(view.container.textContent).toContain('How do I send alerts?')
    expect(view.container.textContent).not.toContain('**')
  })
})

function manyPrompts(count: number): PromptCheckRow[] {
  return Array.from({ length: count }, (_, index) => ({
    promptId: `p-${index}`,
    promptPosition: index + 1,
    label: `Label ${index}`,
    text: `Question text ${index}`,
    source: 'written_by_user',
    intentStage: 'problem',
    status: 'not_cited',
    frequency: { matching: 1, samples: 1 },
    position: null,
    citedUrl: null,
    references: [],
    previousStatus: null,
    previousPosition: null,
    wrongPageCited: false,
    named: false,
    movement: 'unchanged',
    coverage: 'partial',
    action: 'None',
    aioSummary: null,
    checkedAt: '2026-10-19T09:14:00.000Z'
  }))
}
