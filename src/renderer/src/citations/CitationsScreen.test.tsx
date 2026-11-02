// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it } from 'vitest'
import type { Market } from '@shared/domain'
import type {
  CitationReview,
  CitedOverviewRef,
  CitedPageRow,
  CitedPagesData,
  CitedQuestionRef,
  ProjectDetail,
  RestoreCompetitorsRequest,
  SaveCompetitorRequest
} from '@shared/ipc'
import type { AllPagesSource } from '../allPages/source'
import { expectEveryDrillMatches } from '../drill/count.test-helper'
import { CitationsSection } from '../shell/CitationsSection'
import { projectSearches } from '../fixes/searchFixtures'
import { hideUndo } from '../ui'
import { UndoToastHost } from '../ui/UndoToast'
import { resetScreenViewMemory } from '../ui/useScreenView'
import type { CitationsSource } from './source'

const US: Market = {
  id: 'mkt-us',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}
const UK: Market = { ...US, id: 'mkt-uk', country: 'UK' }

const PROJECT = {
  id: 'proj-1',
  name: 'TextBolt',
  domain: 'textbolt.com',
  markets: [US, UK]
} as unknown as ProjectDetail

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
  hideUndo()
  resetScreenViewMemory()
  window.location.hash = ''
})

const PROMPTS: Readonly<Record<string, string>> = {
  'prompt-1': 'How do I alert the crew?',
  'prompt-2': 'Which plan covers scheduled texts?'
}

function question(promptId: string, marketIds: string[], position: number): CitedQuestionRef {
  return {
    id: `page-1|${promptId}`,
    pageId: 'page-1',
    pageKind: 'page',
    pageLabel: 'Alerts',
    promptId,
    promptLabel: promptId,
    promptText: PROMPTS[promptId] ?? promptId,
    marketId: marketIds[0] ?? 'mkt-us',
    runId: `run-${marketIds[0] === 'mkt-uk' ? 'uk' : 'us'}`,
    marketIds,
    position
  }
}

function overview(promptId: string, marketId: string, position: number): CitedOverviewRef {
  const run = `run-${marketId === 'mkt-uk' ? 'uk' : 'us'}`
  return {
    id: `${run}|${promptId}`,
    questionId: `page-1|${promptId}`,
    marketId,
    runId: run,
    position
  }
}

function row(
  patch: Partial<CitedPageRow> & Pick<CitedPageRow, 'id' | 'url' | 'domain'>
): CitedPageRow {
  return {
    title: null,
    domainId: `d-${patch.domain}`,
    whose: 'other',
    competitor: null,
    marketIds: ['mkt-us'],
    questions: [],
    overviews: [],
    ...patch
  }
}

function data(rows?: CitedPageRow[]): CitedPagesData {
  return {
    projectId: 'proj-1',
    ownDomain: 'textbolt.com',
    checks: 2,
    questions: 2,
    checkedAt: '2026-10-19T12:00:00.000Z',
    rows: rows ?? [
      row({
        id: 'sown',
        url: 'https://textbolt.com/blog/alerts/',
        title: 'Alerts',
        domain: 'textbolt.com',
        whose: 'yours',
        marketIds: ['mkt-us', 'mkt-uk'],
        questions: [question('prompt-1', ['mkt-us', 'mkt-uk'], 2)],
        overviews: [overview('prompt-1', 'mkt-us', 2), overview('prompt-1', 'mkt-uk', 3)]
      }),
      row({
        id: 'scomp',
        url: 'https://simpletexting.com/blog/text-employees/',
        domain: 'simpletexting.com',
        whose: 'competitor',
        competitor: 'SimpleTexting',
        questions: [question('prompt-1', ['mkt-us'], 1), question('prompt-2', ['mkt-us'], 1)],
        overviews: [overview('prompt-1', 'mkt-us', 1), overview('prompt-2', 'mkt-us', 1)]
      }),
      row({
        id: 'sg2a',
        url: 'https://www.g2.com/categories/sms',
        title: 'Best SMS software',
        domain: 'g2.com',
        questions: [question('prompt-1', ['mkt-us'], 4)],
        overviews: [overview('prompt-1', 'mkt-us', 4)]
      }),
      row({
        id: 'sg2b',
        url: 'https://www.g2.com/compare/textbolt-vs-simpletexting',
        domain: 'g2.com',
        questions: [question('prompt-1', ['mkt-us'], 5), question('prompt-2', ['mkt-us'], 3)],
        overviews: [overview('prompt-1', 'mkt-us', 5), overview('prompt-2', 'mkt-us', 3)]
      })
    ]
  }
}

