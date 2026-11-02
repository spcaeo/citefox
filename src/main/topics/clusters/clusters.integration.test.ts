import type { QuestionRow } from '@shared/ipc'
import { afterEach, describe, expect, test } from 'vitest'
import { closeSeeds, seed, snapshot } from '../../engine/checks/checks.test-helper'
import {
  finishStoredRun,
  insertStoredCheckJob,
  insertStoredRun,
  insertStoredSerpResult
} from '../../storage/check-records'
import type { SqliteDatabase } from '../../storage/database'
import { getPageMarketFirstCheckNotBefore } from '../../storage/pages'
import { getProject } from '../../storage/records'
import { seedTextboltTopic } from '../fixture-seed'
import { insertTopicBatches, listTopicBatches } from '../records'

afterEach(() => {
  closeSeeds()
})

const PAGE_URL = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'

/** One finished check of page-1 where prompt-1 is cited at #1. */
function plantCitedRun(db: SqliteDatabase): void {
  insertStoredCheckJob(db, {
    id: 'job-run-a',
    startedAt: '2026-10-01T09:00:00.000Z',
    status: 'running',
    pageIds: ['page-1'],
    marketIds: ['mkt-us'],
    promptIds: null,
    reason: 'manual',
    message: null,
    nextStep: null
  })
  insertStoredRun(db, {
    id: 'run-a',
    jobId: 'job-run-a',
    pageId: 'page-1',
    promptSetId: 'pset-1',
    snapshotId: 'snap-1',
    marketId: 'mkt-us',
    startedAt: '2026-10-01T09:00:00.000Z',
    kind: 'manual',
    partial: false,
    samples: 1,
    contentHash: snapshot().contentHash
  })
  insertStoredSerpResult(db, {
    id: 'serp-run-a-prompt-1',
    runId: 'run-a',
    promptId: 'prompt-1',
    sampleNo: 1,
    keyId: null,
    hasAio: true,
    neededFollowup: false,
    searches: 1,
    status: 'page_cited',
    named: true,
    citedUrl: PAGE_URL,
    position: 1,
    aioText: 'An overview.',
    errorCode: null,
    message: null,
    nextStep: null,
    rawSearchJson: '{}',
    rawAioJson: null,
    references: [
      {
        id: 'ref-a1',
        position: 1,
        url: PAGE_URL,
        normalizedUrl: PAGE_URL,
        domain: 'textbolt.com',
        title: null,
        classification: 'target',
        untracked: false,
        sourceType: 'web'
      }
    ]
  })
  finishStoredRun(db, 'run-a', '2026-10-01T09:01:00.000Z', 'finished')
}

async function seeded(): Promise<Awaited<ReturnType<typeof seed>> & { topicId: string }> {
  const seededProject = await seed({
    progress: [],
    secondPage: true,
    secondPrompt: true,
    http: () => ({ status: 500, body: '{}' })
  })
  plantCitedRun(seededProject.projectDb)
  const project = getProject(seededProject.storage.db, 'proj-1')
  if (project === null) throw new Error('no project')
  const { topicId } = seedTextboltTopic(seededProject.projectDb, project)
  return { ...seededProject, topicId }
}

type Seeded = Awaited<ReturnType<typeof seeded>>

async function rows(handlers: Seeded['handlers']): Promise<readonly QuestionRow[]> {
  return (await handlers['questions:list']({ projectId: 'proj-1' })).rows
}

function jobCount(db: SqliteDatabase): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM check_jobs').get() as { n: number }).n
}

