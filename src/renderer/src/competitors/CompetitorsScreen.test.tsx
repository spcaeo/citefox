// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it } from 'vitest'
import type { Market } from '@shared/domain'
import type {
  AddQuestionsRequest,
  CitedSiteRow,
  ClaudeStatus,
  CompetitorsOverview,
  CompetitorsOverviewRequest,
  RemoveCompetitorsRequest,
  RestoreCompetitorsRequest,
  SaveCompetitorRequest,
  SetSiteKindRequest,
  SetSiteTypeRequest
} from '@shared/ipc'
import type { FixSearch } from '@shared/page-fixes'
import type { SiteOverride } from '@shared/site-overrides'
import { hideUndo } from '../ui'
import { PermissionsContext, type PermissionsContextValue } from '../ui/permissionsContext'
import { DrillHost } from '../drill'
import { expectEveryDrillMatches } from '../drill/count.test-helper'
import { resetSiteKindSort } from './hooks/useSiteKindSort'
import { CompetitorsScreen } from './index'
import type { CompetitorsSource } from './source'

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
  resetSiteKindSort()
  window.location.hash = ''
})

function site(patch: Partial<CitedSiteRow> & Pick<CitedSiteRow, 'id' | 'name'>): CitedSiteRow {
  return {
    domain: null,
    kind: 'other',
    siteKind: 'other',
    tier: null,
    citations: 0,
    questions: 0,
    share: 0,
    named: null,
    startCitations: null,
    shareChange: null,
    firstSeenAt: null,
    isNew: false,
    byProduct: [],
    gaps: [],
    links: [],
    citedQuestions: [],
    namedQuestions: [],
    ...patch
  }
}

/** A question the site is cited for (latest checks). */
function ref(
  pageId: string,
  promptId: string,
  promptText: string,
  position: number
): CitedSiteRow['citedQuestions'][number] {
  return {
    id: `${pageId}|${promptId}`,
    pageId,
    pageKind: pageId.startsWith('topic') ? 'topic' : 'page',
    pageLabel: pageId.startsWith('topic') ? 'Carrier gateways' : 'Pricing',
    promptId,
    promptLabel: promptId,
    promptText,
    marketId: 'mkt-us',
    marketIds: ['mkt-us'],
    runId: 'run-9',
    links: 1,
    position
  }
}

/** One of What to fix's searches: your result and win odds. */
function search(
  sourceId: string,
  promptId: string,
  state: FixSearch['state'],
  odds: number
): FixSearch {
  return {
    id: `${sourceId}|${promptId}`,
    sourceKind: 'page',
    sourceId,
    sourceName: 'Pricing',
    promptId,
    marketId: 'mkt-us',
    runId: 'run-9',
    label: 'Q1',
    kind: 'question',
    text: promptId,
    state,
    targetPageId: sourceId,
    targetUrl: 'https://textbolt.com/pricing/',
    citedOwnUrl: state === 'right_page' ? 'https://textbolt.com/pricing/' : null,
    citedInstead: [],
    winOdds: { score: odds, level: odds >= 70 ? 'high' : 'medium', reason: '' },
    checkedAt: '2026-10-19T12:00:00.000Z'
  }
}

/** `count` links to `host`, the first on its blog post about AT&T. */
function links(count: number, host: string): CitedSiteRow['links'] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${host}-${index}`,
    pageId: 'page-1',
    promptId: `prompt-${index}`,
    promptText: `Question ${index + 1}`,
    marketId: 'mkt-us',
    runId: 'run-9',
    url: index === 0 ? `https://${host}/blog/att` : `https://${host}/page-${index}`,
    position: index + 1
  }))
}

