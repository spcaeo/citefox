// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrandFact, BrandPromptSet, SentimentView } from '@shared/domain'
import type { PageDetail, SaveBrandPromptsRequest, SentimentUpdated } from '@shared/ipc'
import { netSentiment, ownClaims, toneCounts } from '@shared/sentiment-metrics'
import { promptHash } from '../shell/routes'
import { SentimentScreen } from '.'
import { SENTIMENT_MARKET, SENTIMENT_PAGE, SENTIMENT_PROJECT, sentimentView } from './fixtures'
import type { SentimentSource } from './source'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

const PAGE: PageDetail = {
  id: SENTIMENT_PAGE,
  projectId: SENTIMENT_PROJECT,
  url: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
  title: 'Alerts',
  label: 'Text alerts for business',
  folder: null,
  status: 'tracked',
  setupStep: null,
  intervalDays: 14,
  samples: 1,
  promptCount: 8,
  defaultMarketId: SENTIMENT_MARKET,
  pinned: false,
  score: 50,
  promptSetVersion: 1,
  markets: [
    {
      id: SENTIMENT_MARKET,
      country: 'US',
      language: 'en',
      location: null,
      device: 'desktop',
      localWording: false,
      serpapiLocation: null
    }
  ],
  snapshotId: 'snap-1'
}

interface Fake {
  source: SentimentSource
  calls: string[]
  saved: SaveBrandPromptsRequest[]
  emit: (payload: SentimentUpdated) => void
}

function fakeSource(view: SentimentView): Fake {
  const calls: string[] = []
  const saved: SaveBrandPromptsRequest[] = []
  let listener: ((payload: SentimentUpdated) => void) | null = null
  const facts: BrandFact[] = [...view.facts]
  const set: BrandPromptSet = view.brandPrompts
  const source: SentimentSource = {
    'sentiment:get': vi.fn(async () => {
      calls.push('get')
      return { ...view, facts: [...facts] }
    }),
    'sentiment:generateBrandPrompts': vi.fn(async () => {
      calls.push('generate')
      return set
    }),
    'sentiment:saveBrandPrompts': vi.fn(async (request: SaveBrandPromptsRequest) => {
      calls.push('save')
      saved.push(request)
      return { ...set, version: 2 }
    }),
    'sentiment:listFacts': vi.fn(async () => facts),
    'sentiment:addFact': vi.fn(async (request) => {
      calls.push(`add:${request.text}`)
      facts.push({ id: 'fact-new', text: request.text, source: request.source, addedAt: 'x' })
      return facts
    }),
    'sentiment:deleteFact': vi.fn(async (request) => {
      calls.push(`delete:${request.factId}`)
      return facts
    }),
    'sentiment:reread': vi.fn(async () => {
      calls.push('reread')
      return { started: true, overviews: 13, message: 'Re-reading 13 saved overviews.' }
    }),
    'sentiment:updated': (next) => {
      listener = next
      return () => {
        listener = null
      }
    }
  }
  return { source, calls, saved, emit: (payload) => listener?.(payload) }
}

async function renderTab(view: SentimentView = sentimentView()): Promise<{
  fake: Fake
  tab: HTMLElement
}> {
  const fake = fakeSource(view)
  const screen = render(
    <SentimentScreen
      source={fake.source}
      projectId={SENTIMENT_PROJECT}
      page={PAGE}
      marketId={SENTIMENT_MARKET}
    />
  )
  const tab = screen.getByTestId('sentiment-tab')
  await waitFor(() => expect(within(tab).queryByText('Loading sentiment…')).toBeNull())
  return { fake, tab }
}

function openDrawer(button: HTMLElement): HTMLElement {
  fireEvent.click(button)
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
  if (!dialog) throw new Error('no drawer')
  return dialog
}

function closeDrawer(dialog: HTMLElement): void {
  fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' })[0] as HTMLElement)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
}

