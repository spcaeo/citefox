import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import type { IntentStage, PromptSource } from '@shared/domain'
import { wordCount } from './hash'
import { BUYER_PROMPT_MAX_CHARS, BUYER_PROMPT_MAX_WORDS, BUYER_PROMPT_MIN_WORDS } from './schemas'
import {
  TEXTBOLT_COVERAGE,
  TEXTBOLT_PROMPTS_EN,
  TEXTBOLT_PROMPTS_ES,
  textboltJinaBody
} from './textbolt-fixture'
import {
  offeredExclusions,
  requiredPromptSources,
  unquoteOffPage,
  validateBuyerPrompts,
  validateCoverage,
  type PromptDraft
} from './validate'

/**
 * The owner's ten TextBolt questions from Docs/textbolt-reference.md.
 * They are the method's quality bar, so every one must be accepted.
 */
const OWNER_REFERENCE_PROMPTS = [
  'How can I send text alerts to my employees without hiring a developer or learning a new app?',
  'Is there a way to schedule a text message to my whole team from Gmail or Outlook?',
  'Our monitoring tool only sends email alerts. How do I get those as text messages on my phone?',
  "My email-to-text through txt.att.net stopped working. What's the best replacement for business alerts?",
  'Verizon is shutting down vtext.com. What should a small business switch to so our automated alerts keep reaching phones?',
  "What's the easiest way to turn emails from our scheduling software into SMS reminders for customers and staff?",
  'Do I need 10DLC registration to send text alerts to my own employees, and is there a service that handles it for me?',
  "What's a cheap alternative to Twilio for sending business text alerts if we don't have developers?",
  "How do I send a text to my field techs early Saturday morning when I'm writing the update Friday afternoon?",
  'Can employees reply to an automated business text alert and have the reply come back to my email?'
] as const

/** The short keyword prompt the owner rejected (SRS section 4.8). */
const REJECTED_KEYWORD_PROMPT = 'sms alert software for small business'

const BASE: readonly PromptDraft[] = [
  draft(OWNER_REFERENCE_PROMPTS[0], 'title_meta_h1', 'problem'),
  draft(OWNER_REFERENCE_PROMPTS[2], 'trigger_event', 'problem'),
  draft(OWNER_REFERENCE_PROMPTS[6], 'objection', 'objection')
]

