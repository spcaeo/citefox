import type { HistorySubject, ProjectCheck, ProjectHistory } from '@shared/ipc'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  readFixture,
  request,
  SEED,
  seedAssistProject,
  type AssistSeed
} from '../assist.test-helper'
import { ASSIST_OUTPUT_RULES } from '../preamble'
import { runAssist } from '../run'
import { checkPairs, WHAT_CHANGED_MAX_PAIRS, whatChangedFacts } from './history'
import { ensureShippedAssists } from './index'

ensureShippedAssists()

const PAGE: HistorySubject = { id: 'p1', kind: 'page', label: 'Alerts', url: 'https://x.com/a' }
const TOPIC: HistorySubject = { id: 't1', kind: 'topic', label: 'Texting', url: null }

function check(over: Partial<ProjectCheck> & { runId: string; startedAt: string }): ProjectCheck {
  return {
    jobId: 'job',
    pageId: PAGE.id,
    marketId: 'us',
    snapshotId: 'snap',
    kind: 'scheduled',
    partial: false,
    status: 'finished',
    finishedAt: over.startedAt,
    durationMs: 1000,
    questionsChecked: 3,
    questionsTotal: 3,
    aiOverviews: 3,
    cited: 1,
    named: 0,
    searchesUsed: 3,
    score: 40,
    scoreChange: null,
    samples: 1,
    promptIds: null,
    failedPromptIds: [],
    ...over
  }
}

function history(checks: ProjectCheck[], subjects = [PAGE, TOPIC]): ProjectHistory {
  return {
    projectId: 'proj',
    builtAt: '2026-10-20T00:00:00.000Z',
    markets: [
      {
        id: 'us',
        country: 'US',
        language: 'en',
        location: null,
        device: 'desktop',
        localWording: false,
        serpapiLocation: null
      }
    ],
    subjects,
    checks,
    trackedCount: subjects.length
  }
}

const ALL = { pageId: null, marketId: null, scope: null } as const

