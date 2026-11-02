import type {
  AioReference,
  FunnelStep,
  IntentStage,
  PromptCheckRow,
  PromptSource
} from '@shared/domain'
import { describe, expect, test } from 'vitest'
import {
  buildFunnel,
  buildLeaderboard,
  buildPageResults,
  buildPromptRows,
  consistencyIssues,
  metricsFor,
  movementFor,
  rollupSamples,
  type ScorePrompt,
  type ScoreSample
} from './score'

function reference(
  position: number,
  domain: string,
  classification: AioReference['classification']
): AioReference {
  return {
    id: `ref-${position}-${domain}`,
    position,
    url: `https://${domain}/post`,
    normalizedUrl: `https://${domain}/post`,
    domain,
    title: null,
    classification,
    untracked: false,
    sourceType: domain.includes('reddit') ? 'reddit' : 'web'
  }
}

function sample(
  partial: Partial<ScoreSample> & Pick<ScoreSample, 'sampleNo' | 'status'>
): ScoreSample {
  return {
    named: partial.status === 'no_aio' || partial.status === 'error' ? null : false,
    citedUrl: null,
    position: null,
    aioText: null,
    references: [],
    ...partial
  }
}

function prompt(
  id: string,
  position: number,
  samples: ScoreSample[],
  stage: IntentStage = 'problem'
): ScorePrompt {
  return {
    promptId: id,
    promptPosition: position,
    label: id,
    text: id,
    source: 'title_meta_h1' satisfies PromptSource,
    intentStage: stage,
    samples,
    coverage: null,
    action: position === 2 ? 'Add the missing step' : null,
    mainGap: position === 2 ? 'The page skips the step.' : null,
    checkedAt: '2026-10-19T12:00:00.000Z'
  }
}

