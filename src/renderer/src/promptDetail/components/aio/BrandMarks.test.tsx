// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it } from 'vitest'
import type { BrandLens } from '@shared/brand-mentions'
import type { AioReference, CitationClass, SampleCapture } from '@shared/domain'
import koha from '@shared/fixtures/aio-overview-koha.json'
import { AioCard } from '../OverviewCards'

afterEach(cleanup)

const LENS: BrandLens = {
  brandNames: ['TextBolt'],
  ownDomain: 'textbolt.com',
  includeSubdomains: true
}

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
    references: [
      reference(1, 'https://koha-community.org/manual/latest/de/html/faq.html', 'other'),
      reference(2, 'https://textbolt.com/blog/att-email-to-text-shutdown/', 'target')
    ],
    rawSearchJson: null,
    rawAioJson: JSON.stringify(koha),
    ...patch
  }
}

function renderCard(
  capture: SampleCapture,
  lens: BrandLens | null = LENS
): ReturnType<typeof render> {
  return render(
    <AioCard
      sample={capture}
      samples={[capture]}
      sampleIndex={0}
      onSample={() => undefined}
      checkedAt="2026-10-23T10:56:32.000Z"
      marketName="US · EN"
      lens={lens}
    />
  )
}

describe('yellow brand marks in the overview', () => {
  it('marks the brand in the text, not other words', async () => {
    const view = renderCard(sample())
    const text = view.container.querySelector('.aio-g-text') as HTMLElement
    expect([...text.querySelectorAll('mark.aio-brand')].map((mark) => mark.textContent)).toEqual([
      'TextBolt'
    ])
    const item = text.querySelector('mark.aio-brand')?.closest('li')
    expect(item?.getAttribute('data-passage')).toBe('b10.i0')
    const result = await axe.run(view.container, { rules: { region: { enabled: false } } })
    expect(result.violations).toEqual([])
  })

  it('gives own-site source cards the yellow treatment with the brand marked', () => {
    const view = renderCard(sample())
    fireEvent.click(view.getByRole('button', { name: 'Show all 12' }))
    const rail = view.getByRole('list', { name: 'Sources Google showed' })
    const cards = within(rail).getAllByRole('listitem')
    const own = cards.filter((card) => card.classList.contains('is-own'))
    // Index 1 is scored as this page; 3, 4 and 9 are unscored but on textbolt.com.
    expect(own.map((card) => card.getAttribute('data-source-index'))).toEqual(['1', '3', '4', '9'])
    expect(within(own[0] as HTMLElement).getByText('This page')).toBeTruthy()
    expect(own[0]?.querySelector('mark.aio-brand')?.textContent).toBe('TextBolt')
    expect(cards[0]?.classList.contains('is-own')).toBe(false)
  })

  it('marks own sources in the citation hover card', () => {
    const view = renderCard(sample())
    fireEvent.focus(view.getByRole('button', { name: '5 sources: Koha, TextBolt, Unique Library' }))
    const tip = view.getByRole('tooltip')
    const own = tip.querySelector('.aio-tip-src.is-own') as HTMLElement
    expect(own).toBeTruthy()
    expect(within(own).getByText('This page')).toBeTruthy()
    expect(own.querySelector('mark.aio-brand')?.textContent).toBe('TextBolt')
  })

  it('marks the brand and domain in the fallback text', () => {
    const view = renderCard(
      sample({
        rawAioJson: null,
        aioText: 'Try TextBolt at https://www.textbolt.com/pricing or TextBolted.'
      })
    )
    const marks = [...view.container.querySelectorAll('.pd2-aio mark.aio-brand')]
    expect(marks.map((mark) => mark.textContent)).toEqual([
      'TextBolt',
      'https://www.textbolt.com/pricing'
    ])
  })

  it('marks nothing without a lens', () => {
    const view = renderCard(sample(), null)
    expect(view.container.querySelector('mark')).toBeNull()
  })
})
