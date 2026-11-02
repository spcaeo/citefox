// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Market } from '@shared/domain'
import type {
  ImportCandidate,
  ImportCandidateList,
  ImportEstimate,
  ImportEstimateRequest,
  ImportTrackRequest,
  ParseImportUrlsRequest,
  ProjectDetail
} from '@shared/ipc'
import { closeDrawer, resetDrawersForTests } from '../shell/drawers'
import { pageHash, pagesHash, structureHash } from '../shell/routes'
import type { StructureClient } from '../structure/client'
import { ImportPagesScreen } from '.'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

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

const PROJECT: ProjectDetail = {
  id: 'proj-1',
  name: 'TextBolt',
  slug: 'textbolt',
  domain: 'textbolt.com',
  dbPath: 'projects/textbolt.sqlite',
  clientName: null,
  status: 'active',
  includeSubdomains: false,
  brandNames: ['TextBolt'],
  competitors: [],
  defaultMarket: US,
  foundPageCount: 4,
  trackedPageCount: 1
}

function candidate(path: string, patch: Partial<ImportCandidate> = {}): ImportCandidate {
  const parts = path.split('/').filter(Boolean)
  return {
    pageId: `page-${parts.join('-') || 'home'}`,
    url: `https://textbolt.com${path}`,
    path,
    title: null,
    folder: parts.length >= 2 ? `/${parts[0]}/` : '/',
    clusterId: null,
    clusterName: null,
    lastmod: '2026-10-01',
    internalLinks: null,
    moneyPage: false,
    alreadyTracked: false,
    needsSetup: true,
    status: 'not_tracked',
    ...patch
  }
}

const LIST: ImportCandidateList = {
  projectId: 'proj-1',
  rows: [
    candidate('/blog/10dlc-registration-guide/', {
      clusterId: 'c-10dlc',
      clusterName: '10DLC & compliance'
    }),
    candidate('/blog/email-to-sms/', { needsSetup: false }),
    candidate('/blog/text-alerts/', { alreadyTracked: true, status: 'tracked' }),
    candidate('/pricing/', { moneyPage: true })
  ],
  folders: [
    { folder: '/blog/', pageCount: 3, trackedCount: 1 },
    { folder: '/', pageCount: 1, trackedCount: 0 }
  ],
  clusters: [{ id: 'c-10dlc', name: '10DLC & compliance', pageCount: 1 }],
  markets: [US, UK],
  hasLinkData: false,
  sitemapCount: 2,
  skippedSitemaps: ['tag-sitemap.xml'],
  trackedCount: 1
}

function estimateFor(request: ImportEstimateRequest): ImportEstimate {
  const min = request.pageCount * request.promptCount * request.marketCount * request.samples
  return {
    minSearches: min,
    maxSearches: min * 2,
    checksPerMonth: 1,
    monthlyMin: min,
    monthlyMax: min * 2,
    searchesLeft: 3760,
    monthlyPlan: 5000,
    perDayMin: Math.round(min / 7),
    perDayMax: Math.round((min * 2) / 7),
    firstRoundFits: true,
    monthlyFits: true,
    claudeCalls: request.setupPageCount * 3
  }
}

function fakeClient(overrides: Partial<StructureClient> = {}): {
  client: StructureClient
  track: ReturnType<typeof vi.fn<(request: ImportTrackRequest) => Promise<unknown>>>
  parse: ReturnType<typeof vi.fn<(request: ParseImportUrlsRequest) => Promise<unknown>>>
} {
  const track = vi.fn(async (request: ImportTrackRequest) => ({
    trackedCount: request.pageIds.length + request.urls.length,
    addedCount: request.urls.length,
    skippedCount: 0,
    firstCheckFrom: '2026-10-20T09:00:00.000Z',
    firstCheckUntil: '2026-10-26T09:00:00.000Z'
  }))
  const parse = vi.fn(async (request: ParseImportUrlsRequest) => ({
    rows: request.text.includes('new-page')
      ? [candidate('/new-page/', { pageId: null, status: null })]
      : [],
    rejected: [{ line: 2, value: 'https://other.com/x', reason: 'Not a textbolt.com page' }],
    duplicates: 1
  }))
  const base: Partial<StructureClient> = {
    'import:candidates': async () => LIST,
    'import:estimate': async (request) => estimateFor(request),
    'import:track': track as unknown as StructureClient['import:track'],
    'import:parseUrls': parse as unknown as StructureClient['import:parseUrls'],
    'import:claudePick': async () => {
      throw new Error('CiteFox AI is not signed in. Open Connections to sign in.')
    },
    'sitemaps:discover': async () => {
      throw new Error('not used')
    }
  }
  return { client: { ...base, ...overrides } as StructureClient, track, parse }
}