describe('What changed: pairs counted in code', () => {
  test('compares the last two finished full checks, skipping partial, stopped and failed ones', () => {
    const pairs = checkPairs(
      history([
        check({ runId: 'r5', startedAt: '2026-10-19T00:00:00Z', score: 60, cited: 2 }),
        check({ runId: 'r4', startedAt: '2026-10-15T00:00:00Z', status: 'cancelled', score: 0 }),
        check({ runId: 'r3', startedAt: '2026-10-12T00:00:00Z', partial: true, score: 99 }),
        check({ runId: 'r2', startedAt: '2026-10-08T00:00:00Z', status: 'error', score: 1 }),
        check({ runId: 'r1', startedAt: '2026-10-05T00:00:00Z', score: 40, cited: 1 }),
        check({ runId: 't-1', pageId: TOPIC.id, startedAt: '2026-10-06T00:00:00Z' })
      ]),
      ALL
    )
    expect(pairs.map((pair) => [pair.latest.runId, pair.previous?.runId ?? null])).toEqual([
      ['r5', 'r1'],
      ['t-1', null]
    ])
    expect(pairs[0]).toMatchObject({ scoreChange: 20, direction: 'better' })
    expect(pairs[1]).toMatchObject({ scoreChange: null, direction: null })
  })

  test('a lower score is worse; with no score the page-cited count decides', () => {
    const worse = checkPairs(
      history([
        check({ runId: 'b', startedAt: '2026-10-19T00:00:00Z', score: 30 }),
        check({ runId: 'a', startedAt: '2026-10-05T00:00:00Z', score: 40 })
      ]),
      ALL
    )
    expect(worse[0]).toMatchObject({ scoreChange: -10, direction: 'worse' })
    const unscored = checkPairs(
      history([
        check({ runId: 'b', startedAt: '2026-10-19T00:00:00Z', score: null, cited: 0 }),
        check({ runId: 'a', startedAt: '2026-10-05T00:00:00Z', score: null, cited: 0 })
      ]),
      ALL
    )
    expect(unscored[0]).toMatchObject({ scoreChange: null, direction: 'same' })
  })

  test('the facts carry the counts, both dates and both checks’ numbers, in the view only', () => {
    const data = history([
      check({ runId: 'b', startedAt: '2026-10-19T12:00:00Z', score: 78, cited: 2 }),
      check({ runId: 'a', startedAt: '2026-10-05T12:00:00Z', score: 44, cited: 1 }),
      check({ runId: 't', pageId: TOPIC.id, startedAt: '2026-10-06T00:00:00Z', score: 12 })
    ])
    const { facts } = whatChangedFacts(data, ALL)
    expect(facts).toContain('View: All pages and topics · All markets')
    expect(facts).toContain('Compared: 1 ')
    expect(facts).toContain('Better: 1 · Worse: 0 · Same: 0 · One check only: 1')
    expect(facts).toContain(
      '- "Alerts" (page, https://x.com/a) · US · en · desktop: Oct 5, 2026 → Oct 19, 2026, better. Score 44 → 78 (change +34). AI Overviews 3 of 3 → 3 of 3 questions. Page cited 1 → 2. Brand named 0 → 0.'
    )
    expect(facts).toContain('One check only (nothing to compare yet):\n- "Texting" (topic) · US')

    const topics = whatChangedFacts(data, { ...ALL, scope: 'topics' }).facts
    expect(topics).toContain('View: All topics')
    expect(topics).not.toContain('"Alerts"')
    expect(whatChangedFacts(data, { ...ALL, pageId: PAGE.id }).facts).toContain('View: Alerts · ')
    expect(() => whatChangedFacts(data, { ...ALL, pageId: 'gone' })).toThrow(
      'That page or topic has no checks yet.'
    )
    expect(() => whatChangedFacts(data, { ...ALL, marketId: 'mars' })).toThrow(
      'That market was not found.'
    )
    expect(() => whatChangedFacts(history([]), ALL)).toThrow(
      'There is no finished full check in this view yet.'
    )
  })

  test(`lists at most ${WHAT_CHANGED_MAX_PAIRS} pairs and counts the rest`, () => {
    const subjects = Array.from({ length: 20 }, (_, index) => ({
      ...PAGE,
      id: `p${index}`,
      label: `Page ${index}`
    }))
    const checks = subjects.flatMap((subject, index) => [
      check({
        runId: `${subject.id}-b`,
        pageId: subject.id,
        startedAt: `2026-10-19T00:${String(index).padStart(2, '0')}:00Z`
      }),
      check({ runId: `${subject.id}-a`, pageId: subject.id, startedAt: '2026-10-05T00:00:00Z' })
    ])
    const { facts } = whatChangedFacts(history(checks, subjects), ALL)
    expect(facts.split('\n').filter((line) => line.startsWith('- "Page'))).toHaveLength(
      WHAT_CHANGED_MAX_PAIRS
    )
    expect(facts).toContain(`- ${20 - WHAT_CHANGED_MAX_PAIRS} more not listed`)
  })
})

