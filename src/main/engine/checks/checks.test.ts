import type { DuePage } from '@shared/domain'
import type { CheckFinishedNotice, CheckProgress } from '@shared/ipc'
import { afterEach, describe, expect, test } from 'vitest'
import { contentHash } from '../../pipeline/hash'
import { insertPromptSet } from '../../storage/content-records'
import { getPage, listPageMarkets, setPageScore } from '../../storage/pages'
import { writeProjectScheduleCap } from '../../storage/project-schedule'
import { addKeyUsage } from '../../storage/records'
import {
  insertStoredCheckJob,
  insertStoredCheckStep,
  insertStoredRun,
  insertStoredSerpResult,
  listStoredAioReferences,
  listStoredCheckRuns,
  listStoredCheckSteps,
  listStoredSerpResults,
  readStoredCheckJob
} from '../../storage/check-records'
import { createCheckQueue } from '../../queue'
import { monthKey } from '../../scheduler/local-time'
import { CHECK_CANCELLED_MESSAGE } from './index'
import { createCheckRunner, resumeInterruptedChecks } from './engine'
import {
  buyerPrompt,
  closeSeeds,
  leaveNightShiftPending,
  plantMixedRuns,
  createGate,
  envelope,
  flushMicrotasks,
  NOW,
  runFilter,
  scheduledJob,
  SECRET,
  seed,
  snapshot,
  timeZone,
  until
} from './checks.test-helper'

afterEach(() => {
  closeSeeds()
})

