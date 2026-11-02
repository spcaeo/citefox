import type { PromptCheckStatus } from '@shared/domain'
import type { NewAioReference } from '../storage/check-records'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { closeSeeds, seed, snapshot } from '../engine/checks/checks.test-helper'
import {
  finishStoredRun,
  insertStoredCheckJob,
  insertStoredRun,
  insertStoredSerpResult
} from '../storage/check-records'
import type { SqliteDatabase } from '../storage/database'
import { getProject } from '../storage/records'
import { replaceSentimentRead } from '../storage/sentiment-records'
import { seedTextboltTopic } from '../topics/fixture-seed'
import { loadQuestions } from './list'

afterEach(() => {
  closeSeeds()
})

const HASH = 'a'.repeat(64)
const PAGE_URL = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'

function ref(
  id: string,
  position: number,
  url: string,
  classification: NewAioReference['classification']
): NewAioReference {
  const host = new URL(url).hostname
  return {
    id,
    position,
    url,
    normalizedUrl: url,
    domain: host,
    title: null,
    classification,
    untracked: false,
    sourceType: host.includes('reddit') ? 'reddit' : 'web'
  }
}

/** One full, finished check of page-1 with the given capture per prompt. */
function plantRun(
  db: SqliteDatabase,
  runId: string,
  startedAt: string,
  captures: Array<{
    promptId: string
    status: PromptCheckStatus
    named: boolean | null
    position: number | null
    references: NewAioReference[]
  }>
): void {
  insertStoredCheckJob(db, {
    id: `job-${runId}`,
    startedAt,
    status: 'running',
    pageIds: ['page-1'],
    marketIds: ['mkt-us'],
    promptIds: null,
    reason: 'manual',
    message: null,
    nextStep: null
  })
  insertStoredRun(db, {
    id: runId,
    jobId: `job-${runId}`,
    pageId: 'page-1',
    promptSetId: 'pset-1',
    snapshotId: 'snap-1',
    marketId: 'mkt-us',
    startedAt,
    kind: 'manual',
    partial: false,
    samples: 1,
    contentHash: snapshot().contentHash
  })
  for (const capture of captures) {
    const hasAio = capture.status !== 'no_aio' && capture.status !== 'error'
    insertStoredSerpResult(db, {
      id: `serp-${runId}-${capture.promptId}`,
      runId,
      promptId: capture.promptId,
      sampleNo: 1,
      keyId: null,
      hasAio,
      neededFollowup: false,
      searches: 1,
      status: capture.status,
      named: capture.named,
      citedUrl: capture.status === 'page_cited' ? PAGE_URL : null,
      position: capture.position,
      aioText: hasAio ? 'An overview that names TextBolt.' : null,
      errorCode: null,
      message: null,
      nextStep: null,
      rawSearchJson: '{}',
      rawAioJson: null,
      references: capture.references
    })
  }
  finishStoredRun(db, runId, new Date(Date.parse(startedAt) + 60_000).toISOString(), 'finished')
}

/**
 * page-1: prompt-1 not cited, then cited #2 (a gained citation); prompt-2 no overview,
 * then not cited (a new overview). page-2's prompt has no check. Plus the TextBolt
 * topic with its two stored checks.
 */
