import { describe, expect, test } from 'vitest'
import { pageForFix, pageForQuestion, pageHead, type PageRead } from './page-context'

const PAGE: PageRead = {
  url: 'https://textbolt.com/faq',
  title: 'FAQ',
  h1: 'Frequently asked questions',
  metaDescription: null,
  headings: ['Is it secure for business use?', 'What if we accidentally text the wrong patient?'],
  faqs: ['Can we track who sent what message?'],
  text: 'Intro text. Is it secure for business use? Yes, numbers are verified. What if we accidentally text the wrong patient? You have a complete record in Gmail.'
}

describe('page context', () => {
  test('a page never read says so instead of guessing', () => {
    expect(pageHead(null, null)).toBe('No page yet.')
    expect(pageForQuestion(null, 'https://textbolt.com/x', 'anything')).toBe(
      'Not read yet (https://textbolt.com/x). Its headings are not known.'
    )
  })

  test('the head lists title, H1, headings and FAQ questions', () => {
    expect(pageHead(PAGE, PAGE.url)).toBe(
      [
        'Title: FAQ',
        'H1: Frequently asked questions',
        'Headings: Is it secure for business use? | What if we accidentally text the wrong patient?',
        'FAQ questions: Can we track who sent what message?'
      ].join('\n')
    )
  })

  test('the matched section is the heading that shares the most words with the question', () => {
    const text = pageForQuestion(
      PAGE,
      PAGE.url,
      'What can we do if a text goes to the wrong patient?'
    )
    expect(text).toContain(
      'Section that matches the question (What if we accidentally text the wrong patient?): What if we accidentally text the wrong patient? You have a complete record in Gmail.'
    )
    expect(text).toContain('Opening: Intro text.')
    expect(pageForQuestion(PAGE, PAGE.url, 'Pricing in Canada')).toContain(
      'no heading shares its words'
    )
  })

  test('the fix draft gets the head and the page text', () => {
    expect(pageForFix(PAGE, PAGE.url)).toMatch(/\nText: Intro text\. Is it secure/u)
  })
})