const EMPTY_REVIEW: CitationReview = { wrongPage: [], wrongPagePages: 0, untracked: [] }

interface Calls {
  loads: number
  saves: SaveCompetitorRequest[]
  restores: RestoreCompetitorsRequest[]
}

function sources(
  answer: CitedPagesData | Error = data(),
  review: CitationReview = EMPTY_REVIEW
): { source: AllPagesSource; cited: CitationsSource; calls: Calls } {
  const calls: Calls = { loads: 0, saves: [], restores: [] }
  const cited: CitationsSource = {
    'fixes:searches': () => Promise.resolve(projectSearches()),
    'allpages:citedPages': () => {
      calls.loads += 1
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
    },
    'competitors:save': (request) => {
      calls.saves.push(request)
      return Promise.resolve({ competitor: null, names: [request.name], undoToken: 'undo-1' })
    },
    'competitors:restore': (request) => {
      calls.restores.push(request)
      return Promise.resolve({ projectId: 'proj-1', competitors: [], products: [] })
    }
  }
  const source = { citations: () => Promise.resolve(review) } as unknown as AllPagesSource
  return { source, cited, calls }
}

function screen(
  answer?: CitedPagesData | Error,
  review?: CitationReview
): ReturnType<typeof sources> & { view: ReturnType<typeof render> } {
  const made = sources(answer, review)
  const view = render(
    <>
      <CitationsSection project={PROJECT} source={made.source} cited={made.cited} />
      <UndoToastHost />
    </>
  )
  return { view, ...made }
}

