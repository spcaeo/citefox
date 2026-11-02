import { describe, expect, test } from 'vitest'
import { createCheckQueue } from '../queue/check-queue'
import { fixtureCheckRunner } from '../queue/runner'
import type { QueueKeyInput, QueueProjectInput } from '../queue/types'
import { manualClock } from '../scheduler/clock'
import { planSchedule } from '../scheduler/due'
import type { ScheduledPageInput, ScheduledProjectInput, TopicBatchInput } from '../scheduler/types'
import { defaultAppSchedule } from '../storage/settings'
import { CHECK_DUE_EXIT_CAP, CHECK_DUE_EXIT_OK, runCheckDue } from './index'
import type { CheckCatalog } from './check-due'

/**
 * Staggered topic batches run from the due planner and the queue, so the closed-app
 * `citefox --check-due` pass and the window's due pass treat them alike: one due
 * item per batch with its prompts, quiet hours, pause, caps and the once-a-day pass.
 */

const NOON = Date.parse('2026-04-20T12:00:00.000Z')
const CHECKED = '2026-04-19T08:00:00.000Z'

function topic(patch: Partial<ScheduledPageInput> = {}): ScheduledPageInput {
  return {
    projectId: 'proj-1',
    pageId: 'topic-1',
    label: 'Text alerts for teams',
    title: 'Text alerts for teams',
    url: null,
    status: 'tracked',
    intervalDays: 14,
    promptSetVersion: 1,
    markets: [{ marketId: 'us', lastCheckedAt: CHECKED, firstCheckNotBefore: null }],
    ...patch
  }
}

function project(patch: Partial<ScheduledProjectInput> = {}): ScheduledProjectInput {
  return {
    projectId: 'proj-1',
    defaultIntervalDays: 14,
    dailyCheckTime: '08:00',
    quietFrom: null,
    quietUntil: null,
    spreadAcrossDay: false,
    catchUp: true,
    paused: false,
    archived: false,
    nextCheckAt: null,
    pagesDueToday: 0,
    ...patch
  }
}

function batch(patch: Partial<TopicBatchInput> = {}): TopicBatchInput {
  return {
    id: 'batch-1',
    projectId: 'proj-1',
    pageId: 'topic-1',
    dueAt: '2026-04-20T09:00:00.000Z',
    marketIds: ['us'],
    promptIds: ['prompt-7', 'prompt-8'],
    ...patch
  }
}

const KEY: QueueKeyInput = {
  keyId: 'key-1',
  name: 'Primary',
  provider: 'serpapi',
  cap: null,
  planLimit: null,
  state: 'ok',
  rotationOrder: 1,
  projectIds: []
}

function queueProject(patch: Partial<QueueProjectInput> = {}): QueueProjectInput {
  return {
    projectId: 'proj-1',
    name: 'TextBolt',
    cap: null,
    capRule: 'pause',
    dedicatedKeyId: null,
    paused: false,
    ...patch
  }
}

function catalog(
  batches: readonly TopicBatchInput[],
  projects = [project()],
  pages = [topic()]
): CheckCatalog {
  return { app: defaultAppSchedule(), projects, pages, followUps: [], topicBatches: batches }
}

describe('staggered topic batches in the due planner', () => {
  test('a batch whose day has come is one due item with its prompts; a later one waits', () => {
    const plan = planSchedule(
      catalog([
        batch(),
        batch({ id: 'batch-2', dueAt: '2026-04-21T09:00:00.000Z', promptIds: ['prompt-9'] })
      ]),
      NOON,
      'UTC'
    )
    expect(plan.due.pages).toEqual([
      expect.objectContaining({
        pageId: 'topic-1',
        url: null,
        reason: 'scheduled',
        promptIds: ['prompt-7', 'prompt-8'],
        topicBatchId: 'batch-1',
        marketIds: ['us']
      })
    ])
    expect(plan.projects[0]?.pagesDueToday).toBe(1)
  })

  test('paused or archived projects, untracked topics and removed markets run nothing', () => {
    expect(
      planSchedule(catalog([batch()], [project({ paused: true })]), NOON, 'UTC').due.pages
    ).toEqual([])
    expect(
      planSchedule(catalog([batch()], [project({ archived: true })]), NOON, 'UTC').due.pages
    ).toEqual([])
    expect(
      planSchedule(catalog([batch()], [project()], [topic({ status: 'paused' })]), NOON, 'UTC').due
        .pages
    ).toEqual([])
    expect(planSchedule(catalog([batch({ marketIds: ['mx'] })]), NOON, 'UTC').due.pages).toEqual([])
  })

  test('quiet hours hold a batch until they end', () => {
    const quiet = project({ quietFrom: '11:00', quietUntil: '13:00' })
    const plan = planSchedule(
      catalog([batch({ dueAt: '2026-04-20T11:30:00.000Z' })], [quiet]),
      NOON,
      'UTC'
    )
    expect(plan.due.pages[0]?.dueAt).toBe('2026-04-20T13:00:00.000Z')
  })
})

describe('citefox --check-due runs topic batches', () => {
  test('the batch runs once through the queue with only its prompts', async () => {
    const clock = manualClock(NOON)
    const queue = createCheckQueue({
      clock,
      timeZone: 'UTC',
      keys: [KEY],
      projects: [queueProject()]
    })
    const runner = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [{ slotId: 's1' }] }))
    const input = {
      clock,
      timeZone: 'UTC',
      runner,
      catalog: catalog([batch()]),
      queue,
      keys: [KEY],
      queueProjects: [queueProject()]
    }
    const first = await runCheckDue(input)
    expect(first.exitCode).toBe(CHECK_DUE_EXIT_OK)
    expect(runner.jobs).toHaveLength(1)
    expect(runner.jobs[0]).toMatchObject({
      pageId: 'topic-1',
      promptIds: ['prompt-7', 'prompt-8'],
      topicBatchId: 'batch-1',
      partial: true
    })
    const second = await runCheckDue(input)
    expect(second.stop).toBe('already_ran')
    expect(runner.jobs).toHaveLength(1)
  })

  test('a batch and the topic’s own scheduled check are separate items', async () => {
    const clock = manualClock(NOON)
    const queue = createCheckQueue({
      clock,
      timeZone: 'UTC',
      keys: [KEY],
      projects: [queueProject()]
    })
    const runner = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [] }))
    const due = topic({
      markets: [
        { marketId: 'us', lastCheckedAt: '2026-04-01T08:00:00.000Z', firstCheckNotBefore: null }
      ]
    })
    await runCheckDue({
      clock,
      timeZone: 'UTC',
      runner,
      catalog: catalog([batch()], [project()], [due]),
      queue,
      keys: [KEY],
      queueProjects: [queueProject()]
    })
    expect(runner.jobs.map((job) => job.promptIds)).toEqual(
      expect.arrayContaining([null, ['prompt-7', 'prompt-8']])
    )
  })

  test('a project at its search cap stops before the batch (cap exit)', async () => {
    const clock = manualClock(NOON)
    const capped = queueProject({ cap: 0, capRule: 'pause' })
    const queue = createCheckQueue({ clock, timeZone: 'UTC', keys: [KEY], projects: [capped] })
    const runner = fixtureCheckRunner(() => ({ outcome: 'ok', searches: [] }))
    const result = await runCheckDue({
      clock,
      timeZone: 'UTC',
      runner,
      catalog: catalog([batch()]),
      queue,
      keys: [KEY],
      queueProjects: [capped],
      estimateSearches: () => 4
    })
    expect(runner.jobs).toEqual([])
    expect(result.exitCode).toBe(CHECK_DUE_EXIT_CAP)
  })
})
