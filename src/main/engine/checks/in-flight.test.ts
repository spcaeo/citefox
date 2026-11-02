import { afterEach, describe, expect, test } from 'vitest'
import type { CheckInFlightItem, CheckJob, CheckProgress } from '@shared/ipc'
import type { HttpRequest, HttpResponse } from '../../providers/http'
import { savePageEngines } from '../../storage/engine-records'
import { closeSeeds, envelope, NOW, seed } from './checks.test-helper'
import {
  addCloroKey,
  citingAnswer,
  cloroEngineOf,
  cloroFixture,
  cloroResponse
} from './engines.test-helper'

afterEach(() => {
  closeSeeds()
})

type Seeded = Awaited<ReturnType<typeof seed>>

const QUESTIONS = Array.from(
  { length: 7 },
  (_, index) => `How do I text crew number ${index + 1} about a shift change?`
)

/**
 * The running list in `checks:progress` (owner, 2026-10-29: "if there are three
 * processes, why don't we show these three", "what is that searching?"): each running
 * question with its Q/K number, its words, and its engines ticked as they answer.
 */

/** SerpApi with no AI Overview, each call held a few ms so the questions overlap. */
async function slowSerp(): Promise<HttpResponse> {
  await new Promise((resolve) => setTimeout(resolve, 5))
  return envelope('google-no-aio.json')
}

async function startTopic(seeded: Seeded, topic: { id: string }): Promise<string> {
  const base = { projectId: 'proj-1' }
  const draft = await seeded.handlers['topics:createDraft']({
    ...base,
    path: 'questions',
    name: 'Crew'
  })
  await seeded.handlers['topics:importQuestions']({
    ...base,
    draftId: draft.id,
    text: QUESTIONS.join('\n')
  })
  const started = await seeded.handlers['topics:start']({
    ...base,
    draftId: draft.id,
    plan: 'all_now'
  })
  topic.id = started.topicId
  return started.jobId ?? ''
}

async function waitForJob(seeded: Seeded, jobId: string): Promise<CheckJob | null> {
  let job = await seeded.handlers['checks:get']({ jobId })
  for (let attempt = 0; attempt < 600 && (job === null || job.status === 'running'); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    job = await seeded.handlers['checks:get']({ jobId })
  }
  return job
}

function label(item: Pick<CheckInFlightItem, 'kind' | 'number'>): string {
  return `${item.kind === 'question' ? 'Q' : 'K'}${item.number}`
}

