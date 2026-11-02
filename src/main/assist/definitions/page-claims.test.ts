import { describe, expect, test } from 'vitest'
import { checkableClaims, cutOffWords, normalizeQuote, quotedFromPage } from './page-claims'

const PAGE = {
  title: 'How to Set Up Text Alerts for Business (2026) | TextBolt',
  metaDescription: 'Learn how to set up business text alerts in 5 steps without coding.',
  h1: 'How to Set Up Text Alerts for Business',
  bodyText: [
    '* [Law Firms Text Messaging Service for Law Firms](https://example.com/law/)',
    '# How to Set Up Text Alerts for Business',
    '**Last Updated:** October 21, 2026',
    '## Step 3: Write the alert',
    'Keep it short and clear. A standard SMS supports up to **155 characters** when using standard GSM characters.',
    'Sending business SMS to US recipients requires A2P 10DLC registration.',
    'Your team will love how easy it is.',
    '* Basic plan: $29/month with 500 message credits per month',
    'Before Verizon’s shutdown deadline, send a test alert to a Verizon phone.'
  ].join('\n'),
  faqs: [
    {
      question: 'Can employees reply??',
      answer: 'Yes. Replies land in the sender’s inbox.',
      typo: null
    }
  ]
}

describe('checkableClaims', () => {
  test('keeps sentences with a price, limit, date, rule or shutdown, in page order', () => {
    expect(checkableClaims(PAGE)).toEqual([
      'A standard SMS supports up to 155 characters when using standard GSM characters.',
      'Sending business SMS to US recipients requires A2P 10DLC registration.',
      'Basic plan: $29/month with 500 message credits per month',
      'Before Verizon’s shutdown deadline, send a test alert to a Verizon phone.'
    ])
  })

  test('keeps the best claim of each kind first, so a limit is not crowded out by prices', () => {
    expect(checkableClaims(PAGE, 1)).toEqual([
      'A standard SMS supports up to 155 characters when using standard GSM characters.'
    ])
    expect(checkableClaims(PAGE, 2)).toEqual([
      'A standard SMS supports up to 155 characters when using standard GSM characters.',
      'Before Verizon’s shutdown deadline, send a test alert to a Verizon phone.'
    ])
  })

  test('skips the menu above the H1, link-only lines and bylines', () => {
    const claims = checkableClaims({
      ...PAGE,
      bodyText: `* [Pricing from $29 per month](https://example.com/pricing/)\n${PAGE.bodyText}\n* [Verizon vText Migration Guide](https://example.com/verizon/)`
    })
    expect(claims.join(' ')).not.toMatch(/Law Firms|Last Updated|Pricing from|Migration Guide/u)
  })
})

describe('quotes', () => {
  test('a quote matches the page through markdown, curly quotes and end punctuation', () => {
    expect(quotedFromPage('A standard SMS supports up to 155 characters', PAGE)).toBe(true)
    expect(quotedFromPage("Before Verizon's shutdown deadline", PAGE)).toBe(true)
    expect(quotedFromPage('Can employees reply??', PAGE)).toBe(true)
    expect(quotedFromPage('A standard SMS supports up to 160 characters', PAGE)).toBe(false)
  })

  test('normalizeQuote folds case, quotes and dashes', () => {
    expect(normalizeQuote('“Email‑to‑SMS” works.')).toBe('email-to-sms" works')
  })
})

describe('cutOffWords', () => {
  test('returns the words past the limit, cut at a word', () => {
    expect(cutOffWords('How to Set Up Text Alerts for Business (2026) | TextBolt', 40)).toBe(
      '(2026) | TextBolt'
    )
    expect(cutOffWords('Short title', 60)).toBeNull()
    expect(cutOffWords(null, 60)).toBeNull()
  })
})
