// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { BrandLens } from '@shared/brand-mentions'
import { setFetchIconsForTests } from '../../siteIcon/loader'
import { axeViolations } from '../../ui/axe.test-helper'
import { NAGIOS_AIO, NAGIOS_CHATGPT, PRICING_AIO } from './answer.fixtures.test-helper'
import { AnswerView } from './AnswerView'
import type { ScoredSource } from './model'

afterEach(() => {
  cleanup()
  setFetchIconsForTests(null)
})

const LENS: BrandLens = {
  brandNames: ['TextBolt'],
  ownDomain: 'textbolt.com',
  includeSubdomains: true
}

/** The Nagios sample's scored sources, as the check stored them. */
const NAGIOS_SOURCES: ScoredSource[] = [
  {
    url: 'https://assets.nagios.com/downloads/nagiosxi/docs/Twilio-SMS-Integration-in-Nagios-XI-2024.pdf',
    domain: 'assets.nagios.com',
    classification: 'other'
  },
  {
    url: 'https://textbolt.com/integration/nagios-email-to-text-alerts/',
    domain: 'textbolt.com',
    classification: 'own'
  },
  {
    url: 'https://www.twilio.com/en-us/pricing/messaging',
    domain: 'twilio.com',
    classification: 'competitor'
  }
]

function renderAnswer(
  markdown: string,
  sources: readonly ScoredSource[] = NAGIOS_SOURCES
): ReturnType<typeof render> {
  setFetchIconsForTests((request) =>
    Promise.resolve({ icons: request.domains.map((domain) => ({ domain, dataUri: null })) })
  )
  return render(<AnswerView markdown={markdown} sources={sources} lens={LENS} />)
}

function chipsIn(element: Element): HTMLAnchorElement[] {
  return [...element.querySelectorAll<HTMLAnchorElement>('a.ans-chip')]
}

describe('AnswerView with the real Google AI Overview', () => {
  it('shows section titles as headings, lists, a rule and a real table', () => {
    const view = renderAnswer(NAGIOS_AIO)
    const titles = view.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)
    expect(titles).toEqual([
      'Email-to-SMS Service (e.g., TextBolt or similar gateway)',
      'Twilio API/Component',
      'Comparison Summary'
    ])
    expect(view.container.querySelector('h3.ans-sub')).not.toBeNull()
    // Two bullet lists of four, then the closing follow-up list of two.
    const lists = view.container.querySelectorAll('.md-block > ul')
    expect([...lists].map((list) => list.children.length)).toEqual([4, 4, 2])
    expect(lists[0]?.querySelector('strong')?.textContent).toBe('How it works:')
    expect(view.container.querySelectorAll('hr')).toHaveLength(1)

    const table = view.getByRole('table')
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent?.trim())
    expect(headers).toEqual(['Feature', 'Email-to-SMS Service', 'Twilio (API / Nagios Component)'])
    expect(within(table).getAllByRole('row')).toHaveLength(5)
    // The table scrolls sideways in its own focusable region on a narrow window.
    expect(view.getByRole('region', { name: 'Table' }).getAttribute('tabindex')).toBe('0')
  })

  it('turns the links after each sentence into site chips, grouped, opening in the browser', () => {
    const view = renderAnswer(NAGIOS_AIO)
    const intro = view.container.querySelector('.md-block > p')
    expect(intro?.textContent).toContain('when used for Nagios alerts:')
    const introChips = chipsIn(intro as Element)
    expect(introChips).toHaveLength(1)
    const chip = introChips[0] as HTMLAnchorElement
    expect(chip.getAttribute('href')).toBe(
      'https://textbolt.com/integration/nagios-email-to-text-alerts/'
    )
    expect(chip.getAttribute('target')).toBe('_blank')
    expect(chip.getAttribute('rel')).toBe('noopener noreferrer')
    expect(chip.textContent).toBe('textbolt.com')
    expect(chip.getAttribute('title')).toBe('Nagios Text Alerts: Email-to\ntextbolt.com\nYour site')
    expect(chip.getAttribute('aria-label')).toBe(
      'Nagios Text Alerts: Email-to, textbolt.com, your site (opens in your browser)'
    )

    // "[a](u)[b](v)" glued after a sentence is one group of two chips.
    const reliability = view
      .getByText(/Direct API integration bypasses email routing/)
      .closest('li')
    const pair = chipsIn(reliability as Element)
    expect(pair.map((link) => link.textContent)).toEqual(['nagios.com', 'textbolt.com'])
    expect(pair[0]?.closest('.ans-cites-row')).toBe(pair[1]?.closest('.ans-cites-row'))
  })

  it("marks the owner's chips in the brand colour and a competitor's chips", () => {
    const view = renderAnswer(NAGIOS_AIO)
    const own = chipsIn(view.container).filter((link) => link.dataset.kind === 'own')
    expect(own.length).toBeGreaterThan(5)
    expect(own.every((link) => link.classList.contains('is-own'))).toBe(true)
    const rival = chipsIn(view.container).filter((link) => link.dataset.kind === 'competitor')
    // Twilio is a competitor here (its pricing page, so its site). Its two pages after one
    // sentence are one chip with a count, opening the first; the tooltip lists both.
    expect(rival).toHaveLength(1)
    const twilio = rival[0] as HTMLAnchorElement
    expect(twilio.getAttribute('href')).toBe('https://www.twilio.com/en-us/messaging/channels/sms')
    expect(twilio.textContent).toBe('twilio.com2')
    expect(twilio.getAttribute('title')).toBe(
      'SMS API for business text messaging - Twilio\nMessaging Pricing | Twilio\ntwilio.com\nCompetitor'
    )
    expect(twilio.getAttribute('aria-label')).toBe(
      '2 pages on twilio.com: SMS API for business text messaging - Twilio; Messaging Pricing | Twilio, competitor (opens in your browser)'
    )
  })

  it('keeps a link inside a sentence an ordinary link', () => {
    const view = renderAnswer(NAGIOS_AIO)
    const inline = view.getByRole('link', {
      name: 'Twilio SMS Component for Nagios XI (opens in your browser)'
    })
    expect(inline.classList.contains('ans-chip')).toBe(false)
    // In a table cell a lone link at the end is content, not a citation.
    const cell = within(view.getByRole('table')).getByRole('link', {
      name: 'Nagios XI Component (opens in your browser)'
    })
    expect(cell.classList.contains('ans-chip')).toBe(false)
  })

  it('marks the brand in yellow in the text, headings included', () => {
    const view = renderAnswer(NAGIOS_AIO)
    const marks = [...view.container.querySelectorAll('mark.aio-brand')].map(
      (mark) => mark.textContent
    )
    expect(marks).toContain('TextBolt')
    expect(
      view.getAllByRole('heading', { level: 3 })[0]?.querySelector('mark.aio-brand')
    ).not.toBeNull()
  })

  it('folds after about 16 lines with a clear button, and opens', () => {
    const view = renderAnswer(NAGIOS_AIO)
    const button = view.getByRole('button', { name: 'Show full answer' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    const body = document.getElementById(button.getAttribute('aria-controls') ?? '')
    expect(body?.classList.contains('is-folded')).toBe(true)
    fireEvent.click(button)
    expect(view.getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded')).toBe(
      'true'
    )
    expect(body?.classList.contains('is-folded')).toBe(false)
  })

  it('shows nested lists and the escaped "1." section titles of the pricing overview', () => {
    const view = renderAnswer(PRICING_AIO, [])
    const titles = view.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)
    expect(titles).toEqual([
      'Common Pricing Models',
      '1. Monthly Subscription Plans',
      '2. Pay-As-You-Go & Developer APIs',
      'Additional Costs to Consider'
    ])
    // TextBolt's own prices are first named mid-answer, so the answer starts open.
    expect(view.queryByRole('button', { name: 'Show full answer' })).toBeNull()
    expect(view.getByRole('button', { name: 'Show less' })).toBeTruthy()
    const textbolt = view.getAllByText('TextBolt', { selector: 'mark' })[0]?.closest('li')
    expect(textbolt?.querySelectorAll(':scope > ul > li')).toHaveLength(4)
    expect(view.container.querySelectorAll('hr')).toHaveLength(2)
  })

  it('is axe clean, folded and open', async () => {
    const view = renderAnswer(NAGIOS_AIO)
    expect(await axeViolations(view.container)).toEqual([])
    fireEvent.click(view.getByRole('button', { name: 'Show full answer' }))
    expect(await axeViolations(view.container)).toEqual([])
  })
})

