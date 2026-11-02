import type { CheckProgress } from '@shared/ipc'
import type { PromptCheckStatus } from '@shared/domain'
import { afterEach, describe, expect, test } from 'vitest'
import {
  finishStoredRun,
  insertStoredCheckJob,
  insertStoredRun,
  insertStoredSerpResult,
  type NewAioReference
} from '../storage/check-records'
import { insertEngineAnswer } from '../storage/engine-records'
import { createFixFollowUp } from '../storage/fix-follow-ups'
import { closeSeeds, page, seed, snapshot } from '../engine/checks/checks.test-helper'

type Seeded = Awaited<ReturnType<typeof seed>>
type Db = Seeded['projectDb']

const PAGE_URL = page().url ?? ''

afterEach(() => {
  closeSeeds()
})

function project(): Promise<Seeded> {
  return seed({
    progress: [] as CheckProgress[],
    http() {
      throw new Error('Metrics must not search')
    }
  })
}

function ref(
  id: string,
  position: number,
  url: string,
  classification: NewAioReference['classification']
): NewAioReference {
  return {
    id,
    position,
    url,
    normalizedUrl: url,
    domain: new URL(url).hostname,
    title: null,
    classification,
    untracked: false,
    sourceType: 'web'
  }
}

/** One finished full check of page-1's prompt-1. */
function plantRun(
  db: Db,
  id: string,
  finishedAt: string,
  status: PromptCheckStatus,
  refs: readonly NewAioReference[]
): void {
  insertStoredCheckJob(db, {
    id: `job-${id}`,
    startedAt: finishedAt,
    status: 'running',
    pageIds: ['page-1'],
    marketIds: ['mkt-us'],
    promptIds: null,
    reason: 'manual',
    message: null,
    nextStep: null
  })
  insertStoredRun(db, {
    id,
    jobId: `job-${id}`,
    pageId: 'page-1',
    promptSetId: 'pset-1',
    snapshotId: 'snap-1',
    marketId: 'mkt-us',
    startedAt: finishedAt,
    kind: 'manual',
    partial: false,
    samples: 1,
    contentHash: snapshot().contentHash
  })
  finishStoredRun(db, id, finishedAt, 'finished')
  const own = refs.find((item) => item.classification === 'target')
  insertStoredSerpResult(db, {
    id: `serp-${id}`,
    runId: id,
    promptId: 'prompt-1',
    sampleNo: 1,
    keyId: null,
    hasAio: status !== 'no_aio',
    neededFollowup: false,
    searches: 1,
    status,
    named: status === 'no_aio' ? null : true,
    citedUrl: own?.url ?? null,
    position: own?.position ?? null,
    aioText: status === 'no_aio' ? null : 'An overview.',
    errorCode: null,
    message: null,
    nextStep: null,
    rawSearchJson: '{}',
    rawAioJson: null,
    references: refs
  })
}

/** Not cited on Sep 10, cited on Oct 1 and on Oct 15; ChatGPT cites the page on Oct 15. */
function plant(db: Db): void {
  plantRun(db, 'run-1', '2026-09-10T09:00:00.000Z', 'not_cited', [
    ref('a1', 1, 'https://www.simpletexting.com/a/', 'competitor')
  ])
  plantRun(db, 'run-2', '2026-10-01T09:00:00.000Z', 'page_cited', [
    ref('b1', 1, PAGE_URL, 'target'),
    ref('b2', 2, 'https://www.reddit.com/r/x/', 'other')
  ])
  plantRun(db, 'run-3', '2026-10-15T09:00:00.000Z', 'page_cited', [
    ref('c1', 1, 'https://www.reddit.com/r/x/', 'other'),
    ref('c2', 2, PAGE_URL, 'target')
  ])
  insertEngineAnswer(db, {
    id: 'gpt-1',
    runId: 'run-3',
    promptId: 'prompt-1',
    sampleNo: 1,
    engine: 'chatgpt',
    keyId: null,
    status: 'cited',
    citedUrl: PAGE_URL,
    position: 1,
    named: true,
    answerText: 'An answer',
    answerMarkdown: null,
    errorCode: null,
    message: null,
    searches: 1,
    credits: 1,
    costMicros: 0,
    rawJson: null,
    checkedAt: '2026-10-15T09:00:00.000Z',
    sources: [
      {
        id: 'gpt-s1',
        position: 1,
        url: PAGE_URL,
        normalizedUrl: PAGE_URL,
        domain: new URL(PAGE_URL).hostname,
        title: null,
        classification: 'target'
      }
    ]
  })
  createFixFollowUp(db, {
    id: 'fix-1',
    pageId: 'page-1',
    description: 'Rewrite the intro',
    goLiveAt: '2026-09-20T00:00:00.000Z',
    rule: 'after_7_days',
    promptIds: ['prompt-1'],
    marketIds: ['mkt-us']
  })
}

const BASE = { projectId: 'proj-1', marketId: null, scope: { kind: 'project' } } as const