async function seeded(): Promise<Awaited<ReturnType<typeof seed>> & { topicId: string }> {
  const seededProject = await seed({
    progress: [],
    secondPage: true,
    secondPrompt: true,
    http: () => ({ status: 500, body: '{}' })
  })
  const db = seededProject.projectDb
  plantRun(db, 'run-a', '2026-10-01T09:00:00.000Z', [
    {
      promptId: 'prompt-1',
      status: 'not_cited',
      named: false,
      position: null,
      references: [
        ref('ref-a1', 1, 'https://www.twilio.com/sms', 'competitor'),
        ref('ref-a2', 2, 'https://www.reddit.com/r/sms', 'other')
      ]
    },
    { promptId: 'prompt-2', status: 'no_aio', named: null, position: null, references: [] }
  ])
  plantRun(db, 'run-b', '2026-10-10T09:00:00.000Z', [
    {
      promptId: 'prompt-1',
      status: 'page_cited',
      named: true,
      position: 2,
      references: [
        ref('ref-b1', 1, 'https://www.twilio.com/sms', 'competitor'),
        ref('ref-b2', 2, PAGE_URL, 'target'),
        ref('ref-b3', 3, 'https://www.reddit.com/r/sms', 'other')
      ]
    },
    {
      promptId: 'prompt-2',
      status: 'not_cited',
      named: false,
      position: null,
      references: [ref('ref-b4', 1, 'https://simpletexting.com/', 'competitor')]
    }
  ])
  replaceSentimentRead(
    db,
    {
      id: 'read-1',
      runId: 'run-b',
      marketId: 'mkt-us',
      source: 'buyer',
      captureId: 'serp-run-b-prompt-1',
      promptId: 'prompt-1',
      aioHash: HASH,
      inputHash: HASH,
      templateId: 'tpl-sentiment',
      templateHash: HASH,
      generationId: null,
      readAt: '2026-10-10T09:05:00.000Z',
      ok: true,
      error: null,
      brandsNamed: ['TextBolt'],
      reason: null
    },
    [
      {
        id: 'claim-1',
        brand: 'TextBolt',
        isOwn: true,
        theme: 'price',
        attribute: 'cheap',
        tone: 'positive',
        sentence: 'TextBolt is cheap.',
        url: null,
        factProblem: null
      }
    ]
  )
  const project = getProject(seededProject.storage.db, 'proj-1')
  if (project === null) throw new Error('no project')
  const { topicId } = seedTextboltTopic(db, project)
  return { ...seededProject, topicId }
}