describe('topics:moveQuestions', () => {
  test('moves a page question into a topic and keeps its history and target page', async () => {
    const { handlers, topicId, projectDb } = await seeded()
    const jobs = jobCount(projectDb)
    const result = await handlers['topics:moveQuestions']({
      projectId: 'proj-1',
      items: [{ sourceId: 'page-1', promptId: 'prompt-1' }],
      to: { kind: 'topic', topicId }
    })
    expect(result.moved).toBe(1)
    expect(result.skipped).toEqual([])
    expect(result.topicId).toBe(topicId)
    expect(result.message).toMatch(/^Moved 1 question to /u)
    const to = result.promptIds[0]?.to ?? ''

    const list = await rows(handlers)
    const moved = list.find((row) => row.promptId === to)
    expect(moved).toMatchObject({
      sourceId: topicId,
      text: 'How do I alert the crew?',
      targetPageId: 'page-1',
      targetUrl: PAGE_URL,
      result: 'cited',
      runId: 'run-a',
      resultPageId: 'page-1',
      resultPromptId: 'prompt-1'
    })
    // The page keeps its other question; the moved one is no longer on it.
    expect(list.filter((row) => row.sourceId === 'page-1').map((row) => row.text)).toEqual([
      'How do I reach the night shift?'
    ])
    // Nothing was searched.
    expect(jobCount(projectDb)).toBe(jobs)
  })

  test('a page keeps at least one question', async () => {
    const { handlers, topicId } = await seeded()
    const result = await handlers['topics:moveQuestions']({
      projectId: 'proj-1',
      items: [{ sourceId: 'page-2', promptId: 'prompt-2b' }],
      to: { kind: 'topic', topicId }
    })
    expect(result.moved).toBe(0)
    expect(result.skipped).toEqual([
      { promptId: 'prompt-2b', reason: expect.stringMatching(/keeps at least one question/u) }
    ])
    expect(result.message).toMatch(/^Nothing moved\. 1 question stayed/u)
  })

  test('skips a question already in the topic and an older version', async () => {
    const { handlers, topicId } = await seeded()
    const list = await rows(handlers)
    const inTopic = list.find((row) => row.sourceId === topicId)
    if (inTopic === undefined) throw new Error('no topic row')
    const result = await handlers['topics:moveQuestions']({
      projectId: 'proj-1',
      items: [
        { sourceId: topicId, promptId: inTopic.promptId },
        { sourceId: 'page-1', promptId: 'prompt-gone' }
      ],
      to: { kind: 'topic', topicId }
    })
    expect(result.moved).toBe(0)
    expect(result.skipped.map((item) => item.reason).sort()).toEqual([
      expect.stringMatching(/^Already in /u),
      expect.stringMatching(/older version/u)
    ])
  })

  test('a new topic from selected questions is saved unchecked with its interval held', async () => {
    const { handlers, projectDb, topicId } = await seeded()
    const list = await rows(handlers)
    const fromTopic = list.filter((row) => row.sourceId === topicId).slice(0, 2)
    const jobs = jobCount(projectDb)
    const result = await handlers['topics:moveQuestions']({
      projectId: 'proj-1',
      items: [
        { sourceId: 'page-1', promptId: 'prompt-1' },
        ...fromTopic.map((row) => ({ sourceId: row.sourceId, promptId: row.promptId }))
      ],
      to: { kind: 'new', name: 'Crew alerts' }
    })
    expect(result.moved).toBe(3)
    const newId = result.topicId ?? ''
    expect(newId).not.toBe('')
    const topics = await handlers['topics:list']({ projectId: 'proj-1' })
    expect(topics.topics.map((topic) => topic.name)).toContain('Crew alerts')
    expect(getPageMarketFirstCheckNotBefore(projectDb, newId, 'mkt-us')).not.toBeNull()
    expect(jobCount(projectDb)).toBe(jobs)

    const after = await rows(handlers)
    const inNew = after.filter((row) => row.sourceId === newId)
    expect(inNew).toHaveLength(3)
    // The topic questions keep their stage; the page question keeps its page as target.
    for (const row of fromTopic) {
      expect(inNew.find((item) => item.text === row.text)?.stage).toBe(row.stage)
    }
    expect(inNew.find((row) => row.text === 'How do I alert the crew?')).toMatchObject({
      targetPageId: 'page-1',
      result: 'cited',
      resultPageId: 'page-1'
    })
    // The old topic lost the two questions.
    expect(after.filter((row) => row.sourceId === topicId)).toHaveLength(
      list.filter((row) => row.sourceId === topicId).length - 2
    )
  })

  test('moves a topic question back to its target page', async () => {
    const { handlers, topicId } = await seeded()
    const first = await handlers['topics:moveQuestions']({
      projectId: 'proj-1',
      items: [{ sourceId: 'page-1', promptId: 'prompt-1' }],
      to: { kind: 'topic', topicId }
    })
    const inTopic = first.promptIds[0]?.to ?? ''
    const back = await handlers['topics:moveQuestions']({
      projectId: 'proj-1',
      items: [{ sourceId: topicId, promptId: inTopic }],
      to: { kind: 'page' }
    })
    expect(back.moved).toBe(1)
    expect(back.topicId).toBeNull()
    const list = await rows(handlers)
    const row = list.find((item) => item.promptId === back.promptIds[0]?.to)
    expect(row).toMatchObject({
      sourceId: 'page-1',
      text: 'How do I alert the crew?',
      result: 'cited',
      resultPromptId: 'prompt-1'
    })
  })

  test('a topic question with no tracked target cannot go back to a page', async () => {
    const { handlers, topicId } = await seeded()
    const list = await rows(handlers)
    const orphan = list.find((row) => row.sourceId === topicId && row.targetPageId === null)
    if (orphan === undefined) throw new Error('no untargeted topic row')
    const result = await handlers['topics:moveQuestions']({
      projectId: 'proj-1',
      items: [{ sourceId: topicId, promptId: orphan.promptId }],
      to: { kind: 'page' }
    })
    expect(result.moved).toBe(0)
    expect(result.skipped[0]?.reason).toMatch(/no tracked target page/u)
  })

  test('waiting batches stop checking a moved question', async () => {
    const { handlers, topicId, projectDb } = await seeded()
    const keys = projectDb
      .prepare<unknown[], { prompt_id: string; stable_key: string }>(
        `SELECT tp.prompt_id, tp.stable_key FROM topic_prompts tp
           JOIN prompts p ON p.id = tp.prompt_id
           JOIN prompt_sets s ON s.id = p.prompt_set_id AND s.is_active = 1
          WHERE tp.page_id = ? ORDER BY p.position LIMIT 2`
      )
      .all(topicId)
    const [a, b] = keys
    if (a === undefined || b === undefined) throw new Error('topic has too few questions')
    insertTopicBatches(projectDb, [
      {
        id: 'batch-x',
        pageId: topicId,
        batchNo: 90,
        marketIds: ['mkt-us'],
        promptKeys: [a.stable_key, b.stable_key],
        dueAt: '2026-11-01T00:00:00.000Z',
        jobId: null,
        startedAt: null,
        cancelledAt: null
      },
      {
        id: 'batch-y',
        pageId: topicId,
        batchNo: 91,
        marketIds: ['mkt-us'],
        promptKeys: [a.stable_key],
        dueAt: '2026-11-02T00:00:00.000Z',
        jobId: null,
        startedAt: null,
        cancelledAt: null
      }
    ])
    await handlers['topics:moveQuestions']({
      projectId: 'proj-1',
      items: [{ sourceId: topicId, promptId: a.prompt_id }],
      to: { kind: 'new', name: 'Elsewhere' }
    })
    const batches = listTopicBatches(projectDb, topicId)
    expect(batches.find((batch) => batch.id === 'batch-x')?.promptKeys).toEqual([b.stable_key])
    expect(batches.find((batch) => batch.id === 'batch-y')?.cancelledAt).not.toBeNull()
  })
})