describe('section 7 scoring', () => {
  test('breaks ties toward higher points, then the earlier sample, and drops errors', () => {
    expect(
      rollupSamples([
        sample({ sampleNo: 1, status: 'not_cited' }),
        sample({
          sampleNo: 2,
          status: 'page_cited',
          position: 2,
          citedUrl: 'https://textbolt.com/a'
        })
      ]).status
    ).toBe('page_cited')
    expect(
      rollupSamples([
        sample({ sampleNo: 1, status: 'brand_mentioned', named: true }),
        sample({
          sampleNo: 2,
          status: 'other_own_page',
          position: 1,
          citedUrl: 'https://textbolt.com/b'
        })
      ]).status
    ).toBe('brand_mentioned')
    expect(
      rollupSamples([
        sample({ sampleNo: 1, status: 'error' }),
        sample({ sampleNo: 2, status: 'error' }),
        sample({ sampleNo: 3, status: 'not_cited' })
      ]).status
    ).toBe('not_cited')
  })

  test('scores a page, moves it against the previous check, and stays consistent', () => {
    expect(movementFor(null, { status: 'page_cited', position: 1 })).toBeNull()
    expect(
      movementFor({ status: 'not_cited', position: null }, { status: 'page_cited', position: 2 })
    ).toBe('gained')
    expect(
      movementFor({ status: 'page_cited', position: 1 }, { status: 'not_cited', position: null })
    ).toBe('lost')
    expect(
      movementFor(
        { status: 'brand_mentioned', position: null },
        { status: 'other_own_page', position: 1 }
      )
    ).toBe('unchanged')
    expect(
      movementFor({ status: 'page_cited', position: 4 }, { status: 'page_cited', position: 2 })
    ).toBe('improved')

    const cited = sample({
      sampleNo: 1,
      status: 'page_cited',
      named: true,
      position: 1,
      citedUrl: 'https://textbolt.com/a',
      aioText: 'TextBolt is cited.',
      references: [reference(1, 'textbolt.com', 'target'), reference(2, 'reddit.com', 'other')]
    })
    const results = buildPageResults({
      scope: {
        promptCount: 3,
        marketCount: 1,
        brands: ['TextBolt'],
        pageUrl: 'https://textbolt.com/a',
        pageTitle: 'Alerts',
        checkedAt: '2026-10-19T12:00:00.000Z',
        builtAt: '2026-10-19T12:00:00.000Z',
        promptSetVersion: 1,
        promptSetSavedAt: '2026-10-19T11:00:00.000Z',
        stale: false,
        nextFixNumber: 1
      },
      identity: {
        runId: 'run-1',
        pageId: 'page-1',
        marketId: 'mkt-us',
        promptSetId: 'pset-1',
        promptSetVersion: 1,
        snapshotId: 'snap-1',
        contentHash: 'a'.repeat(64),
        kind: 'baseline',
        partial: false,
        status: 'finished',
        startedAt: '2026-10-19T12:00:00.000Z',
        finishedAt: '2026-10-19T12:00:01.000Z'
      },
      prompts: [
        prompt('p1', 1, [cited]),
        prompt('p2', 2, [sample({ sampleNo: 1, status: 'not_cited', aioText: 'Nothing.' })]),
        prompt('p3', 3, [sample({ sampleNo: 1, status: 'no_aio' })], 'solution')
      ],
      previousRows: new Map(),
      contentChanged: false,
      contentChange: null,
      baseline: null,
      previous: null,
      ownDomain: 'textbolt.com',
      includeSubdomains: false,
      gapReasons: new Map([['p2', 'The page skips the step.']]),
      trackedPages: new Map()
    })
    expect(results.run?.visibilityScore).toBe(50)
    expect(results.run?.promptsWithAio).toBe(2)
    expect(results.funnel.map((step) => step.count)).toEqual([3, 2, 1, 1, 1])
    expect(results.buckets.map((bucket) => bucket.count)).toEqual([1, 0, 0, 1])
    expect(results.topActions).toHaveLength(1)
    expect(results.topActions[0]?.linkLabel).toBe('Open the gap for prompt 2')
    expect(results.leaderboard[0]?.badge).toBe('you')
    expect(consistencyIssues(results)).toEqual([])
    expect(
      buildPageResults({
        scope: results.scope,
        identity: null,
        prompts: [],
        previousRows: new Map(),
        contentChanged: false,
        contentChange: null,
        baseline: null,
        previous: null,
        ownDomain: 'textbolt.com',
        includeSubdomains: false,
        gapReasons: new Map(),
        trackedPages: new Map()
      }).run
    ).toBeNull()
  })
})

function aioPrompt(id: string, position: number, references: AioReference[]): ScorePrompt {
  const own = references.find(
    (item) => item.classification === 'target' || item.classification === 'own'
  )
  return prompt(id, position, [
    sample({
      sampleNo: 1,
      status:
        own === undefined
          ? 'not_cited'
          : own.classification === 'target'
            ? 'page_cited'
            : 'other_own_page',
      references
    })
  ])
}

describe('funnel drops', () => {
  const row = (promptId: string, status: PromptCheckRow['status']): PromptCheckRow =>
    ({ promptId, status, named: status === 'page_cited' ? true : null }) as PromptCheckRow
  const aioDrop = (rows: PromptCheckRow[]): FunnelStep['drop'] | undefined =>
    buildFunnel(rows).find((step) => step.id === 'aio_shown')?.drop

  test('does not call a failed search "No AI Overview"', () => {
    // A live AU check: prompts 3 and 8 timed out, the other eight showed an overview.
    expect(aioDrop([row('p1', 'not_cited'), row('p3', 'error'), row('p8', 'error')])).toEqual({
      count: 2,
      reason: 'The search failed, so the AI Overview is unknown',
      promptIds: ['p3', 'p8']
    })
    expect(aioDrop([row('p1', 'no_aio'), row('p2', 'error'), row('p3', 'page_cited')])).toEqual({
      count: 2,
      reason: 'No AI Overview (1) or the search failed (1)',
      promptIds: ['p1', 'p2']
    })
    expect(aioDrop([row('p1', 'no_aio'), row('p2', 'not_cited')])).toEqual({
      count: 1,
      reason: 'No AI Overview',
      promptIds: ['p1']
    })
  })
})