describe('the check names the questions it is searching now', () => {
  test('up to three at once, numbered like the topic screen, each with its words', async () => {
    const progress: CheckProgress[] = []
    const seeded = await seed({ progress, http: slowSerp })
    const topic = { id: '' }
    const job = await waitForJob(seeded, await startTopic(seeded, topic))
    expect(job).toMatchObject({ status: 'finished', done: 7 })

    // The count and the list always agree, and never pass the pool's three.
    for (const event of progress) {
      expect(event.inFlightItems?.length ?? 0).toBe(event.inFlight ?? 0)
    }
    const lists = progress.map((event) => (event.inFlightItems ?? []).map(label))
    expect(Math.max(...lists.map((list) => list.length))).toBe(3)
    expect(lists).toContainEqual(['Q1', 'Q2', 'Q3'])
    // Every question was named once it ran, with the exact words searched.
    const seen = new Map<string, CheckInFlightItem>()
    for (const event of progress)
      for (const item of event.inFlightItems ?? []) seen.set(label(item), item)
    expect([...seen.keys()].sort()).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7'])
    for (const item of seen.values()) {
      expect(item.text).toBe(QUESTIONS[item.number - 1])
      expect(item).toMatchObject({ pageId: topic.id, kind: 'question' })
      expect(Number.isNaN(Date.parse(item.startedAt))).toBe(false)
    }
    // Google AI Overview is asked, then ticked: no overview is an answer, not a wait.
    const engines = progress.flatMap((event) =>
      (event.inFlightItems ?? []).map((item) => item.engines)
    )
    expect(engines).toContainEqual([{ engine: 'google_aio', status: null }])
    expect(engines).toContainEqual([{ engine: 'google_aio', status: 'no_answer' }])
    // The purpose line's domain, and the last one scored with its result.
    const running = progress.filter((event) => event.inFlightItems !== undefined)
    expect(running.every((event) => event.domain === 'textbolt.com')).toBe(true)
    const last = progress.at(-1)
    expect(last?.inFlightItems).toBeUndefined()
    expect(last?.lastDone).toMatchObject({ kind: 'question', number: 7, cited: false })
  })

  test('keywords are numbered apart from questions (K1, K2, then Q1…)', async () => {
    const progress: CheckProgress[] = []
    const seeded = await seed({ progress, http: slowSerp })
    const topic = { id: '' }
    await waitForJob(seeded, await startTopic(seeded, topic))
    // The first two become keywords, as a topic with both lists them.
    seeded.projectDb
      .prepare(
        `UPDATE topic_prompts SET kind = 'keyword' WHERE prompt_id IN (
           SELECT id FROM prompts WHERE position <= 2 AND prompt_set_id IN (
             SELECT id FROM prompt_sets WHERE page_id = ? AND is_active = 1))`
      )
      .run(topic.id)
    progress.length = 0
    const job = await seeded.handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: [topic.id],
      marketIds: null,
      promptIds: null
    })
    await waitForJob(seeded, job.id)
    const seen = new Map<string, string>()
    for (const event of progress) {
      for (const item of event.inFlightItems ?? []) seen.set(label(item), item.text)
    }
    expect(Object.fromEntries(seen)).toEqual({
      K1: QUESTIONS[0],
      K2: QUESTIONS[1],
      Q1: QUESTIONS[2],
      Q2: QUESTIONS[3],
      Q3: QUESTIONS[4],
      Q4: QUESTIONS[5],
      Q5: QUESTIONS[6]
    })
  })

  test('each engine is ticked the moment it answers', async () => {
    const progress: CheckProgress[] = []
    let releaseGoogle: () => void = () => undefined
    const googleHeld = new Promise<void>((resolve) => {
      releaseGoogle = resolve
    })
    const NIGHT = 'How do I reach the night shift?'
    const seeded = await seed({
      progress,
      secondPrompt: true,
      sleep: async () => undefined,
      async http(request: HttpRequest) {
        const body = JSON.parse(request.body ?? '{}') as { query?: string }
        if (cloroEngineOf(request) === 'google_aio') {
          // The job's first call goes alone, so only the second question's Google waits.
          if (body.query === NIGHT) await googleHeld
          return cloroResponse(cloroFixture('google-overview.json'), 9)
        }
        return cloroResponse(citingAnswer(), 5)
      }
    })
    addCloroKey(seeded.storage, seeded.checkDeps.secrets)
    savePageEngines(seeded.projectDb, 'page-1', ['google_aio', 'chatgpt'], NOW)
    const pending = seeded.handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    const night = (event: CheckProgress): CheckInFlightItem | undefined =>
      event.inFlightItems?.find((item) => item.promptId === 'prompt-2')
    const chatgptIn = (): CheckProgress | undefined =>
      progress.find((event) =>
        night(event)?.engines.some((entry) => entry.engine === 'chatgpt' && entry.status !== null)
      )
    for (let turn = 0; turn < 200 && chatgptIn() === undefined; turn += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    // ChatGPT is in and cited us; Google is still out, and the words say so.
    const event = chatgptIn()
    expect(event).toMatchObject({
      promptId: 'prompt-2',
      phase: 'search',
      state: 'running',
      detail: 'Searching Google',
      promptText: NIGHT
    })
    expect(night(event as CheckProgress)).toMatchObject({
      kind: 'question',
      number: 2,
      text: NIGHT,
      engines: [
        { engine: 'google_aio', status: null },
        { engine: 'chatgpt', status: 'cited' }
      ]
    })
    releaseGoogle()
    const job = await pending
    expect(job.status).toBe('finished')
    // Google ticked before the question left the list, then "Q2 cited".
    expect(
      progress.some((item) => night(item)?.engines.every((entry) => entry.status !== null))
    ).toBe(true)
    expect(progress.at(-1)?.lastDone).toMatchObject({ promptId: 'prompt-2', cited: true })
  })
})