function overview(patch: Partial<CompetitorsOverview> = {}): CompetitorsOverview {
  return {
    projectId: 'proj-1',
    period: 30,
    periodStart: '2026-09-20T12:00:00.000Z',
    marketId: null,
    productId: null,
    markets: [US, UK],
    products: [],
    ownDomain: 'textbolt.com',
    citations: 22,
    questions: 12,
    checks: 4,
    checkedAt: '2026-10-19T12:00:00.000Z',
    newSites: 1,
    unsortedDomains: 0,
    rows: [
      site({
        id: 'syou',
        name: 'TextBolt',
        domain: 'textbolt.com',
        kind: 'you',
        siteKind: null,
        citations: 6,
        links: links(6, 'textbolt.com'),
        questions: 5,
        share: 0.3,
        named: 4,
        startCitations: 4,
        shareChange: 0.05
      }),
      site({
        id: 'stextus',
        name: 'TextUs',
        domain: 'textus.com',
        kind: 'competitor',
        siteKind: 'competitors',
        tier: 'direct',
        citations: 9,
        links: links(9, 'textus.com'),
        startCitations: 4,
        questions: 7,
        share: 0.45,
        named: 3,
        shareChange: 0.1,
        citedQuestions: [
          ref('page-1', 'prompt-4', 'What does business texting cost per message?', 2),
          ref('topic-1', 'prompt-7', 'What replaced the AT&T email to text gateway?', 1),
          ref('page-1', 'prompt-5', 'Which texting app works with Gmail?', 3)
        ],
        gaps: [
          {
            id: 'page-1|prompt-4',
            pageId: 'page-1',
            pageKind: 'page',
            pageLabel: 'Pricing',
            pageUrl: 'https://textbolt.com/pricing/',
            promptId: 'prompt-4',
            promptLabel: 'Q4',
            promptText: 'What does business texting cost per message?',
            marketId: 'mkt-us',
            marketIds: ['mkt-us', 'mkt-uk'],
            runId: 'run-9',
            position: 2,
            url: 'https://textus.com/pricing',
            checkedAt: '2026-10-19T12:00:00.000Z'
          },
          {
            id: 'topic-1|prompt-7',
            pageId: 'topic-1',
            pageKind: 'topic',
            pageLabel: 'Carrier gateways',
            pageUrl: null,
            promptId: 'prompt-7',
            promptLabel: 'Q2',
            promptText: 'What replaced the AT&T email to text gateway?',
            marketId: 'mkt-us',
            marketIds: ['mkt-us'],
            runId: 'run-10',
            position: 1,
            url: 'https://textus.com/blog/att',
            checkedAt: '2026-10-19T12:00:00.000Z'
          }
        ]
      }),
      site({
        id: 'sreddit',
        name: 'reddit.com',
        domain: 'reddit.com',
        siteKind: 'video_social',
        citations: 5,
        links: links(5, 'reddit.com'),
        questions: 4,
        share: 0.25,
        isNew: true,
        startCitations: 0,
        gaps: []
      }),
      site({
        id: 'semail',
        name: 'email2phone.net',
        domain: 'email2phone.net',
        siteKind: 'other',
        citations: 2,
        links: links(2, 'email2phone.net'),
        questions: 2,
        share: 0.1,
        startCitations: 2,
        gaps: []
      })
    ],
    ...patch
  }
}

interface Calls {
  overview: CompetitorsOverviewRequest[]
  sorts: number
  saves: SaveCompetitorRequest[]
  removes: RemoveCompetitorsRequest[]
  restores: RestoreCompetitorsRequest[]
  kinds: SetSiteKindRequest[]
  types: SetSiteTypeRequest[]
  added: AddQuestionsRequest[]
}

function fakeSource(
  respond: (request: CompetitorsOverviewRequest) => CompetitorsOverview | Error = () => overview()
): { source: CompetitorsSource; calls: Calls } {
  const calls: Calls = {
    overview: [],
    sorts: 0,
    saves: [],
    removes: [],
    restores: [],
    kinds: [],
    types: [],
    added: []
  }
  let overrides: SiteOverride[] = []
  const list = { projectId: 'proj-1', competitors: [], products: [] }
  const source: CompetitorsSource = {
    'competitors:overview': (request) => {
      calls.overview.push(request)
      const answer = respond(request)
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
    },
    'competitors:sortSites': () => {
      calls.sorts += 1
      return Promise.resolve({ sorted: 2, remaining: 0 })
    },
    'competitors:list': () => Promise.resolve(list),
    'competitors:save': (request) => {
      calls.saves.push(request)
      return Promise.resolve({ competitor: null, names: [request.name], undoToken: 'undo-1' })
    },
    'competitors:remove': (request) => {
      calls.removes.push(request)
      return Promise.resolve({ competitor: null, names: ['TextUs'], undoToken: 'undo-2' })
    },
    'competitors:merge': () => Promise.reject(new Error('not used')),
    'competitors:restore': (request) => {
      calls.restores.push(request)
      return Promise.resolve(list)
    },
    'competitors:siteTypes': () =>
      Promise.resolve({ overrides, customTypes: [{ id: 't1', name: 'Carrier', tone: 'info' }] }),
    'competitors:setSiteType': (request) => {
      calls.types.push(request)
      const previous = overrides.find((item) => item.domain === request.domain) ?? null
      const next = {
        domain: request.domain,
        type: request.type === undefined ? (previous?.type ?? null) : request.type,
        role: request.role === undefined ? (previous?.role ?? null) : request.role
      }
      overrides = [...overrides.filter((item) => item.domain !== request.domain), next]
      return Promise.resolve({ previous, override: next })
    },
    'competitors:setSiteKind': (request) => {
      calls.kinds.push(request)
      return Promise.resolve({ domain: request.domain, kind: request.kind })
    },
    'fixes:searches': () =>
      Promise.resolve({
        projectId: 'proj-1',
        domain: 'textbolt.com',
        builtAt: '2026-10-19T12:00:00.000Z',
        sources: [],
        searches: [
          search('page-1', 'prompt-4', 'not_cited', 72),
          search('page-1', 'prompt-5', 'right_page', 88)
        ]
      }),
    'prompts:addTargets': () =>
      Promise.resolve({
        projectId: 'proj-1',
        markets: [US],
        searchesLeft: null,
        targets: [
          {
            id: 'topic-9',
            kind: 'topic',
            name: 'Carrier gateways',
            url: null,
            status: 'tracked',
            questions: 3,
            keywords: 0,
            samples: 1
          }
        ]
      } as never),
    'prompts:addQuestions': (request) => {
      calls.added.push(request)
      return Promise.resolve({
        pageId: request.pageId,
        promptIds: request.questions.slice(1).map((_, index) => `new-${index}`),
        skipped: request.questions.slice(0, 1).map((item) => item.text),
        version: 2,
        savedAt: '2026-10-23T10:00:00.000Z'
      })
    }
  }
  return { source, calls }
}

