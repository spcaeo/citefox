import { describe, expect, test } from 'vitest'
import {
  brandInQuestion,
  causeProblem,
  citationFacts,
  fixDraftProblem,
  overviewWithSources,
  referencesBlock,
  tagReferences,
  verifiedPassage,
  type StoredReference
} from './citations'

const REFS: StoredReference[] = [
  {
    position: 1,
    url: 'https://www.simpletexting.com/blog/text-employees/',
    domain: 'www.simpletexting.com',
    title: 'Text employees',
    classification: 'competitor',
    sourceType: 'web'
  },
  {
    position: 2,
    url: 'https://textbolt.com/faq',
    domain: 'textbolt.com',
    title: 'FAQ',
    classification: 'target',
    sourceType: 'web'
  },
  {
    position: 3,
    url: 'https://www.reddit.com/r/sysadmin/comments/abc/',
    domain: 'reddit.com',
    title: 'Email to SMS for alerts?',
    classification: 'other',
    sourceType: 'reddit'
  },
  {
    position: 4,
    url: 'https://www.twilio.com/en-us/blog/employee-sms',
    domain: 'twilio.com',
    title: 'Employee SMS',
    classification: 'competitor',
    sourceType: 'web'
  }
]

const CONTEXT = {
  direct: [{ name: 'SimpleTexting', domain: 'simpletexting.com' }],
  partial: [{ name: 'Gmail', domain: null }]
}

describe('tagReferences', () => {
  test("tags what the check stored, with the tier from the product's competitors", () => {
    const tagged = tagReferences(REFS, CONTEXT, 'textbolt.com')
    // twilio.com was stored as a competitor by an older list; it keeps that, with no tier.
    expect(tagged.map((ref) => ref.tag)).toEqual(['direct', 'own', 'other', 'competitor'])
  })

  test('a source the check stored as other stays other, as the numbers count it (P9)', () => {
    const stored = { ...REFS[0], classification: 'other' } as StoredReference
    expect(tagReferences([stored], CONTEXT, 'textbolt.com')[0]?.tag).toBe('other')
  })

  test('the own domain tags a source the check classified as other', () => {
    const tagged = tagReferences(
      [{ ...REFS[1], classification: 'other' } as StoredReference],
      CONTEXT,
      'https://www.textbolt.com/'
    )
    expect(tagged[0]?.tag).toBe('own')
  })
})

describe('referencesBlock and citationFacts', () => {
  const tagged = tagReferences(REFS, CONTEXT, 'textbolt.com')

  test('one line per source with its tag, type and the snippet Google showed', () => {
    const block = referencesBlock(tagged, new Map([[1, 'Employees get texts with no app.']]))
    expect(block).toContain(
      '1. simpletexting.com · Text employees · direct competitor · https://www.simpletexting.com/blog/text-employees/'
    )
    expect(block).toContain('   Shown from it: Employees get texts with no app.')
    expect(block).toContain('3. reddit.com · Email to SMS for alerts? · other · reddit ·')
    expect(referencesBlock([])).toBe('The overview shows no sources.')
  })

  test('code states who is cited first, where the site stands and the rivals', () => {
    expect(citationFacts(tagged)).toEqual([
      'simpletexting.com is cited first (direct competitor).',
      'Your site is cited at position 2 of 4.',
      '2 competitors cited: simpletexting.com, twilio.com.',
      '1 of 4 sources are forums, reviews or videos.'
    ])
    expect(citationFacts([])).toEqual([])
  })
})

describe('overviewWithSources', () => {
  const raw = JSON.stringify({
    ai_overview: {
      text_blocks: [
        { type: 'heading', snippet: 'Ways to text employees' },
        {
          type: 'paragraph',
          snippet: 'Turn alert emails into SMS with no app.',
          reference_indexes: [0, 2]
        },
        {
          type: 'list',
          list: [{ title: 'Shared inbox', snippet: 'see who replied', reference_indexes: [1] }]
        }
      ],
      references: [
        { index: 0, link: 'https://www.simpletexting.com/blog/text-employees/', snippet: 'A…' },
        { index: 1, link: 'https://textbolt.com/faq', snippet: 'Track who sent what.' },
        { index: 2, link: 'https://www.twilio.com/en-us/blog/employee-sms' }
      ]
    }
  })

  test('marks each passage with the stored positions of its sources', () => {
    const read = overviewWithSources(raw, 'flat text', REFS)
    expect(read.marked).toBe(true)
    expect(read.text).toBe(
      [
        '## Ways to text employees',
        'Turn alert emails into SMS with no app. [1, 4]',
        '- Shared inbox: see who replied [2]'
      ].join('\n')
    )
    expect(read.snippets.get(2)).toBe('Track who sent what.')
    expect(read.snippets.get(1)).toBe('A')
  })

  test('falls back to the flat text without a raw overview', () => {
    const read = overviewWithSources(null, '  Flat   overview text ', REFS)
    expect(read).toMatchObject({ text: 'Flat overview text', marked: false })
  })
})

describe('reply checks', () => {
  test('verifiedPassage keeps only passages copied from a source', () => {
    const overview = 'Employees receive alerts as normal SMS, with no app to download.'
    expect(verifiedPassage('"employees receive alerts as normal SMS"', [overview])).not.toBeNull()
    expect(
      verifiedPassage('Employees receive alerts … with no app to download', [overview])
    ).not.toBeNull()
    expect(verifiedPassage('Staff get texts without an app', [overview])).toBeNull()
    expect(verifiedPassage('normal SMS', [overview])).toBeNull()
    expect(verifiedPassage(null, [overview])).toBeNull()
  })

  test('causeProblem names the line that credits a change with a citation', () => {
    expect(causeProblem(['The overview cites simpletexting.com for its setup steps.'])).toBeNull()
    expect(causeProblem(['After you updated the FAQ, Google started citing the page.'])).toMatch(
      /credits a change with a citation/u
    )
  })

  test('fixDraftProblem checks FAQ answers and section bodies by word count', () => {
    const answer = Array.from({ length: 50 }, () => 'word').join(' ')
    expect(fixDraftProblem(`How do we text staff from Outlook?\n${answer}`)).toBeNull()
    expect(fixDraftProblem('How do we text staff from Outlook?\nToo short.')).toMatch(
      /FAQ answer has 2 words/u
    )
    expect(fixDraftProblem(`Text staff from Outlook\n${answer}`)).toMatch(/section has 50 words/u)
    expect(fixDraftProblem('Only one line')).toMatch(/first line/u)
  })

  test('brandInQuestion flags a brand inside a question only', () => {
    expect(brandInQuestion(['Is TextBolt HIPAA compliant?'], ['TextBolt'])).toMatch(/TextBolt/u)
    expect(brandInQuestion(['TextBolt sends texts. Is it HIPAA compliant?'], ['TextBolt'])).toBe(
      null
    )
    expect(brandInQuestion(['Is it HIPAA compliant?'], [])).toBeNull()
  })
})