describe('reports:metrics', () => {
  test('Google: the same change and counts as Summary, each with its rows', async () => {
    const { handlers, projectDb } = await project()
    plant(projectDb)
    const metrics = await handlers['reports:metrics']({
      ...BASE,
      engine: 'google_aio',
      from: 'previous',
      to: null
    })
    const overview = await handlers['visibility:overview']({ projectId: 'proj-1', period: '30d' })
    expect(metrics.now.cited.n).toBe(overview.kpis.cited.value)
    expect(metrics.now.answered.n).toBe(overview.kpis.withAio.value)
    expect(metrics.comparison?.movement.kept.n).toBe(overview.diff?.kept)
    expect(metrics.comparison?.movement.kept.ids).toEqual(['google_aio:run-3:prompt-1'])
    const row = metrics.rows['google_aio:run-3:prompt-1']
    expect(row).toMatchObject({
      result: 'target',
      position: 2,
      named: true,
      domains: ['reddit.com'],
      questionId: 'page-1|prompt-1',
      segments: { funnel: expect.anything() }
    })
    expect(metrics.history[0]?.points.map((point) => point.checkId)).toEqual(['run-2', 'run-3'])
  })

  test('a window from a run id, a day, or latest only', async () => {
    const { handlers, projectDb } = await project()
    plant(projectDb)
    const fromRun = await handlers['reports:metrics']({
      ...BASE,
      engine: 'google_aio',
      from: 'run-1',
      to: '2026-10-02'
    })
    expect(fromRun.window).toEqual({
      from: '2026-09-10T09:00:00.000Z',
      to: '2026-10-02T23:59:59.999Z'
    })
    expect(fromRun.comparison?.movement.gained.ids).toEqual(['google_aio:run-2:prompt-1'])
    expect(fromRun.comparison?.decomposition).toMatchObject({ total: 1, market: 0, work: 1 })
    const first = await handlers['reports:metrics']({
      ...BASE,
      engine: 'google_aio',
      from: 'first',
      to: null
    })
    expect(first.window.from).toBe('2026-09-10T09:00:00.000Z')
    expect(first.comparison?.movement.gained.ids).toEqual(['google_aio:run-3:prompt-1'])
    const latest = await handlers['reports:metrics']({
      ...BASE,
      engine: 'all',
      from: null,
      to: null
    })
    expect(latest.comparison).toBeNull()
    expect(latest.engines.map((item) => item.engine)).toEqual(['google_aio', 'chatgpt'])
    expect(latest.offeredEngines).toEqual(['google_aio', 'chatgpt'])
    expect(latest.checks.map((check) => check.id)).toEqual(['run-1', 'run-2', 'run-3'])
    // "All engines" counts the question once: cited when any engine cites the page.
    expect(latest.counting).toBe('once')
    expect(latest.now.cited.ids).toEqual(['all:run-3:mkt-us:page-1|prompt-1'])
    const merged = latest.rows['all:run-3:mkt-us:page-1|prompt-1']
    expect(merged).toMatchObject({ engine: 'all', result: 'target', position: 1 })
    expect(merged?.parts).toEqual(['google_aio:run-3:prompt-1', 'chatgpt:run-3:prompt-1'])
    for (const id of merged?.parts ?? []) expect(latest.rows[id]).toBeDefined()
    // The engine filter still shows ChatGPT on its own, whatever "All" does.
    const gpt = await handlers['reports:metrics']({
      ...BASE,
      engine: 'chatgpt',
      from: null,
      to: null
    })
    expect(gpt.offeredEngines).toEqual(['google_aio', 'chatgpt'])
    expect(gpt.now.cited.ids).toEqual(['chatgpt:run-3:prompt-1'])
  })

  test('one answer engine, a page scope, and the published page', async () => {
    const { handlers, projectDb } = await project()
    plant(projectDb)
    const chatgpt = await handlers['reports:metrics']({
      ...BASE,
      scope: { kind: 'page', id: 'page-1' },
      engine: 'chatgpt',
      from: 'previous',
      to: null
    })
    expect(chatgpt.now.first.ids).toEqual(['chatgpt:run-3:prompt-1'])
    // ChatGPT was not asked in run-2: nothing to compare with.
    expect(chatgpt.comparison?.excluded.noBefore.ids).toEqual(['chatgpt:run-3:prompt-1'])
    const pricing = chatgpt.pages.rows.find((item) => item.liveSince !== null)
    expect(pricing).toMatchObject({ kind: 'rewrite', status: 'cited', daysLive: 25 })
    expect(chatgpt.pages.published.n).toBe(1)
    const none = await handlers['reports:metrics']({
      ...BASE,
      scope: { kind: 'topic', id: 'page-1' },
      engine: 'all',
      from: null,
      to: null
    })
    expect(none.now.checked.n).toBe(0)
  })

  test('rejects a bad request', async () => {
    const { handlers } = await project()
    await expect(
      handlers['reports:metrics']({ ...BASE, engine: 'bard' as never, from: null, to: null })
    ).rejects.toThrow('reports:metrics')
    await expect(
      handlers['reports:metrics']({ ...BASE, engine: 'all', from: null, to: 'previous' })
    ).rejects.toThrow('reports:metrics')
    await expect(
      handlers['reports:metrics']({ ...BASE, engine: 'all', from: null, to: 'first' })
    ).rejects.toThrow('reports:metrics')
    await expect(
      handlers['reports:metrics']({ ...BASE, engine: 'all', from: 'no-such-run', to: null })
    ).rejects.toThrow('Pick a check, a day or a time')
  })
})
