import type { PromptCheckStatus } from '@shared/domain'
import type { CheckProgress, SiteStartPlan } from '@shared/ipc'
import { afterEach, describe, expect, test } from 'vitest'
import { contentHash } from '../../pipeline/hash'
import {
  finishStoredRun,
  insertStoredCheckJob,
  insertStoredRun,
  insertStoredSerpResult,
  type NewAioReference
} from '../../storage/check-records'
import { insertBuyerProfile, insertSnapshot } from '../../storage/content-records'
import { createFixFollowUp } from '../../storage/fix-follow-ups'
import { addPageMarket, insertPage } from '../../storage/pages'
import { insertPromptSet } from '../../storage/prompt-set-records'
import { saveStartPlan } from '../../start/store'
import { insertTopicPrompts } from '../../topics/records'
import {
  buyerPrompt,
  closeSeeds,
  NOW,
  page,
  profile,
  seed,
  snapshot
} from '../checks/checks.test-helper'

type Seeded = Awaited<ReturnType<typeof seed>>
type Db = Seeded['projectDb']

const PAGE_URL = page().url ?? ''
const TOPIC = 'topic-1'

afterEach(() => {
  closeSeeds()
})

/** A project with page-1 (prompt-1 enabled) and no checks. Nothing is searched. */
function project(): Promise<Seeded> {
  return seed({
    progress: [] as CheckProgress[],
    http() {
      throw new Error('The Overview must not search')
    }
  })
}

function ref(
  id: string,
  position: number,
  url: string,
  classification: NewAioReference['classification']
): NewAioReference {
  const parsed = new URL(url)
  return {
    id,
    position,
    url,
    normalizedUrl: url,
    domain: parsed.hostname,
    title: null,
    classification,
    untracked: false,
    sourceType: 'web'
  }
}

interface PlantedResult {
  promptId: string
  status: PromptCheckStatus
  named?: boolean | null
  refs?: readonly NewAioReference[]
}

/** One finished run with one sample per prompt. */
function plantRun(
  db: Db,
  input: {
    id: string
    jobId?: string
    pageId: string
    promptSetId: string
    snapshotId: string
    finishedAt: string
    partial?: boolean
    results: readonly PlantedResult[]
  }
): void {
  const jobId = input.jobId ?? `job-${input.id}`
  try {
    insertStoredCheckJob(db, {
      id: jobId,
      startedAt: input.finishedAt,
      status: 'running',
      pageIds: [input.pageId],
      marketIds: ['mkt-us'],
      promptIds: null,
      reason: 'manual',
      message: null,
      nextStep: null
    })
  } catch {
    // A second run of the same job.
  }
  insertStoredRun(db, {
    id: input.id,
    jobId,
    pageId: input.pageId,
    promptSetId: input.promptSetId,
    snapshotId: input.snapshotId,
    marketId: 'mkt-us',
    startedAt: input.finishedAt,
    kind: 'manual',
    partial: input.partial ?? false,
    samples: 1,
    contentHash: snapshot().contentHash
  })
  finishStoredRun(db, input.id, input.finishedAt, 'finished')
  for (const result of input.results) {
    const refs = result.refs ?? []
    const own = refs.find(
      (item) => item.classification === 'target' || item.classification === 'own'
    )
    insertStoredSerpResult(db, {
      id: `serp-${input.id}-${result.promptId}`,
      runId: input.id,
      promptId: result.promptId,
      sampleNo: 1,
      keyId: null,
      hasAio: result.status !== 'no_aio',
      neededFollowup: false,
      searches: 1,
      status: result.status,
      named: result.status === 'no_aio' ? null : (result.named ?? false),
      citedUrl: own?.url ?? null,
      position: own?.position ?? null,
      aioText: result.status === 'no_aio' ? null : 'An overview.',
      errorCode: null,
      message: null,
      nextStep: null,
      rawSearchJson: '{}',
      rawAioJson: null,
      references: refs
    })
  }
}