afterEach(() => {
  hideUndo()
})

describe('Competitors screen', () => {
  it('shows the KPIs, the sites with share bars, and your own row marked', async () => {
    window.location.hash = '#/competitors'
    const { source, calls } = fakeSource()
    const view = render(<CompetitorsScreen projectId="proj-1" source={source} />)
    const grid = await view.findByRole('grid', { name: 'Cited sites' })
    expect(calls.overview[0]).toEqual({
      projectId: 'proj-1',
      period: 30,
      marketId: null,
      productId: null
    })
    const kpis = view.getByRole('region', { name: 'Share of citations' })
    const yours = within(kpis).getByRole('region', { name: 'Your share of citations' })
    expect(yours.textContent).toContain('30%')
    expect(yours.textContent).not.toContain('across')
    const top = within(kpis).getByRole('region', { name: 'Top competitor’s share' })
    expect(top.textContent).toContain('45%')
    // The top competitor's share opens its links, like its Citations cell.
    fireEvent.click(within(top).getByRole('button', { name: /^45% share of citations for/ }))
    const links = await view.findByRole('dialog', { name: /^Links to/ })
    expect(window.location.hash).toContain('drawer=drill')
    fireEvent.keyDown(links, { key: 'Escape' })
    await waitFor(() => expect(view.queryByRole('dialog', { name: /^Links to/ })).toBeNull())
    expect(within(kpis).getByRole('region', { name: 'New sites cited' }).textContent).toContain('1')
    // No basis line under the tiles: the header and the drawers carry the scope.
    expect(view.queryByText(/^From 4 checks/)).toBeNull()
    const you = within(grid).getByText('TextBolt')
    expect(you.className).toContain('site-name-own')
    expect(within(grid).getByText('+10 pts').className).toBe('cmp-change-bad')
    expect(within(grid).getByText('+5 pts').className).toBe('cmp-change-ok')
    expect(within(grid).getByText('New')).toBeTruthy()
    const results = await axe.run(view.container, AXE_RULES)
    expect(results.violations.map((item) => item.id)).toEqual([])
  })

  it('opens "Where X is cited" on They win, with links to the question detail, in the URL', async () => {
    window.location.hash = '#/competitors'
    const { source } = fakeSource()
    const view = render(<CompetitorsScreen projectId="proj-1" source={source} />)
    const grid = await view.findByRole('grid', { name: 'Cited sites' })
    fireEvent.click(
      within(grid).getByRole('button', { name: '2 searches cite TextUs and not you' })
    )
    const drawer = await view.findByRole('dialog', { name: /Where TextUs is cited/ })
    expect(window.location.hash).toBe('#/competitors?site=stextus')
    // They win first: each a search you are not cited on, with the orange result.
    const list = within(drawer).getByRole('grid', { name: 'Searches that cite TextUs' })
    expect(within(list).getAllByText('Not cited')[0]?.className).toContain('ui-result-not-cited')
    expect(within(list).queryByText('Which texting app works with Gmail?')).toBeNull()
    const question = within(drawer).getByRole('link', {
      name: 'What does business texting cost per message?'
    })
    expect(question.getAttribute('href')).toBe(
      '#/pages/page-1/prompt/prompt-4?market=mkt-us&run=run-9'
    )
    expect(within(drawer).getByRole('link', { name: 'Carrier gateways' })).toBeTruthy()
    expect(drawer.textContent).toContain('🇺🇸 US · EN, 🇬🇧 UK · EN')
    // The page URL gets the copy and open icons; so does the competitor's cited page.
    expect(within(drawer).getByRole('button', { name: 'Copy /pricing/' })).toBeTruthy()
    expect(
      within(drawer).getByRole('link', { name: 'Open textus.com/blog/att in a new tab' })
    ).toBeTruthy()
    fireEvent.click(within(drawer).getByRole('button', { name: /^Close Where TextUs/ }))
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    expect(window.location.hash).toBe('#/competitors')
  })

  it('restores every state from the URL and writes filter changes back', async () => {
    window.location.hash = '#/p/proj-1/competitors?period=7&market=mkt-uk&view=new&site=stextus'
    const { source, calls } = fakeSource((request) =>
      overview({ period: request.period, marketId: request.marketId ?? null })
    )
    const view = render(<CompetitorsScreen projectId="proj-1" source={source} />)
    await view.findByRole('dialog', { name: /Where TextUs is cited/ })
    expect(calls.overview[0]).toMatchObject({ period: 7, marketId: 'mkt-uk', productId: null })
    fireEvent.click(view.getByRole('button', { name: /^Close Where TextUs/ }))
    const grid = await view.findByRole('grid', { name: 'Cited sites' })
    // "New" keeps your own row and the new site only.
    expect(within(grid).queryByText('TextUs')).toBeNull()
    expect(within(grid).getByText('reddit.com')).toBeTruthy()
    fireEvent.click(
      within(view.getByRole('group', { name: 'Period' })).getByRole('button', { name: '90 days' })
    )
    await waitFor(() => expect(calls.overview.at(-1)).toMatchObject({ period: 90 }))
    expect(window.location.hash).toBe('#/p/proj-1/competitors?period=90&market=mkt-uk&view=new')
    fireEvent.change(view.getByRole('combobox', { name: 'Market' }), { target: { value: '' } })
    await waitFor(() => expect(calls.overview.at(-1)).toMatchObject({ marketId: null }))
    expect(window.location.hash).toBe('#/p/proj-1/competitors?period=90&view=new')
  })

  it('adds an unknown site as a competitor at once, with Undo', async () => {
    window.location.hash = '#/competitors?site=semail'
    const { source, calls } = fakeSource()
    const view = render(<CompetitorsScreen projectId="proj-1" source={source} />)
    const drawer = await view.findByRole('dialog', { name: /Where email2phone\.net is cited/ })
    expect(within(drawer).getByText('No search cites email2phone.net without you.')).toBeTruthy()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add as competitor' }))
    await waitFor(() =>
      expect(calls.saves).toEqual([
        {
          projectId: 'proj-1',
          id: null,
          name: 'email2phone.net',
          domain: 'email2phone.net',
          aliases: [],
          tier: 'direct'
        }
      ])
    )
    expect(await view.findByText('email2phone.net is now a saved competitor.')).toBeTruthy()
    // The list reloads; the saved site has a new row id, so its drawer closes.
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    expect(calls.overview.length).toBeGreaterThan(1)
  })

  it('with a product picked, adds the site to that product’s competitors', async () => {
    window.location.hash = '#/competitors?product=prod-a'
    const { source, calls } = fakeSource((request) =>
      overview({
        productId: request.productId ?? null,
        products: [{ id: 'prod-a', name: 'Alerts' }]
      })
    )
    const view = render(<CompetitorsScreen projectId="proj-1" source={source} />)
    const grid = await view.findByRole('grid', { name: 'Cited sites' })
    expect(calls.overview[0]).toMatchObject({ productId: 'prod-a' })
    fireEvent.click(within(grid).getByRole('button', { name: 'Actions for email2phone.net' }))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Mark as competitor' }))
    await waitFor(() => expect(calls.saves).toHaveLength(1))
    expect(calls.saves[0]).toMatchObject({ name: 'email2phone.net', productIds: ['prod-a'] })
    expect(await view.findByText('email2phone.net is now a competitor of Alerts.')).toBeTruthy()
  })

  it('edits, merges and removes a saved competitor from its row menu', async () => {
    window.location.hash = '#/competitors'
    const { source, calls } = fakeSource()
    const view = render(<CompetitorsScreen projectId="proj-1" source={source} />)
    const grid = await view.findByRole('grid', { name: 'Cited sites' })
    fireEvent.click(within(grid).getByRole('button', { name: 'Actions for TextUs' }))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Edit…' }))
    expect(window.location.hash).toBe('#/competitors?drawer=competitor&competitor=stextus')
    fireEvent.click(within(grid).getByRole('button', { name: 'Actions for TextUs' }))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Merge with…' }))
    expect(window.location.hash).toContain('competitor.mode=merge')
    window.location.hash = '#/competitors'
    fireEvent.click(within(grid).getByRole('button', { name: 'Actions for TextUs' }))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Remove from competitors' }))
    await waitFor(() => expect(calls.removes).toEqual([{ projectId: 'proj-1', ids: ['stextus'] }]))
    expect(calls.overview.length).toBeGreaterThan(1)
    // The header adds one through the same drawer.
    fireEvent.click(view.getByRole('button', { name: 'Add competitor' }))
    expect(window.location.hash).toBe('#/competitors?drawer=competitor&competitor=new')
  })

  it('opens the links and questions behind a row’s numbers', async () => {
    window.location.hash = '#/competitors'
    const { source } = fakeSource()
    const view = render(
      <DrillHost>
        <CompetitorsScreen projectId="proj-1" source={source} />
      </DrillHost>
    )
    const grid = await view.findByRole('grid', { name: 'Cited sites' })
    const number = within(grid).getByRole('button', { name: '9 links to TextUs' })
    expect(number.textContent).toBe('9')
    fireEvent.click(number)
    const drawer = await view.findByRole('dialog', { name: /Links to TextUs/ })
    expect(drawer.textContent).toContain('9 links')
    expect(drawer.textContent).toContain('textus.com/blog/att')
  })

  it('every count opens a list as long as its number, on the URL', async () => {
    window.location.hash = '#/competitors'
    const { source } = fakeSource()
    const view = render(<CompetitorsScreen projectId="proj-1" source={source} />)
    const kpis = await view.findByRole('region', { name: 'Share of citations' })
    // "6 of 22 links": 6 opens your links, 22 every link (yours first); New sites its 1.
    const strip = await expectEveryDrillMatches(kpis)
    expect(strip).toEqual([
      { id: 'cmp:citations:syou', count: 6 },
      { id: 'cmp:links', count: 22 },
      { id: 'cmp:new', count: 1 }
    ])
    fireEvent.click(within(kpis).getByRole('button', { name: /^30% share of citations/ }))
    const all = await view.findByRole('dialog', { name: /Links in AI Overviews/ })
    expect(all.querySelector('[data-drill-row="0"]')?.textContent).toContain('textbolt.com')
    fireEvent.keyDown(all, { key: 'Escape' })
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())

    const kinds = await expectEveryDrillMatches(view.getByRole('grid', { name: 'Site types' }))
    expect(kinds.length).toBeGreaterThan(0)
    const grid = await expectEveryDrillMatches(view.getByRole('grid', { name: 'Cited sites' }))
    expect(grid.length).toBeGreaterThan(0)
  })

  it('a site’s drawer switches They win, Both cited, All and Their pages on the URL; counts open them', async () => {
    window.location.hash = '#/competitors?site=stextus'
    const { source } = fakeSource()
    const view = render(<CompetitorsScreen projectId="proj-1" source={source} />)
    const drawer = await view.findByRole('dialog', { name: /Where TextUs is cited/ })
    // The saved status is one fact; no card repeats the footer's Edit competitor.
    expect(within(drawer).queryByText('Saved competitor')).toBeNull()
    expect(within(drawer).getByText('Saved as')).toBeTruthy()
    expect(within(drawer).getAllByRole('button', { name: /Edit competitor/ })).toHaveLength(1)
    const grid = within(drawer).getByRole('grid', { name: 'Searches that cite TextUs' })
    await waitFor(() => expect(within(grid).getByText('72')).toBeTruthy())
    fireEvent.click(within(drawer).getByRole('button', { name: /^Both cited/ }))
    await waitFor(() => expect(window.location.hash).toContain('gv=both'))
    expect(within(grid).getByText('Which texting app works with Gmail?')).toBeTruthy()
    expect(within(grid).getByText('Target page')).toBeTruthy()
    // A rail count opens its view.
    fireEvent.click(within(drawer).getByRole('button', { name: '3: show All' }))
    await waitFor(() => expect(window.location.hash).toContain('gv=all'))
    fireEvent.click(within(drawer).getByRole('button', { name: /show Their pages/ }))
    await waitFor(() => expect(window.location.hash).toContain('gv=pages'))
    expect(within(drawer).getByRole('treegrid')).toBeTruthy()
    // Closing drops the drawer's keys.
    fireEvent.click(within(drawer).getByRole('button', { name: /^Close Where TextUs/ }))
    await waitFor(() => expect(window.location.hash).toBe('#/competitors'))
  })

  it('lists only the products a site is cited for, each opening the screen for it', async () => {
    window.location.hash = '#/competitors?site=stextus'
    const base = overview()
    const { source } = fakeSource(() =>
      overview({
        products: [
          { id: 'prod-a', name: 'Email to SMS' },
          { id: 'prod-b', name: 'Gmail add-on' }
        ],
        rows: base.rows.map((row) =>
          row.id === 'stextus'
            ? {
                ...row,
                byProduct: [
                  { productId: 'prod-a', citations: 4, questions: 3, share: 0.06 },
                  { productId: 'prod-b', citations: 0, questions: 0, share: null }
                ]
              }
            : row
        )
      })
    )
    const view = render(<CompetitorsScreen projectId="proj-1" source={source} />)
    const drawer = await view.findByRole('dialog', { name: /Where TextUs is cited/ })
    const products = within(drawer).getByRole('list', { name: 'By product' })
    expect(within(products).getAllByRole('listitem')).toHaveLength(1)
    const link = within(products).getByRole('link', { name: 'Email to SMS' })
    expect(link.getAttribute('href')).toContain('product=prod-a')
    expect(link.getAttribute('href')).toContain('site=stextus')
    expect(drawer.textContent).not.toContain('Gmail add-on')
  })

  it('adds the gap questions to a topic and offers a fix for the page with the most', async () => {
    window.location.hash = '#/competitors?site=stextus'
    const { source, calls } = fakeSource()
    const view = render(<CompetitorsScreen projectId="proj-1" source={source} />)
    const drawer = await view.findByRole('dialog', { name: /Where TextUs is cited/ })
    const picker = await within(drawer).findByRole('combobox', {
      name: 'Add these questions to a topic'
    })
    await waitFor(() => expect(within(picker).getByText('Carrier gateways')).toBeTruthy())
    fireEvent.change(picker, { target: { value: 'topic-9' } })
    await waitFor(() => expect(calls.added).toHaveLength(1))
    expect(calls.added[0]).toMatchObject({ projectId: 'proj-1', pageId: 'topic-9' })
    expect(
      await within(drawer).findByText(/Added 1 question to Carrier gateways · 1 already tracked/)
    ).toBeTruthy()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Log a fix' }))
    expect(window.location.hash).toContain('drawer=fix')
    expect(window.location.hash).toContain('fix=new')
    expect(window.location.hash).toContain('fix.page=')
  })

  it('says when there is no check yet, and offers to clear a filter that fails', async () => {
    window.location.hash = '#/competitors?market=mkt-gone'
    const { source } = fakeSource((request) =>
      request.marketId
        ? new Error(
            'Error invoking remote method: competitors:overview: That market is not in this project'
          )
        : overview({ checks: 0, rows: [] })
    )
    const view = render(<CompetitorsScreen projectId="proj-1" source={source} />)
    const alert = await view.findByRole('alert')
    expect(alert.textContent).toContain('That market is not in this project')
    fireEvent.click(within(alert).getByRole('button', { name: 'Show every product and market' }))
    // Nothing checked and no competitor saved: the "No competitors yet" pair says what to do.
    expect(await view.findByText('No competitors yet')).toBeTruthy()
    expect(view.queryByText('No checks in this view yet.')).toBeNull()
    expect(window.location.hash).toBe('#/competitors')
  })

  it('a saved competitor and no check yet: says there is no check', async () => {
    window.location.hash = '#/competitors'
    const saved = overview().rows.filter((row) => row.kind === 'competitor')
    const { source } = fakeSource(() => overview({ checks: 0, rows: saved }))
    const view = render(<CompetitorsScreen projectId="proj-1" source={source} />)
    expect(await view.findByText('No checks in this view yet.')).toBeTruthy()
    expect(view.queryByText('No competitors yet')).toBeNull()
  })

  it('no competitor saved: Add competitor and ✦ Help me find them', async () => {
    window.location.hash = '#/competitors'
    const others = overview().rows.filter((row) => row.kind !== 'competitor')
    const { source } = fakeSource(() => overview({ rows: others }))
    const view = render(<CompetitorsScreen projectId="proj-1" source={source} />)
    const empty = await view.findByTestId('cmp-no-competitors')
    expect(within(empty).getByText('Who else should Google cite for your questions?')).toBeTruthy()
    // The cited sites still show under it.
    expect(view.getByRole('grid', { name: 'Cited sites' })).toBeTruthy()
    fireEvent.click(within(empty).getByRole('button', { name: 'Help me find them' }))
    expect(window.location.hash).toBe(
      '#/competitors?drawer=import&import.entity=competitors&import.help=1'
    )
    window.location.hash = '#/competitors'
    fireEvent.click(within(empty).getByRole('button', { name: 'Add competitor' }))
    expect(window.location.hash).toBe('#/competitors?drawer=competitor&competitor=new')
  })

  it('shows who else is cited by kind of site, and filters the list by kind in the URL', async () => {
    window.location.hash = '#/competitors'
    const { source, calls } = fakeSource()
    const view = render(<CompetitorsScreen projectId="proj-1" source={source} />)
    const kinds = await view.findByRole('grid', { name: 'Site types' })
    expect(view.getByRole('heading', { name: 'Who else the AI answers cite' })).toBeTruthy()
    const competitors = within(kinds).getByRole('row', { name: /Competitors/ })
    // TextUs: 4 citations at the period start, 9 now.
    expect(competitors.textContent).toContain('Competitors')
    expect(competitors.textContent).toContain('+5')
    expect(within(kinds).getByRole('row', { name: /Video, social & forums/ })).toBeTruthy()
    // Nothing unsorted: Claude is not asked.
    expect(calls.sorts).toBe(0)
    fireEvent.click(within(kinds).getByText('Video, social & forums'))
    await waitFor(() => expect(window.location.hash).toBe('#/competitors?kind=video_social'))
    const grid = view.getByRole('grid', { name: 'Cited sites' })
    expect(within(grid).queryByText('TextUs')).toBeNull()
    expect(within(grid).getByText('reddit.com')).toBeTruthy()
    // The list's Filter ▾ holds the same site types as the table (audit2 #9).
    fireEvent.click(view.getByRole('button', { name: 'Filter, 1 set' }))
    expect(
      view
        .getByRole('menuitemradio', { name: 'Site type: Video, social & forums' })
        .getAttribute('aria-checked')
    ).toBe('true')
    fireEvent.click(view.getByRole('menuitemradio', { name: 'Site type: Competitors' }))
    await waitFor(() => expect(window.location.hash).toBe('#/competitors?kind=competitors'))
    expect(within(grid).getByText('TextUs')).toBeTruthy()
    expect(within(grid).queryByText('reddit.com')).toBeNull()
    const results = await axe.run(view.container, AXE_RULES)
    expect(results.violations.map((item) => item.id)).toEqual([])
  })

  it('asks CiteFox AI once to sort the sites no list knows, then reloads', async () => {
    window.location.hash = '#/competitors'
    let sorted = false
    const { source, calls } = fakeSource(() => overview({ unsortedDomains: sorted ? 0 : 2 }))
    const original = source['competitors:sortSites']
    source['competitors:sortSites'] = (request) => {
      sorted = true
      return original(request)
    }
    const view = render(<CompetitorsScreen projectId="proj-1" source={source} />)
    await view.findByRole('grid', { name: 'Site types' })
    await waitFor(() => expect(calls.sorts).toBe(1))
    await waitFor(() => expect(calls.overview.length).toBe(2))
    expect(view.queryByText(/not sorted yet/)).toBeNull()
  })

  /** The overview with email2phone.net not sorted by any list or AI yet. */
  function withPending(): CompetitorsOverview {
    const base = overview({ unsortedDomains: 1 })
    return {
      ...base,
      rows: base.rows.map((row) => (row.id === 'semail' ? { ...row, siteKindPending: true } : row))
    }
  }

  it('keeps unsorted sites in their own "Not sorted yet" row, with Sort now', async () => {
    window.location.hash = '#/competitors'
    const { source, calls } = fakeSource(withPending)
    const view = render(<CompetitorsScreen projectId="proj-1" source={source} />)
    const kinds = await view.findByRole('grid', { name: 'Site types' })
    await waitFor(() => expect(calls.sorts).toBe(1))
    const pending = within(kinds).getByRole('row', { name: /Not sorted yet/ })
    expect(pending.textContent).toContain('Not sorted yet (1)')
    expect(within(kinds).queryByRole('row', { name: /^Other/ })).toBeNull()
    fireEvent.click(await within(pending).findByRole('button', { name: 'Sort now' }))
    await waitFor(() => expect(calls.sorts).toBe(2))
    fireEvent.click(within(kinds).getByText('Not sorted yet (1)'))
    await waitFor(() => expect(window.location.hash).toBe('#/competitors?kind=pending'))
    const grid = view.getByRole('grid', { name: 'Cited sites' })
    expect(within(grid).getAllByText('email2phone.net').length).toBeGreaterThan(0)
    expect(within(grid).queryByText('reddit.com')).toBeNull()
  })

  it('with no AI connected: no sort call, no console, one calm line to Connections', async () => {
    window.location.hash = '#/competitors'
    const { source, calls } = fakeSource(withPending)
    const view = render(
      <PermissionsContext.Provider value={noAi()}>
        <CompetitorsScreen projectId="proj-1" source={source} />
      </PermissionsContext.Provider>
    )
    const kinds = await view.findByRole('grid', { name: 'Site types' })
    const line = await view.findByText(/1 site not sorted yet\. Connect an AI/)
    expect(within(line).getByRole('link', { name: 'Connect an AI' }).getAttribute('href')).toBe(
      '#/connections?tab=claude'
    )
    expect(within(kinds).queryByRole('button', { name: 'Sort now' })).toBeNull()
    expect(calls.sorts).toBe(0)
    expect(view.container.textContent).not.toMatch(/Claude|not found/)
  })
})

