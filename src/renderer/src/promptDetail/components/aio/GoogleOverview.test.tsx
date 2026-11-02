// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it } from 'vitest'
import type { AioReference, CitationClass, SampleCapture } from '@shared/domain'
import koha from '@shared/fixtures/aio-overview-koha.json'
import { AioCard } from '../OverviewCards'

afterEach(cleanup)

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

const REFERENCES = [
  reference(1, 'https://koha-community.org/manual/latest/de/html/faq.html', 'other'),
  reference(2, 'https://textbolt.com/blog/att-email-to-text-shutdown/', 'target'),
  reference(3, 'https://textbolt.com/migration/tmobile2/', 'own'),
  reference(
    4,
    'https://uniquelibrary.com/the-future-of-library-communications-why-sms-solutions-like-messagebee-are-essential/',
    'competitor'
  )
]

function sample(patch: Partial<SampleCapture> = {}): SampleCapture {
  return {
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
    references: REFERENCES,
    rawSearchJson: '{"ai_overview":{"page_token":"abc"}}',
    rawAioJson: JSON.stringify(koha),
    ...patch
  }
}

function renderCard(capture: SampleCapture | null): ReturnType<typeof render> {
  return render(
    <AioCard
      sample={capture}
      samples={capture ? [capture] : []}
      sampleIndex={0}
      onSample={() => undefined}
      checkedAt="2026-10-23T10:56:32.000Z"
      marketName="🇺🇸 US · EN"
    />
  )
}