describe('Citations (project)', () => {
  it('lists every cited page with whose it is, most overviews first', async () => {
    window.location.hash = '#/citations?view=list'
    const { view } = screen()
    const grid = await view.findByRole('grid', { name: 'Cited pages' })
    const rows = within(grid).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(4)
    expect(rows[0]?.textContent).toContain('Alerts')
    expect(rows[0]?.textContent).toContain('Yours')
    expect(grid.textContent).toContain('SimpleTexting')
    expect(grid.textContent).toContain('Other')
    // A page with no title shows its address, with Copy and Open.
    expect(
      within(grid).getByRole('button', { name: 'Copy simpletexting.com/blog/text-employees/' })
    ).toBeTruthy()
    expect(view.queryByText(/From 2 checks/)).toBeNull()
    // The Whose filter counts each kind.
    const filter = view.getByRole('group', { name: 'Whose' })
    expect(filter.textContent).toMatch(/All\s*4/)
    expect(filter.textContent).toMatch(/Yours\s*1/)
    expect(filter.textContent).toMatch(/Competitors\s*1/)
    expect(filter.textContent).toMatch(/Others\s*2/)
    // Nothing to review: no "Needs review" part.
    expect(view.queryByRole('heading', { name: /^Needs review/ })).toBeNull()
    const results = await axe.run(view.container, AXE_RULES)
    expect(results.violations.map((item) => item.id)).toEqual([])
  })

  it('keeps the Whose filter, search and sort in the URL', async () => {
    window.location.hash = '#/citations?view=list'
    const { view } = screen()
    const grid = await view.findByRole('grid', { name: 'Cited pages' })
    const filter = view.getByRole('group', { name: 'Whose' })
    fireEvent.click(within(filter).getByRole('button', { name: /Others/ }))
    await waitFor(() => expect(window.location.hash).toBe('#/citations?view=list&cit.whose=other'))
    await waitFor(() => expect(within(grid).getAllByRole('row')).toHaveLength(3))
    fireEvent.change(view.getByRole('searchbox'), { target: { value: 'compare' } })
    await waitFor(() => expect(window.location.hash).toContain('cit.q=compare'))
    await waitFor(() => expect(within(grid).getAllByRole('row')).toHaveLength(2))
    fireEvent.click(within(grid).getByRole('button', { name: /^Searches/ }))
    await waitFor(() => expect(window.location.hash).toContain('cit.sort=questions'))
  })

  it('opens from a copied link with the filter and search applied', async () => {
    window.location.hash = '#/citations?view=list&cit.whose=competitor'
    const { view } = screen()
    const grid = await view.findByRole('grid', { name: 'Cited pages' })
    await waitFor(() => expect(within(grid).getAllByRole('row')).toHaveLength(2))
    expect(grid.textContent).toContain('SimpleTexting')
  })

  it('groups the same rows by domain, counting a shared overview once', async () => {
    window.location.hash = '#/citations?view=list'
    const { view } = screen()
    await view.findByRole('grid', { name: 'Cited pages' })
    fireEvent.click(view.getByRole('button', { name: 'Domains' }))
    await waitFor(() => expect(window.location.hash).toBe('#/citations?view=list&cit.by=domains'))
    const grid = await view.findByRole('grid', { name: 'Cited domains' })
    const g2 = within(grid)
      .getAllByRole('row')
      .find((line) => line.textContent?.includes('g2.com'))
    expect(g2).toBeTruthy()
    const line = within(g2 as HTMLElement)
    expect(line.getByRole('button', { name: '2 pages cited on g2.com' })).toBeTruthy()
    expect(line.getByRole('button', { name: '2 searches citing g2.com' })).toBeTruthy()
    // Both pages are in run-us|prompt-1's overview: it counts once.
    expect(line.getByRole('button', { name: '2 AI Overviews citing g2.com' })).toBeTruthy()
    expect(view.getByRole('group', { name: 'Whose' }).textContent).toMatch(/All\s*3/)
  })

  it('expands a row to the questions that cited it, each linking to its question detail', async () => {
    window.location.hash = '#/citations?view=list'
    const { view } = screen()
    const grid = await view.findByRole('grid', { name: 'Cited pages' })
    // An untitled page is named by its address.
    fireEvent.click(
      within(grid).getByRole('button', {
        name: 'Show the searches citing simpletexting.com/blog/text-employees/'
      })
    )
    await waitFor(() => expect(window.location.hash).toBe('#/citations?view=list&cit.open=scomp'))
    const list = await view.findByRole('list', { name: 'Searches citing it' })
    const links = within(list).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      'How do I alert the crew?',
      'Which plan covers scheduled texts?'
    ])
    expect(links[0]?.getAttribute('href')).toContain('#/pages/page-1/prompt/prompt-1')
    expect(links[0]?.getAttribute('href')).toContain('run-us')
  })

  it('opens the row named in the URL', async () => {
    window.location.hash = '#/citations?view=list&cit.open=sown'
    const { view } = screen()
    const list = await view.findByRole('list', { name: 'Searches citing it' })
    expect(within(list).getByText(/🇺🇸 US · EN, 🇬🇧 UK · EN · best #2/)).toBeTruthy()
  })

  it('offers ✦ Draft a pitch on another site’s page only where a competitor is cited and you are not', async () => {
    window.location.hash = '#/citations?view=list&cit.open=sg2b'
    const { view } = screen()
    const list = await view.findByRole('list', { name: 'Searches citing it' })
    // prompt-1's overview cites you too; prompt-2's cites SimpleTexting and not you.
    const pitch = within(list).getAllByTestId('cit-pitch')
    expect(pitch).toHaveLength(1)
    expect(pitch[0]?.getAttribute('aria-label')).toBe(
      'Draft a pitch to g2.com for “Which plan covers scheduled texts?”'
    )
    fireEvent.click(pitch[0] as HTMLElement)
    await waitFor(() =>
      expect(window.location.hash).toContain(
        'drawer=pitch&pitch.row=sg2b&pitch.page=page-1&pitch.prompt=prompt-2'
      )
    )
    cleanup()
    window.location.hash = '#/citations?view=list&cit.open=sg2a'
    const again = screen()
    const other = await again.view.findByRole('list', { name: 'Searches citing it' })
    expect(within(other).queryByTestId('cit-pitch')).toBeNull()
  })

  it('adds an other site as a competitor from its row menu, with Undo', async () => {
    window.location.hash = '#/citations?view=list&cit.by=domains'
    const att = row({
      id: 'satt',
      url: 'https://www.att.com/support/article/email-to-text/',
      domain: 'att.com',
      questions: [question('prompt-2', ['mkt-us'], 2)],
      overviews: [overview('prompt-2', 'mkt-us', 2)]
    })
    const { view, calls } = screen(data([...data().rows, att]))
    const grid = await view.findByRole('grid', { name: 'Cited domains' })
    fireEvent.click(within(grid).getByRole('button', { name: 'Actions for att.com' }))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Add as competitor' }))
    await waitFor(() =>
      expect(calls.saves).toEqual([
        {
          projectId: 'proj-1',
          id: null,
          name: 'att.com',
          domain: 'att.com',
          aliases: [],
          tier: 'direct'
        }
      ])
    )
    // The list reloads so the site reads as a competitor.
    await waitFor(() => expect(calls.loads).toBeGreaterThan(1))
    fireEvent.click(await view.findByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(calls.restores).toEqual([{ projectId: 'proj-1', undoToken: 'undo-1' }])
    )
    // Yours, competitors and known platforms (G2) have no such item.
    for (const name of ['simpletexting.com', 'g2.com']) {
      fireEvent.click(within(grid).getByRole('button', { name: `Actions for ${name}` }))
      expect(view.queryByRole('menuitem', { name: 'Add as competitor' })).toBeNull()
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    }
  })

  it('shows a domain as every site list does: icon, name, website and type', async () => {
    window.location.hash = '#/citations?view=list&cit.by=domains'
    const { view } = screen()
    const grid = await view.findByRole('grid', { name: 'Cited domains' })
    const headers = within(grid)
      .getAllByRole('columnheader')
      .map((item) => item.textContent)
    expect(headers.slice(0, 4)).toEqual(['Site icon', 'Name', 'Website', 'Type'])
    const rows = within(grid).getAllByRole('row').slice(1)
    const text = rows.map((item) => item.textContent ?? '')
    // The saved name, the website once, and who it is.
    expect(text.some((line) => line.includes('SimpleTexting') && line.includes('Competitor'))).toBe(
      true
    )
    expect(text.some((line) => line.includes('G2') && line.includes('Review site'))).toBe(true)
    expect(within(grid).getByRole('button', { name: 'Copy g2.com' })).toBeTruthy()
  })

  it('every number opens exactly what it counts', async () => {
    window.location.hash = '#/citations?view=list'
    const { view } = screen()
    const grid = await view.findByRole('grid', { name: 'Cited pages' })
    const checked = await expectEveryDrillMatches(grid)
    expect(checked).toContainEqual({ id: 'cit:questions:scomp', count: 2 })
    expect(checked).toContainEqual({ id: 'cit:markets:sown', count: 2 })
    expect(checked).toContainEqual({ id: 'cit:overviews:sown', count: 2 })
  })

  it('shows Needs review first only when there is something to review', async () => {
    window.location.hash = '#/citations?view=list'
    const review: CitationReview = {
      wrongPage: [],
      wrongPagePages: 0,
      untracked: [
        {
          url: 'https://textbolt.com/pricing/',
          normalizedUrl: 'textbolt.com/pricing',
          pageId: null,
          citations: 1,
          citedFor: 1,
          refs: [
            {
              pageId: 'page-1',
              pageLabel: 'Alerts',
              marketId: 'mkt-us',
              promptId: 'prompt-2',
              promptLabel: 'Q2',
              promptPosition: 2,
              position: 1,
              runId: 'run-us'
            }
          ],
          noise: null,
          ignored: false
        }
      ]
    }
    const { view } = screen(data(), review)
    expect(await view.findByRole('heading', { name: /^Needs review/ })).toBeTruthy()
    // One list, a group per kind that has rows.
    const list = view.getByRole('grid', { name: 'Needs review' })
    expect(list.textContent).toContain('Cited but not tracked')
    expect(list.textContent).not.toContain('Wrong page cited')
    expect(await view.findByRole('grid', { name: 'Cited pages' })).toBeTruthy()
  })

  it('says so plainly when nothing is cited yet, and when loading fails', async () => {
    window.location.hash = '#/citations?view=list'
    const empty = screen({ ...data([]), checks: 0, questions: 0, checkedAt: null })
    expect(await empty.view.findByText('No cited pages yet')).toBeTruthy()
    cleanup()
    const failed = screen(new Error('Database is locked'))
    expect(await failed.view.findByText('Could not load the cited pages.')).toBeTruthy()
    expect(failed.view.getByText(/Database is locked/)).toBeTruthy()
  })
})

