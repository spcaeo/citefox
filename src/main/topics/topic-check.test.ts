import { afterEach, describe, expect, test } from 'vitest'
import type { CheckProgress } from '@shared/ipc'
import { closeSeeds, envelope, seed } from '../engine/checks/checks.test-helper'

afterEach(closeSeeds)

/**
 * A topic subject through the real check engine, queue-free path and stored
 * results: recorded SerpApi fixtures, no network, no Claude (reports skip a
 * topic). Checks, Prompt detail, Results, History and topics:results all
 * key on the topic's page id and must work with its null URL.
 */
describe('a topic runs through the check engine', () => {
  test('first check, results, prompt detail and history', async () => {
    const progress: CheckProgress[] = []
    const queries: string[] = []
    const { handlers } = await seed({
      progress,
      http(request) {
        const url = new URL(request.url)
        if (url.searchParams.get('engine') === 'google')
          queries.push(url.searchParams.get('q') ?? '')
        return url.searchParams.get('engine') === 'google_ai_overview'
          ? envelope('google-ai-overview.json')
          : envelope('google-page-token.json')
      }
    })
    const base = { projectId: 'proj-1' }
    const draft = await handlers['topics:createDraft']({
      ...base,
      path: 'questions',
      name: 'Crew alerts'
    })
    await handlers['topics:importQuestions']({
      ...base,
      draftId: draft.id,
      text: 'How do I send an urgent text to my whole field crew from Outlook?\nWhat is the cheapest way to text forty employees a schedule change?'
    })
    const started = await handlers['topics:start']({ ...base, draftId: draft.id, plan: 'all_now' })
    expect(started.jobId).not.toBeNull()
    const jobId = started.jobId ?? ''
    let job = await handlers['checks:get']({ jobId })
    for (
      let attempt = 0;
      attempt < 200 && (job === null || job.status === 'running');
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      job = await handlers['checks:get']({ jobId })
    }
    expect(job?.status).toBe('finished')
    expect(queries.sort()).toEqual([
      'How do I send an urgent text to my whole field crew from Outlook?',
      'What is the cheapest way to text forty employees a schedule change?'
    ])

    const results = await handlers['topics:results']({
      ...base,
      topicId: started.topicId,
      marketId: null,
      runId: null
    })
    expect(results.rows).toHaveLength(2)
    expect(results.rows.every((row) => row.state !== 'not_checked' && row.runId !== null)).toBe(
      true
    )
    expect(results.progress).toHaveLength(1)
    expect(results.goals.questions.checked).toBe(2)

    const pageResults = await handlers['results:get']({
      projectId: 'proj-1',
      pageId: started.topicId,
      marketId: null,
      runId: null
    })
    expect(pageResults.scope.pageUrl).toBe('')
    expect(pageResults.prompts).toHaveLength(2)
    const promptId = results.rows[0]?.promptId ?? ''
    const detail = await handlers['checks:getPrompt']({
      projectId: 'proj-1',
      pageId: started.topicId,
      promptId,
      marketId: 'mkt-us',
      runId: null
    })
    expect(detail.row?.promptId).toBe(promptId)
    expect(detail.samples.length).toBeGreaterThan(0)
    const history = await handlers['history:list']({
      projectId: 'proj-1',
      pageId: started.topicId,
      marketId: 'mkt-us'
    } as never)
    expect(history).toBeTruthy()
    const scores = await handlers['scores:listPages']({ projectId: 'proj-1' })
    expect(scores.pages.some((page) => page.pageId === started.topicId)).toBe(false)
  })

  test('a question longer than the 160-character label still starts', async () => {
    const { handlers } = await seed({
      progress: [],
      http(request) {
        const url = new URL(request.url)
        return url.searchParams.get('engine') === 'google_ai_overview'
          ? envelope('google-ai-overview.json')
          : envelope('google-page-token.json')
      }
    })
    const base = { projectId: 'proj-1' }
    const draft = await handlers['topics:createDraft']({ ...base, path: 'questions', name: 'Long' })
    // Character 160 is a space, so a plain cut leaves a trailing space the label check rejects.
    const long = `${'crew '.repeat(32)}alerts from Outlook when the plant alarm fires at night and nobody is in the office to answer?`
    expect(long[159]).toBe(' ')
    await handlers['topics:importQuestions']({ ...base, draftId: draft.id, text: long })
    const started = await handlers['topics:start']({ ...base, draftId: draft.id, plan: 'all_now' })
    expect(started.jobId).not.toBeNull()
  })
})
