import { describe, expect, test } from 'vitest'
import {
  PAGE_TEXT_CUT_NOTE,
  PAGE_TEXT_TEMPLATE_MAX,
  capPageText,
  formatBuyerProfile,
  formatFaqs,
  formatLastModified,
  formatOutline
} from './template-context'
import { TEXTBOLT_PROFILE } from './textbolt-fixture'

describe('template context', () => {
  test('writes the outline as indented H2 and H3 lines', () => {
    expect(
      formatOutline([
        { level: 'h2', text: 'Ways to Send Alerts', table: true },
        { level: 'h3', text: 'Gmail or Outlook', table: false }
      ])
    ).toBe('H2: Ways to Send Alerts (has a table)\n  H3: Gmail or Outlook')
    expect(formatOutline([])).toBe('No H2 or H3 headings on the page.')
  })

  test('writes FAQs as numbered question and answer pairs', () => {
    expect(
      formatFaqs([
        { question: 'Do staff need an app?', answer: 'No.', typo: null },
        { question: 'Where do replies go??', answer: '', typo: 'Question ends with ??.' }
      ])
    ).toBe(
      'FAQ 1. Q: Do staff need an app?\nA: No.\n\nFAQ 2. Q: Where do replies go??\nA: (no answer on the page)\nTypo: Question ends with ??.'
    )
    expect(formatFaqs([])).toBe('No FAQs on the page.')
  })

  test('names the last-modified date, or says it is not stated', () => {
    expect(formatLastModified('2026-10-16T09:00:00Z', null)).toBe('2026-10-16T09:00:00Z')
    expect(formatLastModified(null, '2026-07-28T11:22:29.000Z')).toBe(
      'Not stated on the page. Published 2026-07-28T11:22:29.000Z.'
    )
    expect(formatLastModified(null, null)).toBe('Not stated on the page.')
  })

  test('writes the buyer profile as readable labelled lines, not JSON', () => {
    const text = formatBuyerProfile(TEXTBOLT_PROFILE)
    expect(text.startsWith(`Who: ${TEXTBOLT_PROFILE.who}`)).toBe(true)
    expect(text).toContain('Strongest segments:\n- Field service and facilities: ')
    expect(text).toContain('Trigger events:\n- A missed alert caused real damage over a weekend.')
    expect(text).toContain('What they value:\n- Setup in about 30 minutes')
    expect(text).toContain('Poor fit:\n- SMS marketers: ')
    expect(text.includes('{"who"')).toBe(false)
  })

  test('caps page text at a paragraph boundary and says it was cut', () => {
    expect(capPageText('short', 100)).toBe('short')
    const paragraph = 'word '.repeat(40).trim()
    const body = Array.from({ length: 10 }, () => paragraph).join('\n\n')
    const capped = capPageText(body, 500)
    expect(capped.endsWith(PAGE_TEXT_CUT_NOTE)).toBe(true)
    const kept = capped.slice(0, -PAGE_TEXT_CUT_NOTE.length)
    expect(kept.length).toBeLessThanOrEqual(500)
    expect(kept.endsWith(paragraph)).toBe(true)
    const solid = 'x'.repeat(1000)
    expect(capPageText(solid, 300).startsWith('x'.repeat(300))).toBe(true)
    expect(PAGE_TEXT_TEMPLATE_MAX).toBe(60_000)
  })
})