describe('What changed on saved checks (recorded replies, no live Claude)', () => {
  let seed: AssistSeed

  beforeAll(async () => {
    seed = await seedAssistProject()
  })

  afterAll(() => {
    seed.close()
  })

  test('one call, a single-purpose prompt with the saved numbers, and the answer as given', async () => {
    const before = seed.claude.requests.length
    const answer = {
      summary: 'Of the 2 compared, 0 got better, 0 got worse and 2 stayed the same.',
      items: [
        {
          text: 'Alerts in US stayed the same from Oct 5, 2026 to Oct 19, 2026: score 67, cited for 1 of 2 questions.',
          detail: null,
          tag: 'same',
          verify: null,
          sign: null
        }
      ],
      caution: null
    }
    seed.claude.queue.push(answer)
    const result = await runAssist(seed.host, request('history.whatChanged', { pageId: null }))
    const sent = seed.claude.requests.slice(before)
    expect(sent).toHaveLength(1)
    const prompt = sent[0]?.prompt ?? ''
    expect(prompt.startsWith('Assist: history.whatChanged\n')).toBe(true)
    expect(prompt).toContain(ASSIST_OUTPUT_RULES)
    expect(prompt).toContain('Say what changed between the last two full checks')
    expect(prompt).toContain('Better: 0 · Worse: 0 · Same: 2 · One check only: 0')
    expect(prompt).toContain('Score 67 → 67 (change 0)')
    expect(prompt).toContain('UK · en · London · desktop')
    expect(sent[0]?.trace).toMatchObject({ source: 'assist', assistId: 'history.whatChanged' })
    expect(result.title).toBe('What changed')
    expect(result.summary).toBe(answer.summary)
    expect(result.items.map((item) => item.text)).toEqual([answer.items[0]?.text])
    expect(result.caution).toBeNull()
    expect(result.savedDataOnly).toBe(true)
    expect(result.searchesUsed).toBe(0)
  })

  test('an invented number is asked again with the number named, and the fixed answer is kept', async () => {
    const before = seed.claude.requests.length
    const item = (text: string): Record<string, unknown> => ({
      text,
      detail: null,
      tag: 'same',
      verify: null,
      sign: null
    })
    seed.claude.queue.push(
      { summary: 'Scores held at 67 across 7 markets.', items: [], caution: null },
      {
        summary: 'Both pairs stayed the same.',
        items: [item('US held a score of 67.')],
        caution: null
      }
    )
    const result = await runAssist(seed.host, request('history.whatChanged', { pageId: null }))
    const sent = seed.claude.requests.slice(before)
    expect(sent).toHaveLength(2)
    expect(sent[1]?.prompt).toContain(
      'The previous reply was rejected: These numbers are not in the saved checks: 7.'
    )
    expect(result.summary).toBe('Both pairs stayed the same.')
    expect(result.caution).toBeNull()
  })

  test('the recorded reply’s numbers are not in this project: asked again, then taken out and flagged', async () => {
    // The recorded reply was written for the Progress seed (44 → 78); this seed scored 67 and 17.
    const before = seed.claude.requests.length
    const result = await runAssist(seed.host, request('history.whatChanged', { pageId: null }))
    expect(seed.claude.requests.slice(before)).toHaveLength(2)
    const fixture = readFixture('history.whatChanged') as { summary: string }
    expect(result.summary).toBe(fixture.summary)
    expect(result.items).toEqual([])
    expect(result.caution).toBe(
      'Took out sentences with numbers that are not in your saved checks (44, 78, 34, 11). Check the grid for those.'
    )
  })

  test('a numbered instruction may be quoted back; a market or page outside the project is refused', async () => {
    seed.claude.queue.push({
      summary: 'In 3 words: nothing changed.',
      items: [],
      caution: null
    })
    const result = await runAssist(
      seed.host,
      request('history.whatChanged', {
        pageId: null,
        marketId: SEED.uk,
        instruction: 'Say it in 3 words.'
      })
    )
    expect(result.summary).toBe('In 3 words: nothing changed.')
    expect(seed.claude.requests.at(-1)?.prompt).toContain('View: All pages and topics · UK')
    await expect(
      runAssist(seed.host, request('history.whatChanged', { pageId: 'page-9' }))
    ).rejects.toThrow('That page or topic has no checks yet.')
    await expect(
      runAssist(seed.host, request('history.whatChanged', { pageId: null, marketId: 'mkt-xx' }))
    ).rejects.toThrow('That market was not found.')
  })

  test('with one full check only, the answer comes from saved data with no Claude call', async () => {
    const list = await seed.handlers['history:listProject']({ projectId: SEED.projectId })
    const latestUk = list.checks.find((item) => item.marketId === SEED.uk)
    if (!latestUk) throw new Error('seed has a UK check')
    await seed.handlers['history:delete']({ projectId: SEED.projectId, runId: latestUk.runId })
    const before = seed.claude.requests.length
    const result = await runAssist(
      seed.host,
      request('history.whatChanged', { pageId: null, marketId: SEED.uk })
    )
    expect(seed.claude.requests.length).toBe(before)
    expect(result.summary).toBe(
      'This page or topic has one full check so far, so there is nothing to compare yet.'
    )
    expect(result.model).toBeNull()
  })
})
