// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { CommunityAio, Market, VideoIdea, VideoScreen } from '@shared/domain'
import { VideosScreen } from '.'
import type { VideosSource } from './source'

function market(id: string, country: string): Market {
  return {
    id,
    country,
    language: 'en',
    location: null,
    device: 'desktop',
    localWording: false,
    serpapiLocation: null
  }
}

const MARKETS: Market[] = [market('us', 'US'), market('uk', 'GB')]

function aio(key: string, partial: Partial<CommunityAio> = {}): CommunityAio {
  return {
    key,
    runId: 'run-1',
    pageId: 'page-1',
    pageLabel: 'Alerts',
    marketId: 'us',
    promptId: `prompt-${key}`,
    promptPosition: Number(key.replace(/\D/g, '')) || 1,
    label: `Question **${key}**`,
    text: `How do I ${key}?`,
    status: 'not_cited',
    named: false,
    checkedAt: '2026-10-19T12:00:00Z',
    latest: true,
    ...partial
  }
}

const AIOS: CommunityAio[] = [
  aio('a1'),
  aio('a2', { marketId: 'uk' }),
  aio('a3', { status: 'page_cited' }),
  aio('a4', { pageId: 'page-2', marketId: 'uk' }),
  aio('b0', { latest: false, runId: 'run-0', checkedAt: '2026-09-01T12:00:00Z' })
]

const IDEA: VideoIdea = {
  id: 'vi-1',
  saved: true,
  step: 'tracking',
  question: 'How do I alert the crew?',
  pageId: 'page-1',
  pageLabel: 'Alerts',
  pageUrl: 'https://textbolt.com/alerts',
  promptIds: ['prompt-a1', 'prompt-a4'],
  promptPositions: [1, 4],
  prompts: [
    { promptId: 'prompt-a1', pageId: 'page-1', position: 1 },
    { promptId: 'prompt-a4', pageId: 'page-2', position: 4 }
  ],
  evidence: 3,
  // 'gone' is no longer stored: the drawer still lists it, so 3 = 3 rows.
  evidenceKeys: ['a1', 'a2', 'gone'],
  evidencePages: 1,
  marketIds: ['uk', 'us'],
  videos: [],
  competitorVideo: true,
  deadline: null,
  brief: {
    title: 'Alert your crew',
    hook: 'h',
    chapters: [],
    script: [],
    sources: [{ n: 1, section: 'Text alerts', onPage: false }],
    description: 'd',
    thumbnailText: 't',
    tags: [],
    scenes: [],
    writtenAt: '2026-10-20T00:00:00Z',
    templateHash: 'x'
  },
  checklist: [],
  sentToFoxcueAt: null,
  videoUrl: 'https://youtube.com/watch?v=abc',
  trackingStartedAt: '2026-09-02T00:00:00Z',
  tracking: {
    beforeAt: '2026-09-01T12:00:00Z',
    beforeCiting: 1,
    beforeAios: 2,
    beforeKeys: ['b0'],
    nowAt: '2026-10-19T12:00:00Z',
    nowCiting: 1,
    nowAios: 2,
    nowKeys: ['a1'],
    openKeys: ['a2']
  }
}

const SCREEN: VideoScreen = {
  projectId: 'proj-1',
  pageId: null,
  marketId: null,
  builtAt: '2026-10-20T00:00:00Z',
  checkedAt: '2026-10-19T12:00:00Z',
  markets: MARKETS,
  aios: AIOS,
  stats: {
    aiosShown: 4,
    aiosShownKeys: ['a1', 'a2', 'a3', 'a4'],
    prompts: 4,
    citingVideo: 3,
    citingVideoKeys: ['a1', 'a2', 'a4'],
    citingYours: 1,
    citingYoursKeys: ['a1'],
    openSlots: 2,
    openSlotKeys: ['a2', 'a4'],
    competitorChannels: 2,
    competitorChannelNames: ['Ops Shortcuts', 'Rival'],
    competitorChannelKeys: [
      { name: 'Ops Shortcuts', keys: ['a2', 'a4'] },
      { name: 'Rival', keys: ['a4'] }
    ]
  },
  ideas: [IDEA],
  extras: { youtubeKey: true, ownChannel: null, threadsChecked: 0, videosWithDetails: 0 }
}

function pending<T>(): Promise<T> {
  return new Promise<T>(() => undefined)
}

const SOURCE: VideosSource = {
  'videos:get': async () => SCREEN,
  'videos:writeBrief': pending,
  'videos:update': pending,
  'videos:markSent': pending,
  'videos:track': pending,
  'videos:export': pending,
  'communities:refreshVideos': pending,
  'communities:getSettings': pending,
  'communities:setSettings': pending
}