describe('questions:list', () => {
  test('lists every question of every page and topic with its latest check', async () => {
    const { handlers, topicId } = await seeded()
    const list = await handlers['questions:list']({ projectId: 'proj-1' })

    expect(list.marketId).toBe('mkt-us')
    expect(list.markets).toEqual([{ id: 'mkt-us', label: 'US · EN', isDefault: true }])
    expect(list.sources.map((source) => source.kind)).toEqual(['topic', 'page', 'page'])
    expect(list.sources[0]).toMatchObject({ id: topicId, kind: 'topic', url: null, path: null })
    expect(list.sources[1]).toMatchObject({
      id: 'page-1',
      path: '/blog/how-to-set-up-text-alerts-for-business/',
      samples: 1,
      marketIds: ['mkt-us']
    })
    expect(list.lens).toEqual({
      brandNames: ['TextBolt'],
      ownDomain: 'textbolt.com',
      includeSubdomains: false
    })

    const one = list.rows.find((row) => row.promptId === 'prompt-1')
    expect(one).toMatchObject({
      sourceId: 'page-1',
      text: 'How do I alert the crew?',
      enabled: true,
      inMarket: true,
      result: 'cited',
      status: 'page_cited',
      overview: true,
      cited: true,
      position: 2,
      named: true,
      citedInstead: ['Twilio', 'reddit.com'],
      sentiment: 'positive',
      change: 'gained',
      runId: 'run-b',
      resultPromptId: 'prompt-1',
      checkedAt: '2026-10-10T09:01:00.000Z'
    })
    const two = list.rows.find((row) => row.promptId === 'prompt-2')
    expect(two).toMatchObject({
      result: 'not_cited',
      cited: false,
      position: null,
      named: false,
      citedInstead: ['SimpleTexting'],
      change: 'new_overview',
      sentiment: null
    })
    const unchecked = list.rows.find((row) => row.promptId === 'prompt-2b')
    expect(unchecked).toMatchObject({
      sourceId: 'page-2',
      result: 'not_checked',
      status: null,
      overview: null,
      change: 'none',
      checkedAt: null,
      runId: null
    })
    expect(list.hasSentiment).toBe(true)

    // Facet counts add up to the rows.
    const topicRows = list.rows.filter((row) => row.sourceId === topicId)
    expect(list.facets.kind).toEqual({ topic: topicRows.length, page: 3 })
    expect(list.facets.source['page-1']).toBe(2)
    expect(Object.values(list.facets.result).reduce((a, b) => a + b, 0)).toBe(list.rows.length)
    expect(Object.values(list.facets.change).reduce((a, b) => a + b, 0)).toBe(list.rows.length)
    expect(list.facets.change.gained).toBeGreaterThanOrEqual(1)
  })

  test('matches prompt detail for a page and topic results for a topic', async () => {
    const { handlers, topicId } = await seeded()
    const list = await handlers['questions:list']({ projectId: 'proj-1', marketId: 'mkt-us' })

    for (const promptId of ['prompt-1', 'prompt-2']) {
      const row = list.rows.find((item) => item.promptId === promptId)
      const detail = await handlers['checks:getPrompt']({
        projectId: 'proj-1',
        pageId: 'page-1',
        promptId,
        marketId: 'mkt-us',
        runId: row?.runId ?? null
      })
      expect(row?.status).toBe(detail.row?.status)
      expect(row?.named).toBe(detail.row?.named)
      expect(row?.checkedAt).toBe(detail.row?.checkedAt)
      if (row?.cited) expect(row.position).toBe(detail.row?.position)
    }

    const topic = await handlers['topics:results']({
      projectId: 'proj-1',
      topicId,
      marketId: 'mkt-us',
      runId: null
    })
    expect(topic.rows.length).toBeGreaterThan(0)
    for (const expected of topic.rows) {
      const row = list.rows.find((item) => item.promptId === expected.promptId)
      expect(row?.sourceId).toBe(topicId)
      expect(row?.checkedAt).toBe(expected.checkedAt)
      if (expected.checkedAt === null) continue
      expect(row?.named).toBe(expected.named)
      expect(row?.cited === true).toBe(expected.citedOwnUrl !== null)
      if (row?.cited) expect(row.position).toBe(expected.position)
      // The status names the same own page as the topic's row state.
      if (expected.state === 'right_page') expect(row?.status).toBe('page_cited')
      if (expected.state === 'other_page') expect(row?.status).toBe('other_own_page')
    }
    expect(topic.rows.some((row) => row.state === 'right_page')).toBe(true)
  })

  test('lists a thousand questions in a fixed number of statements', async () => {
    const seededProject = await seeded()
    const db = seededProject.projectDb
    const project = getProject(seededProject.storage.db, 'proj-1')
    if (project === null) throw new Error('no project')
    const prepare = vi.spyOn(db, 'prepare')
    loadQuestions(db, project, null)
    const small = prepare.mock.calls.length
    prepare.mockClear()

    const insertPrompt = db.prepare(
      `INSERT INTO prompts (id, prompt_set_id, position, label, source, intent_stage, mapped_element, enabled)
       VALUES (?, 'pset-1', ?, ?, 'objection', 'solution', 'Body', 1)`
    )
    const insertVariant = db.prepare(
      `INSERT INTO prompt_variants (prompt_id, market_id, language, text, original_text)
       VALUES (?, 'mkt-us', 'en', ?, NULL)`
    )
    const captures: Parameters<typeof plantRun>[3] = []
    db.transaction(() => {
      for (let n = 0; n < 1000; n += 1) {
        const id = `bulk-${n}`
        insertPrompt.run(id, 10 + n, `Q${n}`)
        insertVariant.run(id, `Which texting tool works for case ${n}?`)
        captures.push({
          promptId: id,
          status: n % 2 === 0 ? 'page_cited' : 'not_cited',
          named: n % 3 === 0,
          position: n % 2 === 0 ? 2 : null,
          references: [
            ref(`ref-${n}-1`, 1, 'https://www.twilio.com/sms', 'competitor'),
            ref(`ref-${n}-2`, 2, PAGE_URL, n % 2 === 0 ? 'target' : 'other')
          ]
        })
      }
    })()
    plantRun(db, 'run-c', '2026-10-15T09:00:00.000Z', captures)
    prepare.mockClear()

    const started = performance.now()
    const list = loadQuestions(db, project, null)
    const elapsed = performance.now() - started
    expect(list.rows.length).toBeGreaterThan(1000)
    expect(list.facets.result.cited).toBeGreaterThanOrEqual(500)
    // References come in chunks of 500 samples; nothing else grows with the questions.
    expect(prepare.mock.calls.length).toBeLessThanOrEqual(small + 4)
    expect(elapsed).toBeLessThan(2000)
  })

  test('falls back to the default market for an unknown one', async () => {
    const { handlers } = await seeded()
    const list = await handlers['questions:list']({ projectId: 'proj-1', marketId: 'mkt-xx' })
    expect(list.marketId).toBe('mkt-us')
  })
})

