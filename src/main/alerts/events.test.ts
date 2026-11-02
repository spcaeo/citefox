import { describe, expect, test } from 'vitest'
import type { PromptCheckStatus } from '@shared/domain'
import { matchRule, sameSite, type MatchRule, type QuestionFacts, type RunFacts } from './events'

function q(
  promptId: string,
  status: PromptCheckStatus,
  competitors: readonly string[] = []
): QuestionFacts {
  return { promptId, text: `Question ${promptId}`, status, competitors }
}

function run(
  runId: string,
  questions: readonly QuestionFacts[],
  patch: Partial<RunFacts> = {}
): RunFacts {
  return {
    runId,
    pageId: 'page-1',
    marketId: 'mkt-us',
    at: '2026-10-10T10:00:00.000Z',
    status: 'finished',
    partial: false,
    score: 60,
    questions,
    ...patch
  }
}

const rule = (when: MatchRule['when'], patch: Partial<MatchRule> = {}): MatchRule => ({
  when,
  scoreDrop: null,
  competitorDomain: null,
  ...patch
})

describe('matchRule', () => {
  const before = run('r1', [q('a', 'page_cited'), q('b', 'not_cited'), q('c', 'not_cited')])

  test('citation lost and gained name the questions; an error is not a loss', () => {
    const after = run('r2', [q('a', 'not_cited'), q('b', 'page_cited'), q('c', 'error')])
    expect(matchRule(rule('citation_lost'), before, after)).toEqual({
      when: 'citation_lost',
      summary: 'Target page no longer cited on 1 question',
      details: ['Question a']
    })
    expect(matchRule(rule('citation_gained'), before, after)?.details).toEqual(['Question b'])
    const failedOnly = run('r3', [q('a', 'error'), q('b', 'not_cited'), q('c', 'not_cited')])
    expect(matchRule(rule('citation_lost'), before, failedOnly)).toBeNull()
  })

  test('nothing compares without a previous check, or with a partial one on either side', () => {
    const after = run('r2', [q('a', 'not_cited')])
    expect(matchRule(rule('citation_lost'), null, after)).toBeNull()
    expect(matchRule(rule('citation_lost'), { ...before, partial: true }, after)).toBeNull()
    expect(matchRule(rule('citation_lost'), before, { ...after, partial: true })).toBeNull()
  })

  test('score drop fires at the threshold, not below it, and defaults to 10 points', () => {
    const after = (score: number): RunFacts => run('r2', before.questions, { score })
    expect(matchRule(rule('score_drop', { scoreDrop: 15 }), before, after(45))?.summary).toBe(
      'Score fell from 60 to 45 (−15)'
    )
    expect(matchRule(rule('score_drop', { scoreDrop: 15 }), before, after(46))).toBeNull()
    expect(matchRule(rule('score_drop'), before, after(50))).not.toBeNull()
    expect(matchRule(rule('score_drop'), before, after(51))).toBeNull()
    expect(matchRule(rule('score_drop'), { ...before, score: null }, after(0))).toBeNull()
  })

  test('a competitor cited instead: new on that question, page not cited, domain or any', () => {
    const was = run('r1', [
      q('a', 'page_cited'),
      q('b', 'not_cited', ['twilio.com']),
      q('c', 'not_cited')
    ])
    const now = run('r2', [
      q('a', 'not_cited', ['www.twilio.com']),
      q('b', 'not_cited', ['twilio.com']),
      q('c', 'not_cited', ['simpletexting.com'])
    ])
    const twilio = matchRule(rule('competitor_cited', { competitorDomain: 'twilio.com' }), was, now)
    expect(twilio).toEqual({
      when: 'competitor_cited',
      summary: 'twilio.com is cited instead on 1 question',
      details: ['www.twilio.com on “Question a”']
    })
    const any = matchRule(rule('competitor_cited'), was, now)
    expect(any?.summary).toBe('www.twilio.com, simpletexting.com is cited instead on 2 questions')
    expect(
      matchRule(rule('competitor_cited', { competitorDomain: 'other.com' }), was, now)
    ).toBeNull()
  })

  test('wrong page and AI Overview gone', () => {
    const after = run('r2', [q('a', 'other_own_page'), q('b', 'no_aio'), q('c', 'not_cited')])
    expect(matchRule(rule('wrong_page'), before, after)?.details).toEqual(['Question a'])
    expect(matchRule(rule('aio_gone'), before, after)).toEqual({
      when: 'aio_gone',
      summary: 'No AI Overview any more on 1 question',
      details: ['Question b']
    })
  })

  test('check failed: an error run, or every question failed; needs no previous check', () => {
    expect(matchRule(rule('check_failed'), null, run('r2', [], { status: 'error' }))?.summary).toBe(
      'The check failed'
    )
    expect(
      matchRule(rule('check_failed'), null, run('r2', [q('a', 'error'), q('b', 'error')]))?.summary
    ).toBe('Every question failed (2 questions)')
    expect(
      matchRule(rule('check_failed'), null, run('r2', [q('a', 'error'), q('b', 'no_aio')]))
    ).toBeNull()
  })

  test('details stop at five questions', () => {
    const many = Array.from({ length: 7 }, (_, index) => `p${index}`)
    const was = run(
      'r1',
      many.map((id) => q(id, 'page_cited'))
    )
    const now = run(
      'r2',
      many.map((id) => q(id, 'not_cited'))
    )
    const match = matchRule(rule('citation_lost'), was, now)
    expect(match?.summary).toBe('Target page no longer cited on 7 questions')
    expect(match?.details).toHaveLength(5)
  })
})

test('sameSite treats www and subdomains as the same competitor', () => {
  expect(sameSite('www.twilio.com', 'twilio.com')).toBe(true)
  expect(sameSite('api.twilio.com', 'Twilio.com')).toBe(true)
  expect(sameSite('nottwilio.com', 'twilio.com')).toBe(false)
})
