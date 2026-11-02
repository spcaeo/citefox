import { describe, expect, test } from 'vitest'
import { KEYWORD_INTENT_FAMILIES } from '@shared/domain'
import {
  cleanKeywordPattern,
  COMPETITOR_FAMILIES,
  familyLines,
  KEYWORD_FAMILY_RULES,
  keywordsPerFamily,
  keywordWordsFit,
  nameKeys,
  namesAny,
  normalizeKeyword,
  patternsToApply,
  topicOptions
} from './keyword-rules'

const EMPTY = { product: null, direct: [], partial: [], switchingFrom: [], integrations: [] }

describe('keyword families (P4)', () => {
  test('every family has a rule; the two competitor families map to comparison pages', () => {
    for (const family of KEYWORD_INTENT_FAMILIES) {
      expect(KEYWORD_FAMILY_RULES[family].means.length, family).toBeGreaterThan(20)
    }
    expect(COMPETITOR_FAMILIES).toEqual(['alternatives_vs', 'competitor_vs'])
    for (const family of COMPETITOR_FAMILIES) {
      expect(KEYWORD_FAMILY_RULES[family].pageType).toBe('comparison page')
    }
  })

  test('family lines name the family, its label and its mapping', () => {
    expect(familyLines(['pricing'])).toBe(
      `- pricing ("Pricing / free / trial"; commercial, bofu, landing page): ${KEYWORD_FAMILY_RULES.pricing.means}`
    )
  })

  test('the budget is shared so every family fits, within the per-group cap', () => {
    expect(keywordsPerFamily(60, 13, 8)).toBe(4)
    expect(keywordsPerFamily(200, 5, 8)).toBe(8)
    expect(keywordsPerFamily(3, 5, 8)).toBe(1)
    expect(keywordsPerFamily(60, 0, 8)).toBe(0)
  })
})

describe('names in keywords', () => {
  test('a brand name matches whole, split at capitals, and as its domain label', () => {
    const keys = nameKeys('SimpleTexting', 'simpletexting.com')
    expect(namesAny('simpletexting alternative', keys)).toBe(true)
    expect(namesAny('simple texting vs twilio', keys)).toBe(true)
    expect(namesAny('simple text alerts', keys)).toBe(false)
    expect(namesAny('txt impact pricing', nameKeys('TXTImpact'))).toBe(true)
    expect(namesAny('get voip review', nameKeys('get-voip.com'))).toBe(true)
  })

  test('a descriptive switch-from name matches on its brand-like words only', () => {
    expect(namesAny('att email to text alternative', nameKeys('AT&T email to text gateway'))).toBe(
      true
    )
    expect(namesAny('at&t email to text not working', nameKeys('AT&T email to text gateway'))).toBe(
      true
    )
    expect(namesAny('vtext replacement', nameKeys('Verizon vtext.com'))).toBe(true)
    expect(namesAny('email to text gateway', nameKeys('AT&T email to text gateway'))).toBe(false)
    // Short plain words of a name never count on their own.
    expect(namesAny('send texts to all staff', nameKeys('Text Em All'))).toBe(false)
  })

  test('topic options: the draft list before products, the product list after', () => {
    const before = topicOptions(EMPTY, {
      competitors: ['simpletexting.com', 'Twilio'],
      switchingFrom: ['Verizon vtext.com'],
      integrations: ['Outlook']
    })
    expect(before.competitors.map((item) => [item.name, item.domain])).toEqual([
      ['simpletexting.com', 'simpletexting.com'],
      ['Twilio', null]
    ])
    expect(namesAny('twilio vs simpletexting', before.competitorKeys)).toBe(true)
    expect(namesAny('vtext alternative', before.switchKeys)).toBe(true)
    const product = topicOptions(
      {
        ...EMPTY,
        product: { id: 'p1', name: 'Email to SMS', job: 'texts from email', buyer: 'ops teams' },
        direct: [{ name: 'Textmagic', domain: 'textmagic.com' }],
        partial: [{ name: 'Twilio', domain: 'twilio.com' }]
      },
      { competitors: ['simpletexting.com'], switchingFrom: [], integrations: [] }
    )
    expect(product.competitors.map((item) => item.name)).toEqual(['Textmagic'])
    expect(product.partial.map((item) => item.name)).toEqual(['Twilio'])
    expect(namesAny('simpletexting alternative', product.competitorKeys)).toBe(false)
  })
})

describe('keyword shape', () => {
  test('normalized, and sized by family', () => {
    expect(normalizeKeyword('  "Best  Email to SMS"  service. ')).toBe('best email to sms service')
    expect(keywordWordsFit('email to text', 'core_category')).toBe(true)
    expect(keywordWordsFit('sms', 'core_category')).toBe(false)
    expect(
      keywordWordsFit('can i send alarm panel emails to a cell phone as text', 'question_long_tail')
    ).toBe(true)
    expect(keywordWordsFit('alarm texts', 'question_long_tail')).toBe(false)
  })
})

describe('coverage patterns (P4 follow-up)', () => {
  test('a reply pattern is cleaned to one {X} slot, or dropped', () => {
    expect(cleanKeywordPattern('X service')).toBe('{X} service')
    expect(cleanKeywordPattern('Free {x}')).toBe('free {X}')
    expect(cleanKeywordPattern('{X} for <segment>')).toBe('{X} for {segment}')
    expect(cleanKeywordPattern('best <X> provider')).toBe('best {X} provider')
    expect(cleanKeywordPattern('{X}')).toBeNull()
    expect(cleanKeywordPattern('{X} vs {X}')).toBeNull()
    expect(cleanKeywordPattern('service')).toBeNull()
    expect(cleanKeywordPattern('{X} for very small local service businesses')).toBeNull()
  })

  test("a preset applies its current defaults plus the topic's; Custom keeps the user's", () => {
    const topic = ['{X} service', 'free {X}']
    expect(
      patternsToApply(
        { preset: 'standard', patternVariants: ['ai {X} software', '{X} for {segment}'] },
        topic,
        ['{X} for {segment}']
      )
    ).toEqual(['{X} for {segment}', '{X} service', 'free {X}'])
    expect(
      patternsToApply({ preset: 'custom', patternVariants: ['ai {X} software'] }, topic, [
        '{X} for {segment}'
      ])
    ).toEqual(['ai {X} software', '{X} service', 'free {X}'])
    expect(
      patternsToApply({ preset: 'quick', patternVariants: [] }, undefined, ['{X} for {segment}'])
    ).toEqual(['{X} for {segment}'])
  })
})
