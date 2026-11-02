import { describe, expect, test } from 'vitest'
import { pluralWord, pluralize, questionsAndKeywords } from './pluralize'

describe('pluralize', () => {
  test('uses the singular only for 1, and the plural for 0 and 2+', () => {
    expect(pluralize(0, 'page')).toBe('0 pages')
    expect(pluralize(1, 'page')).toBe('1 page')
    expect(pluralize(2, 'page')).toBe('2 pages')
    expect(pluralize(2014, 'page')).toBe('2,014 pages')
  })

  test('uses an explicit plural when the word is irregular', () => {
    expect(pluralWord(1, 'person', 'people')).toBe('person')
    expect(pluralWord(0, 'person', 'people')).toBe('people')
    expect(pluralize(2, 'person', 'people')).toBe('2 people')
  })
})

describe('questionsAndKeywords', () => {
  test('counts buyer questions and keywords apart, and leaves keywords out when there are none', () => {
    expect(questionsAndKeywords(30, 118)).toBe('30 questions · 118 keywords')
    expect(questionsAndKeywords(1, 1)).toBe('1 question · 1 keyword')
    expect(questionsAndKeywords(28, 0)).toBe('28 questions')
    expect(questionsAndKeywords(0, 5)).toBe('0 questions · 5 keywords')
  })
})