describe('AioCard laid out like Google', () => {
  it('shows the AI Overview label, headings, tables and list labels', async () => {
    const view = renderCard(sample())
    const card = view.getByRole('region', { name: /^AI Overview · / })
    expect(within(card).getByText('AI Overview', { selector: 'span' })).toBeTruthy()
    const headings = within(card).getAllByRole('heading', { level: 3 })
    expect(headings.map((heading) => heading.textContent)).toEqual([
      '1. Direct API Driver Integration (Recommended for Self-Hosted or Vendor-Supported)',
      '2. Turnkey Third-Party Library Integration (Easiest / Fully Managed)',
      '3. Middleware Email-to-SMS Gateway (Drop-in Replacement)'
    ])
    const tables = within(card).getAllByRole('grid', { name: /^Table: / })
    expect(tables).toHaveLength(2)
    const firstTable = tables[0] as HTMLElement
    expect(
      within(firstTable)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)
    ).toEqual(['Option', 'Approach / Driver', 'Cons', 'Column 4'])
    expect(within(firstTable).getAllByRole('row')).toHaveLength(3)
    const labels = [...card.querySelectorAll('li > strong.aio-label')].map(
      (label) => label.textContent
    )
    expect(labels).toEqual(['How it works:', 'Pros:', 'Cons:'])
    expect([...card.querySelectorAll('code')].map((code) => code.textContent)).toEqual([
      '@txt.att.net',
      'SMS::Send::Email'
    ])
    expect(card.textContent).not.toContain('flattened text')
    const result = await axe.run(view.container, { rules: { region: { enabled: false } } })
    expect(result.violations).toEqual([])
  })

  it('reveals a citation’s sources on focus and closes on Escape and blur', () => {
    const view = renderCard(sample())
    const chip = view.getByRole('button', {
      name: '5 sources: Koha, TextBolt, Unique Library'
    })
    expect(view.queryByRole('tooltip')).toBeNull()
    fireEvent.focus(chip)
    const tip = view.getByRole('tooltip')
    expect(chip.getAttribute('aria-describedby')).toBe(tip.id)
    expect(within(tip).getByText('When Did AT&T Shut Down Email-to-Text?')).toBeTruthy()
    expect(within(tip).getByText('+2 more sources')).toBeTruthy()
    fireEvent.keyDown(chip, { key: 'Escape' })
    expect(view.queryByRole('tooltip')).toBeNull()
    fireEvent.focus(chip)
    fireEvent.blur(chip)
    expect(view.queryByRole('tooltip')).toBeNull()
    fireEvent.mouseEnter(chip)
    expect(view.getByRole('tooltip')).toBeTruthy()
  })

  it('marks a citation’s sources in the rail on click', () => {
    const view = renderCard(sample())
    const rail = view.getByRole('list', { name: 'Sources Google showed' })
    expect(within(rail).getAllByRole('listitem')).toHaveLength(4)
    const chip = view.getByRole('button', { name: '2 sources: ByWater Solutions, Unique Library' })
    fireEvent.click(chip)
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    const marked = [...rail.querySelectorAll('[aria-current="true"]')].map((card) =>
      card.getAttribute('data-source-index')
    )
    expect(marked).toEqual(['5', '11'])
    fireEvent.click(chip)
    expect(rail.querySelectorAll('[aria-current="true"]')).toHaveLength(0)
  })

  it('shows the sources rail with CiteFox’s kind chips and external links', () => {
    const view = renderCard(sample())
    fireEvent.click(view.getByRole('button', { name: 'Show all 12' }))
    const rail = view.getByRole('list', { name: 'Sources Google showed' })
    const cards = within(rail).getAllByRole('listitem')
    expect(cards).toHaveLength(12)
    expect(within(cards[1] as HTMLElement).getByText('This page')).toBeTruthy()
    expect(within(cards[2] as HTMLElement).getByText('Competitor')).toBeTruthy()
    expect(within(cards[3] as HTMLElement).getByText('Own page')).toBeTruthy()
    expect(within(cards[0] as HTMLElement).queryByText('Other')).toBeNull()
    const link = cards[1]?.querySelector('a.aio-src-title') as HTMLElement
    expect(link.getAttribute('href')).toBe('https://textbolt.com/blog/att-email-to-text-shutdown/')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    // The site's favicon where Google shows one (a letter tile until main has it).
    expect(rail.querySelector('img')).toBeNull()
    expect(cards[1]?.querySelector('[data-site-icon="textbolt.com"]')).toBeTruthy()
    // Copy and Open the source's address, outside the title link.
    expect(
      within(cards[1] as HTMLElement).getByRole('button', { name: 'Copy textbolt.com' })
    ).toBeTruthy()
    expect(cards[1]?.querySelector('a .ui-url')).toBeNull()
  })

  it('shows Markdown-looking characters literally', () => {
    const raw = JSON.stringify({
      ai_overview: {
        text_blocks: [{ type: 'paragraph', snippet: 'Pro costs ~$112.00 / mo ~ and *not* _bold_.' }]
      }
    })
    const view = renderCard(sample({ rawAioJson: raw }))
    const card = view.getByRole('region', { name: /^AI Overview · / })
    expect(card.textContent).toContain('Pro costs ~$112.00 / mo ~ and *not* _bold_.')
    expect(card.querySelector('del, s, em')).toBeNull()
  })

  it('falls back to the stored text, as plain text, when no raw JSON is stored', () => {
    const view = renderCard(
      sample({ rawAioJson: null, rawSearchJson: null, aioText: 'Costs ~$9 ~ a **month**.' })
    )
    const card = view.getByRole('region', { name: /^AI Overview · / })
    expect(card.textContent).toContain('Costs ~$9 ~ a **month**.')
    expect(card.querySelector('strong, del')).toBeNull()
  })

  it('keeps the error, empty and no-overview states', () => {
    const failed = renderCard(
      sample({ errorCode: 'rate_limited', message: 'SerpApi said slow down.', nextStep: 'Wait.' })
    )
    expect(failed.getByRole('note').textContent).toContain('SerpApi said slow down.')
    cleanup()
    const none = renderCard(
      sample({ rawAioJson: null, rawSearchJson: '{"search_metadata":{}}', aioText: null })
    )
    expect(
      none.getByText('Google showed no AI Overview for this question in this check.')
    ).toBeTruthy()
    cleanup()
    expect(
      renderCard(null).getByText('No search is stored for this question in this check.')
    ).toBeTruthy()
  })
})