/** Opens the drawer behind a drill button and returns the listed row count. */
function drawerCount(button: HTMLElement): number {
  const dialog = openDrawer(button)
  const rows = dialog.querySelectorAll('[data-drill-row]').length
  const heading = dialog.querySelector('h2')?.textContent ?? ''
  if (!/ · \d+ (claim|claims|overview|overviews|check|checks)$/.test(heading)) {
    throw new Error(`heading has no count: ${heading}`)
  }
  expect(heading.endsWith(` · ${rows} ${heading.split(' ').at(-1) ?? ''}`)).toBe(true)
  closeDrawer(dialog)
  return rows
}

/** Opens a section tab (Overview, Answers, Themes, Problems, Facts & prompts). */
function showTab(tab: HTMLElement, name: RegExp): void {
  fireEvent.click(within(tab).getByRole('tab', { name }))
}

function leadingNumber(button: HTMLElement): number {
  const match = /^-?\d+/.exec(button.getAttribute('aria-label') ?? '')
  if (!match) throw new Error(`no number in ${button.getAttribute('aria-label') ?? ''}`)
  return Number(match[0])
}

describe('SentimentScreen', () => {
  it('shows the KPI numbers from the shared metrics', async () => {
    const { tab } = await renderTab()
    const own = ownClaims(sentimentView().claims)
    const net = netSentiment(toneCounts(own))
    expect(net).toBe(26)
    const summary = within(tab).getByRole('region', { name: 'Sentiment summary' })
    expect(
      within(summary).getByRole('button', { name: /^Net sentiment \+26 from 19 claims/ })
    ).toBeTruthy()
    expect(summary.textContent).toContain('−10 since Oct 5')
    expect(within(summary).getByRole('button', { name: '10 positive, show them' })).toBeTruthy()
    expect(within(summary).getByRole('button', { name: '5 negative, show them' })).toBeTruthy()
    expect(
      within(summary).getByRole('button', { name: /^7 of 13 read overviews name TextBolt/ })
    ).toBeTruthy()
  })

  it('shows "Not enough data" below 5 claims', async () => {
    const view = sentimentView()
    const few = view.claims.filter((claim) => claim.isOwn).slice(0, 4)
    const { tab } = await renderTab({ ...view, claims: few })
    const summary = within(tab).getByRole('region', { name: 'Sentiment summary' })
    expect(summary.textContent).toContain('Not enough data')
  })

  it('every drill drawer lists exactly the number that opened it (NFR-14)', async () => {
    const { tab } = await renderTab()
    const ids = new Set<string>()
    for (const name of [/^Overview/, /^Answers/, /^Themes/, /^Problems/, /^Facts/]) {
      showTab(tab, name)
      for (const button of tab.querySelectorAll<HTMLElement>('button[data-nfr-drill]')) {
        const id = button.getAttribute('data-nfr-drill') ?? ''
        const figure = tab.querySelector(`[data-nfr-figure="${CSS.escape(id)}"]`)
        expect(figure, id).not.toBeNull()
        expect(drawerCount(button), id).toBe(Number(figure?.textContent))
        ids.add(id)
      }
    }
    // Every section drills: KPIs, tone split, share, trend, problems, answers, themes,
    // negative sources, the matrix and the brand prompts.
    for (const id of [
      'claims:own',
      'claims:tone:positive',
      'overviews:named',
      'overviews:brand:SimpleTexting',
      'trend:run-sep-21',
      'trend:run-oct-5',
      'trend:run-oct-19',
      'claims:problems',
      'theme:Pricing',
      'theme:Pricing:negative',
      'claims:negative',
      'matrix:Replies:SimpleTexting',
      'brand-prompt:bp-1'
    ]) {
      expect(ids.has(id), id).toBe(true)
    }
    // About 30 drawers open and close here; a loaded full run needs the room.
  }, 30_000)

  it('every older check on the trend drills to the claims it counts', async () => {
    const { tab } = await renderTab()
    const trend = within(tab).getByRole('region', { name: 'Net sentiment over time' })
    expect(drawerCount(within(trend).getByRole('button', { name: /^Sep 21 · 12 claims/ }))).toBe(12)
    expect(drawerCount(within(trend).getByRole('button', { name: /^Oct 5 · 22 claims/ }))).toBe(22)
  })

  it('claim rows link to Question detail and to their source in the browser', async () => {
    const { tab } = await renderTab()
    const view = sentimentView()
    const dialog = openDrawer(
      within(tab).getByRole('button', { name: /^Net sentiment \+26 from 19 claims/ })
    )
    const buyer = view.claims.find((claim) => claim.isOwn && claim.source === 'buyer')
    if (!buyer) throw new Error('fixture has no buyer claim')
    const href = promptHash(SENTIMENT_PAGE, buyer.promptId, {
      marketId: SENTIMENT_MARKET,
      runId: buyer.runId
    })
    expect(dialog.querySelector(`a[href="${href}"]`)).not.toBeNull()
    const sourced = view.claims.find((claim) => claim.isOwn && claim.url !== null)
    const external = dialog.querySelector<HTMLAnchorElement>(
      `a[href="${sourced?.url ?? ''}"][target="_blank"]`
    )
    expect(external?.getAttribute('rel')).toBe('noopener noreferrer')
    // Enter on a buyer claim row opens Prompt detail; a brand claim row expands instead.
    const rows = [...dialog.querySelectorAll<HTMLElement>('[data-drill-row]')]
    const buyerRow = rows.find((row) => row.querySelector(`a[href="${href}"]`))
    if (!buyerRow) throw new Error('no buyer row')
    fireEvent.keyDown(buyerRow, { key: 'Enter' })
    expect(window.location.hash).toBe(href)
  })

  it('a brand claim expands to the overview it comes from', async () => {
    const { tab } = await renderTab()
    const dialog = openDrawer(
      within(tab).getByRole('button', { name: /^Net sentiment \+26 from 19 claims/ })
    )
    const toggle = within(dialog).getAllByRole('button', { name: /^Show more about/ })[0]
    if (!toggle) throw new Error('no expand toggle')
    fireEvent.click(toggle)
    const detail = document.getElementById(toggle.getAttribute('aria-controls') ?? '')
    expect(detail?.textContent).toContain('Nearest source')
    expect(detail?.textContent).toContain('Brand question')
  })

  it('Answer by answer: buyer questions link, the rank opens the answer drawer', async () => {
    const { tab } = await renderTab()
    showTab(tab, /^Answers/)
    const answers = within(tab).getByRole('region', { name: 'Answers table' })
    const view = sentimentView()
    const buyer = view.overviews.find(
      (overview) => overview.source === 'buyer' && overview.brandsNamed.includes('TextBolt')
    )
    if (!buyer) throw new Error('fixture has no buyer answer')
    const link = within(answers).getByRole('link', {
      name: `Open question detail: ${buyer.promptText}`
    })
    expect(link.getAttribute('href')).toBe(
      promptHash(SENTIMENT_PAGE, buyer.promptId, { marketId: SENTIMENT_MARKET, runId: buyer.runId })
    )
    const rank = within(answers).getAllByRole('button', {
      name: /^Rank #\d+ of \d+ brands? named: show/
    })[0]
    if (!rank) throw new Error('no rank button')
    expect(rank.tagName).toBe('BUTTON')
    fireEvent.click(rank)
    const drawer = await screen.findByTestId('st-answer-drawer')
    expect(window.location.hash).toMatch(/drawer=st-answer&sa\.id=/)
    expect(drawer.textContent).toContain('Brands named, in rank order')
    expect(drawer.textContent).toContain('Sources Google listed')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('st-answer-drawer')).toBeNull())
    await waitFor(() => expect(window.location.hash).not.toContain('st-answer'))
  })

  it('opens an answer from the URL, and keeps the tone filter on the URL', async () => {
    const view = sentimentView()
    const buyer = view.overviews.find(
      (overview) => overview.source === 'buyer' && overview.brandsNamed.includes('TextBolt')
    )
    if (!buyer) throw new Error('fixture has no buyer answer')
    window.location.hash = `#/pages/${SENTIMENT_PAGE}/sentiment?view=answers&drawer=st-answer&sa.id=${buyer.id}`
    const { tab } = await renderTab(view)
    const drawer = await screen.findByRole('dialog', { name: buyer.promptText })
    expect(within(drawer).getByRole('button', { name: 'Open question detail' })).toBeTruthy()
    fireEvent.click(within(drawer).getByRole('button', { name: `Close ${buyer.promptText}` }))
    await waitFor(() => expect(screen.queryByTestId('st-answer-drawer')).toBeNull())
    expect(window.location.hash).not.toContain('sa.id')
    const answers = within(tab).getByRole('region', { name: 'Answers table' })
    const tone = within(answers).getByRole('group', { name: 'Tone' })
    fireEvent.click(within(tone).getByRole('button', { name: /^Negative/ }))
    await waitFor(() => expect(window.location.hash).toContain('tone=negative'))
  })

  it('drill openers are buttons in the tab order; chart marks are mouse twins', async () => {
    const { tab } = await renderTab()
    for (const button of tab.querySelectorAll<HTMLElement>('[data-nfr-drill]')) {
      expect(button.tagName).toBe('BUTTON')
      expect(button.getAttribute('tabindex')).not.toBe('-1')
    }
    const marks = tab.querySelectorAll<HTMLElement>('.mark-btn')
    expect(marks.length).toBeGreaterThan(0)
    for (const mark of marks) {
      expect(mark.getAttribute('tabindex')).toBe('-1')
      expect(mark.closest('[aria-hidden="true"]')).not.toBeNull()
    }
    // A mark opens the same drawer as its labelled count.
    const first = marks[0] as HTMLElement
    const dialog = openDrawer(first)
    expect(dialog.querySelectorAll('[data-drill-row]').length).toBeGreaterThan(0)
    // Escape closes and focus goes back to the opener.
    closeDrawer(dialog)
    const opener = within(tab).getByRole('button', { name: '10 positive, show them' })
    opener.focus()
    fireEvent.click(opener)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    expect(document.activeElement).toBe(opener)
  })

  it('shows the count, not a net, in a brand × theme cell below 2 claims', async () => {
    const { tab } = await renderTab()
    showTab(tab, /^Themes/)
    const table = within(tab).getByRole('grid', { name: /Net sentiment per theme/ })
    const row = within(table).getByRole('row', { name: /^Support/ })
    const few = within(row).getAllByRole('button', { name: /too few for a net/ })
    expect(few.length).toBeGreaterThan(0)
    for (const button of few) expect(drawerCount(button)).toBe(leadingNumber(button))
    const replies = within(table).getByRole('row', { name: /^Replies/ })
    expect(within(replies).getAllByRole('button', { name: /net/ }).length).toBeGreaterThan(0)
  })

  it('adds and removes facts and re-reads saved overviews', async () => {
    const { tab, fake } = await renderTab()
    showTab(tab, /^Facts/)
    const facts = within(tab).getByRole('region', { name: 'Brand facts' })
    fireEvent.change(within(facts).getByLabelText('New brand fact'), {
      target: { value: 'Replies are included on both plans.' }
    })
    fireEvent.click(within(facts).getByRole('button', { name: 'Add fact' }))
    await waitFor(() => expect(fake.calls).toContain('add:Replies are included on both plans.'))
    fireEvent.click(
      within(facts).getByRole('button', { name: 'Remove fact: Plans are $29 and $49 a month.' })
    )
    await waitFor(() => expect(fake.calls).toContain('delete:fact-1'))
    fireEvent.click(within(facts).getByRole('button', { name: /Re-read saved overviews/ }))
    await waitFor(() =>
      expect(within(facts).getByText('Re-reading 13 saved overviews.')).toBeTruthy()
    )
    expect(fake.calls).toContain('reread')
  })

  it('reloads when sentiment:updated names this page', async () => {
    const { fake } = await renderTab()
    const before = fake.calls.filter((call) => call === 'get').length
    fake.emit({ projectId: SENTIMENT_PROJECT, pageId: 'other' })
    fake.emit({ projectId: SENTIMENT_PROJECT, pageId: SENTIMENT_PAGE })
    await waitFor(() => expect(fake.calls.filter((call) => call === 'get').length).toBe(before + 1))
  })

  it('checks that edited brand questions name the brand, then saves the next version', async () => {
    const { tab, fake } = await renderTab()
    showTab(tab, /^Facts/)
    const card = within(tab).getByRole('region', { name: 'Brand questions' })
    expect(card.textContent).toContain('5 questions × 1 market = 5–10 searches per check')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit brand questions' }))
    fireEvent.change(within(card).getByLabelText('Brand question 1'), {
      target: { value: 'best text alert tool reviews' }
    })
    fireEvent.click(within(card).getByRole('button', { name: 'Save brand questions' }))
    expect(within(card).getByRole('alert').textContent).toContain("doesn't name TextBolt")
    expect(fake.saved).toHaveLength(0)
    fireEvent.change(within(card).getByLabelText('Brand question 1'), {
      target: { value: 'TextBolt reviews from IT teams' }
    })
    fireEvent.click(within(card).getByRole('button', { name: 'Save brand questions' }))
    await waitFor(() => expect(fake.saved).toHaveLength(1))
    expect(fake.saved[0]?.prompts[0]).toEqual({
      kind: 'review',
      language: 'en',
      text: 'TextBolt reviews from IT teams'
    })
  })

  it('offers to write brand questions when there are none', async () => {
    const view = sentimentView()
    const { tab, fake } = await renderTab({
      ...view,
      brandPrompts: { ...view.brandPrompts, version: null, prompts: [] }
    })
    showTab(tab, /^Facts/)
    const card = within(tab).getByRole('region', { name: 'Brand questions' })
    fireEvent.click(within(card).getByRole('button', { name: 'AI actions for brand questions' }))
    fireEvent.click(within(document.body).getByRole('menuitem', { name: /^Write brand questions/ }))
    await waitFor(() => expect(fake.calls).toContain('generate'))
  })

  it('shows the empty states', async () => {
    const view = sentimentView()
    const first = await renderTab({
      ...view,
      latestRunId: null,
      overviews: [],
      claims: [],
      trend: []
    })
    expect(first.tab.textContent).toContain(
      'No check yet. Press Check now to see what Google says about TextBolt.'
    )
    cleanup()
    const second = await renderTab({ ...view, brand: null })
    expect(second.tab.textContent).toContain('This project has no brand name yet.')
  })

  it('shows the reading status', async () => {
    const { tab } = await renderTab(
      sentimentView({ reading: { pending: 3, failed: 0, running: false } })
    )
    expect(tab.textContent).toContain(
      '3 overviews not read yet. Re-read saved overviews to read them. No new searches.'
    )
  })

  it('has no axe violations on any section tab', async () => {
    const { tab } = await renderTab()
    for (const name of [/^Overview/, /^Answers/, /^Themes/, /^Problems/, /^Facts/]) {
      showTab(tab, name)
      const result = await axe.run(tab, { rules: { 'color-contrast': { enabled: false } } })
      expect(result.violations.map((violation) => `${String(name)} ${violation.id}`)).toEqual([])
    }
  }, 30_000)

  it('a theme opens its sentences in a drawer on the URL', async () => {
    const { tab } = await renderTab()
    showTab(tab, /^Themes/)
    const theme = within(tab).getByRole('button', { name: 'Pricing' })
    fireEvent.click(theme)
    const dialog = await screen.findByRole('dialog', { name: 'Pricing' })
    expect(within(dialog).getByRole('list', { name: 'Sentences about Pricing' })).toBeTruthy()
    expect(window.location.hash).toMatch(/drawer=st-theme&sth\.id=t[0-9a-z]+/)
    // Opaque key: the theme's name is not on the URL.
    expect(window.location.hash).not.toContain('Pricing')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Pricing' })).toBeNull())
    expect(window.location.hash).not.toContain('st-theme')
  })
})