function noAi(): PermissionsContextValue {
  const claude: ClaudeStatus = {
    connection: 'claude-code',
    state: 'needs_setup',
    name: 'CiteFox AI',
    summary: 'not found',
    plan: null,
    model: null,
    checkedAt: null,
    fresh: false,
    nextStep: 'Install it.'
  }
  return {
    snapshot: null,
    claude,
    loading: false,
    error: null,
    checking: false,
    progress: null,
    steps: {},
    busy: null,
    message: null,
    refresh: async () => null,
    checkClaude: async () => claude,
    ensureClaude: async () => claude,
    request: async () => null
  }
}

describe('Competitors screen: the sites list', () => {
  /** The grid row whose name cell holds `name`. */
  function rowOf(grid: HTMLElement, name: string): HTMLElement {
    const row = within(grid)
      .getAllByRole('row')
      .find((item) => item.querySelector('.site-name-cell')?.textContent?.startsWith(name))
    if (!row) throw new Error(`No row for ${name}`)
    return row
  }

  it('shows each site on one line: icon, name, website and type in their own columns', async () => {
    window.location.hash = '#/competitors'
    const { source, calls } = fakeSource()
    const view = render(<CompetitorsScreen projectId="proj-1" source={source} />)
    const grid = await view.findByRole('grid', { name: 'Cited sites' })
    const headers = within(grid)
      .getAllByRole('columnheader')
      .map((item) => item.textContent)
    expect(headers.slice(0, 4)).toEqual(['Site icon', 'Name', 'Website', 'Type'])
    // A saved competitor: its name, its website with Copy and Open, its type.
    const textus = rowOf(grid, 'TextUs')
    expect(within(textus).getByRole('button', { name: 'Copy textus.com' })).toBeTruthy()
    expect(within(textus).getByRole('link', { name: 'Open textus.com in a new tab' })).toBeTruthy()
    expect(
      within(textus).getByRole('button', { name: /^Type for textus\.com: Competitor/ })
    ).toBeTruthy()
    // A known platform goes by its name and role, and is never offered as a competitor.
    const reddit = rowOf(grid, 'Reddit')
    expect(within(reddit).getByText('Community')).toBeTruthy()
    expect(within(reddit).queryByRole('button', { name: /as a competitor/ })).toBeNull()
    fireEvent.click(within(reddit).getByRole('button', { name: 'Actions for reddit.com' }))
    expect(
      await view.findByRole('menuitem', { name: 'Where it’s cited and you’re not' })
    ).toBeTruthy()
    expect(view.queryByRole('menuitem', { name: 'Mark as competitor' })).toBeNull()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    // A site known only by its host shows its domain as its name, and the Website
    // column is still filled (muted), with Copy and Open.
    const email = rowOf(grid, 'email2phone.net')
    expect(within(email).getAllByText('email2phone.net')).toHaveLength(2)
    expect(within(email).getByRole('button', { name: 'Copy email2phone.net' })).toBeTruthy()
    expect(email.querySelector('.site-website-same')).not.toBeNull()
    expect(within(email).getByText('Neutral')).toBeTruthy()
    // "Mark as competitor" right in the row.
    fireEvent.click(
      within(email).getByRole('button', { name: 'Mark email2phone.net as a competitor' })
    )
    await waitFor(() => expect(calls.saves).toHaveLength(1))
    expect(calls.saves[0]).toMatchObject({ domain: 'email2phone.net', tier: 'direct' })
  })

  it('filters by site type and New in one Filter ▾, counting the sites without yours', async () => {
    window.location.hash = '#/competitors'
    const { source } = fakeSource()
    const view = render(<CompetitorsScreen projectId="proj-1" source={source} />)
    const grid = await view.findByRole('grid', { name: 'Cited sites' })
    // No second grouping in tabs or a dropdown: the table's site types are the one grouping.
    expect(view.queryByRole('tablist', { name: 'Show sites' })).toBeNull()
    expect(view.getByText('3 sites, and yours to compare')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Filter' }))
    expect(
      view.getByRole('menuitemradio', { name: 'Site type: Every site type' }).textContent
    ).toContain('3')
    fireEvent.click(view.getByRole('menuitemradio', { name: 'Show: New this period' }))
    await waitFor(() => expect(window.location.hash).toBe('#/competitors?view=new'))
    // Your own row stays, to compare with.
    expect(within(grid).getByText('TextBolt')).toBeTruthy()
    expect(within(grid).getByText('Reddit')).toBeTruthy()
    expect(within(grid).queryByText('TextUs')).toBeNull()
    expect(view.getByText('1 site, and yours to compare')).toBeTruthy()
  })

  it('keeps the search and the sort in the URL, and restores them', async () => {
    window.location.hash = '#/competitors?q=text&sort=name.asc'
    const { source } = fakeSource()
    const view = render(<CompetitorsScreen projectId="proj-1" source={source} />)
    const grid = await view.findByRole('grid', { name: 'Cited sites' })
    const search = view.getByRole('searchbox', { name: 'Search sites' })
    expect((search as HTMLInputElement).value).toBe('text')
    expect(within(grid).queryByText('Reddit')).toBeNull()
    expect(within(grid).getByText('TextUs')).toBeTruthy()
    const name = within(grid).getByRole('columnheader', { name: 'Name' })
    expect(name.getAttribute('aria-sort')).toBe('ascending')
    fireEvent.change(search, { target: { value: 'reddit' } })
    await waitFor(() => expect(window.location.hash).toBe('#/competitors?q=reddit&sort=name.asc'))
    expect(within(grid).getByText('Reddit')).toBeTruthy()
    fireEvent.click(
      within(within(grid).getByRole('columnheader', { name: /^Type/ })).getByRole('button')
    )
    await waitFor(() => expect(window.location.hash).toMatch(/sort=type\.(asc|desc)/))
  })

  it('sets a site’s type from its menu for the whole domain, with your own types', async () => {
    window.location.hash = '#/competitors'
    const { source, calls } = fakeSource()
    const view = render(<CompetitorsScreen projectId="proj-1" source={source} />)
    const grid = await view.findByRole('grid', { name: 'Cited sites' })
    fireEvent.click(
      await within(grid).findByRole('button', { name: /^Type for email2phone\.net: Neutral/ })
    )
    expect(view.getByRole('menuitemradio', { name: 'Neutral' }).getAttribute('aria-checked')).toBe(
      'true'
    )
    fireEvent.click(view.getByRole('menuitemradio', { name: 'Community' }))
    await waitFor(() =>
      expect(calls.types).toEqual([
        { projectId: 'proj-1', domain: 'email2phone.net', role: 'community' }
      ])
    )
    // Every list re-reads the choice.
    expect(
      within(grid).getByRole('button', { name: /^Type for email2phone\.net: Community/ })
    ).toBeTruthy()
    // A type of your own, from the same menu.
    fireEvent.click(within(grid).getByRole('button', { name: /^Type for reddit\.com: Community/ }))
    fireEvent.click(view.getByRole('menuitemradio', { name: 'Carrier' }))
    await waitFor(() =>
      expect(calls.types.at(-1)).toEqual({
        projectId: 'proj-1',
        domain: 'reddit.com',
        type: 'custom:t1'
      })
    )
    expect(
      await within(grid).findByRole('button', { name: /^Type for reddit\.com: Carrier/ })
    ).toBeTruthy()
    // Reset puts the type and who it is back to automatic, in one change.
    fireEvent.click(within(grid).getByRole('button', { name: /You set type for reddit\.com/ }))
    await waitFor(() =>
      expect(calls.types.at(-1)).toEqual({
        projectId: 'proj-1',
        domain: 'reddit.com',
        role: null,
        type: null
      })
    )
    const results = await axe.run(view.container, AXE_RULES)
    expect(results.violations.map((item) => item.id)).toEqual([])
  })
})