async function mount(): Promise<HTMLElement> {
  const { container } = render(<VideosScreen projectId="proj-1" pages={[]} source={SOURCE} />)
  await screen.findByRole('heading', { name: 'Videos in AI Overviews' })
  return container
}

function drawer(): HTMLElement {
  return screen.getByRole('dialog')
}

/** Opens a drill control and checks the drawer total equals the number on it. */
function expectTotal(control: HTMLElement, total: number): void {
  const figure = control.querySelector('[data-nfr-figure]')
  expect(figure?.textContent).toBe(String(total))
  fireEvent.click(control)
  const dialog = drawer()
  expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toMatch(
    new RegExp(`· ${total} (answer|answers|channel|channels)$`)
  )
  expect(within(dialog).getAllByRole('row')).toHaveLength(total + 1)
}

beforeEach(() => {
  window.location.hash = ''
})

afterEach(() => cleanup())

describe('YouTube drill-downs (NFR-14)', () => {
  test('every KPI tile opens exactly the answers it counts', async () => {
    await mount()
    const tiles: [string, number][] = [
      ['4 overviews shown. Show the answers', 4],
      ['Cite at least one YouTube video: 3. Show the answers', 3],
      ['Cite your video: 1. Show the answers', 1],
      ['Open video slots: 2. Show the answers', 2],
      ['Competitor channels cited: 2. Show the channels', 2],
      ['Ops Shortcuts: 2 overviews. Show them', 2],
      ['Rival: 1 overviews. Show them', 1]
    ]
    for (const [name, total] of tiles) {
      expectTotal(screen.getByRole('button', { name }), total)
      fireEvent.keyDown(drawer(), { key: 'Escape' })
      expect(screen.queryByRole('dialog')).toBeNull()
    }
  })

  test('an answer opens Question detail in its market and check', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Open video slots: 2. Show the answers' }))
    const link = within(drawer()).getByRole('link', { name: 'Question a4' })
    expect(link.getAttribute('href')).toBe('#/pages/page-2/prompt/prompt-a4?market=uk')
  })

  test('evidence keeps answers no longer stored, so the count matches', async () => {
    await mount()
    const table = screen.getByRole('grid', { name: 'Video opportunities' })
    expectTotal(
      within(table).getByRole('button', { name: '3 questions show a video. Show them' }),
      3
    )
    expect(within(drawer()).getByText('An answer from an older check')).toBeTruthy()
  })

  test('market tags open that market’s evidence; status selects the idea', async () => {
    await mount()
    const table = screen.getByRole('grid', { name: 'Video opportunities' })
    const tags = within(table).getAllByRole('button', { name: /: 1 overviews show a video/ })
    expect(tags).toHaveLength(2)
    for (const tag of tags) {
      fireEvent.click(tag)
      expect(within(drawer()).getAllByRole('row')).toHaveLength(2)
      fireEvent.keyDown(drawer(), { key: 'Escape' })
    }
    const status = within(table).getByRole('button', { name: /^Tracking: open the flow/ })
    expect(status.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(status)
    expect(status.getAttribute('aria-pressed')).toBe('true')
    expect(window.location.hash).toBe('#/?idea=vi-1')
    expect(screen.getByRole('dialog', { name: 'Alert your crew' })).toBeTruthy()
  })

  test('page and question labels link to the page and Question detail', async () => {
    await mount()
    const table = screen.getByRole('grid', { name: 'Video opportunities' })
    expect(within(table).getByRole('link', { name: 'Alerts' }).getAttribute('href')).toBe(
      '#/pages/page-1/results'
    )
    expect(
      within(table)
        .getByRole('link', { name: 'Open question 4 in Question detail' })
        .getAttribute('href')
    ).toBe('#/pages/page-2/prompt/prompt-a4')
    fireEvent.click(within(table).getByRole('button', { name: 'Alert your crew' }))
    const panel = screen.getByRole('dialog', { name: 'Alert your crew' })
    const steps = within(panel).getByRole('navigation', { name: 'Steps' })
    fireEvent.click(within(steps).getByRole('button', { name: /Question/ }))
    expect(
      within(panel).getByRole('link', { name: 'Open the page in CiteFox' }).getAttribute('href')
    ).toBe('#/pages/page-1/results')
    fireEvent.click(within(steps).getByRole('button', { name: /Brief/ }))
    expect(
      within(panel)
        .getByRole('link', { name: "Not on the page yet: see the page's content gaps" })
        .getAttribute('href')
    ).toBe('#/pages/page-1/gaps')
  })

  test('Your videos: before, now and open each drill to their own answers', async () => {
    await mount()
    fireEvent.click(screen.getByRole('tab', { name: /^Your videos/ }))
    const yours = screen.getByRole('grid', { name: 'Your tracked videos' })
    const before = within(yours).getByRole('button', {
      name: '1 of 2 answers: Overviews citing your video before. Show them'
    })
    expectTotal(before, 1)
    expect(within(drawer()).getByRole('link', { name: 'Question b0' }).getAttribute('href')).toBe(
      '#/pages/page-1/prompt/prompt-b0?market=us&run=run-0'
    )
    fireEvent.keyDown(drawer(), { key: 'Escape' })
    expectTotal(
      within(yours).getByRole('button', {
        name: '1 of 2 answers: Overviews citing your video. Show them'
      }),
      1
    )
    fireEvent.keyDown(drawer(), { key: 'Escape' })
    expectTotal(within(yours).getByRole('button', { name: '1 open questions. Show them' }), 1)
  })

  test('keyboard: Enter opens, Escape closes, focus returns to the number', async () => {
    await mount()
    const tile = screen.getByRole('button', { name: 'Open video slots: 2. Show the answers' })
    tile.focus()
    // A native button activates on Enter; the browser turns it into a click.
    fireEvent.keyDown(tile, { key: 'Enter' })
    fireEvent.click(tile)
    const dialog = drawer()
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(tile))
  })
})

