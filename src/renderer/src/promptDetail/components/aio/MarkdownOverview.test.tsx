// @vitest-environment happy-dom
import { cleanup, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { BrandLens } from '@shared/brand-mentions'
import type { AioReference, CitationClass, SampleCapture } from '@shared/domain'
import type { EngineAnswerView } from '@shared/ipc'
import { NAGIOS_AIO, NAGIOS_CHATGPT } from '../../../components/answer/answer.fixtures.test-helper'
import { setFetchIconsForTests } from '../../../siteIcon/loader'
import { axeViolations } from '../../../ui/axe.test-helper'
import { AioCard } from '../OverviewCards'
import { EngineAnswer } from '../engines/EngineAnswer'

afterEach(() => {
  cleanup()
  setFetchIconsForTests(null)
})

const LENS: BrandLens = {
  brandNames: ['TextBolt'],
  ownDomain: 'textbolt.com',
  includeSubdomains: true
}

function reference(
  position: number,
  url: string,
  title: string,
  classification: CitationClass
): AioReference {
  return {
    id: `ref-${position}`,
    position,
    url,
    normalizedUrl: url,
    domain: new URL(url).hostname.replace(/^www\./, ''),
    title,
    classification,
    untracked: false,
    sourceType: 'web'
  }
}

/** The Nagios sample as cloro stored it: markdown, scored sources, no SerpApi JSON. */
function cloroSample(patch: Partial<SampleCapture> = {}): SampleCapture {
  return {
    id: 'sample-cloro',
    sampleNo: 1,
    keyId: null,
    keyLabel: null,
    hasAio: true,
    neededFollowup: false,
    searches: 1,
    errorCode: null,
    message: null,
    nextStep: null,
    aioText: 'An email-to-SMS service and Twilio compare across reliability …',
    aioMarkdown: NAGIOS_AIO,
    references: [
      reference(
        1,
        'https://assets.nagios.com/downloads/nagiosxi/docs/Twilio-SMS-Integration-in-Nagios-XI-2024.pdf',
        'How To Integrate Twilio SMS With Nagios XI 2024 And 2026',
        'other'
      ),
      reference(
        2,
        'https://textbolt.com/integration/nagios-email-to-text-alerts/',
        'Nagios Text Alerts: Email-to',
        'target'
      ),
      reference(
        3,
        'https://www.twilio.com/en-us/pricing/messaging',
        'Messaging Pricing | Twilio',
        'other'
      ),
      reference(
        4,
        'https://www.twilio.com/en-us/messaging/channels/sms',
        'SMS API for business text messaging - Twilio',
        'other'
      )
    ],
    rawSearchJson: '{"success":true,"result":{"organicResults":[]}}',
    rawAioJson: null,
    ...patch
  }
}

function renderCard(sample: SampleCapture): ReturnType<typeof render> {
  setFetchIconsForTests((request) =>
    Promise.resolve({ icons: request.domains.map((domain) => ({ domain, dataUri: null })) })
  )
  return render(
    <AioCard
      sample={sample}
      samples={[sample]}
      sampleIndex={0}
      onSample={() => undefined}
      checkedAt="2026-10-28T10:56:32.000Z"
      marketName="🇺🇸 US · EN"
      lens={LENS}
    />
  )
}

describe('AioCard from cloro markdown', () => {
  it('lays the overview out like Google instead of one paragraph', async () => {
    const view = renderCard(cloroSample())
    const card = view.getByRole('region', { name: /^AI Overview · / })
    expect(within(card).getByText('AI Overview', { selector: 'span' })).toBeTruthy()
    expect(
      within(card)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent)
    ).toEqual([
      'Email-to-SMS Service (e.g., TextBolt or similar gateway)',
      'Twilio API/Component',
      'Comparison Summary'
    ])
    expect(within(card).getByRole('table')).toBeTruthy()
    expect(card.textContent).not.toContain('compare across reliability …')
    // The own page's chips stand out; the rail beside it lists the four scored sources.
    const own = [...card.querySelectorAll('a.ans-chip.is-own')]
    expect(own.length).toBeGreaterThan(5)
    const rail = within(card).getByRole('list', { name: 'Sources Google showed' })
    expect(within(rail).getAllByRole('listitem')).toHaveLength(4)
    expect(within(rail).getByText('This page')).toBeTruthy()
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('keeps the plain text view when no markdown is stored', () => {
    const view = renderCard(cloroSample({ aioMarkdown: null }))
    const card = view.getByRole('region', { name: /^AI Overview · / })
    expect(card.querySelector('p.pd2-aio')?.textContent).toBe(
      'An email-to-SMS service and Twilio compare across reliability …'
    )
    expect(card.querySelector('.ans')).toBeNull()
  })
})

describe('EngineAnswer with the real ChatGPT answer', () => {
  it('shows the answer with its headings and table, the brand marked', async () => {
    setFetchIconsForTests((request) =>
      Promise.resolve({ icons: request.domains.map((domain) => ({ domain, dataUri: null })) })
    )
    const answer: EngineAnswerView = {
      engine: 'chatgpt',
      label: 'ChatGPT',
      selected: true,
      status: 'named',
      checkedAt: '2026-10-28T10:56:32.000Z',
      cited: false,
      named: true,
      citedUrl: null,
      position: null,
      text: null,
      markdown: `${NAGIOS_CHATGPT}\n\nTextBolt is one such service. [TextBolt](https://textbolt.com/integration/nagios-email-to-text-alerts/)`,
      sources: [],
      message: null,
      provider: 'cloro',
      credits: 5,
      costMicros: 4_000
    }
    const view = render(<EngineAnswer answer={answer} marketName="🇺🇸 US · EN" lens={LENS} />)
    const body = view.getByTestId('engine-answer')
    expect(
      within(body).getByRole('heading', { level: 3, name: /Email-to-SMS vs\. Twilio/ })
    ).toBeTruthy()
    expect(within(body).getByRole('table')).toBeTruthy()
    expect(body.querySelector('mark.aio-brand')?.textContent).toBe('TextBolt')
    // The owner is only named at the very end, so the long answer starts open.
    expect(within(body).getByRole('button', { name: 'Show less' })).toBeTruthy()
    expect(body.querySelector('a.ans-chip.is-own')?.getAttribute('href')).toBe(
      'https://textbolt.com/integration/nagios-email-to-text-alerts/'
    )
    expect(await axeViolations(view.container)).toEqual([])
  })
})