describe('competitor leaderboard (section 7.2)', () => {
  test('an own subdomain joins the you row when subdomains count', () => {
    const built = buildPromptRows(
      [
        aioPrompt('p1', 1, [
          reference(1, 'help.textbolt.com', 'own'),
          reference(2, 'simpletexting.com', 'competitor')
        ]),
        aioPrompt('p2', 2, [reference(1, 'twilio.com', 'competitor')])
      ],
      new Map()
    )
    const rows = buildLeaderboard(built, 'www.textbolt.com', true)
    expect(rows.map((row) => [row.domain, row.badge])).toEqual([
      ['textbolt.com', 'you'],
      ['simpletexting.com', 'tracked'],
      ['twilio.com', 'tracked']
    ])
    expect(rows[0]?.promptIds).toEqual(['p1'])
    expect(rows.find((row) => row.domain === 'simpletexting.com')).toMatchObject({
      overlap: 1,
      gap: 0
    })
    expect(rows.find((row) => row.domain === 'twilio.com')).toMatchObject({ overlap: 0, gap: 1 })
  })

  test('an own subdomain the project does not count stays observed', () => {
    const built = buildPromptRows(
      [aioPrompt('p1', 1, [reference(1, 'help.textbolt.com', 'other')])],
      new Map()
    )
    const rows = buildLeaderboard(built, 'textbolt.com', false)
    expect(rows.map((row) => [row.domain, row.badge])).toEqual([
      ['textbolt.com', 'you'],
      ['help.textbolt.com', 'observed']
    ])
  })

  test('the badge follows the class the run stored, not a list read later (P9)', () => {
    // Stored when the page's product listed twilio.com and not clicksend.com: a later
    // edit to the list never changes what an old run shows.
    const built = buildPromptRows(
      [
        aioPrompt('p1', 1, [
          reference(1, 'blog.twilio.com', 'competitor'),
          reference(2, 'clicksend.com', 'other')
        ])
      ],
      new Map()
    )
    const rows = buildLeaderboard(built, 'textbolt.com', false)
    expect(rows.map((row) => [row.domain, row.badge])).toEqual([
      ['textbolt.com', 'you'],
      ['blog.twilio.com', 'tracked'],
      ['clicksend.com', 'observed']
    ])
  })

  test('the target and another own page on the same prompt count the you row once', () => {
    const built = buildPromptRows(
      [
        aioPrompt('p1', 1, [
          reference(1, 'textbolt.com', 'target'),
          reference(2, 'docs.textbolt.com', 'own')
        ])
      ],
      new Map()
    )
    const rows = buildLeaderboard(built, 'textbolt.com', true)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ badge: 'you', aioCount: 1, averagePosition: 1 })
  })
})

describe('citation counts (FR-6.7)', () => {
  test('links to this page and other own pages are counted separately', () => {
    const built = buildPromptRows(
      [
        aioPrompt('p1', 1, [
          reference(1, 'textbolt.com', 'target'),
          reference(2, 'docs.textbolt.com', 'own'),
          reference(3, 'twilio.com', 'competitor')
        ]),
        aioPrompt('p2', 2, [reference(1, 'help.textbolt.com', 'own')]),
        prompt('p3', 3, [sample({ sampleNo: 1, status: 'error' })])
      ],
      new Map()
    )
    const metrics = metricsFor(
      {
        runId: 'run-1',
        pageId: 'page-1',
        marketId: 'mkt-us',
        promptSetId: 'pset-1',
        promptSetVersion: 1,
        snapshotId: 'snap-1',
        contentHash: 'a'.repeat(64),
        kind: 'manual',
        partial: false,
        status: 'finished',
        startedAt: '2026-10-19T12:00:00.000Z',
        finishedAt: '2026-10-19T12:00:01.000Z'
      },
      built,
      false,
      null
    )
    expect(metrics).toMatchObject({
      promptsWithAio: 2,
      pageCited: 1,
      otherOwnPage: 1,
      errors: 1,
      points: 4,
      pointsPossible: 6,
      visibilityScore: 67,
      citationsThisPage: 1,
      citationsOtherOwn: 2
    })
  })
})