describe('questions:update', () => {
  test('disables and enables as a new version; results follow the questions', async () => {
    const { handlers } = await seeded()
    const disabled = await handlers['questions:update']({
      projectId: 'proj-1',
      action: 'disable',
      items: [{ sourceId: 'page-1', promptId: 'prompt-2' }]
    })
    expect(disabled).toMatchObject({ changed: 1, skipped: [], message: 'Disabled 1 question.' })
    expect(disabled.restore).toEqual([
      { sourceId: 'page-1', promptSetId: 'pset-1', replacedBy: expect.any(String) }
    ])

    const list = await handlers['questions:list']({ projectId: 'proj-1' })
    const page = list.rows.filter((row) => row.sourceId === 'page-1')
    expect(page).toHaveLength(2)
    // New prompt ids, but the latest checks still belong to the same questions.
    expect(page.map((row) => row.promptId)).not.toContain('prompt-1')
    expect(page[0]).toMatchObject({
      text: 'How do I alert the crew?',
      enabled: true,
      result: 'cited',
      change: 'gained',
      resultPromptId: 'prompt-1'
    })
    expect(page[1]).toMatchObject({ enabled: false, result: 'not_cited' })

    const enabled = await handlers['questions:update']({
      projectId: 'proj-1',
      action: 'enable',
      items: [{ sourceId: 'page-1', promptId: page[1]?.promptId ?? '' }]
    })
    expect(enabled.changed).toBe(1)
    const again = await handlers['questions:list']({ projectId: 'proj-1' })
    expect(again.rows.filter((row) => row.sourceId === 'page-1').every((row) => row.enabled)).toBe(
      true
    )
  })

  test('removes topic questions, keeps the others’ results, and never empties a source', async () => {
    const { handlers, topicId } = await seeded()
    const before = await handlers['questions:list']({ projectId: 'proj-1' })
    const topicRows = before.rows.filter((row) => row.sourceId === topicId)
    const gone = topicRows[0]
    if (gone === undefined) throw new Error('no topic question')
    const removed = await handlers['questions:update']({
      projectId: 'proj-1',
      action: 'remove',
      items: [
        { sourceId: topicId, promptId: gone.promptId },
        { sourceId: 'page-2', promptId: 'prompt-2b' }
      ]
    })
    expect(removed.changed).toBe(1)
    expect(removed.skipped).toEqual([
      {
        sourceId: 'page-2',
        reason: 'A page needs at least one question. Keep one, or stop tracking the page.'
      }
    ])
    expect(removed.message).toBe('Removed 1 question. 1 page or topic was skipped.')

    const after = await handlers['questions:list']({ projectId: 'proj-1' })
    const kept = after.rows.filter((row) => row.sourceId === topicId)
    expect(kept).toHaveLength(topicRows.length - 1)
    expect(kept.map((row) => row.text)).not.toContain(gone.text)
    // The topic's own results follow the kept questions by stable key.
    const topic = await handlers['topics:results']({
      projectId: 'proj-1',
      topicId,
      marketId: 'mkt-us',
      runId: null
    })
    for (const row of kept) {
      const expected = topic.rows.find((item) => item.promptId === row.promptId)
      if (expected === undefined) continue
      expect(row.checkedAt).toBe(expected.checkedAt)
    }
    expect(after.rows.some((row) => row.promptId === 'prompt-2b')).toBe(true)
  })

  test('rejects a malformed request', async () => {
    const { handlers } = await seeded()
    await expect(
      handlers['questions:update']({ projectId: 'proj-1', action: 'disable', items: [] })
    ).rejects.toThrow(/Select at least one question/)
  })
})
