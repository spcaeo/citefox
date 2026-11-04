// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PageResults } from '@shared/domain'
import { pageHash, promptHash } from '../shell/routes'
import { TEXTBOLT_PAGE, TEXTBOLT_PAGE_ID, textboltResults } from './fixtures'
import { ownLinkCount } from './model'
import { PageResultsScreen } from './PageResultsScreen'

const RULES = {
  rules: {
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    'landmark-one-main': { enabled: false },
    region: { enabled: false }
  }
}

const TABS = ['Questions', 'Breakdown', 'Who gets cited', 'Top actions', 'Checks'] as const

function screen(
  results: PageResults = textboltResults(),
  runId: string | null = null
): ReturnType<typeof render> {
  return render(
    <PageResultsScreen
      pageId={TEXTBOLT_PAGE_ID}
      projectName="TextBolt"
      page={TEXTBOLT_PAGE}
      marketId="us-en"
      runId={runId}
      results={results}
      chrome={false}
    />
  )
}

function openTab(view: ReturnType<typeof render>, name: (typeof TABS)[number]): void {
  const tablist = view.getByRole('tablist', { name: 'Results sections' })
  fireEvent.click(within(tablist).getByRole('tab', { name: new RegExp(`^${name}`) }))
}

/**
 * Data rows in the drawer: the grid's row count includes its header row. An
 * empty drawer draws no grid, only its "No … behind this number" line.
 */
function rowsIn(dialog: HTMLElement): number {
  const grid = within(dialog).queryByRole('grid')
  return grid ? Number(grid.getAttribute('aria-rowcount')) - 1 : 0
}

/** Opens the `⋯` menu of the row named `rowName` in `grid` and picks `item`. */
function pickRowAction(grid: HTMLElement, rowName: string, item: RegExp): void {
  fireEvent.click(within(grid).getByRole('button', { name: `Actions for ${rowName}` }))
  fireEvent.click(within(document.body).getByRole('menuitem', { name: item }))
}

beforeEach(() => {
  window.location.hash = ''
  window.sessionStorage.clear()
})
afterEach(() => cleanup())

