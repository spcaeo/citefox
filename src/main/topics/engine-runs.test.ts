import { afterEach, describe, expect, test } from 'vitest'
import type { AnswerEngineId, EngineAnswerStatus } from '@shared/domain'
import { closeSeeds, envelope, seed } from '../engine/checks/checks.test-helper'
import { insertEngineAnswer, saveEngineSettings } from '../storage/engine-records'
import type { AnswerRunSample } from '../storage/engine-reads'
import { answerOutcome, checkStatusOfAnswer } from './engine-runs'

afterEach(closeSeeds)

/**
 * A topic's results on one answer engine (audit #4): `topics:results` with `engine`
 * scores that engine's stored answers by the same rule as Google's, so every view and
 * Progress re-count. Recorded SerpApi fixtures, no network, no Claude.
 */
const CITED = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business'
const BASE = { projectId: 'proj-1' }

function sample(status: EngineAnswerStatus, extra: Partial<AnswerRunSample> = {}): AnswerRunSample {
  return {
    runId: 'r1',
    promptId: 'p1',
    sampleNo: 1,
    status,
    named: false,
    checkedAt: '2026-10-20T12:00:00.000Z',
    sources: [],
    ...extra
  }
}

describe('answer outcomes', () => {
  test('each status in the words a topic row is scored in', () => {
    expect(checkStatusOfAnswer('cited')).toBe('other_own_page')
    expect(checkStatusOfAnswer('named')).toBe('brand_mentioned')
    expect(checkStatusOfAnswer('not_cited')).toBe('not_cited')
    expect(checkStatusOfAnswer('no_answer')).toBe('no_aio')
    expect(checkStatusOfAnswer('unavailable')).toBe('error')
    expect(checkStatusOfAnswer('error')).toBe('error')
  })

  test('the best sample wins; its sources are the references, each page once', () => {
    const own = {
      url: CITED,
      normalizedUrl: CITED,
      domain: 'textbolt.com',
      classification: 'own' as const
    }
    const outcome = answerOutcome(
      [
        sample('not_cited', { named: true }),
        sample('cited', { sampleNo: 2, sources: [{ ...own, position: 3 }] }),
        sample('cited', {
          sampleNo: 3,
          checkedAt: '2026-10-20T12:05:00.000Z',
          sources: [{ ...own, position: 1 }]
        })
      ],
      'r1'
    )
    expect(outcome).toMatchObject({
      status: 'other_own_page',
      named: true,
      runId: 'r1',
      checkedAt: '2026-10-20T12:05:00.000Z',
      references: [{ url: CITED, position: 1 }]
    })
    expect(answerOutcome([sample('no_answer')], 'r1')).toMatchObject({
      status: 'no_aio',
      named: null,
      references: []
    })
    expect(answerOutcome([], 'r1')).toBeNull()
  })
})

type Handlers = Awaited<ReturnType<typeof seed>>['handlers']

async function startTopic(handlers: Handlers): Promise<string> {
  const draft = await handlers['topics:createDraft']({ ...BASE, path: 'questions', name: 'Crew' })
  await handlers['topics:importQuestions']({
    ...BASE,
    draftId: draft.id,
    text: 'How do I send an urgent text to my whole field crew from Outlook?'
  })
  const started = await handlers['topics:start']({ ...BASE, draftId: draft.id, plan: 'all_now' })
  const jobId = started.jobId ?? ''
  let job = await handlers['checks:get']({ jobId })
  for (let attempt = 0; attempt < 200 && (job === null || job.status === 'running'); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    job = await handlers['checks:get']({ jobId })
  }
  expect(job?.status).toBe('finished')
  return started.topicId
}

describe('topics:results on one engine', () => {
  test('re-counts rows, goals and Progress from that engine’s answers', async () => {
    const { handlers, projectDb } = await seed({
      progress: [],
      http(request) {
        return new URL(request.url).searchParams.get('engine') === 'google_ai_overview'
          ? envelope('google-ai-overview.json')
          : envelope('google-page-token.json')
      }
    })
    const topicId = await startTopic(handlers)
    await handlers['topics:update']({ ...BASE, topicId, targetPage: CITED })
    const request = { ...BASE, topicId, marketId: null, runId: null }
    const google = await handlers['topics:results'](request)
    const row = google.rows[0]
    expect(row?.state).toBe('right_page')
    const runId = row?.runId ?? ''
    const promptId = row?.promptId ?? ''

    const answer = (engine: AnswerEngineId, status: EngineAnswerStatus, url: string | null): void =>
      insertEngineAnswer(projectDb, {
        id: `${engine}-1`,
        runId,
        promptId,
        sampleNo: 1,
        engine,
        keyId: null,
        status,
        citedUrl: url,
        position: url === null ? null : 2,
        named: false,
        answerText: 'An answer',
        answerMarkdown: null,
        errorCode: null,
        message: null,
        searches: 1,
        credits: 1,
        costMicros: 0,
        rawJson: null,
        checkedAt: '2026-10-29T12:00:00.000Z',
        sources:
          url === null
            ? []
            : [
                {
                  id: `${engine}-s1`,
                  position: 2,
                  url,
                  normalizedUrl: url,
                  domain: 'textbolt.com',
                  title: null,
                  classification: 'own'
                }
              ]
      })
    saveEngineSettings(
      projectDb,
      { engines: ['google_aio', 'chatgpt', 'perplexity'] },
      '2026-10-29T12:00:00.000Z'
    )
    // ChatGPT cites the target page; Perplexity cites another own page.
    answer('chatgpt', 'cited', `${CITED}/`)
    answer('perplexity', 'cited', 'https://textbolt.com/pricing')

    const chatgpt = await handlers['topics:results']({ ...request, engine: 'chatgpt' })
    expect(chatgpt.rows[0]?.state).toBe('right_page')
    expect(chatgpt.progress.map((point) => point.target)).toEqual([
      { cited: 1, withAio: 1, rate: 100 }
    ])
    const perplexity = await handlers['topics:results']({ ...request, engine: 'perplexity' })
    expect(perplexity.rows[0]?.state).toBe('other_page')
    expect(perplexity.progress[0]?.target).toEqual({ cited: 0, withAio: 1, rate: 0 })
    // An engine with no answers: not checked, no Progress point.
    const gemini = await handlers['topics:results']({ ...request, engine: 'gemini' })
    expect(gemini.rows[0]?.state).toBe('not_checked')
    expect(gemini.progress).toEqual([])
    // Google AI Overview is the default view.
    const named = await handlers['topics:results']({ ...request, engine: 'google_aio' })
    expect(named.rows[0]?.state).toBe('right_page')

    const summary = await handlers['engines:summary']({
      ...BASE,
      pageIds: [topicId],
      perQuestion: true
    })
    expect(summary.questions?.[0]?.ownUrls).toEqual({
      chatgpt: [`${CITED}/`],
      perplexity: ['https://textbolt.com/pricing']
    })
    await expect(
      handlers['topics:results']({ ...request, engine: 'bing' as never })
    ).rejects.toThrow()
  })
})
