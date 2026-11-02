import { describe, expect, test } from 'vitest'
import {
  DEFAULT_PATTERN_VARIANTS,
  expandPatternKeywords,
  keywordDepthPreset,
  normalizePerStage,
  questionDepthPreset,
  questionTotal,
  splitAcrossStages
} from '@shared/topic-depth'
import {
  cleanImportLines,
  nearDuplicateKeywords,
  overlapPairs,
  parseCsv,
  promptFlags
} from './text'

describe('topic text rules', () => {
  test('flags brand (whole word, aliases), very short and long questions', () => {
    expect(promptFlags('Is TextBolt good?', 'question', ['TextBolt'])).toEqual(['brand', 'short'])
    expect(
      promptFlags('How do I text bolt my crew a message from the office?', 'question', [
        'Text Bolt'
      ])
    ).toEqual(['brand'])
    expect(
      promptFlags('textboltish alerts for crews in the field today', 'question', ['TextBolt'])
    ).toEqual([])
    expect(promptFlags('sms alerts', 'keyword', ['TextBolt'])).toEqual([])
    expect(promptFlags(Array.from({ length: 33 }, () => 'word').join(' '), 'question', [])).toEqual(
      ['long']
    )
  })

  test('import clean-up merges duplicates, strips bullets and keeps short lines flagged', () => {
    const result = cleanImportLines(
      [
        { text: '- How do I text staff from Outlook?', note: 'Support' },
        { text: '2) how do I text staff from outlook', note: 'Sales call' },
        { text: 'sms alerts', note: null }
      ],
      ['TextBolt']
    )
    expect(result.duplicatesMerged).toBe(1)
    expect(result.kept.map((line) => [line.text, line.flags, line.sourceNote])).toEqual([
      ['How do I text staff from Outlook?', ['merged'], 'Support'],
      ['sms alerts', ['short'], null]
    ])
    expect(result.kept[0]?.mergedFrom).toEqual(['how do I text staff from outlook'])
  })

  test('CSV with quotes, doubled quotes, CRLF and semicolons', () => {
    expect(parseCsv('question,channel\r\n"Hi, there ""you""?",Sales\r\nsecond,Web\n')).toEqual([
      ['question', 'channel'],
      ['Hi, there "you"?', 'Sales'],
      ['second', 'Web']
    ])
    expect(parseCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })

  test('overlaps and keyword near-duplicates', () => {
    const pairs = overlapPairs([
      { id: 'a', text: 'How do I send text alerts to my staff from Gmail?' },
      { id: 'b', text: 'How can I send my staff text alerts from Gmail?' },
      { id: 'c', text: 'What does an SMS gateway cost per month?' }
    ])
    expect(pairs.map((pair) => [pair.a, pair.b])).toEqual([['a', 'b']])
    expect(
      nearDuplicateKeywords([
        { id: '1', text: 'email to sms service' },
        { id: '2', text: 'email to sms services' },
        { id: '3', text: 'sms service email' },
        { id: '4', text: 'mass texting' }
      ]).map((pair) => [pair.keepId, pair.dropId])
    ).toEqual([
      ['1', '2'],
      ['1', '3']
    ])
  })
})

describe('depth presets and pattern expansion', () => {
  test('question presets split across stages and Custom caps at 100', () => {
    expect(questionTotal(questionDepthPreset('quick'))).toBe(15)
    expect(questionTotal(questionDepthPreset('standard'))).toBe(30)
    expect(questionTotal(questionDepthPreset('deep'))).toBe(60)
    expect(Object.values(splitAcrossStages(30))).toEqual([6, 5, 5, 5, 5, 4])
    expect(
      questionTotal({ preset: 'custom', perStage: normalizePerStage({ problem: 60, options: 60 }) })
    ).toBe(100)
  })

  test('keyword presets and pattern expansion honour synonyms, patterns, segments and caps', () => {
    expect(keywordDepthPreset('quick').maxKeywords).toBe(30)
    expect(keywordDepthPreset('standard').maxKeywords).toBe(120)
    const depth = {
      ...keywordDepthPreset('standard'),
      synonymsPerCoreTerm: 1,
      perGroupCap: 4,
      patternVariants: ['{X} service', 'free {X}', '{X} provider', '{X} for {segment}']
    }
    const out = expandPatternKeywords(
      [
        { id: 't', term: 'Text Alerts', synonyms: ['sms alerts', 'pager texts'], kept: true },
        { id: 'x', term: 'skipped', synonyms: [], kept: false }
      ],
      depth,
      ['Clinics'],
      100
    )
    expect([...new Set(out.map((item) => item.group))]).toEqual([
      'Cover — text alerts',
      'Cover — sms alerts'
    ])
    expect(
      out.filter((item) => item.group === 'Cover — text alerts').map((item) => item.text)
    ).toEqual(['text alerts', 'text alerts service', 'free text alerts', 'text alerts provider'])
    // The default patterns carry no AI or automation modifiers (P4 follow-up).
    expect(DEFAULT_PATTERN_VARIANTS).toEqual(['{X} for {segment}'])
    // A term that already carries a pattern's modifier is not doubled.
    expect(
      expandPatternKeywords(
        [{ id: 's', term: 'email to text service', synonyms: [], kept: true }],
        { ...depth, longTailQuestions: false },
        [],
        10
      ).map((item) => item.text)
    ).toEqual([
      'email to text service',
      'free email to text service',
      'email to text service provider'
    ])
    expect(
      expandPatternKeywords(
        [{ id: 't', term: 'a b', synonyms: [], kept: true }],
        { ...depth, perGroupCap: 50 },
        ['clinics'],
        3
      )
    ).toHaveLength(3)
    const withSegment = expandPatternKeywords(
      [{ id: 't', term: 'alerts', synonyms: [], kept: true }],
      {
        ...depth,
        perGroupCap: 50,
        patternVariants: ['{X} for {segment}'],
        longTailQuestions: false
      },
      ['Clinics', 'Schools'],
      50
    )
    expect(withSegment.map((item) => item.text)).toEqual([
      'alerts',
      'alerts for clinics',
      'alerts for schools'
    ])
  })
})