describe('AnswerView with the real ChatGPT answer', () => {
  it('keeps its headings, numbered steps, table and code block', async () => {
    const view = renderAnswer(NAGIOS_CHATGPT, [])
    expect(view.getByRole('heading', { level: 3 }).textContent).toBe(
      'Email-to-SMS vs. Twilio for Nagios Alerts'
    )
    expect(
      view.getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent)
    ).toEqual([
      '1. How the two approaches work',
      '2. Side-by-side comparison',
      '5. How I would implement Twilio with Nagios'
    ])
    expect(view.getAllByRole('heading', { level: 5 })).toHaveLength(2)
    expect(view.container.querySelectorAll('ol')).toHaveLength(2)
    expect(within(view.getByRole('table')).getAllByRole('row')).toHaveLength(12)
    const code = view.container.querySelector('pre code')
    expect(code?.textContent).toContain('Notification command')
    // The scraped "text" caption above the code block is gone.
    expect(view.container.querySelector('pre')?.previousElementSibling?.textContent).toBe(
      'A sensible architecture would look like this:'
    )
    expect(chipsIn(view.container)).toHaveLength(0)
    expect(await axeViolations(view.container)).toEqual([])
  })
})

describe('AnswerView edge cases', () => {
  it('shows plain text as paragraphs, with no fold or chips', () => {
    const view = renderAnswer('TextBolt sends texts from email.\n\nIt works with Nagios.', [])
    expect(view.container.querySelectorAll('p')).toHaveLength(2)
    expect(view.container.querySelector('mark.aio-brand')?.textContent).toBe('TextBolt')
    expect(view.queryByRole('button')).toBeNull()
  })

  it('drops a chip whose link is not a web address, and never renders raw HTML', () => {
    const view = renderAnswer(
      'It works. [bad](javascript:alert(1))[ok](https://example.com/a)\n\n<b>raw</b> and <img src=x onerror=alert(1)>',
      []
    )
    expect(chipsIn(view.container).map((link) => link.getAttribute('href'))).toEqual([
      'https://example.com/a'
    ])
    expect(view.container.querySelector('b, img')).toBeNull()
    expect(view.container.textContent).toContain('<b>raw</b>')
  })

  it('shows the first three chips of a long run and a +N button for the rest', () => {
    const links = ['a', 'b', 'c', 'd', 'e']
      .map((name) => `[${name}](https://${name}-site.com/)`)
      .join('')
    const view = renderAnswer(`Many sources agree. ${links}`, [])
    expect(chipsIn(view.container)).toHaveLength(3)
    fireEvent.click(view.getByRole('button', { name: 'Show 2 more sources' }))
    expect(chipsIn(view.container)).toHaveLength(5)
  })

  it('renders nothing for an empty answer', () => {
    const view = renderAnswer('  \n ', [])
    expect(view.container.innerHTML).toBe('')
  })
})
