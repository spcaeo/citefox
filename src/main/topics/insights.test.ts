import { describe, expect, test } from 'vitest'
import { textboltTopicResults } from '@shared/fixtures/textbolt-topic'
import { actionsProblem, fixProblem, matchesText, resultsText } from './insights'

describe('topic summary results text', () => {
  test('a first check says so instead of "Since the first check"', () => {
    const results = textboltTopicResults()
    const first = resultsText({
      ...results,
      summaryInputs: { ...results.summaryInputs, sinceAt: null, gained: [], lost: [] }
    })
    expect(first).toContain('First check: there is no earlier check to compare with')
    expect(first).not.toMatch(/Since the first check/u)
    expect(first).not.toMatch(/^Since /mu)
  })

  test('a later check names the earlier check date', () => {
    const results = textboltTopicResults()
    const later = resultsText({
      ...results,
      summaryInputs: { ...results.summaryInputs, sinceAt: '2026-10-12T09:00:00.000Z' }
    })
    expect(later).toMatch(/^Since Oct 12, 2026, 9:00 AM: newly cited /mu)
    expect(later).not.toContain('First check:')
  })
})

describe('topic insight checks', () => {
  const answer = Array.from({ length: 50 }, () => 'word').join(' ')
  const steps = ["Rewrite 'Is TextBolt HIPAA compliant?' with the BAA position", 'Two', 'Three']

  test('a fix draft may quote a page heading with the brand, but not ask a buyer question with it', () => {
    expect(
      fixProblem(
        { where: 'target', steps, draft: `What if we text the wrong patient?\n${answer}` },
        ['TextBolt']
      )
    ).toBeNull()
    expect(
      fixProblem({ where: 'target', steps, draft: `Is TextBolt HIPAA compliant?\n${answer}` }, [
        'TextBolt'
      ])
    ).toMatch(/Leave the brand name "TextBolt" out/u)
    expect(fixProblem({ where: 'new', steps, draft: 'Is it safe?\nYes.' }, ['TextBolt'])).toMatch(
      /FAQ answer has 1 words/u
    )
  })

  test('next actions need a question of this topic; unknown numbers alone fail', () => {
    const action = { text: 'Add an H2 to /faq', promptNumbers: [1, 9], verify: null }
    const numbers = new Set([1, 2])
    expect(actionsProblem({ nextActions: [action, action, action] }, numbers)).toBeNull()
    expect(
      actionsProblem({ nextActions: [action, { ...action, promptNumbers: [9] }, action] }, numbers)
    ).toMatch(/^Action 2 names no question/u)
  })

  test('the to-do list for next actions leaves out questions the right page answers', () => {
    const results = textboltTopicResults()
    const text = matchesText(results)
    const done = results.rows.filter((row) => row.kind === 'question' && row.state === 'right_page')
    expect(done.length).toBeGreaterThan(0)
    for (const row of done) expect(text).not.toMatch(new RegExp(`^Q${row.number} · `, 'mu'))
  })
})
