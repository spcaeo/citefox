// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it } from 'vitest'
import type { FixMarketOutcome, LoggedFix, PromptCheckStatus } from '@shared/domain'
import { textboltResults } from '../m3/fixtures'
import type { FixesSource } from '../progress/client'
import { fix, outcome } from '../progress/fixtures'
import { mockVisibilitySource } from './mocks'
import { runIdsDrill } from './progressDrills'
import { ScoresScreen } from './ScoresScreen'

afterEach(() => {
  cleanup()
  // Progress keeps its tab and chart/table view in the route (`?view=`, `?show=`).
  window.history.replaceState(null, '', '#/')
})

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing test value')
  return value
}

function targeted(
  id: string,
  n: number,
  result: FixMarketOutcome['prompts'][number]['result'],
  after: PromptCheckStatus
): FixMarketOutcome['prompts'][number] {
  return {
    promptId: id,
    promptPosition: n,
    label: `Question ${n}`,
    text: `Question ${n}?`,
    before: { status: 'not_cited', position: null },
    after: { status: after, position: after === 'page_cited' ? 2 : null },
    result
  }
}

/** Fix 1 in the shown market (its follow-up is the Oct 5 check); Fix 2 only in another market. */
const FIXES: readonly LoggedFix[] = [
  fix({
    id: 'fix-1',
    number: 1,
    promptIds: ['tb-2', 'tb-3', 'gone'],
    marketIds: ['us'],
    markets: [
      outcome({
        marketId: 'us',
        beforeRunId: 'run-baseline',
        beforeAt: '2026-09-21T09:10:00.000Z',
        afterRunId: 'run-previous',
        afterAt: '2026-10-05T09:10:00.000Z',
        prompts: [
          targeted('tb-2', 2, 'worked', 'page_cited'),
          targeted('tb-3', 3, 'no_change', 'not_cited'),
          targeted('tb-4', 4, 'got_worse', 'not_cited')
        ],
        others: {
          total: 7,
          moved: 2,
          promptIds: ['tb-5', 'tb-6'],
          fromRunId: 'run-baseline',
          toRunId: 'run-previous'
        }
      })
    ]
  }),
  fix({
    id: 'fix-2',
    number: 2,
    description: 'Rewrote the intro',
    promptIds: ['tb-7'],
    marketIds: ['us-en'],
    markets: [
      outcome({
        marketId: 'us-en',
        afterRunId: 'run-baseline',
        others: {
          total: 9,
          moved: 3,
          promptIds: ['tb-5', 'tb-6', 'gone-2'],
          fromRunId: 'run-baseline',
          toRunId: 'run-baseline'
        }
      })
    ]
  })
]

function fixesSource(): FixesSource {
  const never = (): Promise<never> => Promise.reject(new Error('not in this test'))
  return {
    'fixes:list': async (request) => ({ pageId: request.pageId, fixes: FIXES, nextFixNumber: 3 }),
    'fixes:preview': never,
    'fixes:create': never,
    'fixes:runFollowUp': never,
    'fixes:delete': never,
    'prompts:list': never
  }
}

function renderScores(runId: string | null = null): ReturnType<typeof render> {
  return render(
    <ScoresScreen
      source={mockVisibilitySource()}
      fixesSource={fixesSource()}
      projectId="textbolt"
      pageId="alerts"
      marketId="us"
      runId={runId}
      now={() => new Date('2026-10-20T12:00:00.000Z')}
    />
  )
}

/** Data rows in the drawer: the grid's row count includes its header row. */
function rowCount(dialog: HTMLElement): number {
  return Number(required(dialog.querySelector('[aria-rowcount]')).getAttribute('aria-rowcount')) - 1
}

function figureOf(button: HTMLElement): number {
  const id = required(button.getAttribute('data-nfr-drill'))
  const figure = required(document.querySelector(`[data-nfr-figure="${id}"]`))
  return Number(figure.textContent)
}

/** Opens a Progress tab ("Overview", "Fixes" or "Prompts"). */
async function openTab(view: ReturnType<typeof render>, name: string): Promise<void> {
  fireEvent.click(await view.findByRole('tab', { name: new RegExp(`^${name}`) }))
}

/** Opens the Fixes tab and shows Fix N under the grid. */
async function showFix(view: ReturnType<typeof render>, number: number): Promise<HTMLElement> {
  await openTab(view, 'Fixes')
  const grid = await view.findByRole('grid', { name: 'Logged fixes' })
  fireEvent.click(within(grid).getByText(`Fix ${number}`))
  return view.findByRole('article', { name: new RegExp(`^Fix ${number} · `) })
}