describe('topics:setQuestionStage', () => {
  test('sets the stage of topic questions and skips page questions', async () => {
    const { handlers, topicId } = await seeded()
    const list = await rows(handlers)
    const target = list.find((row) => row.sourceId === topicId && row.stage !== 'decide')
    if (target === undefined) throw new Error('no topic row')
    const result = await handlers['topics:setQuestionStage']({
      projectId: 'proj-1',
      items: [
        { sourceId: topicId, promptId: target.promptId },
        { sourceId: 'page-1', promptId: 'prompt-1' }
      ],
      stage: 'decide'
    })
    expect(result.changed).toBe(1)
    expect(result.skipped).toEqual([
      { promptId: 'prompt-1', reason: expect.stringMatching(/Only a question in a topic/u) }
    ])
    expect(result.message).toMatch(/^Set 1 question to Decide\./u)
    const after = await rows(handlers)
    expect(after.find((row) => row.promptId === target.promptId)?.stage).toBe('decide')
  })
})

describe('topics:merge and topics:split', () => {
  test('merge moves every question across and removes the merged topic', async () => {
    const { handlers, topicId } = await seeded()
    const made = await handlers['topics:moveQuestions']({
      projectId: 'proj-1',
      items: [{ sourceId: 'page-1', promptId: 'prompt-1' }],
      to: { kind: 'new', name: 'Crew alerts' }
    })
    const smallId = made.topicId ?? ''
    const merged = await handlers['topics:merge']({
      projectId: 'proj-1',
      topicId: smallId,
      intoTopicId: topicId
    })
    expect(merged.moved).toBe(1)
    expect(merged.message).toMatch(/^Merged Crew alerts into .+: moved 1 question\.$/u)
    const topics = await handlers['topics:list']({ projectId: 'proj-1' })
    expect(topics.topics.find((topic) => topic.id === smallId)?.status ?? 'removed').toBe('removed')
    const list = await rows(handlers)
    expect(list.find((row) => row.text === 'How do I alert the crew?')?.sourceId).toBe(topicId)
  })

  test('merge refuses the same topic', async () => {
    const { handlers, topicId } = await seeded()
    await expect(
      handlers['topics:merge']({ projectId: 'proj-1', topicId, intoTopicId: topicId })
    ).rejects.toThrow(/another topic/u)
  })

  test('split makes one topic per other stage and keeps the biggest stage', async () => {
    const { handlers, topicId } = await seeded()
    const before = (await rows(handlers)).filter((row) => row.sourceId === topicId)
    const stages = new Map<string, number>()
    for (const row of before) {
      if (row.stage !== null) stages.set(row.stage, (stages.get(row.stage) ?? 0) + 1)
    }
    const result = await handlers['topics:split']({ projectId: 'proj-1', topicId })
    expect(result.topics).toHaveLength(stages.size - 1)
    const movedOut = result.topics.reduce((sum, topic) => sum + topic.questions, 0)
    expect(result.kept + movedOut).toBe(before.length)
    const after = await rows(handlers)
    const keptStages = new Set(
      after.filter((row) => row.sourceId === topicId && row.stage !== null).map((row) => row.stage)
    )
    expect(keptStages.size).toBe(1)
    for (const topic of result.topics) {
      expect(topic.name).toMatch(/ · /u)
      expect(after.filter((row) => row.sourceId === topic.topicId)).toHaveLength(topic.questions)
    }
  })
})