/** page-1 not cited before the 30-day period, then cited (and named) inside it. */
function plantPageRuns(db: Db): void {
  plantRun(db, {
    id: 'run-old',
    pageId: 'page-1',
    promptSetId: 'pset-1',
    snapshotId: 'snap-1',
    finishedAt: '2026-09-10T09:00:00.000Z',
    results: [
      {
        promptId: 'prompt-1',
        status: 'not_cited',
        refs: [ref('r-old-1', 1, 'https://www.simpletexting.com/alerts/', 'competitor')]
      }
    ]
  })
  plantRun(db, {
    id: 'run-new',
    pageId: 'page-1',
    promptSetId: 'pset-1',
    snapshotId: 'snap-1',
    finishedAt: '2026-10-15T09:00:00.000Z',
    results: [
      {
        promptId: 'prompt-1',
        status: 'page_cited',
        named: true,
        refs: [
          ref('r-new-1', 1, 'https://www.simpletexting.com/alerts/', 'competitor'),
          ref('r-new-2', 2, PAGE_URL, 'target'),
          ref('r-new-3', 3, 'https://www.reddit.com/r/smallbusiness/', 'other')
        ]
      }
    ]
  })
}

/** A topic (`kind = 'topic'`, no URL) with two questions under stable keys. */
function addTopic(db: Db, firstQuestion = 'what replaced the carrier email gateway'): void {
  insertPage(db, {
    ...page(),
    id: TOPIC,
    kind: 'topic',
    url: null,
    title: 'Texting after the gateway shutdown',
    label: null
  })
  addPageMarket(db, { pageId: TOPIC, marketId: 'mkt-us', addedAt: NOW, baselineRunId: null })
  insertSnapshot(db, { ...snapshot(), id: 'snap-t', pageId: TOPIC })
  insertBuyerProfile(db, { ...profile(), id: 'icp-t', pageId: TOPIC, snapshotId: 'snap-t' })
  insertPromptSet(
    db,
    {
      id: 'pset-t1',
      pageId: TOPIC,
      version: 1,
      savedAt: NOW,
      icpId: 'icp-t',
      templateId: 'tpl-buyer-prompts',
      templateName: 'CiteFox default',
      templateHash: contentHash('template'),
      templateUpdatedAt: null,
      prompts: [
        buyerPrompt('tq-1', firstQuestion, true),
        { ...buyerPrompt('tq-2', 'send texts from email', true), position: 2 }
      ]
    },
    ['TextBolt']
  )
  insertTopicPrompts(
    db,
    ['tq-1', 'tq-2'].map((promptId, index) => ({
      promptId,
      pageId: TOPIC,
      stableKey: `k${index + 1}`,
      // tq-2 is a short keyword search: tracked, but not a buyer question.
      kind: index === 1 ? ('keyword' as const) : ('question' as const),
      stage: null,
      source: 'claude' as const,
      sourceNote: null,
      kwGroup: null,
      kwGroupKind: null,
      intent: null,
      funnel: null,
      pageType: null,
      targetPageId: null,
      targetUrl: null,
      matchConfidence: null,
      matchReason: null,
      matchSetBy: null,
      matchConfirmed: false
    }))
  )
  // A batch before the period: no overview for tq-1.
  plantRun(db, {
    id: 'run-t1',
    pageId: TOPIC,
    promptSetId: 'pset-t1',
    snapshotId: 'snap-t',
    finishedAt: '2026-09-01T09:00:00.000Z',
    partial: true,
    results: [{ promptId: 'tq-1', status: 'no_aio' }]
  })
  // A batch inside it: tq-1 now has an overview (Twilio cited), tq-2 cites another own page.
  plantRun(db, {
    id: 'run-t2',
    pageId: TOPIC,
    promptSetId: 'pset-t1',
    snapshotId: 'snap-t',
    finishedAt: '2026-10-16T09:00:00.000Z',
    partial: true,
    results: [
      {
        promptId: 'tq-1',
        status: 'not_cited',
        refs: [ref('r-t2-1', 1, 'https://www.twilio.com/docs/sms', 'competitor')]
      },
      {
        promptId: 'tq-2',
        status: 'other_own_page',
        refs: [
          ref('r-t2-2', 1, 'https://textbolt.com/pricing/', 'own'),
          ref('r-t2-3', 2, 'https://www.twilio.com/docs/sms', 'competitor')
        ]
      }
    ]
  })
}

