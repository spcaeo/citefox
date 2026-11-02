import { afterEach, describe, expect, test } from 'vitest'
import type {
  CheckJob,
  CheckProgress,
  QuestionsList,
  ResultsChanged,
  StartCheckRequest,
  TopicResults,
  VisibilityOverview
} from '@shared/ipc'
import { citationNews } from './citation-news'
import { closeSeeds, envelope, seed } from './checks.test-helper'

afterEach(closeSeeds)

const QUESTIONS = [
  'How do I send an urgent text to my whole field crew from Outlook?',
  'What is the cheapest way to text forty employees a schedule change?',
  'Can I text a crew from Nagios when a check fails?'
]

function fixtureHttp(request: { url: string }): ReturnType<typeof envelope> {
  const url = new URL(request.url)
  return url.searchParams.get('engine') === 'google_ai_overview'
    ? envelope('google-ai-overview.json')
    : envelope('google-page-token.json')
}

/**
 * Live results (owner, 2026-10-29): each question's result shows while the check runs.
 * The engine pushes `results:changed` per saved question and keeps the job's spend
 * current; topics, Questions and Summary read the questions done so far.
 */
describe('results while a check runs', () => {
  test('pushes one results:changed per saved question and keeps the job spend current', async () => {
    const changed: ResultsChanged[] = []
    const spentBySecondSearch: number[] = []
    let projectDb: Awaited<ReturnType<typeof seed>>['projectDb'] | null = null
    const seeded = await seed({
      progress: [],
      changed,
      secondPrompt: true,
      http(request) {
        const url = new URL(request.url)
        if (url.searchParams.get('q') === 'How do I reach the night shift?' && projectDb) {
          const row = projectDb
            .prepare<unknown[], { searches_used: number }>(
              "SELECT searches_used FROM check_jobs WHERE status = 'running'"
            )
            .get()
          spentBySecondSearch.push(row?.searches_used ?? -1)
        }
        return fixtureHttp(request)
      }
    })
    projectDb = seeded.projectDb
    const job = await seeded.handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    expect(job.status).toBe('finished')
    expect(changed.map((event) => [event.state, event.promptId, event.done])).toEqual([
      ['running', 'prompt-1', 1],
      ['running', 'prompt-2', 2],
      ['finished', null, 2]
    ])
    expect(changed.map((event) => event.citation ?? null)).toEqual([
      {
        kind: 'cited',
        brand: 'TextBolt',
        promptText: 'How do I alert the crew?',
        position: 2,
        engine: 'google_aio',
        url: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
        firstEver: true
      },
      expect.objectContaining({ kind: 'cited', promptText: 'How do I reach the night shift?' }),
      null
    ])
    expect(changed.every((event) => event.jobId === job.id && event.total === 2)).toBe(true)
    // The first question's searches were on the job row before the second search ran.
    expect(spentBySecondSearch[0]).toBeGreaterThan(0)
  })

  test('the topic page, Questions and Summary show the questions done so far', async () => {
    const changed: ResultsChanged[] = []
    const progress: CheckProgress[] = []
    let snapshot: Promise<[TopicResults, QuestionsList, VisibilityOverview]> | null = null
    let read: (() => Promise<[TopicResults, QuestionsList, VisibilityOverview]>) | null = null
    const { handlers } = await seed({
      progress,
      changed,
      // The first request after the first question was saved: the second question's search.
      beforeRequest: async () => {
        if (changed.length === 1 && snapshot === null && read !== null) snapshot = read()
        if (snapshot !== null) await snapshot
      },
      http: fixtureHttp
    })
    const base = { projectId: 'proj-1' }
    const draft = await handlers['topics:createDraft']({ ...base, path: 'questions', name: 'Crew' })
    await handlers['topics:importQuestions']({
      ...base,
      draftId: draft.id,
      text: QUESTIONS.join('\n')
    })
    const started = await handlers['topics:start']({ ...base, draftId: draft.id, plan: 'all_now' })
    const topicId = started.topicId
    read = () =>
      Promise.all([
        handlers['topics:results']({ ...base, topicId, marketId: null, runId: null }),
        handlers['questions:list']({ ...base, marketId: null }),
        handlers['visibility:overview']({ ...base, period: '30d', marketId: null })
      ])
    const jobId = started.jobId ?? ''
    await waitForJob(handlers, jobId)
    expect(snapshot).not.toBeNull()
    const [topic, questions, overview] = await (snapshot as unknown as Promise<
      [TopicResults, QuestionsList, VisibilityOverview]
    >)

    // Topic page: the first answer is in (it goes alone), the other two are searched
    // side by side (check-pace.ts), so neither waits.
    expect(topic.live).toMatchObject({
      state: 'running',
      done: 1,
      total: 3,
      questions: { done: 1, total: 3 }
    })
    const states = topic.rows.map((row) => row.live ?? row.state)
    expect(states.filter((state) => state === 'checking')).toHaveLength(2)
    expect(states.filter((state) => state === 'waiting')).toHaveLength(0)
    expect(topic.rows.filter((row) => row.runId !== null)).toHaveLength(1)
    expect(topic.goals.questions.checked).toBe(1)
    expect(topic.goals.questions.withAio).toBe(1)
    // A running check is no Progress point and no comparison yet.
    expect(topic.progress).toEqual([])
    expect(topic.questionsTrend.change).toBeNull()
    expect(topic.topic.checkedAt).toBeNull()

    // Questions: the same row is checked, the others say waiting or checking, never "not cited".
    const mine = questions.rows.filter((row) => row.sourceId === topicId)
    expect(mine.filter((row) => row.result !== 'not_checked')).toHaveLength(1)
    expect(mine.find((row) => row.result !== 'not_checked')?.partialCheck).toBe(true)
    expect(
      mine
        .filter((row) => row.result === 'not_checked')
        .map((row) => row.live)
        .sort()
    ).toEqual(['checking', 'checking'])
    expect(questions.live).toMatchObject({ state: 'running', done: 1, total: 3 })

    // Summary: numbers from the answer so far, no "since" change while it runs.
    expect(overview.hasChecks).toBe(true)
    expect(overview.live).toMatchObject({ state: 'running', done: 1, total: 3 })
    expect(overview.kpis.withAio.value).toBe(1)
    expect(overview.kpis.withAio.delta).toBeNull()

    // At the end: a whole check, nothing live.
    const after = await handlers['topics:results']({
      ...base,
      topicId,
      marketId: null,
      runId: null
    })
    expect(after.live).toBeNull()
    expect(after.progress).toHaveLength(1)
    expect(after.rows.every((row) => (row.live ?? null) === null && row.runId !== null)).toBe(true)
    expect(changed.at(-1)).toMatchObject({ state: 'finished', promptId: null })
  })

  test('a check stopped part-way keeps the answers it saved, marked partial', async () => {
    const changed: ResultsChanged[] = []
    let cancel: (() => void) | null = null
    const { handlers } = await seed({
      progress: [],
      changed,
      // One question at a time, so Stop lands after exactly one (parallel-check.test.ts
      // covers Stop while several run).
      questionsAtOnce: 1,
      beforeRequest: async () => {
        if (changed.length === 1 && cancel !== null) {
          cancel()
          cancel = null
        }
      },
      http: fixtureHttp
    })
    const base = { projectId: 'proj-1' }
    const draft = await handlers['topics:createDraft']({ ...base, path: 'questions', name: 'Crew' })
    await handlers['topics:importQuestions']({
      ...base,
      draftId: draft.id,
      text: QUESTIONS.join('\n')
    })
    const started = await handlers['topics:start']({ ...base, draftId: draft.id, plan: 'all_now' })
    const jobId = started.jobId ?? ''
    cancel = () => {
      void handlers['checks:cancel']({ jobId })
    }
    const job = await waitForJob(handlers, jobId)
    expect(job?.status).toBe('cancelled')
    const topic = await handlers['topics:results']({
      ...base,
      topicId: started.topicId,
      marketId: null,
      runId: null
    })
    expect(topic.live).toMatchObject({ state: 'stopped', done: 1, total: 3 })
    expect(topic.live?.endedAt).not.toBeNull()
    expect(topic.rows.filter((row) => row.runId !== null)).toHaveLength(1)
    // Stopped: nothing is "checking" any more, and the check is a partial point only.
    expect(topic.rows.every((row) => (row.live ?? null) === null)).toBe(true)
    expect(topic.progress.map((point) => point.partial)).toEqual([true])
    expect(topic.questionsTrend.change).toBeNull()
    expect(changed.at(-1)).toMatchObject({ state: 'stopped', promptId: null })
  })

  test('celebrates only the own site: named-only is quiet, a competitor link is nothing', async () => {
    const changed: ResultsChanged[] = []
    const { handlers, projectDb } = await seed({ progress: [], changed, http: fixtureHttp })
    const start: StartCheckRequest = {
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    }
    const first = await handlers['checks:start'](start)
    const input = {
      jobId: first.id,
      pageId: 'page-1',
      marketId: changed[0]?.marketId ?? '',
      promptId: 'prompt-1',
      brand: 'TextBolt'
    }
    projectDb
      .prepare(
        "UPDATE serp_results SET status = 'brand_mentioned', named = 1, cited_url = NULL, position = NULL"
      )
      .run()
    expect(citationNews(projectDb, input)).toMatchObject({
      kind: 'named',
      position: null,
      engine: null,
      url: null
    })
    // Only competitors cited and the brand not named: nothing to celebrate.
    projectDb.prepare("UPDATE serp_results SET status = 'not_cited', named = 0").run()
    expect(citationNews(projectDb, input)).toBeNull()
  })

  test('names the engine with the best link for the celebration', async () => {
    const changed: ResultsChanged[] = []
    const { handlers, projectDb } = await seed({ progress: [], changed, http: fixtureHttp })
    const first = await handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    const input = {
      jobId: first.id,
      pageId: 'page-1',
      marketId: changed[0]?.marketId ?? '',
      promptId: 'prompt-1',
      brand: 'TextBolt'
    }
    const run = projectDb.prepare('SELECT id FROM runs WHERE job_id = ?').get(first.id) as {
      id: string
    }
    const answer = projectDb.prepare(
      `INSERT INTO engine_answers (id, run_id, prompt_id, sample_no, engine, status, cited_url, position, checked_at)
       VALUES (?, ?, 'prompt-1', 1, ?, 'cited', 'https://textbolt.com/', ?, '2026-10-29T00:00:00Z')`
    )
    answer.run('a1', run.id, 'perplexity', 3)
    // Google AI Overview links it as #2: it keeps the lead over a #3.
    expect(citationNews(projectDb, input)).toMatchObject({ position: 2, engine: 'google_aio' })
    answer.run('a2', run.id, 'chatgpt', 1)
    expect(citationNews(projectDb, input)).toMatchObject({
      position: 1,
      engine: 'chatgpt',
      url: 'https://textbolt.com/'
    })
    // Only an answer engine links it.
    projectDb.prepare("UPDATE serp_results SET status = 'not_cited', named = 0").run()
    expect(citationNews(projectDb, input)).toMatchObject({ kind: 'cited', engine: 'chatgpt' })
  })

  test('a citation is first-ever only when no earlier check cited the site', async () => {
    const changed: ResultsChanged[] = []
    const { handlers } = await seed({ progress: [], changed, http: fixtureHttp })
    const start: StartCheckRequest = {
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    }
    await handlers['checks:start'](start)
    await handlers['checks:start'](start)
    const cited = changed.filter((event) => event.citation?.kind === 'cited')
    expect(cited.map((event) => event.citation?.firstEver)).toEqual([true, false])
  })
})

async function waitForJob(
  handlers: Awaited<ReturnType<typeof seed>>['handlers'],
  jobId: string
): Promise<CheckJob | null> {
  let job = await handlers['checks:get']({ jobId })
  for (let attempt = 0; attempt < 400 && (job === null || job.status === 'running'); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    job = await handlers['checks:get']({ jobId })
  }
  return job
}