describe('buyer prompt length', () => {
  test('accepts every owner reference prompt, first person and all', () => {
    expect(OWNER_REFERENCE_PROMPTS).toHaveLength(10)
    for (const text of OWNER_REFERENCE_PROMPTS) {
      expect(wordCount(text)).toBeGreaterThan(12)
      expect(validateBuyerPrompts({ prompts: withText(BASE, text) }, options(BASE.length))).toBe(
        null
      )
    }
  })

  test('rejects the short keyword prompt the owner turned down', () => {
    const words = wordCount(REJECTED_KEYWORD_PROMPT)
    expect(words).toBeLessThan(BUYER_PROMPT_MIN_WORDS)
    expect(
      validateBuyerPrompts(
        { prompts: withText(BASE, REJECTED_KEYWORD_PROMPT) },
        options(BASE.length)
      )
    ).toMatchObject({
      code: 'schema_validation',
      message: `A buyer prompt is ${words} words. Write it as a full situational question of at least ${BUYER_PROMPT_MIN_WORDS} words.`
    })
  })

  test('accepts a situational sentence with no question mark', () => {
    const text =
      'I write the crew update on Friday afternoon but it needs to reach their phones Saturday at 6am'
    expect(validateBuyerPrompts({ prompts: withText(BASE, text) }, options(BASE.length))).toBeNull()
  })

  test('rejects a prompt over the word cap and over the character cap', () => {
    const atCap = Array.from({ length: BUYER_PROMPT_MAX_WORDS }, () => 'alert').join(' ')
    expect(
      validateBuyerPrompts({ prompts: withText(BASE, atCap) }, options(BASE.length))
    ).toBeNull()
    const overCap = `${atCap} again`
    expect(
      validateBuyerPrompts({ prompts: withText(BASE, overCap) }, options(BASE.length))
    ).toMatchObject({
      code: 'schema_validation',
      message: `A buyer prompt is ${BUYER_PROMPT_MAX_WORDS + 1} words. Google reads at most ${BUYER_PROMPT_MAX_WORDS}, so keep it to ${BUYER_PROMPT_MAX_WORDS} or fewer.`
    })

    const longWords = Array.from({ length: 10 }, () => 'x'.repeat(45)).join(' ')
    expect(longWords.length).toBeGreaterThan(BUYER_PROMPT_MAX_CHARS)
    const tooLong = validateBuyerPrompts(
      { prompts: withText(BASE, longWords) },
      options(BASE.length)
    )
    expect(tooLong?.code).toBe('schema_validation')
    expect(tooLong?.message).toContain(
      `must NOT have more than ${BUYER_PROMPT_MAX_CHARS} characters`
    )
  })

  test('rejects a prompt that contains the brand name or an alias', () => {
    for (const [text, brand] of [
      ['Is TextBolt a good way to text my whole team from Outlook on a Saturday?', 'TextBolt'],
      ['Can text bolt send alerts from our monitoring tool to the on-call phone?', 'Text Bolt']
    ] as const) {
      expect(
        validateBuyerPrompts({ prompts: withText(BASE, text) }, options(BASE.length))
      ).toMatchObject({
        code: 'brand_in_prompt',
        message: `A buyer prompt contains the brand name "${brand}".`
      })
    }
  })

  test('still requires the three sources and a real stage', () => {
    const noObjection = BASE.map((prompt) => ({ ...prompt, source: 'title_meta_h1' as const }))
    expect(validateBuyerPrompts({ prompts: noObjection }, options(BASE.length))).toMatchObject({
      code: 'schema_validation',
      message: 'Prompts must use title_meta_h1, trigger_event, and objection.'
    })
    const badStage = validateBuyerPrompts(
      { prompts: BASE.map((prompt) => ({ ...prompt, intentStage: 'awareness' })) },
      options(BASE.length)
    )
    expect(badStage?.code).toBe('schema_validation')
  })

  test('a set of 1 or 2 prompts (Prompts per page 1 or 2) needs only the first sources', () => {
    // Live textbolt.com import with 1 prompt per page failed: 'Expected 1 prompts and received 3.'
    const titleOnly = BASE.slice(0, 1).map((prompt) => ({
      ...prompt,
      source: 'title_meta_h1' as const
    }))
    expect(validateBuyerPrompts({ prompts: titleOnly }, options(1))).toBeNull()
    const two = BASE.slice(0, 2).map((prompt, index) => ({
      ...prompt,
      source: index === 0 ? ('title_meta_h1' as const) : ('trigger_event' as const)
    }))
    expect(validateBuyerPrompts({ prompts: two }, options(2))).toBeNull()
    const noTitle = BASE.slice(0, 1).map((prompt) => ({ ...prompt, source: 'objection' as const }))
    expect(validateBuyerPrompts({ prompts: noTitle }, options(1))).toMatchObject({
      code: 'schema_validation',
      message: 'Prompts must use title_meta_h1.'
    })
    expect(requiredPromptSources(1)).toEqual(['title_meta_h1'])
    expect(requiredPromptSources(2)).toEqual(['title_meta_h1', 'trigger_event'])
    expect(requiredPromptSources(5)).toEqual(['title_meta_h1', 'trigger_event', 'objection'])
  })

  test('the source no longer carries the first-person ban or the 12-word cap', () => {
    const source = readFileSync(fileURLToPath(new URL('./validate.ts', import.meta.url)), 'utf8')
    expect(source.includes('FIRST_PERSON')).toBe(false)
    expect(source.includes('Write it as a Google search')).toBe(false)
    expect(BUYER_PROMPT_MAX_WORDS).toBeGreaterThan(12)
  })

  test('accepts the recorded TextBolt fixtures, which are the owner questions', () => {
    expect(TEXTBOLT_PROMPTS_EN.prompts.map((prompt) => prompt.text)).toEqual([
      ...OWNER_REFERENCE_PROMPTS
    ])
    expect(validateBuyerPrompts({ prompts: TEXTBOLT_PROMPTS_EN.prompts }, options(10))).toBeNull()
    expect(
      validateBuyerPrompts(
        { prompts: TEXTBOLT_PROMPTS_ES.prompts },
        {
          ...options(10),
          language: 'es',
          canonicalLanguage: 'en',
          canonical: TEXTBOLT_PROMPTS_EN.prompts
        }
      )
    ).toBeNull()
    expect(recordedPromptTexts()).toEqual([...OWNER_REFERENCE_PROMPTS])
    for (const spec of ['first-check.spec.ts', 'full-journey.spec.ts']) {
      const body = readFileSync(
        fileURLToPath(new URL(`../../../tests/e2e/${spec}`, import.meta.url)),
        'utf8'
      )
      for (const text of OWNER_REFERENCE_PROMPTS) {
        expect(body).toContain(text)
      }
    }
  })
})