describe('YouTube layout (UI kit)', () => {
  test('four KPI tiles, no sponsor card in the content, no h1 of its own', async () => {
    const container = await mount()
    expect(container.querySelectorAll('.ui-kpi')).toHaveLength(4)
    expect(screen.queryByRole('complementary', { name: 'Sponsored placement' })).toBeNull()
    expect(container.querySelector('h1')).toBeNull()
  })

  test('market, step and tab live in the URL', async () => {
    await mount()
    fireEvent.click(screen.getByRole('combobox', { name: 'Market' }))
    const markets = screen.getByRole('listbox', { name: 'Market' })
    fireEvent.click(within(markets).getByRole('option', { name: /GB/ }))
    expect(window.location.hash).toBe('#/?market=uk')
    const steps = screen.getByRole('group', { name: 'Step' })
    fireEvent.click(within(steps).getByRole('button', { name: /^Tracking/ }))
    expect(window.location.hash).toBe('#/?market=uk&step=tracking')
    fireEvent.click(screen.getByRole('tab', { name: /^Your videos/ }))
    expect(window.location.hash).toBe('#/?market=uk&step=tracking&tab=yours')
    expect(screen.getByRole('combobox', { name: 'Scope' })).toBeTruthy()
  })

  test('an idea opens from the URL in a drawer on its step; Escape closes it', async () => {
    window.location.hash = '#/youtube?idea=vi-1'
    await mount()
    const panel = await screen.findByRole('dialog', { name: 'Alert your crew' })
    // A tracked idea opens on Track; the step is in the header too.
    expect(within(panel).getByRole('heading', { name: '6 · Track' })).toBeTruthy()
    expect(panel.textContent).toContain('Step 6 of 6')
    fireEvent.keyDown(panel, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(window.location.hash).toBe('#/youtube')
  })

  test('the stepper and Back / Next move through the steps on the URL', async () => {
    window.location.hash = '#/youtube?idea=vi-1&idea.step=brief'
    await mount()
    const panel = await screen.findByRole('dialog', { name: 'Alert your crew' })
    expect(within(panel).getByRole('heading', { name: '2 · Brief' })).toBeTruthy()
    const steps = within(panel).getByRole('navigation', { name: 'Steps' })
    expect(
      within(steps)
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual([
      '✓Question (done)',
      '✓Brief (done)',
      '✓Storyboard (done)',
      '✓Make (done)',
      '✓Publish (done)',
      '✓Track (done)'
    ])
    fireEvent.click(within(panel).getByRole('button', { name: /^Next: Storyboard/ }))
    await waitFor(() => expect(window.location.hash).toContain('idea.step=storyboard'))
    expect(within(panel).getByRole('heading', { name: '3 · Storyboard' })).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: /^Back/ }))
    await waitFor(() => expect(window.location.hash).toContain('idea.step=brief'))
    fireEvent.click(within(steps).getByRole('button', { name: /Make/ }))
    expect(within(panel).getByRole('heading', { name: '4 · Make it' })).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: 'Close Alert your crew' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(window.location.hash).toBe('#/youtube')
  })

  test('a stale idea link says the idea is gone', async () => {
    window.location.hash = '#/youtube?idea=nope'
    await mount()
    const panel = await screen.findByRole('dialog', { name: 'Video idea' })
    expect(panel.textContent).toContain('This idea is not in this scope any more.')
  })
})