describe('topics:createTopics and topics:createFromDraft', () => {
  test('creates one topic per idea with draft questions and nothing searched', async () => {
    const { handlers, projectDb } = await seeded()
    const jobs = jobCount(projectDb)
    const result = await handlers['topics:createTopics']({
      projectId: 'proj-1',
      topics: [
        {
          name: 'Shift alerts',
          situation: 'A plant manager needs to reach the night shift fast.',
          questions: [
            { text: 'How do I text every worker on a shift at once?', stage: 'problem' },
            { text: 'What is the best mass texting tool for factories?', stage: 'options' },
            { text: 'How do I text every worker on a shift at once?', stage: 'problem' }
          ],
          targetUrl: PAGE_URL
        }
      ]
    })
    expect(result.topicIds).toHaveLength(1)
    expect(result.questions).toBe(2)
    expect(result.message).toMatch(/Nothing is checked until you press Check now/u)
    expect(jobCount(projectDb)).toBe(jobs)
    const list = await rows(handlers)
    const made = list.filter((row) => row.sourceId === result.topicIds[0])
    expect(made.map((row) => row.stage)).toEqual(['problem', 'options'])
    expect(made.every((row) => row.targetPageId === 'page-1')).toBe(true)
    expect(made.every((row) => row.result === 'not_checked')).toBe(true)
  })

  test('saves a draft as a topic and moves in tracked questions', async () => {
    const { handlers } = await seeded()
    const draft = await handlers['topics:createDraft']({
      projectId: 'proj-1',
      path: 'questions',
      name: 'Night shift'
    })
    await handlers['topics:updateDraft']({
      projectId: 'proj-1',
      draftId: draft.id,
      patch: {
        upsertPrompts: [
          { kind: 'question', text: 'How do I reach workers after hours?', stage: 'problem' }
        ]
      }
    })
    const result = await handlers['topics:createFromDraft']({
      projectId: 'proj-1',
      draftId: draft.id,
      moveIn: [{ sourceId: 'page-1', promptId: 'prompt-2' }]
    })
    expect(result).toMatchObject({ questions: 1, moved: 1 })
    const list = await rows(handlers)
    expect(
      list
        .filter((row) => row.sourceId === result.topicId)
        .map((row) => row.text)
        .sort()
    ).toEqual(['How do I reach the night shift?', 'How do I reach workers after hours?'])
    await expect(
      handlers['topics:createFromDraft']({ projectId: 'proj-1', draftId: draft.id })
    ).rejects.toThrow(/already saved/u)
  })
})