function closeDrawer(): void {
  fireEvent.keyDown(document, { key: 'Escape' })
}

describe('runIdsDrill (NFR-14)', () => {
  const results = textboltResults()
  const context = {
    pageId: 'alerts',
    marketId: 'us',
    runId: 'run-9',
    marketLabel: 'US · EN',
    meta: new Map([['gone', { n: 12, label: 'An old question' }]])
  }

  it('lists question rows when every id is in the check', () => {
    const drill = runIdsDrill(
      { id: 'x', title: 'X', description: '' },
      ['tb-1', 'tb-2'],
      results,
      context
    )
    expect(drill.kind).toBe('prompts')
    expect(drill.kind === 'prompts' ? drill.rows.length : -1).toBe(2)
  })

  it('never drops an id missing from the check', () => {
    const drill = runIdsDrill(
      { id: 'x', title: 'X', description: '' },
      ['tb-1', 'gone', 'tb-1'],
      results,
      context
    )
    if (drill.kind !== 'items') throw new Error('expected an item drill')
    expect(drill.items).toHaveLength(2)
    const gone = required(drill.items[1])
    expect(gone.primary).toBe('12. An old question')
    expect(gone.secondary).toBe('No result in this check')
    expect(gone.target).toEqual({
      kind: 'prompt',
      pageId: 'alerts',
      promptId: 'gone',
      marketId: 'us',
      runId: null
    })
    expect(required(drill.items[0]).target).toMatchObject({ runId: 'run-9', marketId: 'us' })
  })
})

