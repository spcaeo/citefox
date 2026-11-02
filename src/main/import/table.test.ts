import { describe, expect, test } from 'vitest'
import {
  BUILT_IN_STAGE_WORDS,
  columnLetter,
  promptKindOf,
  translateStage
} from '@shared/import-fields'
import { indexed, SimilarIndex } from './similar'
import { buildTable, columnsOf, guessMapping, headerSignature, looksLikeHeader } from './table'

describe('looksLikeHeader', () => {
  test('known column names are a header', () => {
    expect(
      looksLikeHeader(
        [
          ['Query', 'Funnel stage'],
          ['a', 'TOFU']
        ],
        'questions'
      )
    ).toBe(true)
    expect(
      looksLikeHeader(
        [
          ['Page URL', 'Label'],
          ['https://a.com/', 'A']
        ],
        'pages'
      )
    ).toBe(true)
  })

  test('data in the first row is not', () => {
    expect(
      looksLikeHeader(
        [
          ['how do I text from Gmail', 'TOFU'],
          ['b', 'MOFU']
        ],
        'questions'
      )
    ).toBe(false)
  })

  test('a word above a column of numbers is a header', () => {
    expect(
      looksLikeHeader(
        [
          ['Phrase', 'Volume'],
          ['email to sms', '320'],
          ['sms gateway', '1,900']
        ],
        'questions'
      )
    ).toBe(true)
  })
})

describe('buildTable', () => {
  test('pads rows, trims cells, numbers rows after the header', () => {
    const table = buildTable(
      [['Question', 'Stage'], ['  a  question ', 'TOFU', 'extra'], ['b']],
      true
    )
    expect(table.header).toEqual(['Question', 'Stage', ''])
    expect(table.rows).toEqual([
      ['a question', 'TOFU', 'extra'],
      ['b', '', '']
    ])
    expect(table.rowNumbers).toEqual([2, 3])
    expect(table.warnings).toEqual([])
  })

  test('applies the row, column and cell limits with warnings', () => {
    const rows = Array.from({ length: 5003 }, (_, index) => [`q ${index}`])
    expect(buildTable(rows, false).rows).toHaveLength(5000)
    expect(buildTable(rows, false).warnings[0]).toContain('first 5,000 rows')
    const wide = [Array.from({ length: 55 }, (_, index) => `c${index}`)]
    expect(buildTable(wide, false).width).toBe(50)
    const long = buildTable([['x'.repeat(600)]], false)
    expect(long.rows[0]?.[0]).toHaveLength(500)
    expect(long.warnings[0]).toContain('cut')
  })
})

describe('guessMapping', () => {
  test('headers that name a field win', () => {
    const table = buildTable(
      [
        ['Keyword', 'Funnel stage', 'Landing page', 'Country', 'Volume'],
        ['how do I text from Gmail', 'TOFU', '/gmail/', 'US', '320']
      ],
      true
    )
    expect(guessMapping(table, 'questions')).toEqual(['question', 'stage', 'page', 'market', null])
  })

  test('without headers: URLs, stage words, market codes and the longest text', () => {
    const table = buildTable(
      [
        ['TOFU', 'how do I send texts from Outlook to staff', 'https://textbolt.com/a/', 'US'],
        ['BOFU', 'is email to SMS safe for alerts', '/b/', 'GB']
      ],
      false
    )
    expect(guessMapping(table, 'questions')).toEqual(['stage', 'question', 'page', 'market'])
  })

  test('a page list finds its URL column by content', () => {
    const table = buildTable(
      [
        ['Pricing', 'https://textbolt.com/pricing/'],
        ['Home', 'https://textbolt.com/']
      ],
      false
    )
    expect(guessMapping(table, 'pages')).toEqual(['label', 'url'])
  })

  test('columns list letters, headers and samples; signatures fold headers', () => {
    const table = buildTable(
      [
        ['Question', 'Stage'],
        ['a', ''],
        ['b', 'TOFU']
      ],
      true
    )
    expect(columnsOf(table)).toEqual([
      { index: 0, letter: 'A', header: 'Question', samples: ['a', 'b'] },
      { index: 1, letter: 'B', header: 'Stage', samples: ['TOFU'] }
    ])
    expect(headerSignature(['Question ', 'STAGE'], 2)).toBe('question|stage')
    expect(headerSignature(null, 3)).toBe('#3')
    expect(columnLetter(27)).toBe('AB')
  })
})

describe('stage words and the keyword rule', () => {
  test('built-in words translate; unknown words wait for a choice', () => {
    expect(translateStage('TOFU', {})).toBe('problem')
    expect(translateStage('Bottom of funnel', {})).toBe('decide')
    expect(translateStage('Comparison', {})).toBe('compare')
    expect(translateStage('Awareness', {})).toBe('unknown')
    expect(translateStage('awareness', { awareness: 'problem' })).toBe('problem')
    expect(translateStage('awareness', { awareness: null })).toBe('unknown')
    expect(translateStage('  ', {})).toBe('')
    expect(BUILT_IN_STAGE_WORDS.mofu).toBe('compare')
  })

  test('four words or fewer without a question shape is a keyword', () => {
    expect(promptKindOf('email to sms gateway')).toBe('keyword')
    expect(promptKindOf('what is email to sms')).toBe('question')
    expect(promptKindOf('sms gateway?')).toBe('question')
    expect(promptKindOf('send texts from outlook to staff')).toBe('question')
  })
})

describe('SimilarIndex', () => {
  const index = new SimilarIndex<string>()
  index.add(indexed('a', 'How do I send texts from Outlook to my staff?'))
  index.add(indexed('b', 'best email to sms gateway for alarm panels'))

  test('case and punctuation are exact', () => {
    expect(index.exact(indexed(null, 'how do i send texts from outlook to my staff'))).toBe('a')
    expect(index.exact(indexed(null, 'something else'))).toBeNull()
  })

  test('a year, an article or a plural apart is merged; another word order is not', () => {
    expect(
      index.merged(indexed(null, 'The best email to SMS gateways for alarm panels (2026)'))
    ).toBe('b')
    expect(index.merged(indexed(null, 'How do I send a text from Outlook to my staff?'))).toBe('a')
    expect(index.merged(indexed(null, 'from Outlook, how do I send my staff texts'))).toBeNull()
    expect(index.merged(indexed(null, 'best sms to email gateway for alarm panels'))).toBeNull()
  })

  test('the same words in another order are similar', () => {
    expect(index.similar(indexed(null, 'from Outlook, how do I send my staff texts'))?.item).toBe(
      'a'
    )
  })

  test('a large word overlap is similar; a small one is not', () => {
    expect(
      index.similar(indexed(null, 'best email to sms gateway for alarm panels in 2026'))?.item
    ).toBe('b')
    expect(index.similar(indexed(null, 'is there a free sms gateway'))).toBeNull()
  })
})