describe('Results drill-downs', () => {
  it('every marked count on every tab opens a drawer whose total equals the number (NFR-14)', () => {
    const view = screen()
    const seen = new Set<string>()
    for (const tab of TABS) {
      openTab(view, tab)
      const ids = new Set(
        [...view.container.querySelectorAll('[data-nfr-drill]')].map(
          (node) => node.getAttribute('data-nfr-drill') ?? ''
        )
      )
      for (const id of ids) {
        seen.add(id)
        const figure = view.container.querySelector(`[data-nfr-figure="${CSS.escape(id)}"]`)
        expect(figure, `figure for ${id} on ${tab}`).not.toBeNull()
        const button = view.container.querySelector<HTMLElement>(
          `[data-nfr-drill="${CSS.escape(id)}"]`
        )
        fireEvent.click(button as HTMLElement)
        const dialog = view.getByRole('dialog')
        expect(rowsIn(dialog), id).toBe(Number(figure?.textContent))
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(view.queryByRole('dialog')).toBeNull()
      }
    }
    expect(seen.size).toBeGreaterThan(20)
  }, 30_000)

  it('the headline sentence numbers and the opportunity bar segments are buttons', () => {
    const results = textboltResults()
    const view = screen({ ...results, runSummary: null })
    const summary = view.getByRole('region', { name: 'Summary' })
    expect(within(summary).getAllByRole('button').length).toBeGreaterThanOrEqual(5)
    openTab(view, 'Breakdown')
    const bar = view.getByRole('group', { name: /Opportunities bar/ })
    const segments = within(bar).getAllByRole('button')
    expect(segments.length).toBe(results.buckets.filter((bucket) => bucket.count > 0).length)
    fireEvent.click(segments[0] as HTMLElement)
    expect(view.getByRole('dialog').textContent).toContain('Cited · named: already winning')
  })

  it('the links tile lists links, not questions, and its parts split it', () => {
    const results = textboltResults()
    const links = results.prompts.reduce((sum, row) => sum + ownLinkCount(row.references), 0)
    const view = screen(results)
    const tile = view.container.querySelector<HTMLElement>('[data-nfr-drill="kpi:links"]')
    expect(tile?.querySelector('[data-nfr-headline="links"]')?.textContent).toBe(String(links))
    fireEvent.click(tile as HTMLElement)
    const dialog = view.getByRole('dialog')
    expect(
      within(dialog).getByRole('heading', { name: new RegExp(`${links} links$`) })
    ).toBeTruthy()
    expect(rowsIn(dialog)).toBe(links)
  })

  it('question grid cells and row actions open their own details', () => {
    const results = textboltResults()
    const view = screen(results)
    const grid = view.getByRole('grid', { name: /Buyer questions from the/ })
    const first = results.prompts[0]
    if (!first) throw new Error('missing question')
    const detail = promptHash(TEXTBOLT_PAGE_ID, first.promptId, {
      marketId: results.run?.marketId ?? null
    })
    const opener = within(grid).getAllByRole('link', { name: /open question 1$/ })[0]
    expect(opener?.getAttribute('href')).toBe(detail)

    const withLinks = results.prompts.find((row) => ownLinkCount(row.references) > 0)
    if (withLinks) {
      const count = ownLinkCount(withLinks.references)
      pickRowAction(
        grid,
        `question ${withLinks.promptPosition}`,
        new RegExp(`^Show ${count} textbolt.com links?`)
      )
      expect(rowsIn(view.getByRole('dialog'))).toBe(count)
      fireEvent.keyDown(document, { key: 'Escape' })
    }
    const covered = results.prompts.find((row) => row.coverage !== null)
    if (covered) {
      pickRowAction(grid, `question ${covered.promptPosition}`, /^Open in Content gaps/)
      expect(window.location.hash).toBe(
        pageHash(TEXTBOLT_PAGE_ID, 'gaps', { filter: `row:${covered.promptId}` })
      )
    }
    const acted = results.prompts.find((row) => row.action)
    if (acted) {
      pickRowAction(grid, `question ${acted.promptPosition}`, /^Plan the recommended fix/)
      expect(window.location.hash).toContain('drawer=fix&fix=new')
      expect(window.location.hash).toContain(`fix.prompts=${acted.promptId}`)
    }
  })

  it('the stage filter narrows the grid and groups follow the outcome', async () => {
    const results = textboltResults()
    const view = screen(results)
    const section = view.getByRole('region', { name: 'Questions' })
    const stages = within(section).getByRole('group', { name: 'Buyer stage' })
    const problem = within(stages).getByRole('button', { name: /^Problem/ })
    fireEvent.click(problem)
    // The stage is on the URL, so a copied link opens the same list.
    await waitFor(() => expect(window.location.hash).toContain('pstage=problem'))
    const grid = view.getByRole('grid', { name: /Buyer questions from the/ })
    const expected = results.prompts.filter((row) => row.intentStage === 'problem').length
    await waitFor(() => expect(grid.querySelectorAll('.ui-lg-row').length).toBe(expected))
    const groups = [...grid.querySelectorAll('.ui-lg-group')].map((node) => node.textContent ?? '')
    expect(groups.length).toBeGreaterThan(0)
  })

  it('a click on a question row opens Question detail in that market', () => {
    const results = textboltResults()
    const view = screen(results)
    const grid = view.getByRole('grid', { name: /Buyer questions from the/ })
    const row = grid.querySelector<HTMLElement>('.ui-lg-row')
    const label = row?.querySelector('.m3-pg-n')?.textContent ?? ''
    const clicked = results.prompts.find((item) => String(item.promptPosition) === label)
    fireEvent.click(row?.querySelector('.m3-pg-text') as HTMLElement)
    expect(window.location.hash).toContain(`/prompt/${clicked?.promptId ?? 'missing'}`)
  })

  it('a pinned check keeps its run on question links, and earlier checks open their results', () => {
    const results = textboltResults()
    const view = screen(results, 'run-old')
    const grid = view.getByRole('grid', { name: /Buyer questions from the/ })
    const opener = within(grid).getAllByRole('link', { name: /open question \d+$/ })[0]
    expect(opener?.getAttribute('href')).toContain('run=run-old')
    const previous = results.comparison.find((column) => column.which === 'previous')
    if (previous?.runId) {
      openTab(view, 'Checks')
      const links = [...view.container.querySelectorAll<HTMLAnchorElement>('#m3-baseline a')]
      expect(
        links.some((link) => link.getAttribute('href')?.includes(`run=${previous.runId}`))
      ).toBe(true)
    }
  })

  it('leaderboard types filter, and every tab has no axe violations', async () => {
    const results = textboltResults()
    const view = screen(results)
    expect((await axe.run(view.container, RULES)).violations).toEqual([])
    openTab(view, 'Who gets cited')
    const lead = view.getByRole('grid', { name: 'Domains cited in the AI Overviews' })
    const types = view.getByRole('group', { name: 'Type' })
    const observed = results.leaderboard.filter((row) => row.badge === 'observed').length
    const button = within(types).queryByRole('button', { name: /^Observed/ })
    if (button) {
      fireEvent.click(button)
      expect(lead.querySelectorAll('.ui-lg-row').length).toBe(Math.min(observed, 10))
    }
    for (const tab of TABS.slice(1)) {
      openTab(view, tab)
      expect((await axe.run(view.container, RULES)).violations, tab).toEqual([])
    }
  }, 30_000)

  it('keeps the open tab in the URL, so Back and a reload land on it', () => {
    const view = screen()
    openTab(view, 'Top actions')
    expect(window.location.hash).toContain('view=actions')
    cleanup()
    const again = screen()
    const tablist = again.getByRole('tablist', { name: 'Results sections' })
    expect(
      within(tablist)
        .getByRole('tab', { name: /^Top actions/ })
        .getAttribute('aria-selected')
    ).toBe('true')
  })
})