describe('Progress drills', () => {
  it('has no axe violations with every drill control drawn', async () => {
    const view = renderScores()
    await showFix(view, 1)
    const results = await axe.run(view.container, {
      rules: {
        'document-title': { enabled: false },
        'html-has-lang': { enabled: false },
        'landmark-one-main': { enabled: false },
        region: { enabled: false }
      }
    })
    expect(results.violations.map((item) => `${item.id}: ${item.nodes[0]?.html ?? ''}`)).toEqual([])
  })

  it('a fix marker opens that fix in its drawer, over the chart', async () => {
    const view = renderScores()
    const marker = await view.findByRole('button', { name: /Your fix: Fix 1 · / })
    expect(marker.textContent).toBe('1')
    fireEvent.click(marker)
    expect(window.location.hash).toContain('fix=fix-1')
  })

  it('the fix verdict opens the worked questions from the follow-up check, dated that check', async () => {
    const view = renderScores()
    const card = await showFix(view, 1)
    expect(card.getAttribute('aria-label')).toMatch(/Fix 1 · Added 5 FAQs/)
    const verdict = within(card).getByRole('button', { name: /Partly worked · 1 of 3 questions/ })
    expect(figureOf(verdict)).toBe(1)
    fireEvent.click(verdict)
    const dialog = await view.findByRole('dialog')
    expect(rowCount(dialog)).toBe(1)
    expect(dialog.textContent).toMatch(/Oct 5(, 2026)?, \d{1,2}:\d{2}/)
    const link = within(dialog).getByRole('link', { name: /Open question 2/ })
    expect(link.getAttribute('href')).toBe('#/pages/alerts/prompt/tb-2?market=us&run=run-previous')
    closeDrawer()
  })

  it('fix card links open Question detail at the before and after checks', async () => {
    const view = renderScores()
    const card = await showFix(view, 1)
    expect(card.id).toBe('fix-1')
    const result = within(card).getByRole('link', { name: /^Worked: question 2/ })
    expect(result.getAttribute('href')).toBe(
      '#/pages/alerts/prompt/tb-2?market=us&run=run-previous'
    )
    const before = within(card).getAllByRole('link', { name: 'Not cited' })[0]
    expect(required(before).getAttribute('href')).toContain('run=run-baseline')
    const position = within(card).getByRole('link', { name: /Question 2, open its latest result/ })
    expect(position.getAttribute('href')).toBe('#/pages/alerts/prompt/tb-2?market=us')
  })

  it('the comparison count loads another market’s check and lists exactly its questions', async () => {
    const view = renderScores()
    const card = await showFix(view, 2)
    expect(card.getAttribute('aria-label')).toMatch(/Fix 2 · Rewrote the intro/)
    const others = within(card).getByRole('button', { name: /3 of the 9 questions/ })
    expect(figureOf(others)).toBe(3)
    fireEvent.click(others)
    const dialog = await view.findByRole('dialog')
    expect(rowCount(dialog)).toBe(3)
    expect(dialog.textContent).toMatch(/Sep 21(, 2026)?, \d{1,2}:\d{2}/)
    closeDrawer()
  })

  it('a selected older point drills that check, dated that check, and links rows to it', async () => {
    const view = renderScores('run-baseline')
    const cited = await view.findByRole('button', { name: /^Page cited in \d+ of .* on Sep 21/ })
    cited.focus()
    fireEvent.click(cited)
    const dialog = await view.findByRole('dialog')
    expect(rowCount(dialog)).toBe(figureOf(cited))
    expect(dialog.textContent).toMatch(/Sep 21(, 2026)?, \d{1,2}:\d{2}/)
    for (const link of within(dialog).getAllByRole('link', { name: /^Open question/ })) {
      expect(link.getAttribute('href')).toContain('market=us&run=run-baseline')
    }
    closeDrawer()
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(cited)
  })

  it(
    'every marked count opens a drawer with exactly that many rows',
    { timeout: 30_000 },
    async () => {
      const view = renderScores()
      await view.findByRole('heading', { name: 'How often overviews cite this page' })
      fireEvent.click(view.getByRole('button', { name: 'Table' }))
      let tested = 0
      for (const tab of ['Overview', 'Fixes', 'Questions']) {
        await openTab(view, tab)
        if (tab === 'Fixes') await showFix(view, 1)
        const buttons = [...view.container.querySelectorAll<HTMLElement>('button[data-nfr-drill]')]
        for (const button of buttons) {
          const expected = figureOf(button)
          fireEvent.click(button)
          const dialog = await view.findByRole('dialog')
          expect(rowCount(dialog), button.getAttribute('data-nfr-drill') ?? '').toBe(expected)
          closeDrawer()
          await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
          tested += 1
        }
      }
      expect(tested).toBeGreaterThan(10)
    }
  )

  it('question history links each result to its check and fix marks jump to the card', async () => {
    const view = renderScores()
    await openTab(view, 'Questions')
    const history = (
      await view.findByRole('heading', { name: 'Each question across checks' })
    ).closest('section')
    const section = required(history)
    // The buyer's full question shows, not only the internal label.
    const first = required(textboltResults().prompts.find((row) => row.promptId === 'tb-1'))
    expect(section.textContent).toContain(first.text.split('**').join(''))
    const prompt = within(section).getAllByRole('link', { name: /^Question 1,/ })[0]
    expect(required(prompt).getAttribute('href')).toBe('#/pages/alerts/prompt/tb-1?market=us')
    const cell = within(section).getAllByRole('link', { name: /^Question 1 on Sep 21/ })[0]
    expect(required(cell).getAttribute('href')).toBe(
      '#/pages/alerts/prompt/tb-1?market=us&run=run-baseline'
    )
    const mark = within(section).getAllByRole('button', {
      name: /Fix 1 · Targeted, go to the fix/
    })[0]
    fireEvent.click(required(mark))
    await waitFor(() => expect(document.activeElement?.id).toBe('fix-1'))
    expect(view.getByRole('tab', { name: /^Fixes/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('all markets: names open that market and the checks count lists each check', async () => {
    const view = render(
      <ScoresScreen
        source={mockVisibilitySource()}
        fixesSource={fixesSource()}
        projectId="textbolt"
        pageId="alerts"
        marketId="us"
        markets={[
          {
            id: 'us',
            country: 'US',
            language: 'en',
            location: null,
            device: 'desktop',
            localWording: false,
            serpapiLocation: null
          }
        ]}
      />
    )
    const name = await view.findByRole('link', { name: /show Progress in this market/ })
    expect(name.getAttribute('href')).toBe('#/pages/alerts/progress?market=us')
    const checks = view.getByRole('button', { name: /3 checks/ })
    fireEvent.click(checks)
    const dialog = await view.findByRole('dialog')
    expect(rowCount(dialog)).toBe(3)
    closeDrawer()
    const score = view.getAllByRole('button', {
      name: /visibility score .* show the questions behind it/
    })[0]
    fireEvent.click(required(score))
    const scored = await view.findByRole('dialog')
    expect(rowCount(scored)).toBeGreaterThan(0)
  })
})
