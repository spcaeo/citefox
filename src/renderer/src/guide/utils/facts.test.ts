import { describe, expect, test } from 'vitest'
import type { TopicSummary } from '@shared/domain'
import { TEXTBOLT_TOPIC_ID, textboltTopicResults } from '@shared/fixtures/textbolt-topic'
import { rollupPageFixes } from '@shared/page-fixes'
import { projectSearches } from '../../fixes/searchFixtures'
import { factsFrom, fixFacts, focusTopic } from './facts'

const results = textboltTopicResults()

function topic(id: string, checkedAt: string | null): TopicSummary {
  return {
    id,
    projectId: 'p1',
    name: id,
    source: 'seed',
    status: 'tracked',
    questions: 3,
    keywords: 0,
    questionsGoal: null,
    targetPct: null,
    keywordsGoal: null,
    bands: results.topic.bands,
    intervalDays: 14,
    checkedAt,
    pendingBatches: 0
  } as TopicSummary
}

describe('guide facts', () => {
  test('reads the topic results: a question to open, own-site citations, a missing page', () => {
    const facts = factsFrom({ journey: null, topics: [], results, competitors: [] })
    expect(facts.hasResults).toBe(true)
    expect(facts.topic).toEqual({
      id: TEXTBOLT_TOPIC_ID,
      name: results.topic.name,
      marketId: 'mkt-us',
      targetPage: null
    })
    // Likeliest win first among questions with an AI Overview that are not won yet.
    expect(facts.prompt).toEqual({ id: 'prompt-tq-06', label: 'Q6' })
    expect(facts.citesOwn).toBe(11)
    expect(facts.noPage).toEqual({ id: 'prompt-tq-23', label: 'Q23' })
  })

  test('the rival is the site cited most that is not a saved competitor or a known platform', () => {
    const first = factsFrom({ journey: null, topics: [], results, competitors: [] })
    expect(first.rival).toEqual({
      domain: 'simpletexting.com',
      answers: 8,
      promptId: 'prompt-tq-02'
    })
    const saved = factsFrom({
      journey: null,
      topics: [],
      results,
      competitors: [
        { domain: 'simpletexting.com', aliases: [] },
        { domain: null, aliases: ['www.twilio.com'] }
      ]
    })
    expect(saved.rival?.domain).toBe('pagerduty.com')
    // Reddit, G2 and Capterra are platforms, never offered as competitors.
    expect(['reddit.com', 'g2.com', 'capterra.com']).not.toContain(saved.rival?.domain)
  })

  test('no topic results: only whether any check finished', () => {
    expect(
      factsFrom({ journey: { hasResults: true }, topics: [], results: null, competitors: [] })
    ).toMatchObject({ hasResults: true, topic: null, prompt: null, rival: null })
    expect(
      factsFrom({ journey: null, topics: [topic('t1', null)], results: null, competitors: [] })
        .hasResults
    ).toBe(false)
  })

  test('the focus topic is the first-run topic when checked, else the first checked one', () => {
    const topics = [
      topic('a', null),
      topic('b', '2026-10-19T00:00:00.000Z'),
      topic('c', '2026-10-20T00:00:00.000Z')
    ]
    expect(focusTopic(topics, 'c')?.id).toBe('c')
    expect(focusTopic(topics, 'a')?.id).toBe('b')
    expect(focusTopic([topic('a', null)], 'a')?.id).toBe('a')
    expect(focusTopic([], null)).toBeNull()
  })

  test('page fixes: one of each kind, most searches first; the newest logged fix', () => {
    const searches = projectSearches()
    const rollup = rollupPageFixes(searches.searches, null)
    const improve = rollup.fixes
      .filter((fix) => fix.kind === 'improve')
      .sort((a, b) => b.searches.length - a.searches.length)[0]
    const fixes = [
      { fix: { id: 'old', goLiveAt: '2026-09-01T00:00:00.000Z' } },
      { fix: { id: 'new', goLiveAt: '2026-10-20T00:00:00.000Z' } }
    ] as unknown as Parameters<typeof fixFacts>[1]
    const found = fixFacts(searches, fixes)
    expect(found.pageFix.improve).toBe(improve?.id ?? null)
    expect(found.loggedFix).toBe('new')
    expect(fixFacts(null, [])).toEqual({
      pageFix: { improve: null, owner: null, create: null },
      loggedFix: null
    })
    // factsFrom carries them even before a topic has results.
    const facts = factsFrom({
      journey: null,
      topics: [],
      results: null,
      competitors: [],
      searches,
      fixes
    })
    expect(facts.loggedFix).toBe('new')
  })
})