function draft(text: string, source: PromptSource, intentStage: IntentStage): PromptDraft {
  return { text, label: text.slice(0, 40), source, intentStage, mappedElement: 'H1' }
}

function options(count: number): {
  count: number
  brands: readonly string[]
  canonical: null
  language: string
  canonicalLanguage: string
} {
  return {
    count,
    brands: ['TextBolt', 'Text Bolt'],
    canonical: null,
    language: 'en',
    canonicalLanguage: 'en'
  }
}

function withText(prompts: readonly PromptDraft[], text: string): PromptDraft[] {
  return prompts.map((prompt, index) => (index === 0 ? { ...prompt, text } : prompt))
}

function recordedPromptTexts(): string[] {
  const file = fileURLToPath(
    new URL('../providers/fixtures/textbolt/claude-prompts.json', import.meta.url)
  )
  const envelope = JSON.parse(readFileSync(file, 'utf8')) as {
    body: { content: { text: string }[] }
  }
  const parsed = JSON.parse(envelope.body.content[0]?.text ?? '') as { prompts: { text: string }[] }
  return parsed.prompts.map((prompt) => prompt.text)
}

describe('coverage quotes against the page', () => {
  // The live TextBolt page uses typographic quotes; Claude copies them as straight ones.
  const pageText = [
    textboltJinaBody(),
    'Schedule Send uses the sender’s time zone, not the recipient’s.',
    'Send from an inbox someone actually monitors, so a “running late” reply reaches the right person.',
    ...TEXTBOLT_COVERAGE.rows.flatMap((row) => row.whereCovered),
    ...TEXTBOLT_COVERAGE.rows.flatMap((row) =>
      row.suggestedFaq === null ? [] : [row.suggestedFaq.answer]
    )
  ].join('\n')
  const count = TEXTBOLT_COVERAGE.rows.length

  function withFirstRow(change: Partial<(typeof TEXTBOLT_COVERAGE.rows)[number]>): unknown {
    return {
      ...TEXTBOLT_COVERAGE,
      rows: TEXTBOLT_COVERAGE.rows.map((row, index) => (index === 0 ? { ...row, ...change } : row))
    }
  }

  test('the fixture matrix passes', () => {
    expect(validateCoverage(TEXTBOLT_COVERAGE, { count, pageText })).toBeNull()
  })

  test('every partial, weak, or none row needs a 40-70 word FAQ draft', () => {
    for (const coverage of ['partial', 'weak', 'none'] as const) {
      const value = withFirstRow({
        coverage,
        actions: ['update_existing'],
        suggestedFaq: null,
        ...(coverage === 'none' ? { whereCovered: [] } : {})
      })
      expect(validateCoverage(value, { count, pageText }), coverage).toMatchObject({
        code: 'schema_validation',
        message: expect.stringContaining('Position 1 is ' + coverage)
      })
    }
    const strong = withFirstRow({
      coverage: 'strong',
      actions: ['small_update'],
      suggestedFaq: null
    })
    expect(validateCoverage(strong, { count, pageText })).toBeNull()
  })

  test('straight quotes and apostrophes match the page’s curly ones', () => {
    const value = withFirstRow({
      whereCovered: ["Schedule Send uses the sender's time zone, not the recipient's."],
      mainGap: 'The page says a "running late" reply reaches the right person, but not where.'
    })
    expect(validateCoverage(value, { count, pageText })).toBeNull()
  })

  test('a sentence with markdown links on the page matches its plain text (live re-run)', () => {
    const linked =
      'You can send alerts from Gmail, [Datadog](https://textbolt.com/integration/datadog/ "Datadog"), [Grafana](https://textbolt.com/integration/grafana/ "Grafana"), or any **SMTP-enabled** system.'
    const value = withFirstRow({
      currentContent:
        'Step 3 says "You can send alerts from Gmail, Datadog, Grafana, or any SMTP-enabled system."'
    })
    expect(validateCoverage(value, { count, pageText: `${pageText}\n${linked}` })).toBeNull()
  })

  test('the buyer prompt’s own words may be quoted (live re-run: "what replaced it")', () => {
    const value = withFirstRow({
      mainGap: 'The buyer asks "what replaced those free addresses" and the page never says.'
    })
    expect(validateCoverage(value, { count, pageText })).toMatchObject({
      code: 'quote_not_on_page'
    })
    expect(
      validateCoverage(value, {
        count,
        pageText,
        promptText: 'What replaced those free addresses for a small business?'
      })
    ).toBeNull()
  })

  test('a quote that ends with a period where the page has a comma still matches', () => {
    const value = withFirstRow({
      currentContent:
        'The API section says "Schedule Send uses the sender’s time zone, not the recipient’s"'
    })
    expect(validateCoverage(value, { count, pageText })).toBeNull()
    const trailing = withFirstRow({
      currentContent: 'It says "...Schedule Send uses the sender’s time zone."'
    })
    expect(validateCoverage(trailing, { count, pageText })).toBeNull()
  })

  test('a paraphrase in quotes loses its quote marks instead of failing the matrix', () => {
    const value = withFirstRow({
      mainGap: 'The page never says "employees get it on day one", so buyers cannot tell.'
    })
    expect(validateCoverage(value, { count, pageText })).toMatchObject({
      code: 'quote_not_on_page'
    })
    const cleaned = unquoteOffPage(value, { pageText })
    expect(validateCoverage(cleaned, { count, pageText })).toBeNull()
    const row = (cleaned as typeof TEXTBOLT_COVERAGE).rows[0]
    expect(row?.mainGap).toBe(
      'The page never says employees get it on day one, so buyers cannot tell.'
    )
    // A place that is not on the page is still rejected.
    const place = unquoteOffPage(withFirstRow({ whereCovered: ['An invented heading here'] }), {
      pageText
    })
    expect(validateCoverage(place, { count, pageText })).toMatchObject({
      code: 'quote_not_on_page'
    })
  })

  test('a short label before a copied place is accepted', () => {
    const value = withFirstRow({
      whereCovered: [
        'H3: 5. Connect Your Existing Business Systems',
        'Step 5: "Schedule Send uses the sender\'s time zone"'
      ]
    })
    expect(validateCoverage(value, { count, pageText })).toBeNull()
  })

  test('a page part named the way the template lists it is a place', () => {
    const value = withFirstRow({ whereCovered: ['H1', 'Intro', 'FAQ section'] })
    expect(validateCoverage(value, { count, pageText })).toBeNull()
  })

  test('words proposed in "What to update" are not page quotes', () => {
    const value = withFirstRow({
      whatToUpdate: 'Add a sentence: "In Datadog, add the gateway address as a monitor recipient."'
    })
    expect(validateCoverage(value, { count, pageText })).toBeNull()
  })

  test('the words between two short quotes are not read as a quote', () => {
    const value = {
      ...TEXTBOLT_COVERAGE,
      findings: [
        {
          ...TEXTBOLT_COVERAGE.findings[0],
          detail: 'The FAQ ends in "??". It appears twice. Change it to a single "?".'
        }
      ]
    }
    expect(validateCoverage(value, { count, pageText })).toBeNull()
  })

  test('an invented place or quote is still rejected, with or without a label', () => {
    for (const place of [
      'This heading was invented for the test',
      'FAQ: This heading was invented'
    ]) {
      expect(
        validateCoverage(withFirstRow({ whereCovered: [place] }), { count, pageText })
      ).toMatchObject({
        code: 'quote_not_on_page'
      })
    }
    const quoted = withFirstRow({ mainGap: 'The page never says "employees get it on day one".' })
    expect(validateCoverage(quoted, { count, pageText })).toMatchObject({
      code: 'quote_not_on_page'
    })
  })
})

describe('offeredExclusions (the rule prompts.more shares, assist/definitions/rules.ts)', () => {
  const lists = {
    competitors: ['ClickSend', 'Textmagic'],
    switchingFrom: [
      'AT&T email-to-text gateway (txt.att.net)',
      'Verizon vtext.com email-to-text gateway'
    ],
    integrations: ['Microsoft Outlook', 'WIN-911']
  }

  test.each([
    [
      'Is txt.att.net or ClickSend more reliable for alarm texts?',
      ['AT&T email-to-text gateway (txt.att.net)']
    ],
    ['What are alternatives like WIN-911 for texting night operators?', ['WIN-911']],
    ['Is Outlook or Textmagic simpler for a crew of twelve?', ['Microsoft Outlook']],
    ['My txt.att.net alerts stopped. Is ClickSend or Textmagic better for alarms?', []],
    ['We schedule alerts in Outlook. Is ClickSend or Textmagic cheaper?', []]
  ])('comparison: %s', (text, expected) => {
    expect(offeredExclusions(text, 'comparison', lists)).toEqual(expected)
  })

  test('only comparison prompts are checked', () => {
    expect(offeredExclusions('Is Outlook or Textmagic simpler?', 'problem', lists)).toEqual([])
  })
})
