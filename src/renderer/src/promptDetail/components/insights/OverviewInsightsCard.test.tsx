// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { useState, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseAiOverview } from '@shared/aio-overview'
import type { AioReference, CitationClass, OverviewLens, SampleCapture } from '@shared/domain'
import koha from '@shared/fixtures/aio-overview-koha.json'
import type { AssistRunRequest } from '@shared/ipc'
import type { AssistClient } from '../../../assist/client'
import { describeMockAssist, runMockAssist } from '../../../assist/mock'
import { AioCard } from '../OverviewCards'
import { depthText, placeText, readItems } from './model'
import { OverviewInsightsCard } from './OverviewInsightsCard'
import type { ShownRead } from './useOverviewRead'
import { formatMoment } from '../../../utils/dates'

afterEach(cleanup)

const LENS: OverviewLens = {
  brandNames: ['TextBolt'],
  ownDomain: 'textbolt.com',
  includeSubdomains: true,
  productName: 'Email to SMS',
  competitors: [
    { name: 'Twilio', domain: 'twilio.com', tier: 'direct' },
    { name: 'MessageBee', domain: 'uniquelibrary.com', tier: 'direct' }
  ]
}

const OVERVIEW = parseAiOverview(koha)

function reference(position: number, url: string, classification: CitationClass): AioReference {
  return {
    id: `ref-${position}`,
    position,
    url,
    normalizedUrl: url,
    domain: new URL(url).hostname,
    title: null,
    classification,
    untracked: false,
    sourceType: 'web'
  }
}

const SAMPLE: SampleCapture = {
  id: 'sample-1',
  sampleNo: 1,
  keyId: null,
  keyLabel: null,
  hasAio: true,
  neededFollowup: true,
  searches: 2,
  errorCode: null,
  message: null,
  nextStep: null,
  aioText: 'flattened text',
  aioMarkdown: null,
  references: [reference(2, 'https://textbolt.com/blog/att-email-to-text-shutdown/', 'target')],
  rawSearchJson: null,
  rawAioJson: JSON.stringify(koha)
}

const SAVED: ShownRead = {
  sampleId: 'sample-1',
  ranAt: '2026-10-22T09:05:00.000Z',
  footnote: null,
  read: {
    positioning: 'TextBolt is one drop-in middleware option, after the API routes.',
    tone: { value: 'neutral', quote: 'You subscribe to a service like TextBolt or .' },
    competitors: [{ name: 'Twilio', reason: 'Low cost.', quote: 'Very low per-message cost' }],
    actions: [
      { text: 'Add a Koha setup section.', basis: 'They give you a unique routing domain.' }
    ],
    confidence: { level: 'medium', reason: 'One sample only.' }
  }
}

function recording(): { client: AssistClient; requests: AssistRunRequest[] } {
  const requests: AssistRunRequest[] = []
  return {
    requests,
    client: {
      describe: describeMockAssist,
      run: async (request) => {
        requests.push(request)
        return runMockAssist(request)
      }
    }
  }
}

function Screen({
  client,
  saved = null,
  onRead = () => undefined
}: {
  client: AssistClient
  saved?: ShownRead | null
  onRead?: (read: ShownRead) => void
}): JSX.Element {
  const [read, setRead] = useState(saved)
  return (
    <>
      <AioCard
        sample={SAMPLE}
        samples={[SAMPLE]}
        sampleIndex={0}
        onSample={() => undefined}
        checkedAt="2026-10-23T10:56:32.000Z"
        marketName="US · EN"
        lens={LENS}
      />
      <OverviewInsightsCard
        sample={SAMPLE}
        overview={OVERVIEW}
        lens={LENS}
        read={read}
        onRead={(next) => {
          setRead(next)
          onRead(next)
        }}
        projectId="p1"
        pageId="page-1"
        marketId="mkt-us"
        promptId="prompt-1"
        assistClient={client}
      />
    </>
  )
}

function card(view: ReturnType<typeof render>): HTMLElement {
  return view.getByRole('region', { name: 'What this overview says about you' })
}