describe('Citations · Pages (the main view)', () => {
  it('opens on Pages: your pages, the sites cited instead, what needs no page; it adds up', async () => {
    window.location.hash = '#/citations'
    const { view } = screen()
    const tabs = await view.findByRole('tablist', { name: 'Citations views' })
    expect(within(tabs).getByRole('tab', { name: /Pages/ }).getAttribute('aria-selected')).toBe(
      'true'
    )
    const grid = await view.findByRole('treegrid', { name: 'Pages' })
    expect([...grid.querySelectorAll('.cpg-section')].map((item) => item.textContent)).toEqual([
      'Your pages',
      'Cited instead of you',
      'No page needed'
    ])
    fireEvent.click(view.getByRole('button', { name: 'Expand all' }))
    expect(within(grid).getAllByText('Target page')).toHaveLength(2)
    expect(within(grid).getByText('Your other page')).toBeTruthy()
    expect(within(grid).getAllByText('Other site')).toHaveLength(2)
    expect(
      view.getByText(
        'Your pages: 2 + 1 + 2 cited · 9 still to win · 2 need no page · 1 not checked yet = 17'
      )
    ).toBeTruthy()
    const results = await axe.run(view.container, AXE_RULES)
    expect(results.violations.map((item) => item.id)).toEqual([])
  })

  it('every count opens its searches, and a page leads to its fix', async () => {
    window.location.hash = '#/citations?view=pages'
    const { view } = screen()
    const grid = await view.findByRole('treegrid', { name: 'Pages' })
    fireEvent.click(view.getByRole('button', { name: 'Expand all' }))
    fireEvent.click(
      within(grid).getByRole('button', {
        name: '4 searches: Searches /integration/nagios-email-to-text-alerts still has to win'
      })
    )
    const drill = await view.findByRole('dialog')
    expect(drill.querySelectorAll('[data-drill-row]')).toHaveLength(4)
    fireEvent.keyDown(drill, { key: 'Escape' })
    // The fix opens in its drawer over Citations (the shell draws it), not in Fixes.
    fireEvent.click(within(grid).getByRole('button', { name: 'Choose owner' }))
    await waitFor(() => expect(window.location.hash).toMatch(/drawer=page-fix&pfx\.id=pf/))
    expect(window.location.hash).toMatch(/^#\/citations\?view=pages/)
  })

  it('the List view is a tab away, in the URL', async () => {
    window.location.hash = '#/citations'
    const { view } = screen()
    const tabs = await view.findByRole('tablist', { name: 'Citations views' })
    fireEvent.click(within(tabs).getByRole('tab', { name: /List/ }))
    await waitFor(() => expect(window.location.hash).toBe('#/citations?view=list'))
    expect(await view.findByRole('grid', { name: 'Cited pages' })).toBeTruthy()
  })
})