describe('visibility:overview', () => {
  test('a project with no checks: counts the questions and points to Check now', async () => {
    const { handlers } = await project()
    const overview = await handlers['visibility:overview']({ projectId: 'proj-1', period: '30d' })
    expect(overview.brand).toBe('TextBolt')
    expect(overview.hasChecks).toBe(false)
    expect(overview.lastCheckedAt).toBeNull()
    expect(overview.trackedPages).toBe(1)
    expect(overview.trackedTopics).toBe(0)
    // prompt-2 is disabled: one question, one search (two when the overview needs a second call).
    expect(overview.kpis.tracked).toEqual({ value: 1, before: null, delta: null })
    expect(overview.tracked).toMatchObject([
      { key: 'page-1|prompt-1', pageId: 'page-1', promptId: 'prompt-1', keyword: false }
    ])
    expect(overview.kpis.keywords).toBe(0)
    expect(overview.checkSearches).toEqual({ min: 1, max: 2 })
    expect(overview.kpis.withAio).toEqual({ value: 0, before: null, delta: null })
    expect(overview.kpis.cited).toEqual({ value: 0, before: null, delta: null })
    expect(overview.kpis.named).toEqual({ value: 0, before: null, delta: null })
    expect(overview.kpis.share).toEqual({
      value: null,
      before: null,
      delta: null,
      ownCitations: 0,
      allCitations: 0,
      questions: 0
    })
    expect(overview.weeks).toHaveLength(5)
    expect(overview.weeks.every((week) => week.cited === null)).toBe(true)
    expect(overview.questions).toEqual([])
    expect(overview.diff).toBeNull()
    expect(overview.compare).toMatchObject({
      vs: null,
      mode: 'previous',
      available: false,
      options: []
    })
    expect(overview.method).toEqual({
      marketIds: [],
      firstCheckAt: null,
      lastCheckAt: null,
      agreement: null
    })
    expect(overview.markets.map((market) => market.id)).toEqual(['mkt-us'])
    expect(overview.citedSites).toEqual([
      {
        name: 'TextBolt',
        domain: 'textbolt.com',
        count: 0,
        own: true,
        competitor: false,
        before: null,
        keys: []
      }
    ])
    expect(overview.shareLinks).toEqual([])
    expect(overview.fixes).toEqual([])
    expect(overview.openFixes).toBe(0)
    expect(overview.firstReport).toBeNull()
  })

  test('two checks where a citation is gained: earlier values, the weekly series and the change', async () => {
    const { handlers, projectDb } = await project()
    plantPageRuns(projectDb)
    const overview = await handlers['visibility:overview']({ projectId: 'proj-1', period: '30d' })
    expect(overview.hasChecks).toBe(true)
    expect(overview.lastCheckedAt).toBe('2026-10-15T09:00:00.000Z')
    expect(overview.kpis.withAio).toEqual({ value: 1, before: 1, delta: 0 })
    expect(overview.kpis.cited).toEqual({ value: 1, before: 0, delta: 1 })
    expect(overview.kpis.named).toEqual({ value: 1, before: 0, delta: 1 })
    // 1 own link of 3 now; 0 of 1 at the previous check.
    expect(overview.kpis.share).toEqual({
      value: 33,
      before: 0,
      delta: 33,
      ownCitations: 1,
      allCitations: 3,
      questions: 1
    })
    // One scope with Competitors: the same share for the same market.
    const competitors = await handlers['competitors:overview']({
      projectId: 'proj-1',
      period: 30
    })
    const you = competitors.rows.find((row) => row.kind === 'you')
    expect(you?.citations).toBe(overview.kpis.share.ownCitations)
    expect(competitors.citations).toBe(overview.kpis.share.allCitations)
    expect(competitors.questions).toBe(overview.kpis.share.questions)
    // Same definition as the page's Results.
    const results = await handlers['results:get']({
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: null,
      runId: null
    })
    expect(overview.kpis.cited.value).toBe(
      (results.run?.pageCited ?? 0) + (results.run?.otherOwnPage ?? 0)
    )
    expect(overview.kpis.withAio.value).toBe(results.run?.promptsWithAio)
    expect(overview.weeks.map((week) => week.cited)).toEqual([0, 0, 0, 0, 1])
    expect(overview.weeks.map((week) => week.withAio)).toEqual([1, 1, 1, 1, 1])
    // Each week lists the searches behind its numbers, so a point opens exactly them.
    for (const week of overview.weeks) {
      expect(week.searches).toHaveLength(week.withAio ?? 0)
      expect(week.searches?.filter((item) => item.cited)).toHaveLength(week.cited ?? 0)
    }
    expect(overview.weeks.at(-1)?.searches?.[0]).toMatchObject({
      key: 'page-1|prompt-1',
      pageId: 'page-1',
      cited: true
    })
    expect(overview.questions).toEqual([
      {
        key: 'page-1|prompt-1',
        pageId: 'page-1',
        promptId: 'prompt-1',
        marketId: 'mkt-us',
        runId: 'run-new',
        text: 'How do I alert the crew?',
        source: {
          kind: 'page',
          url: PAGE_URL,
          path: '/blog/how-to-set-up-text-alerts-for-business/'
        },
        you: 'cited',
        // The cited link is the page's own URL: its target page.
        ownPage: 'target',
        position: 2,
        citedUrl: PAGE_URL,
        citedInstead: ['SimpleTexting', 'reddit.com'],
        change: 'gained',
        before: {
          you: 'not_cited',
          ownPage: null,
          position: null,
          checkedAt: '2026-09-10T09:00:00.000Z'
        },
        checkedAt: '2026-10-15T09:00:00.000Z'
      }
    ])
    expect(overview.diff).toEqual({ gained: 1, kept: 0, lost: 0, never: 0, unmatched: 0 })
    expect(overview.compare).toEqual({
      vs: null,
      mode: 'previous',
      at: null,
      unknown: false,
      available: true,
      options: [{ value: 'run-old', at: '2026-09-10T09:00:00.000Z' }]
    })
    expect(
      overview.citedSites.map((site) => [site.name, site.count, site.own, site.before])
    ).toEqual([
      ['TextBolt', 1, true, 0],
      ['SimpleTexting', 1, false, 1],
      ['reddit.com', 1, false, 0]
    ])
    expect(overview.citedSites[1]?.competitor).toBe(true)
    // Each site's count is the length of its question keys, so the count drills.
    for (const site of overview.citedSites) expect(site.keys).toHaveLength(site.count)
    expect(overview.citedSites[0]?.keys).toEqual(['page-1|prompt-1'])
    // The share's links: one row per link, own first, so the drill equals "N of M links".
    expect(overview.shareLinks).toHaveLength(overview.kpis.share.allCitations)
    expect(overview.shareLinks.filter((link) => link.own)).toHaveLength(
      overview.kpis.share.ownCitations
    )
    expect(overview.shareLinks[0]?.own).toBe(true)
    expect(overview.shareLinks.every((link) => link.host.length > 0)).toBe(true)
    // Every link has its own id: the drawer keys its rows by it.
    expect(new Set(overview.shareLinks.map((link) => link.id)).size).toBe(
      overview.shareLinks.length
    )
    // The verdict's sets: each number is the length of its list of question keys.
    expect(overview.verdictSets.gained).toEqual(['page-1|prompt-1'])
    expect(overview.verdictSets.cited_before).toEqual([])
    expect(overview.verdictSets.cited_after).toEqual(['page-1|prompt-1'])
    expect(overview.verdictSets.named_after).toEqual(['page-1|prompt-1'])
    expect(overview.verdictSets.not_visible).toEqual([])
    expect(overview.topSite).toEqual({ name: 'SimpleTexting', count: 1 })
    expect(overview.verdictSets.top_site).toEqual(['page-1|prompt-1'])
    expect(overview.method).toMatchObject({
      marketIds: ['mkt-us'],
      firstCheckAt: '2026-09-10T09:00:00.000Z',
      lastCheckAt: '2026-10-15T09:00:00.000Z',
      agreement: null
    })

    // The period sets the weekly chart only; the comparison is the same.
    const week = await handlers['visibility:overview']({ projectId: 'proj-1', period: '7d' })
    expect(week.kpis.cited).toEqual({ value: 1, before: 0, delta: 1 })
    expect(week.weeks.map((item) => item.cited)).toEqual([0, 1])
    const quarter = await handlers['visibility:overview']({ projectId: 'proj-1', period: '90d' })
    expect(quarter.weeks).toHaveLength(13)
    expect(quarter.weeks[0]?.cited).toBeNull()
  })

  test('compare with a chosen check, a day, or an unknown value', async () => {
    const { handlers, projectDb } = await project()
    plantPageRuns(projectDb)
    // Comparing with the latest check itself: nothing changed.
    const self = await handlers['visibility:overview']({
      projectId: 'proj-1',
      period: '30d',
      vs: 'run-new'
    })
    expect(self.compare).toMatchObject({ mode: 'run', at: '2026-10-15T09:00:00.000Z' })
    expect(self.diff).toEqual({ gained: 0, kept: 1, lost: 0, never: 0, unmatched: 0 })
    expect(self.kpis.cited).toEqual({ value: 1, before: 1, delta: 0 })
    // A day before any check: no earlier result, so no change and no earlier values.
    const early = await handlers['visibility:overview']({
      projectId: 'proj-1',
      period: '30d',
      vs: '2026-09-01'
    })
    expect(early.compare).toMatchObject({ mode: 'day', at: '2026-09-01T23:59:59.999Z' })
    expect(early.compare.available).toBe(false)
    expect(early.diff).toBeNull()
    expect(early.kpis.cited.before).toBeNull()
    expect(early.questions[0]?.change).toBeNull()
    // A day between the checks reads the older one.
    const between = await handlers['visibility:overview']({
      projectId: 'proj-1',
      period: '30d',
      vs: '2026-09-20'
    })
    expect(between.diff?.gained).toBe(1)
    // An unknown check falls back to the previous one, marked.
    const unknown = await handlers['visibility:overview']({
      projectId: 'proj-1',
      period: '30d',
      vs: 'run-gone'
    })
    expect(unknown.compare).toMatchObject({ vs: 'run-gone', mode: 'previous', unknown: true })
    expect(unknown.diff?.gained).toBe(1)
  })

  test('a partial page run never enters the comparison', async () => {
    const { handlers, projectDb } = await project()
    plantPageRuns(projectDb)
    plantRun(projectDb, {
      id: 'run-partial',
      pageId: 'page-1',
      promptSetId: 'pset-1',
      snapshotId: 'snap-1',
      finishedAt: '2026-10-18T09:00:00.000Z',
      partial: true,
      results: [{ promptId: 'prompt-1', status: 'not_cited' }]
    })
    const overview = await handlers['visibility:overview']({ projectId: 'proj-1', period: '30d' })
    expect(overview.questions[0]).toMatchObject({ runId: 'run-new', change: 'gained' })
    expect(overview.compare.options.map((option) => option.value)).toEqual(['run-old'])
  })

  test('topics count with pages; batches keep each question’s latest outcome', async () => {
    const { handlers, projectDb } = await project()
    plantPageRuns(projectDb)
    addTopic(projectDb)
    createFixFollowUp(projectDb, {
      id: 'fix-1',
      pageId: 'page-1',
      description: '## Add a **per-message** price table\n\nMore detail.',
      goLiveAt: '2026-10-18T00:00:00.000Z',
      rule: 'after_7_days',
      promptIds: ['prompt-1'],
      marketIds: ['mkt-us']
    })
    saveStartPlan(projectDb, {
      topicId: TOPIC,
      firstCheckAt: '2026-09-01T08:00:00.000Z',
      recommendedUrls: [PAGE_URL, 'https://textbolt.com/pricing/'],
      questions: [],
      builtAt: '2026-09-01T07:00:00.000Z'
    } as unknown as SiteStartPlan)

    const overview = await handlers['visibility:overview']({ projectId: 'proj-1', period: '30d' })
    expect(overview.trackedPages).toBe(1)
    expect(overview.trackedTopics).toBe(1)
    expect(overview.kpis.tracked.value).toBe(3)
    expect(overview.kpis.keywords).toBe(1)
    // Each headline number lists exactly the questions it counts (its drill).
    expect(overview.tracked).toHaveLength(overview.kpis.tracked.value)
    expect(overview.tracked.filter((item) => item.keyword)).toHaveLength(overview.kpis.keywords)
    expect(overview.tracked.map((item) => item.key)).toEqual(
      expect.arrayContaining(overview.questions.map((question) => question.key))
    )
    expect(overview.verdictSets.aio).toHaveLength(overview.kpis.withAio.value)
    expect(overview.verdictSets.cited).toHaveLength(overview.kpis.cited.value)
    expect(overview.verdictSets.named).toHaveLength(overview.kpis.named.value)
    expect(overview.kpis.withAio).toEqual({ value: 3, before: 1, delta: 2 })
    expect(overview.kpis.cited).toEqual({ value: 2, before: 0, delta: 2 })
    expect(overview.checkSearches).toEqual({ min: 3, max: 6 })
    const topicQuestion = overview.questions.find((question) => question.promptId === 'tq-1')
    expect(topicQuestion).toMatchObject({
      runId: 'run-t2',
      text: 'what replaced the carrier email gateway',
      source: { kind: 'topic', name: 'Texting after the gateway shutdown' },
      you: 'not_cited',
      ownPage: null,
      citedInstead: ['Twilio'],
      // No overview in the earlier batch, none citing you now.
      change: 'never'
    })
    // tq-2 had no result before the topic's latest batch, so it has no change.
    expect(overview.questions.map((question) => [question.promptId, question.change])).toEqual([
      ['prompt-1', 'gained'],
      ['tq-1', 'never'],
      ['tq-2', null]
    ])
    expect(overview.diff).toEqual({ gained: 1, kept: 0, lost: 0, never: 1, unmatched: 1 })
    expect(overview.citedSites[0]).toMatchObject({ name: 'TextBolt', count: 2, own: true })
    expect(overview.citedSites.find((site) => site.name === 'Twilio')?.count).toBe(2)
    expect(overview.fixes).toEqual([
      {
        fixId: 'fix-1',
        pageId: 'page-1',
        number: 1,
        title: 'Add a per-message price table',
        source: {
          kind: 'page',
          url: PAGE_URL,
          path: '/blog/how-to-set-up-text-alerts-for-business/'
        },
        questions: 1,
        goLiveAt: '2026-10-18T00:00:00.000Z'
      }
    ])
    expect(overview.openFixes).toBe(1)
    expect(overview.firstReport).toEqual({
      checkedAt: '2026-09-01T09:00:00.000Z',
      topicId: TOPIC,
      topics: 1,
      questions: 1,
      suggestedPages: 2,
      untrackedSuggested: 1
    })

    // A market the project does not check reads nothing.
    const other = await handlers['visibility:overview']({
      projectId: 'proj-1',
      period: '30d',
      marketId: 'mkt-de'
    })
    expect(other.kpis.tracked.value).toBe(0)
    expect(other.tracked).toEqual([])
    expect(other.hasChecks).toBe(false)
  })

  test('How we measure: a page prompt and a topic question with the same wording agree or not', async () => {
    const { handlers, projectDb } = await project()
    plantPageRuns(projectDb)
    // The topic asks the page's question: the page check cites you, the topic batch does not.
    addTopic(projectDb, 'How do I alert the crew?')
    const overview = await handlers['visibility:overview']({ projectId: 'proj-1', period: '30d' })
    expect(overview.method.agreement).toEqual({
      total: 1,
      agree: 0,
      percent: 0,
      totalIds: ['page-1|prompt-1'],
      agreeIds: []
    })
  })

  test('a check that measured under 90% of its questions shows no changes for that source', async () => {
    const latestBatch = async (tq2: PromptCheckStatus): Promise<unknown[]> => {
      const { handlers, projectDb } = await project()
      plantPageRuns(projectDb)
      addTopic(projectDb)
      // The latest batch: tq-1 now cites another own page (gained), tq-2 as given.
      plantRun(projectDb, {
        id: 'run-t3',
        pageId: TOPIC,
        promptSetId: 'pset-t1',
        snapshotId: 'snap-t',
        finishedAt: '2026-10-17T09:00:00.000Z',
        partial: true,
        results: [
          {
            promptId: 'tq-1',
            status: 'other_own_page',
            refs: [ref('r-t3-1', 1, 'https://textbolt.com/pricing/', 'own')]
          },
          { promptId: 'tq-2', status: tq2 }
        ]
      })
      const overview = await handlers['visibility:overview']({
        projectId: 'proj-1',
        period: '30d'
      })
      closeSeeds()
      return overview.questions.map((question) => [question.promptId, question.change])
    }
    // Both measured: compared like for like, a partial batch included.
    expect(await latestBatch('not_cited')).toEqual([
      ['prompt-1', 'gained'],
      ['tq-1', 'gained'],
      ['tq-2', 'lost']
    ])
    // One of two searches failed (50%): the topic's changes are hidden, the page's stay,
    // and the failed search is never "not cited".
    expect(await latestBatch('error')).toEqual([
      ['prompt-1', 'gained'],
      ['tq-2', null],
      ['tq-1', null]
    ])
  })

  test('rejects a bad period or an unknown key', async () => {
    const { handlers } = await project()
    await expect(
      handlers['visibility:overview']({
        projectId: 'proj-1',
        period: '14d' as '7d'
      })
    ).rejects.toThrow(/visibility:overview/)
    await expect(
      handlers['visibility:overview']({
        projectId: 'proj-1',
        period: '7d',
        extra: true
      } as unknown as { projectId: string; period: '7d' })
    ).rejects.toThrow(/visibility:overview/)
    await expect(
      handlers['visibility:overview']({ projectId: 'proj-1', period: '7d', vs: 'not an id!' })
    ).rejects.toThrow(/visibility:overview/)
  })
})
