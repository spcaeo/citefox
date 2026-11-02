import { describe, expect, test } from 'vitest'
import {
  keepOnPageFindings,
  validateCoverageFixes,
  validateCoverageMatrix,
  validatePageAudit,
  wrongFacts,
  type AuditDraftFinding
} from './coverage-validate'
import { withoutLeadingNone } from './coverage'

describe('withoutLeadingNone', () => {
  test('drops a leading "None." and keeps the real sentence', () => {
    expect(withoutLeadingNone('None. A plain-language line would help.')).toBe(
      'A plain-language line would help.'
    )
    expect(withoutLeadingNone('none: add the overage rate.')).toBe('Add the overage rate.')
    expect(withoutLeadingNone('N/A')).toBe('')
    expect(withoutLeadingNone('None.')).toBe('')
    // Live run on /pricing: the strong-row answer used as a prefix.
    expect(withoutLeadingNone('Answered directly. The FAQ could say how to cancel.')).toBe(
      'The FAQ could say how to cancel.'
    )
    expect(withoutLeadingNone('Answered directly.')).toBe('Answered directly.')
    // A sentence that starts with the word is left alone.
    expect(withoutLeadingNone('Nothing on the page names Datadog.')).toBe(
      'Nothing on the page names Datadog.'
    )
    expect(withoutLeadingNone('None of the plans list overage.')).toBe(
      'None of the plans list overage.'
    )
  })
})

const PAGE = [
  '# Text Alerts for Business',
  '## Pricing',
  'The Standard plan is $49/month with 1,000 credits.',
  'A standard SMS supports up to 155 characters (87 characters = 1 credit).'
].join('\n')

const FAQ_ANSWER = Array.from({ length: 45 }, (_, index) => `word${index}`).join(' ')

function finding(quote: string, correction: string | null): AuditDraftFinding {
  return { type: 'factual_claim', text: 'Fix it.', quote, correction, verify: null }
}

function fixRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    position: 1,
    currentContent: 'The Pricing section names the plan.',
    whatToUpdate: 'Add one sentence to "Pricing".',
    suggestedFaq: { question: 'How much does it cost for a small team?', answer: FAQ_ANSWER },
    ...overrides
  }
}

function fixes(rows: Record<string, unknown>[], facts = wrongFacts([])): string | null {
  return (
    validateCoverageFixes(
      { rows },
      { pageText: PAGE, positions: [1], brands: ['TextBolt'], wrongFacts: facts }
    )?.message ?? null
  )
}

describe('wrongFacts', () => {
  test('marks a number the correction replaces, not a number it leaves alone', () => {
    expect(
      wrongFacts([
        finding(
          'A standard SMS supports up to 155 characters',
          'A single GSM-7 segment is 160 characters.'
        )
      ])
    ).toEqual([{ number: '155', word: 'characters' }])
    // Live run on textbolt.com/pricing: the count is wrong, "1 credit" is not.
    expect(
      wrongFacts([
        finding(
          '(87 characters = 1 credit)',
          'Use the real count (about 68 characters) or change the example text.'
        )
      ])
    ).toEqual([{ number: '87', word: 'characters' }])
    expect(wrongFacts([finding('155 characters', null)])).toEqual([])
    expect(wrongFacts([{ ...finding('155 characters', '160 characters'), type: 'typo' }])).toEqual(
      []
    )
  })
})

describe('validateCoverageFixes', () => {
  test('accepts a specific fix with a 40 to 70 word FAQ', () => {
    expect(fixes([fixRow()])).toBeNull()
  })

  test('rejects a short FAQ, a brand in the question, an unconfirmed price and a wrong fact', () => {
    expect(
      fixes([fixRow({ suggestedFaq: { question: 'How much?', answer: 'Too short.' } })])
    ).toMatch(/is 2 words/)
    expect(
      fixes([fixRow({ suggestedFaq: { question: 'Is TextBolt cheap?', answer: FAQ_ANSWER } })])
    ).toMatch(/names "TextBolt"/)
    expect(
      fixes([
        fixRow({ suggestedFaq: { question: 'How much?', answer: `${FAQ_ANSWER} It is $19.` } })
      ])
    ).toMatch(/price the page does not confirm \(\$19\)/)
    const facts = wrongFacts([
      finding('A standard SMS supports up to 155 characters', 'A segment is 160 characters.')
    ])
    expect(fixes([fixRow({ whatToUpdate: 'Say texts hold 155 characters.' })], facts)).toMatch(
      /repeats "155 characters"/
    )
    expect(fixes([fixRow({ whatToUpdate: 'Say each message is 1 credit.' })], facts)).toBeNull()
  })

  test('checks positions and quotes in what the page says now', () => {
    expect(fixes([fixRow(), fixRow()])).toMatch(/Expected 1 fixes and received 2/)
    expect(fixes([fixRow({ position: 2 })])).toMatch(/Position 1 is missing/)
    expect(fixes([fixRow({ currentContent: 'The page says "free forever".' })])).toMatch(
      /not on the page: "free forever"/
    )
  })
})

describe('validateCoverageMatrix and validatePageAudit', () => {
  const row = {
    position: 1,
    coverage: 'partial',
    whereCovered: ['Pricing'],
    mainGap: 'No per-team price.',
    priority: 'medium',
    actions: ['update_existing']
  }

  function matrix(rows: Record<string, unknown>[]): string | null {
    return validateCoverageMatrix({ rows }, { pageText: PAGE, positions: [1] })?.message ?? null
  }

  test('a rated row names where the page covers it; none names nothing', () => {
    expect(matrix([row])).toBeNull()
    expect(matrix([{ ...row, whereCovered: [] }])).toMatch(/does not say where/)
    expect(matrix([{ ...row, coverage: 'none' }])).toMatch(/whereCovered must be empty/)
    expect(matrix([{ ...row, whereCovered: ['Enterprise plans'] }])).toMatch(
      /heading is not on the page/
    )
  })

  test('an audit quote must be copied from the page', () => {
    const audit = (quote: string): string | null =>
      validatePageAudit(
        { findings: [{ ...finding(quote, null), verify: 'GSM 03.38' }] },
        { pageText: PAGE }
      )?.message ?? null
    expect(audit('A standard SMS supports up to 155 characters')).toBeNull()
    expect(audit('Texts hold 200 characters')).toMatch(/quote is not on the page/)
    expect(validatePageAudit({ findings: [] }, { pageText: PAGE })).toBeNull()
  })

  test('a finding whose quote is not on the page is dropped, not the whole audit', () => {
    const onPage = finding('A standard SMS supports up to 155 characters', null)
    const offPage = finding(
      '[Add Toll-Free to My Account – $45](https://textbolt.com/pricing',
      null
    )
    const kept = keepOnPageFindings({ findings: [onPage, offPage] }, PAGE)
    expect(kept).toEqual({ findings: [onPage] })
    expect(validatePageAudit(kept, { pageText: PAGE })).toBeNull()
    expect(keepOnPageFindings('not json', PAGE)).toBe('not json')
  })
})