describe('check handlers', () => {
  test('runs a fixture check through classify, score, storage, and IPC', async () => {
    const progress: CheckProgress[] = []
    const httpCalls: string[] = []
    const { handlers, projectDb } = await seed({
      progress,
      http(request) {
        httpCalls.push(request.url)
        const url = new URL(request.url)
        expect(progress[0]?.phase).toBe('reread')
        expect(url.searchParams.get('api_key')).toBe(SECRET)
        if (url.searchParams.get('engine') === 'google') {
          expect(url.searchParams.get('q')).toBe('How do I alert the crew?')
        }
        return url.searchParams.get('engine') === 'google_ai_overview'
          ? envelope('google-ai-overview.json')
          : envelope('google-page-token.json')
      }
    })
    const pending = handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    const active = await handlers['checks:listActive']({ projectId: 'proj-1' })
    expect(active.some((job) => job.status === 'running')).toBe(true)
    const job = await pending
    expect(job.status).toBe('finished')
    expect(job.message).toBeNull()
    await expect(handlers['checks:listActive']({ projectId: null })).resolves.toEqual([])
    // A "searching" step names the question before its search returns.
    expect(progress.map((event) => `${event.phase}:${event.state}`).slice(0, 6)).toEqual([
      'reread:running',
      'reread:ok',
      'search:running',
      'search:ok',
      'aio:ok',
      'analysis:ok'
    ])
    expect(progress[2]?.promptText).toBe('How do I alert the crew?')
    expect(new Set(httpCalls.map((url) => new URL(url).searchParams.get('api_key')))).toEqual(
      new Set([SECRET])
    )
    const results = await handlers['results:get']({
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: null,
      runId: null
    })
    expect(results.run?.kind).toBe('baseline')
    expect(results.run?.partial).toBe(false)
    expect(results.run?.pageCited).toBe(1)
    expect(results.run?.visibilityScore).toBe(100)
    expect(results.prompts[0]?.status).toBe('page_cited')
    expect(results.comparison.map((column) => column.which)).toEqual([
      'baseline',
      'previous',
      'current'
    ])
    const detail = await handlers['checks:getPrompt']({
      projectId: 'proj-1',
      pageId: 'page-1',
      promptId: 'prompt-1',
      marketId: null,
      runId: null
    })
    const raw = `${detail.samples[0]?.rawSearchJson ?? ''}${detail.samples[0]?.rawAioJson ?? ''}`
    expect(raw).not.toContain(SECRET)
    expect(raw).not.toContain('fixture-page-token')
    expect(detail.samples[0]?.neededFollowup).toBe(true)
    expect(detail.aioGap).toBeNull()
    const history = await handlers['results:history']({
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: null
    })
    expect(history.points).toHaveLength(1)
    expect(history.points[0]?.partial).toBe(false)
    const projects = await handlers['scores:listProjects']()
    expect(projects.projects[0]?.averageScore).toBe(100)
    const pages = await handlers['scores:listPages']({ projectId: 'proj-1' })
    expect(pages.pages[0]?.score).toBe(100)
    const follow = await handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: ['prompt-1']
    })
    expect(follow.status).toBe('finished')
    const runs = listStoredCheckRuns(projectDb, {
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketId: 'mkt-us',
      from: null,
      to: null,
      runId: null,
      promptId: null
    })
    expect(runs.map((run) => run.kind)).toEqual(['baseline', 'follow_up'])
    expect(runs[1]?.partial).toBe(true)
    await expect(handlers['checks:cancel']({ jobId: job.id })).resolves.toMatchObject({
      id: job.id,
      status: 'finished',
      message: null
    })
  })

  test('refuses a check that would pass the cap without calling SerpApi', async () => {
    const httpCalls: string[] = []
    const { handlers, projectDb } = await seed({
      progress: [],
      http(request) {
        httpCalls.push(request.url)
        return envelope('google-no-aio.json')
      }
    })
    writeProjectScheduleCap(projectDb, { cap: 0, capRule: 'pause', dedicatedKeyId: null })
    const job = await handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    expect(job.status).toBe('error')
    expect(job.message).toBe("This check would pass the project's search cap.")
    expect(httpCalls).toEqual([])
    await expect(handlers['checks:cancel']({ jobId: 'missing-job' })).rejects.toThrow(/Unknown job/)
    await expect(
      handlers['results:get']({
        projectId: 'proj-1',
        pageId: 'missing',
        marketId: null,
        runId: null
      })
    ).rejects.toThrow(/Unknown page/)
  })

  test('counts the follow-up and stops before a search that would pass the cap', async () => {
    const httpCalls: string[] = []
    let followUps = 0
    const { handlers, projectDb } = await seed({
      progress: [],
      http(request) {
        httpCalls.push(request.url)
        const engine = new URL(request.url).searchParams.get('engine')
        if (engine === 'google_ai_overview') {
          followUps += 1
          return envelope(followUps === 1 ? 'google-token-expired.json' : 'google-ai-overview.json')
        }
        return envelope('google-page-token.json')
      }
    })
    writeProjectScheduleCap(projectDb, { cap: 2, capRule: 'pause', dedicatedKeyId: null })
    const job = await handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    expect(httpCalls).toHaveLength(2)
    expect(job).toMatchObject({
      status: 'error',
      message: "This check would pass the project's search cap.",
      searchesUsed: 2
    })
    expect(job.searchesUsed).toBeLessThanOrEqual(2)
  })

  test('cancels before the first search and does not make that run the baseline', async () => {
    const progress: CheckProgress[] = []
    const events: string[] = []
    const httpCalls: string[] = []
    let block = true
    const gate = createGate()
    const { handlers, projectDb } = await seed({
      progress,
      events,
      beforeRequest: () => (block ? gate.beforeRequest() : Promise.resolve()),
      http(request) {
        httpCalls.push(request.url)
        return envelope('google-no-aio.json')
      }
    })
    const pending = handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    await until(() => gate.pending() === 1 && (progress[0]?.jobId.length ?? 0) > 0)
    const jobId = progress[0]?.jobId ?? ''
    const cancelling = handlers['checks:cancel']({ jobId })
    await flushMicrotasks()
    gate.release()
    const cancelled = await cancelling
    await expect(pending).resolves.toMatchObject({ id: jobId, status: 'cancelled', message: null })
    expect(cancelled.finishedAt).not.toBeNull()
    expect(httpCalls).toEqual([])
    // The search was about to start; it never ran, and screens hear the job stopped.
    expect(events).toEqual([
      'progress:reread…',
      'progress:reread',
      'progress:search…',
      'results:stopped'
    ])
    expect(listPageMarkets(projectDb, 'page-1')[0]?.baselineRunId).toBeNull()
    expect(getPage(projectDb, 'page-1', 'proj-1')?.score).toBeNull()
    await expect(handlers['checks:get']({ jobId })).resolves.toMatchObject({
      id: jobId,
      status: 'cancelled'
    })
    block = false
    const again = await handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    expect(again.status).toBe('finished')
    expect(httpCalls).toHaveLength(1)
    const runs = listStoredCheckRuns(projectDb, runFilter())
    expect(runs.some((run) => run.jobId === jobId)).toBe(false)
    const cancelledRunId = cancelled.runIds[0] ?? ''
    expect(listStoredCheckRuns(projectDb, runFilter(cancelledRunId))[0]?.status).toBe('cancelled')
    const finished = runs.find((run) => run.jobId === again.id)
    expect(finished?.kind).toBe('baseline')
    expect(finished?.status).toBe('finished')
    expect(listPageMarkets(projectDb, 'page-1')[0]?.baselineRunId).toBe(finished?.id)
  })

  test('cancels between the search and the AI Overview follow-up', async () => {
    const progress: CheckProgress[] = []
    const events: string[] = []
    const httpCalls: string[] = []
    const gate = createGate()
    const { handlers, projectDb, storage } = await seed({
      progress,
      events,
      beforeRequest: gate.beforeRequest,
      http(request) {
        httpCalls.push(request.url)
        const engine = new URL(request.url).searchParams.get('engine')
        return engine === 'google_ai_overview'
          ? envelope('google-ai-overview.json')
          : envelope('google-page-token.json')
      }
    })
    const pending = handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    await until(() => gate.pending() === 1)
    gate.release()
    await until(() => gate.pending() === 1 && httpCalls.length === 1)
    const jobId = progress[0]?.jobId ?? ''
    const cancelling = handlers['checks:cancel']({ jobId })
    await flushMicrotasks()
    gate.release()
    const cancelled = await cancelling
    await pending
    expect(cancelled.status).toBe('cancelled')
    expect(httpCalls).toHaveLength(1)
    expect(new URL(httpCalls[0] ?? '').searchParams.get('engine')).toBe('google')
    expect(events).toEqual([
      'progress:reread…',
      'progress:reread',
      'progress:search…',
      'progress:search',
      'results:stopped'
    ])
    expect(cancelled.searchesUsed).toBe(1)
    const steps = listStoredCheckSteps(projectDb, jobId)
    expect(steps.map((step) => step.phase)).toEqual(['search'])
    const cancelledRunId = cancelled.runIds[0] ?? ''
    expect(listStoredSerpResults(projectDb, runFilter())).toEqual([])
    // FR-5.5: a follow-up that never ran is not a sample, so no `no_aio` row is stored.
    expect(listStoredSerpResults(projectDb, runFilter(cancelledRunId))).toEqual([])
    expect(
      storage.db.prepare('SELECT COALESCE(SUM(searches), 0) AS searches FROM key_usage').get()
    ).toEqual({
      searches: 1
    })
    expect(listPageMarkets(projectDb, 'page-1')[0]?.baselineRunId).toBeNull()
    expect(getPage(projectDb, 'page-1', 'proj-1')?.score).toBeNull()
    const runs = listStoredCheckRuns(projectDb, runFilter(cancelledRunId))
    expect(runs[0]?.status).toBe('cancelled')
    expect(runs[0]?.partial).toBe(false)
  })

  test('cancels mid-batch after one page finishes and before the next page searches', async () => {
    const events: string[] = []
    const finished: CheckFinishedNotice[] = []
    const httpCalls: string[] = []
    const gate = createGate()
    const { handlers, projectDb } = await seed({
      progress: [],
      finished,
      events,
      secondPage: true,
      beforeRequest: gate.beforeRequest,
      http(request) {
        httpCalls.push(request.url)
        const engine = new URL(request.url).searchParams.get('engine')
        return engine === 'google_ai_overview'
          ? envelope('google-ai-overview.json')
          : envelope('google-page-token.json')
      }
    })
    const pending = handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1', 'page-2'],
      marketIds: null,
      promptIds: null
    })
    await until(() => gate.pending() === 1)
    gate.release()
    await until(() => gate.pending() === 1 && httpCalls.length === 1)
    gate.release()
    await until(() => gate.pending() === 1 && finished.length === 1)
    const jobId = finished[0]?.jobId ?? ''
    const cancelling = handlers['checks:cancel']({ jobId })
    await flushMicrotasks()
    gate.release()
    const cancelled = await cancelling
    await pending
    expect(cancelled.status).toBe('cancelled')
    expect(httpCalls).toHaveLength(2)
    expect(
      httpCalls
        .filter((url) => new URL(url).searchParams.get('engine') === 'google')
        .map((url) => new URL(url).searchParams.get('q'))
    ).toEqual(['How do I alert the crew?'])
    expect(httpCalls.some((url) => url.includes('second site'))).toBe(false)
    expect(events).toEqual([
      'progress:reread…',
      'progress:reread',
      'progress:search…',
      'progress:search',
      'progress:aio',
      'results:running',
      'progress:analysis',
      'finished',
      'progress:reread…',
      'progress:reread',
      'progress:search…',
      // One end event per page of the job.
      'results:stopped',
      'results:stopped'
    ])
    expect(finished.map((notice) => notice.pageId)).toEqual(['page-1'])
    expect(getPage(projectDb, 'page-1', 'proj-1')?.score).toBe(100)
    expect(getPage(projectDb, 'page-2', 'proj-1')?.score).toBeNull()
    expect(listPageMarkets(projectDb, 'page-1')[0]?.baselineRunId).not.toBeNull()
    expect(listPageMarkets(projectDb, 'page-2')[0]?.baselineRunId).toBeNull()
    const runs = listStoredCheckRuns(projectDb, {
      projectId: 'proj-1',
      pageIds: null,
      marketId: null,
      from: null,
      to: null,
      runId: null,
      promptId: null
    })
    expect(runs.find((run) => run.pageId === 'page-1')).toMatchObject({
      status: 'finished',
      kind: 'baseline'
    })
    expect(runs.some((run) => run.pageId === 'page-2')).toBe(false)
    const pageTwo = cancelled.runIds
      .map(
        (id) =>
          listStoredCheckRuns(projectDb, {
            projectId: 'proj-1',
            pageIds: null,
            marketId: null,
            from: null,
            to: null,
            runId: id,
            promptId: null
          })[0]
      )
      .find((run) => run?.pageId === 'page-2')
    expect(pageTwo).toMatchObject({ status: 'cancelled' })
  })

  test('resumes a crashed job without repeating a completed search', async () => {
    const events: string[] = []
    const httpCalls: string[] = []
    const { storage, projectDb, checkEngine } = await seed({
      progress: [],
      events,
      secondPrompt: true,
      http(request) {
        httpCalls.push(request.url)
        return envelope('google-no-aio.json')
      }
    })
    const hash = snapshot().contentHash
    insertStoredCheckJob(projectDb, {
      id: 'job-resume',
      startedAt: NOW,
      status: 'running',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null,
      reason: 'manual',
      message: null,
      nextStep: null
    })
    insertStoredRun(projectDb, {
      id: 'run-resume',
      jobId: 'job-resume',
      pageId: 'page-1',
      promptSetId: 'pset-1',
      snapshotId: 'snap-1',
      marketId: 'mkt-us',
      startedAt: NOW,
      kind: 'baseline',
      partial: false,
      samples: 1,
      contentHash: hash
    })
    insertStoredSerpResult(projectDb, {
      id: 'serp-resume',
      runId: 'run-resume',
      promptId: 'prompt-1',
      sampleNo: 1,
      keyId: 'key-1',
      hasAio: false,
      neededFollowup: false,
      searches: 1,
      status: 'no_aio',
      named: null,
      citedUrl: null,
      position: null,
      aioText: null,
      errorCode: null,
      message: null,
      nextStep: null,
      rawSearchJson: '{}',
      rawAioJson: null,
      references: []
    })
    for (const step of [
      ['search', 1, 'Loaded'],
      ['aio', 1, 'No AI Overview'],
      ['analysis', 0, 'Scored']
    ] as const) {
      insertStoredCheckStep(projectDb, {
        jobId: 'job-resume',
        pageId: 'page-1',
        marketId: 'mkt-us',
        promptId: 'prompt-1',
        sampleNo: step[1],
        phase: step[0],
        promptPosition: 1,
        label: 'Crew',
        promptText: 'How do I alert the crew?',
        state: 'ok',
        detail: step[2],
        errorCode: null,
        error: null,
        retrySearches: 0,
        updatedAt: NOW
      })
    }
    addKeyUsage(storage.db, {
      id: 'usage-resume',
      keyId: 'key-1',
      projectId: 'proj-1',
      month: monthKey(Date.parse(NOW), timeZone()),
      searches: 1,
      calls: 1,
      tokens: 0
    })
    const [job] = await resumeInterruptedChecks(checkEngine)
    expect(job?.id).toBe('job-resume')
    expect(job?.status).toBe('finished')
    expect(job?.searchesUsed).toBe(2)
    expect(httpCalls.map((url) => new URL(url).searchParams.get('q'))).toEqual([
      'How do I reach the night shift?'
    ])
    expect(events).toEqual([
      'progress:search…',
      'progress:search',
      'progress:aio',
      'results:running',
      'progress:analysis',
      'finished',
      'results:finished'
    ])
    expect(
      storage.db.prepare('SELECT COALESCE(SUM(searches), 0) AS searches FROM key_usage').get()
    ).toEqual({
      searches: 2
    })
    const runs = listStoredCheckRuns(projectDb, runFilter())
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ id: 'run-resume', status: 'finished', kind: 'baseline' })
    expect(listStoredSerpResults(projectDb, runFilter())).toHaveLength(2)
    expect(listPageMarkets(projectDb, 'page-1')[0]?.baselineRunId).toBe('run-resume')
  })

  test('lists and cancels a job started through the check runner', async () => {
    const gate = createGate()
    const httpCalls: string[] = []
    const { handlers, checkEngine, checkDeps } = await seed({
      progress: [],
      beforeRequest: () => gate.beforeRequest(),
      http(request) {
        httpCalls.push(request.url)
        return envelope('google-no-aio.json')
      }
    })
    const runner = createCheckRunner(checkDeps, checkEngine)
    const pending = runner.run(scheduledJob())
    await until(() => gate.pending() === 1)
    const active = await handlers['checks:listActive']({ projectId: 'proj-1' })
    expect(active.map((job) => job.id)).toEqual(['job-scheduled'])
    const cancel = handlers['checks:cancel']({ jobId: 'job-scheduled' })
    await flushMicrotasks()
    gate.release()
    const cancelled = await cancel
    const result = await pending
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.message).toBeNull()
    expect(result).toEqual({ outcome: 'error', message: 'Check cancelled.', searches: [] })
    expect(httpCalls).toEqual([])
    await expect(handlers['checks:listActive']({ projectId: 'proj-1' })).resolves.toEqual([])
  })

  test('a cancelled check runner returns CHECK_CANCELLED_MESSAGE', async () => {
    expect(CHECK_CANCELLED_MESSAGE).toBe('Check cancelled.')
    const gate = createGate()
    const { handlers, checkEngine, checkDeps } = await seed({
      progress: [],
      beforeRequest: () => gate.beforeRequest(),
      http() {
        return envelope('google-no-aio.json')
      }
    })
    const runner = createCheckRunner(checkDeps, checkEngine)
    const pending = runner.run(scheduledJob())
    await until(() => gate.pending() === 1)
    const cancel = handlers['checks:cancel']({ jobId: 'job-scheduled' })
    await flushMicrotasks()
    gate.release()
    await cancel
    const result = await pending
    expect(result).toEqual({
      outcome: 'error',
      message: CHECK_CANCELLED_MESSAGE,
      searches: []
    })
  })

  test('listStoredCheckRuns skips a cancelled run unless that run is requested', async () => {
    const { projectDb } = await seed({
      progress: [],
      http() {
        return envelope('google-no-aio.json')
      }
    })
    plantMixedRuns(projectDb)
    expect(listStoredCheckRuns(projectDb, runFilter()).map((run) => run.id)).toEqual([
      'run-finished',
      'run-error'
    ])
    expect(listStoredCheckRuns(projectDb, runFilter('run-cancelled')).map((run) => run.id)).toEqual(
      ['run-cancelled']
    )
  })

  test('listStoredSerpResults skips a cancelled run unless that run is requested', async () => {
    const { projectDb } = await seed({
      progress: [],
      http() {
        return envelope('google-no-aio.json')
      }
    })
    plantMixedRuns(projectDb)
    expect(listStoredSerpResults(projectDb, runFilter()).map((sample) => sample.runId)).toEqual([
      'run-finished',
      'run-error'
    ])
    expect(listStoredSerpResults(projectDb, runFilter('run-cancelled'))).toHaveLength(1)
  })

  test('listStoredAioReferences skips a cancelled run unless that run is requested', async () => {
    const { projectDb } = await seed({
      progress: [],
      http() {
        return envelope('google-no-aio.json')
      }
    })
    plantMixedRuns(projectDb)
    expect(
      listStoredAioReferences(projectDb, runFilter()).map((reference) => reference.runId)
    ).toEqual(['run-finished', 'run-error'])
    expect(listStoredAioReferences(projectDb, runFilter('run-cancelled'))).toHaveLength(1)
  })

  test('results:history skips a cancelled run', async () => {
    const { handlers, projectDb } = await seed({
      progress: [],
      http() {
        return envelope('google-no-aio.json')
      }
    })
    plantMixedRuns(projectDb)
    const history = await handlers['results:history']({
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: null
    })
    expect(history.points.map((point) => point.runId)).toEqual(['run-finished'])
    const viewed = await handlers['results:get']({
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: null,
      runId: 'run-cancelled'
    })
    expect(viewed.run?.runId).toBe('run-cancelled')
    expect(viewed.run?.status).toBe('cancelled')
  })

  test('scores:listPages skips a cancelled run', async () => {
    const { handlers, projectDb } = await seed({
      progress: [],
      http() {
        return envelope('google-no-aio.json')
      }
    })
    plantMixedRuns(projectDb)
    setPageScore(projectDb, 'page-1', 40)
    expect(listStoredCheckRuns(projectDb, runFilter()).map((run) => run.id)).not.toContain(
      'run-cancelled'
    )
    const pages = await handlers['scores:listPages']({ projectId: 'proj-1' })
    expect(pages.pages[0]).toMatchObject({ pageId: 'page-1', score: 40, change: null })
    const projects = await handlers['scores:listProjects']()
    expect(projects.projects[0]).toMatchObject({ projectId: 'proj-1', change: null })
  })

  test('baseline selection ignores a cancelled run and keeps that row', async () => {
    const httpCalls: string[] = []
    const { handlers, projectDb } = await seed({
      progress: [],
      http(request) {
        httpCalls.push(request.url)
        return envelope('google-no-aio.json')
      }
    })
    plantMixedRuns(projectDb)
    projectDb
      .prepare(`DELETE FROM aio_references WHERE serp_result_id = ?`)
      .run('serp-run-finished')
    projectDb.prepare(`DELETE FROM serp_results WHERE run_id = ?`).run('run-finished')
    projectDb.prepare(`DELETE FROM runs WHERE id = ?`).run('run-finished')
    projectDb
      .prepare(`UPDATE runs SET kind = 'baseline' WHERE id IN ('run-cancelled', 'run-error')`)
      .run()
    expect(listStoredCheckRuns(projectDb, runFilter('run-cancelled'))[0]).toMatchObject({
      id: 'run-cancelled',
      status: 'cancelled',
      kind: 'baseline'
    })
    expect(listPageMarkets(projectDb, 'page-1')[0]?.baselineRunId).toBeNull()
    const job = await handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    expect(job.status).toBe('finished')
    expect(httpCalls).toHaveLength(1)
    const finished = listStoredCheckRuns(projectDb, runFilter()).find((run) => run.jobId === job.id)
    expect(finished).toMatchObject({ status: 'finished', kind: 'baseline' })
    expect(listPageMarkets(projectDb, 'page-1')[0]?.baselineRunId).toBe(finished?.id)
    expect(listStoredCheckRuns(projectDb, runFilter('run-cancelled'))[0]).toMatchObject({
      status: 'cancelled',
      kind: 'baseline'
    })
    expect(
      listStoredCheckRuns(projectDb, runFilter()).some((run) => run.id === 'run-cancelled')
    ).toBe(false)
  })

  test('resume searches the stored prompt set after a newer set is saved', async () => {
    const httpCalls: string[] = []
    const { storage, projectDb, checkEngine } = await seed({
      progress: [],
      secondPrompt: true,
      http(request) {
        httpCalls.push(request.url)
        return envelope('google-no-aio.json')
      }
    })
    leaveNightShiftPending(projectDb, storage)
    projectDb.prepare(`UPDATE pages SET samples = 3 WHERE id = ?`).run('page-1')
    insertPromptSet(
      projectDb,
      {
        id: 'pset-new',
        pageId: 'page-1',
        version: 2,
        savedAt: '2026-10-19T18:00:00.000Z',
        icpId: 'icp-1',
        templateId: 'tpl-buyer-prompts',
        templateName: 'CiteFox default',
        templateHash: contentHash('template'),
        templateUpdatedAt: null,
        prompts: [buyerPrompt('prompt-new', 'What is the weather in Toronto?', true)]
      },
      ['TextBolt']
    )
    const [job] = await resumeInterruptedChecks(checkEngine)
    expect(job?.status).toBe('finished')
    expect(httpCalls.map((url) => new URL(url).searchParams.get('q'))).toEqual([
      'How do I reach the night shift?'
    ])
    expect(listStoredCheckRuns(projectDb, runFilter('run-resume'))[0]).toMatchObject({
      promptSetId: 'pset-1',
      samples: 1
    })
  })

  test('resume stops when the project search cap is already reached', async () => {
    const httpCalls: string[] = []
    const { storage, projectDb, checkEngine } = await seed({
      progress: [],
      secondPrompt: true,
      http(request) {
        httpCalls.push(request.url)
        return envelope('google-no-aio.json')
      }
    })
    leaveNightShiftPending(projectDb, storage)
    writeProjectScheduleCap(projectDb, { cap: 1, capRule: 'pause', dedicatedKeyId: null })
    const [job] = await resumeInterruptedChecks(checkEngine)
    expect(job).toMatchObject({
      id: 'job-resume',
      status: 'error',
      message: "This check would pass the project's search cap.",
      nextStep: expect.stringContaining('Checks for this project pause until the cap resets on'),
      searchesUsed: 1
    })
    expect(httpCalls).toEqual([])
    expect(listStoredCheckRuns(projectDb, runFilter('run-resume'))[0]?.status).toBe('error')
    expect(
      storage.db.prepare('SELECT COALESCE(SUM(searches), 0) AS searches FROM key_usage').get()
    ).toEqual({ searches: 1 })
  })

  test('a scheduled check does not start a page whose check job is still running', async () => {
    const httpCalls: string[] = []
    const gate = createGate()
    const { storage, projectDb, checkEngine } = await seed({
      progress: [],
      secondPrompt: true,
      beforeRequest: () => gate.beforeRequest(),
      http(request) {
        httpCalls.push(request.url)
        return envelope('google-no-aio.json')
      }
    })
    leaveNightShiftPending(projectDb, storage)
    expect(checkEngine.pageRunning('proj-1', 'page-1')).toBe(false)
    const due: DuePage = {
      projectId: 'proj-1',
      pageId: 'page-1',
      label: 'Alerts',
      title: 'Alerts',
      url: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
      marketIds: ['mkt-us'],
      dueAt: NOW,
      intervalDays: 14,
      reason: 'scheduled',
      promptIds: null
    }
    const queue = createCheckQueue({
      clock: { now: () => Date.parse(NOW) },
      timeZone: 'UTC',
      keys: [],
      projects: [],
      pageRunning: (projectId, pageId) => checkEngine.pageRunning(projectId, pageId)
    })
    const pending = resumeInterruptedChecks(checkEngine)
    await until(() => gate.pending() === 1)
    expect(checkEngine.pageRunning('proj-1', 'page-1')).toBe(true)
    const pass = queue.checkDue({ day: '2026-10-19', pages: [due] })
    expect(pass.jobIds).toEqual([])
    expect(queue.status().waiting).toBe(0)
    expect(queue.dequeue()).toEqual({ ok: false, reason: 'empty' })
    gate.release()
    const [job] = await pending
    expect(job?.status).toBe('finished')
    expect(httpCalls).toHaveLength(1)
    expect(queue.status()).toMatchObject({ waiting: 0, running: 0 })
  })

  test('a resume that throws for a job leaves that page idle', async () => {
    const { projectDb, checkEngine } = await seed({
      progress: [],
      http() {
        return envelope('google-no-aio.json')
      }
    })
    insertStoredCheckJob(projectDb, {
      id: 'job-throw',
      startedAt: NOW,
      status: 'running',
      pageIds: ['page-missing'],
      marketIds: null,
      promptIds: null,
      reason: 'manual',
      message: null,
      nextStep: null
    })
    expect(checkEngine.pageRunning('proj-1', 'page-missing')).toBe(false)
    const resumed = await resumeInterruptedChecks(checkEngine)
    expect(resumed.map((job) => job.id)).not.toContain('job-throw')
    expect(readStoredCheckJob(projectDb, 'job-throw')).toMatchObject({
      status: 'error',
      message: 'Unknown page'
    })
    expect(checkEngine.pageRunning('proj-1', 'page-missing')).toBe(false)
  })
})