type Rendered = ReturnType<typeof fakeClient> & {
  onTracked: ReturnType<typeof vi.fn>
  view: ReturnType<typeof render>
}

/** Step 1 → Preview, through the wizard footer's primary. */
async function toPreview(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: /^Preview \d+ pages?$/ }))
  return screen.findByRole('grid', { name: 'Pages that match your choices' })
}

/** Preview → How to track. */
function toTrack(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Choose how to track' }))
}

async function renderScreen(overrides: Partial<StructureClient> = {}): Promise<Rendered> {
  const fake = fakeClient(overrides)
  const onTracked = vi.fn()
  const view = render(
    <ImportPagesScreen client={fake.client} project={PROJECT} onTracked={onTracked} />
  )
  await screen.findByText(/already tracked$/)
  return { ...fake, onTracked, view }
}

describe('ImportPagesScreen', () => {
  it('shows what the sitemap found and starts with nothing chosen', async () => {
    await renderScreen()
    expect(screen.getByText(/in 2 sitemaps/)).toBeTruthy()
    expect(screen.getByText(/tag-sitemap.xml left out/)).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Import steps' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Preview 0 pages' })).toHaveProperty('disabled', true)
    expect(screen.getByText('No searches are used until pages are tracked.')).toBeTruthy()
    const links = screen.getByRole('button', { name: /most internal links/ })
    expect(links).toHaveProperty('disabled', true)
  })

  it('tracks the pages of a ticked folder with the default market', async () => {
    const { track, onTracked } = await renderScreen()
    fireEvent.click(screen.getByRole('checkbox', { name: /\/blog\// }))
    await screen.findByText(/2 pages · 10–20 searches per check/)
    const grid = await toPreview()
    // Two new pages plus the tracked one, which stays shown.
    expect(
      within(grid).getByRole('checkbox', { name: 'Track 10dlc registration guide' })
    ).toBeTruthy()
    expect(
      within(grid).getByRole('checkbox', { name: 'Text alerts is already tracked' })
    ).toHaveProperty('disabled', true)
    fireEvent.click(within(grid).getByRole('checkbox', { name: 'Track Email to sms' }))
    toTrack()
    await screen.findByText(/1 page × 5 questions × 1 market × 1–2 searches = 5–10/)
    const button = await screen.findByRole('button', { name: 'Track 1 page' })
    fireEvent.click(button)
    await waitFor(() => expect(track).toHaveBeenCalledTimes(1))
    expect(track.mock.calls[0]?.[0]).toEqual({
      projectId: 'proj-1',
      pageIds: ['page-blog-10dlc-registration-guide'],
      urls: [],
      markets: [
        { country: 'US', language: 'en', location: null, device: 'desktop', localWording: false }
      ],
      intervalDays: 30,
      samples: 1,
      promptCount: 5,
      stagger: true
    })
    await screen.findByText(/Tracking 1 page\. First checks spread from Oct 20, 2026/)
    expect(onTracked).toHaveBeenCalledTimes(1)
  })

  it('offers every project market, default ticked, and counts only pages that need setup', async () => {
    const estimate = vi.fn(async (request: ImportEstimateRequest) => estimateFor(request))
    const { track } = await renderScreen({ 'import:estimate': estimate })
    fireEvent.click(screen.getByRole('checkbox', { name: /\/blog\// }))
    await toPreview()
    toTrack()
    const us = screen.getByRole('checkbox', { name: '🇺🇸 US · EN' })
    const uk = screen.getByRole('checkbox', { name: '🇬🇧 UK · EN' })
    expect(us).toHaveProperty('checked', true)
    expect(uk).toHaveProperty('checked', false)
    fireEvent.click(uk)
    await screen.findByText(/2 pages × 5 questions × 2 markets/)
    const last = estimate.mock.calls.at(-1)?.[0]
    expect(last).toMatchObject({ pageCount: 2, setupPageCount: 1, marketCount: 2 })
    expect(screen.getByText(/Setting up 1 page takes about 3 AI calls/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Track 2 pages' }))
    await waitFor(() => expect(track).toHaveBeenCalledTimes(1))
    expect(track.mock.calls[0]?.[0].markets.map((market) => market.country)).toEqual(['US', 'UK'])
  })

  it('adds pasted URLs, lists rejected lines, and tracks the new URL', async () => {
    const { parse, track } = await renderScreen()
    fireEvent.click(screen.getByRole('radio', { name: 'Paste URLs' }))
    fireEvent.change(screen.getByLabelText('Page URLs'), {
      target: { value: 'https://textbolt.com/new-page/\nhttps://other.com/x' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add these URLs' }))
    await waitFor(() => expect(parse).toHaveBeenCalledTimes(1))
    expect(parse.mock.calls[0]?.[0].format).toBe('lines')
    await screen.findByText(/Not a textbolt.com page/)
    expect(screen.getByText(/1 repeated line skipped/)).toBeTruthy()
    await toPreview()
    toTrack()
    fireEvent.click(await screen.findByRole('button', { name: 'Track 1 page' }))
    await waitFor(() => expect(track).toHaveBeenCalledTimes(1))
    expect(track.mock.calls[0]?.[0].urls).toEqual(['https://textbolt.com/new-page/'])
    expect(track.mock.calls[0]?.[0].pageIds).toEqual([])
  })

  it('imports a CSV or Excel file through the stacked Import a file drawer', async () => {
    resetDrawersForTests()
    const { parse } = await renderScreen()
    fireEvent.click(screen.getByRole('radio', { name: 'CSV or Excel file' }))
    expect(screen.queryByText(/column named url/u)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Choose a file…' }))
    expect(window.location.hash).toContain('drawer=import&import.entity=pages')
    // The drawer gives back the checked rows; their addresses join the selection with
    // the labels the file gave them (W3I-C2).
    act(() =>
      closeDrawer(0, [
        { row: 2, values: { url: 'https://textbolt.com/new-page/', label: 'New' } },
        { row: 3, values: { url: '' } }
      ])
    )
    await waitFor(() => expect(parse).toHaveBeenCalledTimes(1))
    expect(parse.mock.calls[0]?.[0]).toMatchObject({
      format: 'csv',
      text: 'url,label\nhttps://textbolt.com/new-page/,New'
    })
    resetDrawersForTests()
  })

  it('selects by cluster, money pages and rules', async () => {
    await renderScreen()
    fireEvent.click(screen.getByRole('button', { name: '10DLC & compliance' }))
    expect(
      screen.getByRole('button', { name: '10DLC & compliance' }).getAttribute('aria-pressed')
    ).toBe('true')
    await screen.findByRole('button', { name: 'Preview 1 page' })
    fireEvent.click(screen.getByRole('button', { name: /Money pages/ }))
    await screen.findByRole('button', { name: 'Preview 2 pages' })
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    fireEvent.change(screen.getByLabelText('Rule 1 condition'), {
      target: { value: 'not_contains' }
    })
    fireEvent.change(screen.getByLabelText('Rule 1 value'), { target: { value: 'pricing' } })
    expect(screen.getByText('1 page left out')).toBeTruthy()
    await screen.findByRole('button', { name: 'Preview 1 page' })
  })

  it("shows CiteFox AI's pick errors in plain words", async () => {
    await renderScreen()
    fireEvent.click(screen.getByRole('button', { name: /Pick the pages most likely/ }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('CiteFox AI is not signed in')
  })

  it("adds CiteFox AI's pick to the selection and can remove it", async () => {
    await renderScreen({
      'import:claudePick': async () => ({
        pageIds: ['page-pricing'],
        reasons: ['Pricing pages answer cost questions directly']
      })
    })
    fireEvent.click(screen.getByRole('button', { name: /Pick the pages most likely/ }))
    await screen.findByText('Added 1 page to your selection.')
    await screen.findByRole('button', { name: 'Preview 1 page' })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await screen.findByRole('button', { name: 'Preview 0 pages' })
  })

  it('groups the preview by folder, filters it, and leaves pages out with one box per row', async () => {
    await renderScreen()
    fireEvent.click(screen.getByRole('checkbox', { name: /\/blog\// }))
    const grid = await toPreview()
    fireEvent.click(within(grid).getByRole('button', { name: /^\/blog\// }))
    expect(within(grid).queryByText('Email to sms')).toBeNull()
    fireEvent.click(within(grid).getByRole('button', { name: /^\/blog\// }))
    // No second selection box: the Track box is the only one on a row.
    expect(within(grid).queryByRole('checkbox', { name: 'Select Email to sms' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Preview actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Leave all shown out' }))
    await screen.findByRole('button', { name: 'Choose how to track' })
    expect(screen.getByText(/3 pages in this preview · 0 chosen/)).toBeTruthy()
    fireEvent.click(within(grid).getByRole('checkbox', { name: 'Track Email to sms' }))
    expect(screen.getByText(/3 pages in this preview · 1 chosen/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search the preview by title or path'), {
      target: { value: 'nothing-matches' }
    })
    expect(screen.getByText('No pages match “nothing-matches”')).toBeTruthy()
  })

  it('has no axe violations with a selection', async () => {
    const { view } = await renderScreen()
    fireEvent.click(screen.getByRole('checkbox', { name: /\/blog\// }))
    await screen.findByText(/searches per check/)
    await toPreview()
    const result = await axe.run(view.container, { rules: { region: { enabled: false } } })
    expect(result.violations.map((violation) => violation.id)).toEqual([])
  })

  it('asks for a project first', () => {
    const { client } = fakeClient()
    render(<ImportPagesScreen client={client} project={null} onTracked={() => undefined} />)
    expect(screen.getByText('Create a project before importing pages.')).toBeTruthy()
  })
})

describe('Import pages drill-downs (NFR-14)', () => {
  async function openCount(name: string): Promise<{ button: HTMLElement; dialog: HTMLElement }> {
    const button = screen.getByRole('button', { name })
    expect(button.tagName).toBe('BUTTON')
    const id = button.getAttribute('data-nfr-drill') ?? ''
    const figure = Number(button.querySelector(`[data-nfr-figure="${id}"]`)?.textContent)
    button.focus()
    fireEvent.click(button)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toMatch(
      new RegExp(`· ${figure} pages?$`)
    )
    expect(dialog.querySelectorAll('[data-drill-row]')).toHaveLength(figure)
    return { button, dialog }
  }

  it('folder and cluster counts open the pages they count', async () => {
    await renderScreen()
    const tracked = await openCount('1 tracked in /blog/')
    fireEvent.keyDown(tracked.dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(tracked.button)
    const all = await openCount('3 pages in /blog/')
    fireEvent.keyDown(all.dialog, { key: 'Escape' })
    await openCount('1 page in 10DLC & compliance')
  })

  it('the already-tracked count opens All pages on tracked pages', async () => {
    await renderScreen()
    expect(screen.getByRole('link', { name: /already tracked/ }).getAttribute('href')).toBe(
      pagesHash({ view: 'tracked' })
    )
  })

  it('preview titles, Already tracked and clusters link on; a row click toggles it', async () => {
    await renderScreen()
    fireEvent.click(screen.getByRole('checkbox', { name: /\/blog\// }))
    const grid = await toPreview()
    expect(within(grid).getByRole('link', { name: 'Text alerts' }).getAttribute('href')).toBe(
      pageHash('page-blog-text-alerts')
    )
    expect(
      within(grid)
        .getByRole('link', { name: /10dlc registration guide/ })
        .getAttribute('href')
    ).toBe('https://textbolt.com/blog/10dlc-registration-guide/')
    expect(
      within(grid)
        .getByRole('link', { name: 'Already tracked: open Text alerts' })
        .getAttribute('href')
    ).toBe(pageHash('page-blog-text-alerts'))
    expect(
      within(grid)
        .getByRole('link', { name: 'Cluster 10DLC & compliance on Site structure' })
        .getAttribute('href')
    ).toBe(structureHash('c-10dlc'))
    const box = within(grid).getByRole('checkbox', { name: 'Track Email to sms' })
    expect(box).toHaveProperty('checked', true)
    const row = box.closest<HTMLElement>('[data-row]')
    fireEvent.click(row?.querySelector<HTMLElement>('.mono') ?? grid)
    expect(within(grid).getByRole('checkbox', { name: 'Track Email to sms' })).toHaveProperty(
      'checked',
      false
    )
  })

  it("CiteFox AI's pick count opens the picked pages", async () => {
    await renderScreen({
      'import:claudePick': async () => ({
        pageIds: ['page-pricing', 'page-blog-email-to-sms'],
        reasons: []
      })
    })
    fireEvent.click(screen.getByRole('button', { name: /Pick the pages most likely/ }))
    const button = await screen.findByRole('button', { name: 'Show the 2 pages CiteFox AI picked' })
    fireEvent.click(button)
    const dialog = await screen.findByRole('dialog')
    expect(dialog.querySelectorAll('[data-drill-row]')).toHaveLength(2)
  })

  it('lists every rejected line on request', async () => {
    const rejected = Array.from({ length: 25 }, (_, index) => ({
      line: index + 1,
      value: `https://other.com/${index}`,
      reason: 'Not a textbolt.com page'
    }))
    await renderScreen({
      'import:parseUrls': async () => ({ rows: [], rejected, duplicates: 0 })
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Paste URLs' }))
    fireEvent.change(screen.getByLabelText('Page URLs'), {
      target: { value: 'https://other.com/x' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add these URLs' }))
    const more = await screen.findByRole('button', { name: 'Show all 25' })
    expect(screen.getAllByText(/Not a textbolt.com page/)).toHaveLength(20)
    fireEvent.click(more)
    expect(screen.getAllByText(/Not a textbolt.com page/)).toHaveLength(25)
  })
})