describe('What this overview says about you', () => {
  it('shows the verdict and the observed lines for the Koha overview', async () => {
    const view = render(<Screen client={recording().client} />)
    const body = within(card(view))
    expect(body.getByTestId('overview-verdict').textContent).toBe(
      'Named once and cited 4 times — cited for "The permanent shutdown of AT&T\'s email-to-text gateway…"; named under "3. Middleware Email-to-SMS Gateway (Drop-in Replacement)".'
    )
    expect(body.getByText(/^Named 1 time, first in the 8th of 14 passages/)).toBeTruthy()
    expect(body.getByText('4 of 12 sources are yours; the first is 2nd of 12.')).toBeTruthy()
    expect(
      body.getByRole('button', { name: 'Copy textbolt.com/blog/att-email-to-text-shutdown/' })
    ).toBeTruthy()
    expect(
      body.getByRole('link', {
        name: 'Open textbolt.com/blog/att-email-to-text-shutdown/ in a new tab'
      })
    ).toBeTruthy()
    expect(body.getByText('This page')).toBeTruthy()
    const grid = body.getByRole('grid', { name: 'Competitors named or cited' })
    expect(
      within(grid)
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.querySelector('.site-name-cell')?.textContent)
    ).toEqual(['Twilio', 'MessageBee'])
    // Each competitor's website, with Copy and Open.
    expect(within(grid).getByRole('button', { name: 'Copy twilio.com' })).toBeTruthy()
    expect(body.getByRole('note').textContent).toContain(
      'Google showed a name here that the search data left out'
    )
    expect(card(view).querySelectorAll('mark.aio-brand').length).toBeGreaterThan(0)
    // No hint pointing at the AI menu: the menu is right there.
    expect(body.queryByText(/pick “Analyse with CiteFox AI” in the AI menu/)).toBeNull()
    const result = await axe.run(card(view), { rules: { region: { enabled: false } } })
    expect(result.violations).toEqual([])
  })

  it('scrolls to and flashes the passage a line points at', () => {
    vi.useFakeTimers()
    try {
      const view = render(<Screen client={recording().client} />)
      const body = within(card(view))
      fireEvent.click(
        body.getAllByRole('button', { name: /^Show this passage in the overview/ })[0]!
      )
      const passage = view.container.querySelector('[data-passage="b10.i0"]') as HTMLElement
      expect(passage.classList.contains('is-flash')).toBe(true)
      const chip = passage.querySelector('.aio-cite-btn') as HTMLElement
      expect(chip.classList.contains('is-flash')).toBe(true)
      expect(document.activeElement).toBe(chip)
      vi.advanceTimersByTime(2000)
      expect(passage.classList.contains('is-flash')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('runs "Analyse with CiteFox AI" for this sample and shows the checked read', async () => {
    const { client, requests } = recording()
    const onRead = vi.fn()
    const view = render(<Screen client={client} onRead={onRead} />)
    const body = within(card(view))
    fireEvent.click(body.getByRole('button', { name: 'AI actions for this overview' }))
    fireEvent.click(
      within(document.body).getByRole('menuitem', { name: /Analyse with CiteFox AI/ })
    )
    await waitFor(() => expect(body.getByText(/^The overview offers TextBolt/)).toBeTruthy())
    expect(requests[0]).toMatchObject({
      assistId: 'results.overviewRead',
      projectId: 'p1',
      pageId: 'page-1',
      marketId: 'mkt-us',
      promptId: 'prompt-1',
      inputs: { sampleId: 'sample-1' }
    })
    expect(body.getByText('Tone toward you')).toBeTruthy()
    expect(body.getByText('Why Twilio is there')).toBeTruthy()
    expect(body.getByText('Action 3')).toBeTruthy()
    expect(body.getByText(/confidence medium/)).toBeTruthy()
    expect(onRead).toHaveBeenCalledWith(expect.objectContaining({ sampleId: 'sample-1' }))
  })

  it('shows a saved read with when it ran, without asking CiteFox AI', () => {
    const { client, requests } = recording()
    const view = render(<Screen client={client} saved={SAVED} />)
    const body = within(card(view))
    expect(body.getByText(SAVED.read.positioning)).toBeTruthy()
    expect(
      body.getByText(
        `Run ${formatMoment('2026-10-22T09:05:00.000Z')} · confidence medium: One sample only.`
      )
    ).toBeTruthy()
    expect(body.getByText('Saved with this sample · no new call')).toBeTruthy()
    expect(requests).toHaveLength(0)
    fireEvent.click(body.getByRole('button', { name: 'Dismiss suggestion' }))
    expect(body.queryByText(SAVED.read.positioning)).toBeNull()
  })
})

describe('insights copy', () => {
  it('says how far down a passage is and where a source sits', () => {
    expect(depthText({ order: 1, of: 10 })).toBe('1st of 10 passages, near the top')
    expect(depthText({ order: 8, of: 14 })).toBe('8th of 14 passages, about halfway down')
    expect(depthText({ order: 14, of: 14 })).toBe('14th of 14 passages, near the end')
    expect(placeText(3, 8)).toBe('3rd of 8')
  })

  it('lists tone, competitors and numbered actions', () => {
    expect(readItems(SAVED.read).map((item) => item.label)).toEqual([
      'Tone toward you',
      'Why Twilio is there',
      'Action 1'
    ])
  })
})
